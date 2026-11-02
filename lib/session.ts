/**
 * Utilisateur et organisation courants.
 * TODO auth : en attendant la connexion, on agit comme le chef de projet de l'organisation de démo.
 */
import type { Db } from "@/lib/db/client";
import { memberIdByName } from "@/lib/db/repo";
import { DEMO_ORG_ID } from "@/lib/db/seed";

export async function currentSession(db: Db) {
  const orgId = process.env.DEFAULT_ORG_ID || DEMO_ORG_ID;
  const name = process.env.DEFAULT_USER_NAME || "Zaki";
  return { orgId, user: { name, memberId: await memberIdByName(db, orgId, name) } };
}
