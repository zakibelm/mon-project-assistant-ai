import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientFor, DEFAULT_MODEL, MissingKeyError, resolveAi } from "@/lib/ai/client";
import { getDb } from "@/lib/db/client";
import { recordAiTokens } from "@/lib/db/repo";
import { SecretError } from "@/lib/secrets";
import { canManageSettings, SettingsInput } from "@/lib/settings";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ key: SettingsInput.shape.key, model: SettingsInput.shape.model });

/**
 * Teste la connexion avec un vrai petit appel au modèle : la clé et le modèle saisis
 * (avant enregistrement), ou à défaut ceux déjà configurés.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Requête invalide." }, { status: 400 });
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  if (!(await canManageSettings(db, user.memberId))) return NextResponse.json({ ok: false, error: "Seul un chef de projet peut tester la connexion." }, { status: 403 });

  // Clé saisie (pas encore enregistrée) en priorité, sinon la configuration actuelle.
  let saved: Awaited<ReturnType<typeof resolveAi>> | null = null;
  try { saved = await resolveAi(db, orgId); }
  catch (e) {
    if (!(e instanceof MissingKeyError || e instanceof SecretError)) throw e;
    if (!parsed.data.key) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
  const client = parsed.data.key ? clientFor(parsed.data.key) : saved!.client;
  const model = parsed.data.model || saved?.model || DEFAULT_MODEL;

  const t0 = Date.now();
  try {
    const r = await client.messages.create({
      model, max_tokens: 300,
      messages: [{ role: "user", content: "Test de connexion. Réponds seulement : OK" }],
    });
    await recordAiTokens(db, orgId, {
      input: r.usage.input_tokens, output: r.usage.output_tokens,
      cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0,
    });
    const reply = r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
    return NextResponse.json({ ok: true, model, ms: Date.now() - t0, reply: reply.slice(0, 80) });
  } catch (e) {
    let error = "La connexion a échoué.";
    if (e instanceof Anthropic.AuthenticationError) error = "Clé refusée par OpenRouter : vérifiez qu'elle est complète et active.";
    else if (e instanceof Anthropic.PermissionDeniedError) error = "Cette clé n'a pas accès à ce modèle.";
    else if (e instanceof Anthropic.NotFoundError || (e instanceof Anthropic.BadRequestError && /model/i.test(e.message))) error = `Modèle introuvable sur OpenRouter : « ${model} ».`;
    else if (e instanceof Anthropic.RateLimitError) error = "Trop de demandes : réessayez dans un instant.";
    else if (e instanceof Anthropic.APIConnectionError) error = "Impossible de joindre OpenRouter depuis le serveur.";
    else if (e instanceof Anthropic.APIError) error = e.status === 402 ? "Crédits OpenRouter insuffisants : rechargez le compte." : `OpenRouter a renvoyé une erreur (${e.status ?? "inconnue"}).`;
    else console.error("[paramètres] test", e);
    return NextResponse.json({ ok: false, model, error }, { status: 200 });
  }
}
