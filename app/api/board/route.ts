import { NextResponse } from "next/server";
import { getBoard } from "@/lib/board/store";
import { getUsage } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = getBoard("board_site");
  if (!board) return NextResponse.json({ error: "Board introuvable" }, { status: 404 });
  return NextResponse.json({ board, usage: getUsage(board.workspaceId) });
}
