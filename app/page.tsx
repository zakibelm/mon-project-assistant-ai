"use client";
import { useCallback, useEffect, useState } from "react";
import type { Board } from "@/lib/board/types";
import type { Brief, BriefAction } from "@/lib/brief";
import type { Msg } from "./components/Chat";
import ProjectView from "./components/ProjectView";
import Today from "./components/Today";

interface Usage { requests: number; input: number; output: number; cacheRead: number }
const STATE_COLOR = { ok: "var(--st-done)", watch: "var(--st-doing)", late: "var(--st-block)" } as const;

export default function Home() {
  // "today" = point du jour (accueil) ; sinon l'identifiant du projet ouvert.
  const [view, setView] = useState<string>("today");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [busy, setBusy] = useState(false);

  const loadBrief = useCallback(() => fetch("/api/brief").then((r) => r.json()).then(setBrief).catch(() => {}), []);
  useEffect(() => { loadBrief(); }, [loadBrief]);
  useEffect(() => {
    if (view === "today") { loadBrief(); return; }
    setBoard(null);
    fetch(`/api/projects/${view}`).then((r) => r.json()).then((d) => { setBoard(d.board); setUsage(d.usage); }).catch(() => {});
  }, [view, loadBrief]);

  const send = useCallback(async (projectId: string, text: string) => {
    const push = (m: Msg) => setChats((c) => ({ ...c, [projectId]: [...(c[projectId] ?? []), m] }));
    const history = (chats[projectId] ?? []).filter((m) => m.role !== "error").map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    push({ role: "user", text });
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setBoard((b) => (b && b.projectId === projectId ? data.board : b));
      setUsage(data.usage);
      push({ role: "assistant", text: data.reply, actions: data.actions });
    } catch (e) {
      push({ role: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [chats]);

  // Une action du point du jour ouvre le projet et confie la consigne à l'assistant.
  const act = (a: BriefAction) => {
    setView(a.projectId);
    if (a.type === "ask") send(a.projectId, a.prompt);
  };

  return (
    <>
      <header className="topbar">
        <div className="in">
          <span className="brand">Assistant Projet</span>
          <nav className="nav" aria-label="Navigation">
            <button aria-current={view === "today" ? "page" : undefined} onClick={() => setView("today")}>Aujourd&apos;hui</button>
            {brief?.pulse.map((p) => (
              <button key={p.id} aria-current={view === p.id ? "page" : undefined} onClick={() => setView(p.id)}>
                <span className="dot" style={{ background: STATE_COLOR[p.state] }} />{p.name}
              </button>
            ))}
          </nav>
          {usage && <span className="usage mono">IA : {usage.requests} demande(s) aujourd&apos;hui</span>}
        </div>
      </header>
      <div className="page">
        {view === "today"
          ? <Today brief={brief} onAct={act} onOpen={setView} />
          : <ProjectView board={board} msgs={chats[view] ?? []} busy={busy} onSend={(t) => send(view, t)} />}
      </div>
    </>
  );
}
