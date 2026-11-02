import Anthropic from "@anthropic-ai/sdk";
import type { Ai } from "./client";
import { boardSnapshot, runTool, TOOLS } from "./tools";
import type { Db } from "@/lib/db/client";
import type { Actor } from "@/lib/db/repo";
import { Board } from "@/lib/board/types";

/*
 * Prompt système figé : aucune donnée variable ici (date, état du board…), sinon le
 * cache de prompt est invalidé à chaque demande. Les données variables vont dans le
 * message utilisateur.
 */
const SYSTEM = `Tu es l'assistant de « Assistant Projet », une application de gestion de projet pour des équipes francophones.
Tu aides l'utilisateur à planifier, suivre et mettre à jour son board en utilisant les outils fournis.

Fonctionnement :
- Le contexte du projet (description, livrables, parties prenantes, équipe) et l'état actuel du board sont fournis en JSON au début de chaque message de l'utilisateur. « baseline_due » est la date du plan de référence quand elle diffère de l'échéance actuelle : l'écart mesure le glissement. Utilise les identifiants (id) qu'il contient ; n'en invente jamais.
- Quand l'utilisateur demande une action (créer, modifier, assigner, déplacer, commenter, automatiser), fais-la avec les outils, puis confirme brièvement ce qui a été fait.
- Pour planifier un projet : crée d'abord un groupe, puis toutes les tâches en un seul appel create_items, avec responsables, échéances réalistes à partir de la date du jour et sous-tâches utiles. Répartis la charge entre les membres.
- Si une demande est ambiguë au point de risquer une mauvaise modification (ex. plusieurs tâches correspondent), pose une question courte au lieu d'agir.
- Ne supprime une tâche que si l'utilisateur le demande explicitement.
- Pour une question (résumé, blocages, charge, priorités), réponds à partir de l'état du board sans appeler d'outil.
- Si un outil renvoie une erreur, corrige l'appel si possible, sinon explique le problème simplement.
- Pour une question de méthode ou de règle (retards, blocages, escalade, planification, estimation, rapports, leçons apprises), consulte d'abord la base de connaissances du PMO avec search_knowledge. Applique ses règles quand elles s'appliquent et cite la source entre parenthèses, ex. (rag/methodes/gestion-des-retards.md). Si la base ne dit rien, réponds avec ton expertise en le précisant.

Style : français, ton direct et concret, réponses courtes. Dates au format JJ/MM. Pas de jargon technique (ne mentionne pas les identifiants internes ni les outils).`;

const MAX_STEPS = 8;

export interface ChatTurn { role: "user" | "assistant"; text: string }
export interface AssistantResult {
  reply: string;
  actions: string[];
  changed: boolean;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export async function runAssistant(
  db: Db, board: Board, user: { name: string; memberId: string | null }, history: ChatTurn[], message: string, ai: Ai,
): Promise<AssistantResult> {
  // Les écritures de l'assistant sont journalisées comme « assistant, pour le compte de l'utilisateur ».
  const actor: Actor = { memberId: user.memberId, kind: "assistant" };
  const client = ai.client;
  const today = new Date().toISOString().slice(0, 10);

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((t) => ({ role: t.role, content: t.text }) as Anthropic.MessageParam),
    {
      role: "user",
      content: [
        { type: "text", text: `Date du jour : ${today}. Utilisateur : ${user.name}.\nProjet et board :\n${JSON.stringify(boardSnapshot(board))}` },
        { type: "text", text: message },
      ],
    },
  ];
  // L'historique doit commencer par un message utilisateur.
  while (messages.length && messages[0].role !== "user") messages.shift();

  const actions: string[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: ai.model,
      max_tokens: 16000,
      // Point de cache sur le système : couvre les outils + le système (ordre tools → system → messages).
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text).join("\n").trim();

    switch (response.stop_reason) {
      case "end_turn":
      case "stop_sequence":
        return { reply: text || "C'est fait.", actions, changed: actions.length > 0, usage };
      case "refusal":
        // Un filtre de sécurité a refusé la demande : on n'exécute aucun outil de ce tour.
        return { reply: "Je ne peux pas traiter cette demande. Pouvez-vous la reformuler ?", actions, changed: actions.length > 0, usage };
      case "max_tokens":
        return { reply: text || "La réponse était trop longue et a été coupée. Essayez une demande plus ciblée.", actions, changed: actions.length > 0, usage };
      case "pause_turn":
        messages.push({ role: "assistant", content: response.content });
        continue;
      case "tool_use": {
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const out = await runTool(db, board.projectId, actor, block.name, block.input);
          if (!out.isError && out.summary) actions.push(out.summary);
          results.push({ type: "tool_result", tool_use_id: block.id, content: out.content, is_error: out.isError || undefined });
        }
        // Tous les résultats dans un seul message utilisateur.
        messages.push({ role: "user", content: results });
        continue;
      }
      default:
        return { reply: text || "Je n'ai pas pu terminer.", actions, changed: actions.length > 0, usage };
    }
  }
  return { reply: "J'ai fait plusieurs actions mais je me suis arrêté avant la fin. Vérifiez le board et redemandez si besoin.", actions, changed: actions.length > 0, usage };
}
