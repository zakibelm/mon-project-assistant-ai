import { NextResponse } from "next/server";
import { listKnowledge, reloadKnowledge, searchKnowledge } from "@/lib/rag/index";

export const dynamic = "force-dynamic";

/** Base de connaissances métier (dossier rag-metier/) : documents chargés, et recherche de test avec ?q=. ?reload=1 force la relecture. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("reload") === "1") reloadKnowledge();
  const q = url.searchParams.get("q")?.trim();
  return NextResponse.json({
    docs: listKnowledge(),
    results: q ? searchKnowledge(q, 4).map((h) => ({ source: h.source, title: h.title, heading: h.heading, text: h.text, score: h.score })) : null,
  });
}
