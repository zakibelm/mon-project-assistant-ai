import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MissingKeyError, resolveAi } from "@/lib/ai/client";
import { SecretError } from "@/lib/secrets";
import { draftProject, DraftError } from "@/lib/ai/draft";
import { getDb } from "@/lib/db/client";
import { countAiRequest, recordAiTokens } from "@/lib/db/repo";
import { members } from "@/lib/db/schema";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ text: z.string().trim().min(20, "Décrivez le projet en quelques phrases au moins.").max(20000) });

/** Cadrage : transforme un texte libre en brouillon de projet (contexte + plan), sans rien enregistrer. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Requête invalide." }, { status: 400 });

  const db = await getDb();
  const { orgId } = await currentSession(db);
  let ai;
  try { ai = await resolveAi(db, orgId); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: e instanceof MissingKeyError ? 400 : 500 }); }
  const quota = await countAiRequest(db, orgId, ai.dailyLimit);
  if (!quota.ok) return NextResponse.json({ error: `Limite quotidienne atteinte (${quota.limit} demandes).` }, { status: 429 });

  try {
    const known = await db.select({ name: members.displayName }).from(members).where(eq(members.orgId, orgId));
    const { draft, usage } = await draftProject(ai, parsed.data.text, known.map((m) => m.name));
    await recordAiTokens(db, orgId, usage);
    return NextResponse.json({ draft });
  } catch (e) {
    if (e instanceof DraftError) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof MissingKeyError || e instanceof SecretError) return NextResponse.json({ error: e.message }, { status: 500 });
    if (e instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: "Clé OpenRouter refusée : vérifiez-la dans Paramètres." }, { status: 502 });
    if (e instanceof Anthropic.APIError) {
      console.error("[cadrage] erreur API", e.status, e.message);
      return NextResponse.json({ error: e.status === 402 ? "Crédits OpenRouter insuffisants." : `Le modèle a renvoyé une erreur (${e.status ?? "inconnue"}).` }, { status: 502 });
    }
    console.error("[cadrage] erreur", e);
    return NextResponse.json({ error: "Erreur interne du cadrage." }, { status: 500 });
  }
}
