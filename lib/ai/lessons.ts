/**
 * Leçons apprises : l'IA lit les notes d'explication validées par les chefs de projet
 * (pondérées par leur évaluation de 1 à 5) et en tire des leçons par type de problème,
 * avec la résolution qui a marché et une recommandation pour les prochains projets.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Ai } from "./client";
import { PROBLEM_LABEL, PROBLEM_TYPES } from "@/lib/board/types";
import type { LessonInput, ValidatedNote } from "@/lib/db/repo";
import { formatExtracts, searchKnowledge } from "@/lib/rag/index";

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_lessons",
  description: "Enregistre les leçons apprises. À appeler exactement une fois.",
  input_schema: {
    type: "object",
    properties: {
      lessons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            problem_type: { type: "string", enum: [...PROBLEM_TYPES] },
            title: { type: "string", description: "Leçon en une phrase courte" },
            problem: { type: "string", description: "Le problème type, généralisé à partir des notes" },
            resolution: { type: "string", description: "Ce qui a permis de le résoudre" },
            recommendation: { type: "string", description: "Ce qu'il faut faire dès le cadrage des prochains projets pour l'éviter" },
            source_task_ids: { type: "array", items: { type: "string" }, description: "Identifiants des notes sur lesquelles la leçon s'appuie" },
          },
          required: ["problem_type", "title", "problem", "resolution", "recommendation", "source_task_ids"],
        },
      },
    },
    required: ["lessons"],
  },
};

const Out = z.object({
  lessons: z.array(z.object({
    problem_type: z.enum(PROBLEM_TYPES), title: z.string().min(1), problem: z.string().min(1),
    resolution: z.string().default(""), recommendation: z.string().min(1), source_task_ids: z.array(z.string()).min(1),
  })).max(20),
});

const SYSTEM = `Tu es l'analyste d'un bureau de projets (PMO) francophone. On te donne des notes d'explication de retards, écrites par les responsables des tâches, évaluées de 1 à 5, puis validées par le chef de projet.

L'évaluation mesure la fiabilité et l'utilité de l'explication : 5 = cause réelle, bien comprise, leçon importante ; 1 = explication peu crédible ou peu utile. Pondère en conséquence : une leçon doit s'appuyer surtout sur des notes évaluées 4 ou 5 ; une note évaluée 1 ou 2 ne peut justifier une leçon que si d'autres notes la confirment.

Des extraits de la base de connaissances métier du PMO (rag-metier/) peuvent accompagner les notes : appuie-toi dessus pour formuler les recommandations, mais ne les présente pas comme des faits observés dans les projets.

Regroupe les notes par type de problème et produis des leçons utiles pour les prochains projets : le problème généralisé, la résolution qui a marché, et une recommandation concrète à appliquer dès le cadrage. N'invente rien qui ne soit pas dans les notes. Cite les identifiants des notes sources. Écris en français, de façon courte et concrète. Appelle record_lessons une seule fois.`;

export class LessonsError extends Error {}

/** Extraits de la base de connaissances liés aux problèmes rencontrés. */
function knowledgeFor(notes: ValidatedNote[]) {
  const q = "leçons apprises " + notes.map((n) => `${PROBLEM_LABEL[n.problemType]} ${n.problem}`).join(" ").slice(0, 1500);
  const hits = searchKnowledge(q, 4);
  return hits.length ? `\n\nConnaissances métier du PMO (extraits) :\n${formatExtracts(hits)}` : "";
}

export async function synthesizeLessons(ai: Ai, notes: ValidatedNote[]): Promise<{ lessons: LessonInput[]; usage: { input: number; output: number; cacheRead: number; cacheWrite: number } }> {
  if (!notes.length) throw new LessonsError("Aucune note validée pour l'instant : le chef de projet doit d'abord cocher « Validé » sur des notes évaluées.");
  const payload = notes.map((n) => ({
    id: n.taskId, projet: n.projectName, tache: n.task, type: PROBLEM_LABEL[n.problemType], evaluation: n.rating,
    probleme: n.problem, resolution: n.resolution || "(non précisée)", date_prevue: n.baselineDue, echeance: n.due,
  }));
  const response = await ai.client.messages.create({
    model: ai.model,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [RECORD_TOOL],
    messages: [{ role: "user", content: `Notes validées (${notes.length}) :\n${JSON.stringify(payload)}` + knowledgeFor(notes) }],
  });
  const usage = {
    input: response.usage.input_tokens, output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0, cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") throw new LessonsError("L'assistant n'a pas pu analyser ces notes.");
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "record_lessons");
  const parsed = call ? Out.safeParse(call.input) : null;
  if (!parsed?.success) throw new LessonsError("L'assistant n'a pas produit de leçons exploitables. Réessayez.");

  // Le poids d'une leçon est calculé ici, à partir des évaluations réelles de ses sources (on ne fait pas confiance au modèle pour ça).
  const ratingOf = new Map(notes.map((n) => [n.taskId, n.rating]));
  const lessons = parsed.data.lessons.map((l) => {
    const sources = l.source_task_ids.filter((id) => ratingOf.has(id));
    const weight = sources.length ? sources.reduce((a, id) => a + ratingOf.get(id)!, 0) / sources.length : 0;
    return { problemType: l.problem_type, title: l.title, problem: l.problem, resolution: l.resolution, recommendation: l.recommendation,
      weight: Math.round(weight * 10) / 10, sourceTaskIds: sources };
  }).filter((l) => l.sourceTaskIds.length > 0);
  return { lessons, usage };
}
