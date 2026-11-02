import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MissingKeyError } from "@/lib/ai/client";
import { LessonsError, synthesizeLessons } from "@/lib/ai/lessons";
import { getDb } from "@/lib/db/client";
import { countAiRequest, listLessons, listValidatedNotes, problemStats, recordAiTokens, saveLessons } from "@/lib/db/repo";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Notes validées, statistiques par type de problème (sans IA) et dernières leçons, pour un projet ou tous. */
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") || null;
  const db = await getDb();
  const { orgId } = await currentSession(db);
  const notes = await listValidatedNotes(db, orgId, projectId ?? undefined);
  return NextResponse.json({ notes, stats: problemStats(notes), lessons: await listLessons(db, orgId, projectId) });
}

const Body = z.object({ projectId: z.string().min(1).nullable().default(null) });

/** Lance la synthèse par l'IA des notes validées et remplace les leçons de cette portée. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { projectId } = parsed.data;
  const db = await getDb();
  const { orgId } = await currentSession(db);
  const notes = await listValidatedNotes(db, orgId, projectId ?? undefined);
  const quota = await countAiRequest(db, orgId, Number(process.env.AI_DAILY_LIMIT || 200));
  if (!quota.ok) return NextResponse.json({ error: `Limite quotidienne atteinte (${quota.limit} demandes).` }, { status: 429 });
  try {
    const { lessons, usage } = await synthesizeLessons(notes);
    await recordAiTokens(db, orgId, usage);
    await saveLessons(db, orgId, projectId, lessons);
    return NextResponse.json({ notes, stats: problemStats(notes), lessons: await listLessons(db, orgId, projectId) });
  } catch (e) {
    if (e instanceof LessonsError) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof MissingKeyError) return NextResponse.json({ error: e.message }, { status: 500 });
    if (e instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: "Clé OpenRouter refusée : vérifiez OPENROUTER_API_KEY." }, { status: 502 });
    if (e instanceof Anthropic.APIError) {
      console.error("[leçons] erreur API", e.status, e.message);
      return NextResponse.json({ error: e.status === 402 ? "Crédits OpenRouter insuffisants." : `Le modèle a renvoyé une erreur (${e.status ?? "inconnue"}).` }, { status: 502 });
    }
    throw e;
  }
}
