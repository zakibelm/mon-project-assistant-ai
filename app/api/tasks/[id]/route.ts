import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { BoardError, getBoard, updateTask } from "@/lib/db/repo";
import { projects, tasks } from "@/lib/db/schema";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Responsable : un membre de l'équipe du projet (vérifié par updateTask), ou null pour « à assigner ».
const Body = z.object({ owner: z.string().trim().min(1).nullable() });

/** Change le responsable d'une tâche. Le changement est journalisé dans l'historique. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const [row] = await db.select({ projectId: tasks.projectId, orgId: projects.orgId })
    .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(eq(tasks.id, id));
  if (!row || row.orgId !== orgId) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });

  try {
    await updateTask(db, row.projectId, { memberId: user.memberId, kind: "member" }, id, { owner: parsed.data.owner });
  } catch (e) {
    if (e instanceof BoardError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ board: await getBoard(db, row.projectId) });
}
