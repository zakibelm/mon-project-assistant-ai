import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { BoardError, getBoard, setTaskNote } from "@/lib/db/repo";
import { PROBLEM_TYPES } from "@/lib/db/schema";
import { currentSession } from "@/lib/session";
import { taskProject } from "@/lib/task-access";

export const dynamic = "force-dynamic";

const Body = z.object({
  problemType: z.enum(PROBLEM_TYPES),
  problem: z.string().trim().min(5, "Décrivez le problème en quelques mots.").max(4000),
  resolution: z.string().trim().max(4000).default(""),
});

/** Note d'explication : type de problème, ce qui s'est passé, comment c'est résolu. Réservé au responsable et au chef de projet. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Note invalide." }, { status: 400 });
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const projectId = await taskProject(db, id, orgId);
  if (!projectId) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  try {
    const r = await setTaskNote(db, projectId, { memberId: user.memberId, kind: "member" }, id, parsed.data);
    return NextResponse.json({ board: await getBoard(db, projectId), unvalidated: r.unvalidated });
  } catch (e) {
    if (e instanceof BoardError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
