/**
 * Chiffrement des secrets enregistrés en base (clé OpenRouter).
 *
 * AES-256-GCM, avec une clé maîtresse dérivée de APP_SECRET (variable d'environnement,
 * obligatoire en production). En développement, sans APP_SECRET, une clé aléatoire est
 * créée une fois dans .data/app-secret (fichier ignoré par Git).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";

export class SecretError extends Error {}

function masterKey(): Buffer {
  const env = process.env.APP_SECRET;
  if (env) return createHash("sha256").update(env).digest();
  if (process.env.NODE_ENV === "production" && process.env.DATABASE_URL) {
    throw new SecretError("APP_SECRET manquant : il est obligatoire en production pour chiffrer la clé d'IA (voir .env.example).");
  }
  const file = path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "app-secret");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return createHash("sha256").update(fs.readFileSync(file, "utf8")).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new SecretError("Secret enregistré illisible.");
  try {
    const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new SecretError("Impossible de déchiffrer la clé enregistrée (APP_SECRET a changé ?). Enregistrez la clé à nouveau dans Paramètres.");
  }
}
