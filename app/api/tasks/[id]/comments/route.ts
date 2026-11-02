import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { addComment } from "@/lib/db/repo";
import { projects, tasks } from "@/lib/db/schema";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ body: z.string().trim().min(1).max(4000) });

/** Ajoute un message au fil d'une tâche, au nom de l'utilisateur. Les @mentions notifient les membres du projet. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Message vide." }, { status: 400 });
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const [row] = await db.select({ projectId: tasks.projectId, orgId: projects.orgId })
    .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(eq(tasks.id, id));
  if (!row || row.orgId !== orgId) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  await addComment(db, row.projectId, { memberId: user.memberId, kind: "member" }, id, parsed.data.body);
  return NextResponse.json({ ok: true }, { status: 201 });
}
