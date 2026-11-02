import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { BoardError, getBoard, setTaskValidation } from "@/lib/db/repo";
import { currentSession } from "@/lib/session";
import { taskProject } from "@/lib/task-access";

export const dynamic = "force-dynamic";

const Body = z.object({ validated: z.boolean() });

/** Case « Validé » : réservée au chef de projet. Seules les notes validées servent à l'apprentissage. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const projectId = await taskProject(db, id, orgId);
  if (!projectId) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  try {
    await setTaskValidation(db, projectId, { memberId: user.memberId, kind: "member" }, id, parsed.data.validated);
    return NextResponse.json({ board: await getBoard(db, projectId) });
  } catch (e) {
    if (e instanceof BoardError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
