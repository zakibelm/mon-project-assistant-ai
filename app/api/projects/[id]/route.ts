import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getAiUsage, getBoard } from "@/lib/db/repo";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const { orgId, user } = await currentSession(db);
  const board = await getBoard(db, id);
  if (!board || board.orgId !== orgId) return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
  return NextResponse.json({ board, me: user.name, usage: await getAiUsage(db, orgId) });
}
