/**
 * Connexion à PostgreSQL.
 *
 * - DATABASE_URL défini (production sur le VPS) : PostgreSQL via node-postgres.
 * - Sinon (développement, tests) : PGlite, un vrai PostgreSQL embarqué, stocké dans
 *   PGLITE_DIR (défaut ./.data/pglite) ou en mémoire avec PGLITE_DIR=memory://.
 *
 * Les migrations du dossier ./drizzle sont appliquées au premier accès.
 */
import path from "path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { seedDemo } from "./seed";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pg = drizzle({ connection: { connectionString: url, max: 10 }, schema });
    await migrate(pg, { migrationsFolder: MIGRATIONS });
    db = pg as unknown as Db;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
    // PGlite ne crée pas les dossiers parents : sans ceci, le premier lancement d'un clone échoue.
    if (!dir.includes("://")) (await import("fs")).mkdirSync(dir, { recursive: true });
    const lite = drizzle({ client: new PGlite(dir), schema });
    await migrate(lite, { migrationsFolder: MIGRATIONS });
    db = lite as unknown as Db;
  }
  // Données de démonstration : toujours en développement, en production seulement si SEED_DEMO=1.
  if (!url || process.env.SEED_DEMO === "1") await seedDemo(db);
  return db;
}

// Conservé sur globalThis pour ne pas rouvrir la base à chaque rechargement à chaud.
const g = globalThis as unknown as { __db?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__db ??= open().catch((e) => { g.__db = undefined; throw e; });
  return g.__db;
}
