/**
 * Cadrage : à partir d'un texte libre (brief, courriel, notes), l'assistant produit
 * le contexte du projet et un plan. Le résultat est un brouillon que le chef de
 * projet relit et corrige avant de créer le projet.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getClient, MODEL } from "./client";
import { PRIORITIES } from "@/lib/board/types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = date.nullish().transform((v) => v ?? null);

export const ProjectDraft = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  start_date: optDate,
  end_date: optDate,
  deliverables: z.array(z.object({ name: z.string().trim().min(1), due: optDate })).max(20).default([]),
  stakeholders: z.array(z.object({ name: z.string().trim().min(1), role: z.string().trim().default("") })).max(20).default([]),
  team: z.array(z.object({ name: z.string().trim().min(1).max(60), role: z.string().trim().max(60).default("membre") })).min(1).max(30),
  groups: z.array(z.object({
    name: z.string().trim().min(1),
    tasks: z.array(z.object({
      name: z.string().trim().min(1),
      owner: z.string().nullish().transform((v) => v ?? null),
      due: optDate,
      priority: z.enum(PRIORITIES).default("Moyenne"),
      subtasks: z.array(z.string().trim().min(1)).max(12).default([]),
    })).max(40),
  })).min(1).max(12),
  /** Ce que l'assistant n'a pas pu déduire et qu'il faut préciser. */
  questions: z.array(z.string()).max(8).default([]),
});
export type ProjectDraft = z.infer<typeof ProjectDraft>;

const nullableDate = { type: ["string", "null"], description: "AAAA-MM-JJ, ou null si inconnue" };

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_project",
  description: "Renvoie le contexte du projet et le plan proposé. À appeler exactement une fois.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nom court du projet" },
      description: { type: "string", description: "Objectif et périmètre en 2 ou 3 phrases" },
      start_date: nullableDate,
      end_date: nullableDate,
      deliverables: { type: "array", items: { type: "object", properties: { name: { type: "string" }, due: nullableDate }, required: ["name", "due"] } },
      stakeholders: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] } },
      team: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] } },
      groups: {
        type: "array",
        description: "Phases du projet, dans l'ordre",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  owner: { type: ["string", "null"], description: "Nom exact d'un membre de team" },
                  due: nullableDate,
                  priority: { type: "string", enum: [...PRIORITIES] },
                  subtasks: { type: "array", items: { type: "string" } },
                },
                required: ["name", "owner", "due", "priority"],
              },
            },
          },
          required: ["name", "tasks"],
        },
      },
      questions: { type: "array", items: { type: "string" }, description: "Informations manquantes à préciser (0 à 5)" },
    },
    required: ["name", "description", "start_date", "end_date", "deliverables", "stakeholders", "team", "groups", "questions"],
  },
};

const SYSTEM = `Tu es l'assistant de cadrage d'un bureau de projets (PMO) francophone.
On te donne un texte libre décrivant un projet (brief, courriel, notes de réunion). Tu en tires le contexte du projet et un plan réaliste, puis tu appelles l'outil propose_project une seule fois.

Règles :
- N'invente pas de faits. Si une information manque (date de fin, budget, équipe…), fais une hypothèse prudente et ajoute une question dans « questions ».
- Équipe : reprends les personnes citées. Si l'une d'elles correspond à un membre existant du PMO (liste fournie), utilise exactement son nom. Si le texte ne nomme personne, crée des membres anonymes « Membre 1 », « Membre 2 »… avec un rôle.
- Plan : 2 à 6 phases, 3 à 8 tâches par phase, chaque tâche assignée à un membre de l'équipe, avec une échéance entre le début et la fin du projet. Répartis la charge. Mets les tâches qui conditionnent les autres en premier et en priorité Haute.
- Livrables : ceux que le texte cite, sinon ceux qui découlent clairement de l'objectif.
- Écris en français, avec des noms de tâches courts commençant par un verbe.`;

export class DraftError extends Error {}

export async function draftProject(text: string, existingMembers: string[], today = new Date().toISOString().slice(0, 10)) {
  const response = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [PROPOSE_TOOL],
    messages: [{
      role: "user",
      content: `Date du jour : ${today}.\nMembres existants du PMO : ${existingMembers.join(", ") || "aucun"}.\n\nTexte du projet :\n"""\n${text}\n"""`,
    }],
  });
  const usage = {
    input: response.usage.input_tokens, output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0, cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") throw new DraftError("L'assistant n'a pas pu traiter ce texte. Reformulez-le ou remplissez le projet vous-même.");
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_project");
  if (!call) throw new DraftError("L'assistant n'a pas produit de plan. Ajoutez des détails sur l'objectif, les dates et l'équipe, puis réessayez.");
  const parsed = ProjectDraft.safeParse(call.input);
  if (!parsed.success) throw new DraftError("Le plan proposé était incomplet. Réessayez, ou remplissez le projet vous-même.");
  return { draft: normalize(parsed.data), usage };
}

/** Rend le brouillon cohérent : responsables inconnus retirés, dates hors période gardées mais signalées par le chef de projet. */
export function normalize(d: ProjectDraft): ProjectDraft {
  const names = new Set(d.team.map((m) => m.name));
  return { ...d, groups: d.groups.map((g) => ({ ...g, tasks: g.tasks.map((t) => ({ ...t, owner: t.owner && names.has(t.owner) ? t.owner : null })) })) };
}
