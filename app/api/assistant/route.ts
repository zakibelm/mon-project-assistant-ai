import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runAssistant } from "@/lib/ai/assistant";
import { MissingKeyError } from "@/lib/ai/client";
import { checkAndCount, getUsage, recordTokens } from "@/lib/ai/quota";
import { getBoard } from "@/lib/board/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  boardId: z.string().default("board_site"),
  message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) })).max(40).default([]),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { boardId, message, history } = parsed.data;

  const board = getBoard(boardId);
  if (!board) return NextResponse.json({ error: "Board introuvable." }, { status: 404 });

  // TODO auth : l'utilisateur viendra de la session. En attendant, premier membre.
  const user = board.members[0];

  const quota = checkAndCount(board.workspaceId);
  if (!quota.ok) {
    return NextResponse.json({ error: `Limite quotidienne atteinte (${quota.limit} demandes). Elle se réinitialise demain.` }, { status: 429 });
  }

  try {
    const result = await runAssistant(board, user, history, message);
    recordTokens(board.workspaceId, result.usage);
    console.info("[assistant]", JSON.stringify({ workspace: board.workspaceId, ...result.usage, actions: result.actions.length }));
    return NextResponse.json({ ...result, board, usage: getUsage(board.workspaceId) });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof MissingKeyError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Clé OpenRouter refusée : vérifiez OPENROUTER_API_KEY.";
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
  if (e instanceof MissingKeyError) return 500;
  if (e instanceof Anthropic.RateLimitError) return 429;
  if (e instanceof Anthropic.APIError) return 502;
  return 500;
}
