import { NextResponse } from "next/server";
import { ProjectDraft } from "@/lib/ai/draft";
import { getDb } from "@/lib/db/client";
import { createProjectFromDraft, listProjects } from "@/lib/db/repo";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Portefeuille : les projets de l'organisation avec leurs indicateurs de suivi. */
export async function GET() {
  const db = await getDb();
  const { orgId } = await currentSession(db);
  return NextResponse.json({ projects: await listProjects(db, orgId) });
}

/** Crée un projet à partir d'un brouillon relu par le chef de projet. Les échéances deviennent le plan de référence. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = ProjectDraft.safeParse(body?.draft);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return NextResponse.json({ error: `Projet incomplet : ${i?.path.join(".") || "champ"} ${i?.message ?? ""}`.trim() }, { status: 400 });
  }
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const result = await createProjectFromDraft(db, orgId, { memberId: user.memberId, kind: "member" }, parsed.data);
  return NextResponse.json(result, { status: 201 });
}
