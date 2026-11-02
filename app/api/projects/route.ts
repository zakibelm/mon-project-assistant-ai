import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { listProjects } from "@/lib/db/repo";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Portefeuille : les projets de l'organisation avec leurs indicateurs de suivi. */
export async function GET() {
  const db = await getDb();
  const { orgId } = await currentSession(db);
  return NextResponse.json({ projects: await listProjects(db, orgId) });
}
