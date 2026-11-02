import Anthropic from "@anthropic-ai/sdk";

/**
 * Client du SDK officiel Anthropic, branché sur OpenRouter.
 *
 * OpenRouter expose un point d'entrée compatible avec l'API Messages de Claude
 * (https://openrouter.ai/api + /v1/messages). Le SDK v1 envoie `apiKey` en
 * `Authorization: Bearer`, ce qu'attend OpenRouter.
 */
let client: Anthropic | null = null;

export class MissingKeyError extends Error {}

export function getClient(): Anthropic {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new MissingKeyError("OPENROUTER_API_KEY manquante : ajoutez-la dans .env.local (voir .env.example).");
  client ??= new Anthropic({
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
  return client;
}

export const MODEL = () => process.env.AI_MODEL || "anthropic/claude-opus-5.5";
