import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { listProjectDocs, MAX_DOC_BYTES, searchProjectDocs, writeProjectDoc } from "@/lib/rag/index";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function projectFolder(id: string) {
  const db = await getDb();
  const { orgId } = await currentSession(db);
  const [p] = await db.select({ orgId: projects.orgId, dir: projects.docsDir }).from(projects).where(eq(projects.id, id));
  return p && p.orgId === orgId ? p.dir : undefined;
}

/** Documents du projet (dossier rag-client/), et recherche de test avec ?q=. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = await projectFolder(id);
  if (dir === undefined) return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
  if (!dir) return NextResponse.json({ folder: null, docs: [], results: null });
  const q = new URL(req.url).searchParams.get("q")?.trim();
  return NextResponse.json({
    folder: `rag-client/${dir}`,
    docs: listProjectDocs(dir),
    results: q ? searchProjectDocs(dir, q, 4).map((h) => ({ source: h.source, title: h.title, heading: h.heading, text: h.text, score: h.score })) : null,
  });
}

const Body = z.object({
  name: z.string().trim().min(1, "Donnez un nom au document.").max(120),
  content: z.string().trim().min(20, "Le document est vide ou trop court.").max(MAX_DOC_BYTES, "Document trop volumineux (200 Ko au maximum)."),
});

/** Ajoute un document texte au dossier du projet (ne remplace jamais un fichier existant). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Document invalide." }, { status: 400 });
  const dir = await projectFolder(id);
  if (dir === undefined) return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
  if (!dir) return NextResponse.json({ error: "Ce projet n'a pas de dossier de documents." }, { status: 409 });
  try {
    const file = writeProjectDoc(dir, parsed.data.name, parsed.data.content);
    return NextResponse.json({ file, folder: `rag-client/${dir}`, docs: listProjectDocs(dir) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
