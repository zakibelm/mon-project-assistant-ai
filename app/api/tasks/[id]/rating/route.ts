import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { BoardError, getBoard, setTaskRating } from "@/lib/db/repo";
import { currentSession } from "@/lib/session";
import { taskProject } from "@/lib/task-access";

export const dynamic = "force-dynamic";

const Body = z.object({ rating: z.number().int().min(1).max(5).nullable() });

/** Évaluation de 1 à 5 de la note, proposée par le responsable ou le chef de projet. Une modification décoche la validation. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "L'évaluation doit être un entier de 1 à 5." }, { status: 400 });
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const projectId = await taskProject(db, id, orgId);
  if (!projectId) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  try {
    const r = await setTaskRating(db, projectId, { memberId: user.memberId, kind: "member" }, id, parsed.data.rating);
    return NextResponse.json({ board: await getBoard(db, projectId), unvalidated: r.unvalidated });
  } catch (e) {
    if (e instanceof BoardError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
