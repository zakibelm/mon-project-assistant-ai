import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runAssistant } from "@/lib/ai/assistant";
import { MissingKeyError, resolveAi } from "@/lib/ai/client";
import { SecretError } from "@/lib/secrets";
import { getDb } from "@/lib/db/client";
import { countAiRequest, getAiUsage, getBoard, recordAiTokens } from "@/lib/db/repo";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  projectId: z.string().min(1),
  message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) })).max(40).default([]),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { projectId, message, history } = parsed.data;

  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const board = await getBoard(db, projectId);
  if (!board || board.orgId !== orgId) return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });

  let ai;
  try { ai = await resolveAi(db, orgId); } catch (e) { return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }); }
  const quota = await countAiRequest(db, orgId, ai.dailyLimit);
  if (!quota.ok) {
    return NextResponse.json({ error: `Limite quotidienne atteinte (${quota.limit} demandes). Elle se réinitialise demain.` }, { status: 429 });
  }

  try {
    const result = await runAssistant(db, board, user, history, message, ai);
    await recordAiTokens(db, orgId, result.usage);
    console.info("[assistant]", JSON.stringify({ org: orgId, project: projectId, ...result.usage, actions: result.actions.length }));
    return NextResponse.json({ ...result, board: await getBoard(db, projectId), usage: await getAiUsage(db, orgId) });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof MissingKeyError || e instanceof SecretError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Clé OpenRouter refusée : vérifiez-la dans Paramètres.";
  if (e instanceof Anthropic.RateLimitError) return "Trop de demandes vers le modèle. Réessayez dans un instant.";
  if (e instanceof Anthropic.APIConnectionError) return "Impossible de joindre OpenRouter. Vérifiez la connexion.";
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402) return "Crédits OpenRouter insuffisants : rechargez le compte OpenRouter.";
    console.error("[assistant] erreur API", e.status, e.message);
    return `Le modèle a renvoyé une erreur (${e.status ?? "inconnue"}).`;
  }
  console.error("[assistant] erreur", e);
  return "Erreur interne de l'assistant.";
}
function errorStatus(e: unknown): number {
  if (e instanceof MissingKeyError) return 400;
  if (e instanceof SecretError) return 500;
  if (e instanceof Anthropic.RateLimitError) return 429;
  if (e instanceof Anthropic.APIError) return 502;
  return 500;
}
