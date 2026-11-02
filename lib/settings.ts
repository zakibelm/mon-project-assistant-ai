import { eq } from "drizzle-orm";
import { z } from "zod";
import { AI_MODELS, DEFAULT_DAILY_LIMIT, DEFAULT_MODEL, readSettings } from "@/lib/ai/client";
import type { Db } from "@/lib/db/client";
import { isManagerRole } from "@/lib/db/repo";
import { members, orgSettings, projectMembers } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/secrets";

/** Format d'un identifiant de modèle OpenRouter, ex. « anthropic/claude-opus-5.5 ». */
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export const SettingsInput = z.object({
  /** undefined = garder la clé actuelle ; null = la supprimer ; chaîne = la remplacer. */
  key: z.string().trim().nullable().optional()
    .refine((k) => k == null || (/^sk-or-/.test(k) && k.length >= 20 && k.length <= 200 && !/\s/.test(k)),
      "Une clé OpenRouter commence par « sk-or- » (à créer sur openrouter.ai/keys)."),
  model: z.string().trim().regex(MODEL_ID, "Identifiant de modèle invalide (ex. anthropic/claude-opus-5.5).").optional(),
  dailyLimit: z.number().int().min(1, "La limite doit être d'au moins 1 demande.").max(10000, "La limite ne peut pas dépasser 10 000 demandes.").optional(),
});

/** Vue des paramètres renvoyée au navigateur : jamais la clé elle-même, seulement ses 4 derniers caractères. */
export async function settingsView(db: Db, orgId: string) {
  const row = await readSettings(db, orgId);
  const envKey = process.env.OPENROUTER_API_KEY;
  const keySource = row?.openrouterKeyEnc ? "settings" : envKey ? "env" : null;
  let updatedBy: string | null = null;
  if (row?.updatedById) {
    const [m] = await db.select({ name: members.displayName }).from(members).where(eq(members.id, row.updatedById));
    updatedBy = m?.name ?? null;
  }
  return {
    keySource,
    keyLast4: row?.openrouterKeyEnc ? row.openrouterKeyLast4 : envKey ? envKey.slice(-4) : null,
    model: row?.aiModel || process.env.AI_MODEL || DEFAULT_MODEL,
    modelSource: row?.aiModel ? "settings" : process.env.AI_MODEL ? "env" : "default",
    dailyLimit: row?.aiDailyLimit ?? Number(process.env.AI_DAILY_LIMIT || DEFAULT_DAILY_LIMIT),
    models: AI_MODELS,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy,
  };
}

/**
 * Seuls les chefs de projet de l'organisation modifient ces paramètres.
 * TODO auth : à remplacer par un rôle « administrateur » quand la connexion des utilisateurs existera.
 */
export async function canManageSettings(db: Db, memberId: string | null) {
  if (!memberId) return false;
  const roles = await db.select({ role: projectMembers.role }).from(projectMembers).where(eq(projectMembers.memberId, memberId));
  return roles.some((r) => isManagerRole(r.role));
}

export async function saveSettings(db: Db, orgId: string, memberId: string | null, input: z.infer<typeof SettingsInput>) {
  const patch: Partial<typeof orgSettings.$inferInsert> = { updatedById: memberId, updatedAt: new Date() };
  if (input.key === null) { patch.openrouterKeyEnc = null; patch.openrouterKeyLast4 = null; }
  else if (input.key) { patch.openrouterKeyEnc = encryptSecret(input.key); patch.openrouterKeyLast4 = input.key.slice(-4); }
  if (input.model !== undefined) patch.aiModel = input.model;
  if (input.dailyLimit !== undefined) patch.aiDailyLimit = input.dailyLimit;
  await db.insert(orgSettings).values({ orgId, ...patch })
    .onConflictDoUpdate({ target: orgSettings.orgId, set: patch });
}
