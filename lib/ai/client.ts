import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { orgSettings } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/secrets";

/**
 * Configuration de l'IA d'une organisation : clé OpenRouter et modèle choisis dans Paramètres
 * (clé chiffrée en base), avec repli sur les variables d'environnement.
 *
 * Le SDK officiel Anthropic est branché sur le point d'entrée compatible API Messages
 * d'OpenRouter (https://openrouter.ai/api + /v1/messages ; la clé part en Authorization: Bearer).
 * L'adresse de la passerelle n'est réglable que côté serveur (AI_BASE_URL), jamais depuis
 * l'interface : sinon on pourrait détourner les appels, et la clé avec.
 */

export const AI_MODELS = [
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", note: "Recommandé : planification, analyse des retards, leçons" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", note: "Plus rapide et moins cher, pour les demandes courantes" },
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", note: "Le moins cher, pour des résumés simples" },
] as const;
export const DEFAULT_MODEL = AI_MODELS[0].id;
export const DEFAULT_DAILY_LIMIT = 200;

export class MissingKeyError extends Error {}

export interface Ai { client: Anthropic; model: string; dailyLimit: number; keySource: "settings" | "env" }

const clients = new Map<string, Anthropic>();
export function clientFor(key: string): Anthropic {
  let c = clients.get(key);
  if (!c) {
    c = new Anthropic({
      apiKey: key,
      baseURL: process.env.AI_BASE_URL || "https://openrouter.ai/api",
      maxRetries: 2,
      timeout: 120_000,
      defaultHeaders: {
        // En-têtes facultatifs d'OpenRouter pour identifier l'app dans son tableau de bord.
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Assistant Projet",
      },
    });
    clients.set(key, c);
  }
  return c;
}

export async function readSettings(db: Db, orgId: string) {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
  return row ?? null;
}

/** Clé, modèle et limite effectifs pour une organisation. Lève MissingKeyError s'il n'y a aucune clé. */
export async function resolveAi(db: Db, orgId: string): Promise<Ai> {
  const row = await readSettings(db, orgId);
  const stored = row?.openrouterKeyEnc ? decryptSecret(row.openrouterKeyEnc) : null;
  const key = stored || process.env.OPENROUTER_API_KEY || null;
  if (!key) throw new MissingKeyError("Aucune clé OpenRouter : ajoutez-la dans Paramètres.");
  return {
    client: clientFor(key),
    model: row?.aiModel || process.env.AI_MODEL || DEFAULT_MODEL,
    dailyLimit: row?.aiDailyLimit ?? Number(process.env.AI_DAILY_LIMIT || DEFAULT_DAILY_LIMIT),
    keySource: stored ? "settings" : "env",
  };
}
