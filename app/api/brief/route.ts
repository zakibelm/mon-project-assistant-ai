import { NextResponse } from "next/server";
import { computeBrief } from "@/lib/brief";
import { getDb } from "@/lib/db/client";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Point du jour du PMO : ce qui demande une décision, sur tout le portefeuille. */
export async function GET() {
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  return NextResponse.json(await computeBrief(db, orgId, user.name));
}
