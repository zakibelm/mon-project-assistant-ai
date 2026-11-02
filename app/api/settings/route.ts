import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getAiUsage } from "@/lib/db/repo";
import { SecretError } from "@/lib/secrets";
import { canManageSettings, saveSettings, SettingsInput, settingsView } from "@/lib/settings";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Paramètres de l'IA de l'organisation. La clé n'est jamais renvoyée, seulement ses 4 derniers caractères. */
export async function GET() {
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  return NextResponse.json({
    settings: await settingsView(db, orgId),
    canEdit: await canManageSettings(db, user.memberId),
    usage: await getAiUsage(db, orgId),
  });
}

export async function PUT(req: Request) {
  const parsed = SettingsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Paramètres invalides." }, { status: 400 });
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  if (!(await canManageSettings(db, user.memberId))) return NextResponse.json({ error: "Seul un chef de projet peut modifier les paramètres de l'IA." }, { status: 403 });
  try {
    await saveSettings(db, orgId, user.memberId, parsed.data);
  } catch (e) {
    if (e instanceof SecretError) return NextResponse.json({ error: e.message }, { status: 500 });
    throw e;
  }
  return NextResponse.json({ settings: await settingsView(db, orgId) });
}
