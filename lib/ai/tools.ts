import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import {
  Actor, addComment, BoardError, createAutomation, createGroup, createTasks, deleteTask, updateTask,
} from "@/lib/db/repo";
import { Board, PRIORITIES, STATUSES, STATUS_LABEL } from "@/lib/board/types";
import { formatExtracts, searchKnowledge } from "@/lib/rag/index";

/* Schémas de validation (les entrées du modèle sont validées avant exécution). */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date attendue au format AAAA-MM-JJ");
const schemas = {
  create_group: z.object({ name: z.string().min(1) }),
  create_items: z.object({
    items: z.array(z.object({
      name: z.string().min(1),
      group_id: z.string(),
      owner: z.string().nullish(),
      due: date.nullish(),
      priority: z.enum(PRIORITIES).optional(),
      subtasks: z.array(z.string()).optional(),
    })).min(1).max(30),
  }),
  update_item: z.object({
    item_id: z.string(),
    name: z.string().min(1).optional(),
    status: z.enum(STATUSES).optional(),
    owner: z.string().nullish(),
    due: date.nullish(),
    priority: z.enum(PRIORITIES).optional(),
    group_id: z.string().optional(),
  }),
  delete_item: z.object({ item_id: z.string() }),
  add_comment: z.object({ item_id: z.string(), text: z.string().min(1) }),
  create_automation: z.object({ on_status: z.enum(STATUSES), notify: z.string() }),
  search_knowledge: z.object({ query: z.string().trim().min(2).max(300) }),
};
export type ToolName = keyof typeof schemas;

/* Définitions envoyées au modèle. L'ordre est fixe pour que le cache de prompt reste valide. */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge",
    description: "Cherche dans la base de connaissances métier du PMO (méthodes, règles, glossaire : dossier rag/). À utiliser pour toute question de méthode ou de règle (retards, blocages, escalade, planification, estimation, rapports, leçons apprises). Renvoie des extraits avec leur fichier source.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "La question ou les mots-clés, en français" } }, required: ["query"] },
  },
  {
    name: "create_group",
    description: "Crée un nouveau groupe (section) dans le board. Renvoie l'identifiant du groupe, à utiliser ensuite dans create_items.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Nom du groupe, ex. « Phase 1 : préparation »" } }, required: ["name"] },
  },
  {
    name: "create_items",
    description: "Crée une ou plusieurs tâches d'un coup (30 max). Utilisez-le pour planifier un projet entier en un seul appel. Les nouvelles tâches ont le statut « À faire ».",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              group_id: { type: "string", description: "Identifiant d'un groupe existant" },
              owner: { type: ["string", "null"], description: "Prénom d'un membre du projet, ou null" },
              due: { type: ["string", "null"], description: "Échéance AAAA-MM-JJ, ou null" },
              priority: { type: "string", enum: [...PRIORITIES] },
              subtasks: { type: "array", items: { type: "string" } },
            },
            required: ["name", "group_id"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "update_item",
    description: `Modifie une tâche existante. Ne fournir que les champs à changer. Statuts : ${STATUSES.map((s) => `${s} (${STATUS_LABEL[s]})`).join(", ")}. Passer un statut peut déclencher des automatisations.`,
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: [...STATUSES] },
        owner: { type: ["string", "null"] },
        due: { type: ["string", "null"], description: "AAAA-MM-JJ" },
        priority: { type: "string", enum: [...PRIORITIES] },
        group_id: { type: "string", description: "Pour déplacer la tâche dans un autre groupe" },
      },
      required: ["item_id"],
    },
  },
  {
    name: "delete_item",
    description: "Supprime définitivement une tâche. À n'utiliser que si l'utilisateur le demande explicitement.",
    input_schema: { type: "object", properties: { item_id: { type: "string" } }, required: ["item_id"] },
  },
  {
    name: "add_comment",
    description: "Ajoute un message dans le fil de discussion d'une tâche, au nom de l'utilisateur courant. @Prénom notifie le membre mentionné.",
    input_schema: { type: "object", properties: { item_id: { type: "string" }, text: { type: "string" } }, required: ["item_id", "text"] },
  },
  {
    name: "create_automation",
    description: "Crée une règle : quand une tâche passe au statut donné, prévenir un membre.",
    input_schema: {
      type: "object",
      properties: { on_status: { type: "string", enum: [...STATUSES] }, notify: { type: "string", description: "Prénom du membre à prévenir" } },
      required: ["on_status", "notify"],
    },
  },
];

export interface ToolOutcome { content: string; isError: boolean; summary?: string }

/** Exécute un appel d'outil du modèle sur le projet, après validation. Chaque écriture est journalisée. */
export async function runTool(db: Db, projectId: string, actor: Actor, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!(name in schemas)) return { content: `Outil inconnu : ${name}`, isError: true };
  const parsed = schemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Entrée invalide : ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, isError: true };
  }
  try {
    switch (name as ToolName) {
      case "create_group": {
        const g = await createGroup(db, projectId, (parsed.data as z.infer<typeof schemas.create_group>).name);
        return { content: JSON.stringify(g), isError: false, summary: `Groupe créé : ${g.name}` };
      }
      case "create_items": {
        const d = parsed.data as z.infer<typeof schemas.create_items>;
        const created = await createTasks(db, projectId, actor, d.items.map((i) => ({
          name: i.name, groupId: i.group_id, owner: i.owner, due: i.due, priority: i.priority, subtasks: i.subtasks,
        })));
        return { content: JSON.stringify(created), isError: false, summary: `${created.length} tâche(s) créée(s)` };
      }
      case "update_item": {
        const d = parsed.data as z.infer<typeof schemas.update_item>;
        const r = await updateTask(db, projectId, actor, d.item_id, {
          name: d.name, status: d.status, owner: d.owner, due: d.due, priority: d.priority, groupId: d.group_id,
        });
        return r.changed
          ? { content: JSON.stringify(r), isError: false, summary: `Tâche modifiée : ${r.name}` }
          : { content: "Aucun changement : la tâche avait déjà ces valeurs.", isError: false };
      }
      case "delete_item": {
        const r = await deleteTask(db, projectId, actor, (parsed.data as z.infer<typeof schemas.delete_item>).item_id);
        return { content: `Supprimée : ${r.name}`, isError: false, summary: `Tâche supprimée : ${r.name}` };
      }
      case "add_comment": {
        const d = parsed.data as z.infer<typeof schemas.add_comment>;
        await addComment(db, projectId, actor, d.item_id, d.text);
        return { content: "Commentaire ajouté.", isError: false, summary: "Commentaire ajouté" };
      }
      case "search_knowledge": {
        const hits = searchKnowledge((parsed.data as z.infer<typeof schemas.search_knowledge>).query, 4);
        return hits.length
          ? { content: formatExtracts(hits), isError: false }
          : { content: "Aucun extrait pertinent dans la base de connaissances.", isError: false };
      }
      case "create_automation": {
        const d = parsed.data as z.infer<typeof schemas.create_automation>;
        const a = await createAutomation(db, projectId, d.on_status, d.notify);
        return { content: JSON.stringify(a), isError: false, summary: `Automatisation : ${STATUS_LABEL[a.onStatus]} → prévenir ${a.notify}` };
      }
    }
  } catch (e) {
    if (e instanceof BoardError) return { content: e.message, isError: true };
    throw e;
  }
  return { content: "Non géré", isError: true };
}

/** Vue compacte du board envoyée au modèle à chaque demande. */
export function boardSnapshot(board: Board) {
  return {
    project: board.name,
    description: board.description,
    period: { start: board.startDate, end: board.endDate },
    deliverables: board.deliverables,
    stakeholders: board.stakeholders,
    members: board.members,
    groups: board.groups.map((g) => ({ id: g.id, name: g.name })),
    items: board.items.map((i) => ({
      id: i.id, group_id: i.groupId, name: i.name, status: i.status, owner: i.owner, due: i.due,
      baseline_due: i.baselineDue !== i.due ? i.baselineDue : undefined, priority: i.priority,
      subtasks: i.subtasks.length ? `${i.subtasks.filter((s) => s.done).length}/${i.subtasks.length}` : undefined,
      last_comment: i.comments.at(-1) ? `${i.comments.at(-1)!.author} : ${i.comments.at(-1)!.text}` : undefined,
    })),
    automations: board.automations.map((a) => `${a.onStatus} → ${a.notify}`),
  };
}
