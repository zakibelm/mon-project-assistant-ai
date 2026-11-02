import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getTaskHistory } from "@/lib/db/repo";
import { projects } from "@/lib/db/schema";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Historique d'une tâche (créations, changements de statut, de date, de responsable…). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const { orgId } = await currentSession(db);
  const events = await getTaskHistory(db, id);
  if (!events.length) return NextResponse.json({ error: "Aucun historique pour cette tâche." }, { status: 404 });
  const [p] = await db.select({ orgId: projects.orgId }).from(projects).where(eq(projects.id, events[0].projectId));
  if (p?.orgId !== orgId) return NextResponse.json({ error: "Aucun historique pour cette tâche." }, { status: 404 });
  return NextResponse.json({ events });
}
