"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Board, ProjectSummary, Status } from "@/lib/board/types";

const LABEL: Record<Status, string> = { todo: "À faire", doing: "En cours", block: "Bloqué", done: "Terminé" };
const fmt = (d: string | null) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : "—");
const SUGGESTIONS = [
  "Résume le projet",
  "Qu'est-ce qui bloque ?",
  "Qu'est-ce qui a glissé par rapport au plan ?",
  "Quand une tâche est terminée, préviens Léa",
];

interface Msg { role: "user" | "assistant" | "error"; text: string; actions?: string[] }
interface Usage { requests: number; input: number; output: number; cacheRead: number }

function health(p: ProjectSummary) {
  if (p.overdue > 0 || p.blocked > 0) return { label: "En retard", color: "var(--st-block)" };
  if (p.slipped > 0) return { label: "Glissement", color: "var(--st-doing)" };
  return { label: "À l'heure", color: "var(--st-done)" };
}

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const msgs = projectId ? chats[projectId] ?? [] : [];

  const loadProjects = useCallback(() =>
    fetch("/api/projects").then((r) => r.json()).then((d) => {
      setProjects(d.projects);
      setProjectId((cur) => cur ?? d.projects[0]?.id ?? null);
    }).catch(() => setError("Impossible de charger les projets.")), []);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => {
    if (!projectId) return;
    setBoard(null);
    fetch(`/api/projects/${projectId}`).then((r) => r.json()).then((d) => { setBoard(d.board); setUsage(d.usage); })
      .catch(() => setError("Impossible de charger le projet."));
  }, [projectId]);
  useEffect(() => { logRef.current?.scrollTo(0, 1e6); }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy || !projectId) return;
    const pid = projectId;
    const history = msgs.filter((m) => m.role !== "error").map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    const push = (m: Msg) => setChats((c) => ({ ...c, [pid]: [...(c[pid] ?? []), m] }));
    push({ role: "user", text });
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: pid, message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      if (pid === projectId) setBoard(data.board);
      setUsage(data.usage);
      push({ role: "assistant", text: data.reply, actions: data.actions });
      if (data.changed) loadProjects();
    } catch (e) {
      push({ role: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(input); };

  return (
    <div className="wrap">
      <header>
        <div>
          <div className="muted">PMO Démo · portefeuille « Projets clients »</div>
          <h1>Assistant Projet</h1>
        </div>
        {usage && (
          <div className="muted">
            IA aujourd&apos;hui : {usage.requests} demande(s) · {usage.input + usage.cacheRead} tokens lus ({usage.cacheRead} depuis le cache) · {usage.output} écrits
          </div>
        )}
      </header>
      {error && <p className="msg error">{error}</p>}

      <section className="portfolio" aria-label="Portefeuille">
        {projects.map((p) => {
          const h = health(p);
          return (
            <button key={p.id} className="pcard" aria-pressed={p.id === projectId} onClick={() => setProjectId(p.id)}>
              <span className="pname">{p.name}</span>
              <span className="phealth" style={{ color: h.color }}>● {h.label}</span>
              <span className="muted">
                {p.done}/{p.total} terminées · {p.overdue} en retard · {p.blocked} bloquée(s) · {p.slipped} glissée(s)
                {p.endDate ? ` · fin ${fmt(p.endDate)}` : ""}
              </span>
            </button>
          );
        })}
      </section>

      <div className="layout">
        <main>
          {!board && <p className="muted">Chargement du projet…</p>}
          {board && (
            <>
              <h2 className="ptitle">{board.name}</h2>
              <p className="muted">{board.description}</p>
              <p className="muted">
                Livrables : {board.deliverables.map((d) => `${d.name} (${fmt(d.due)})`).join(" · ") || "—"}
                <br />Équipe : {board.members.map((m) => `${m.name} (${m.role})`).join(", ")}
              </p>
              {board.groups.map((g) => {
                const items = board.items.filter((i) => i.groupId === g.id);
                return (
                  <section className="group" key={g.id}>
                    <h3>{g.name} <span className="muted">{items.length}</span></h3>
                    <div className="tscroll">
                      <table>
                        <thead><tr><th>Tâche</th><th>Statut</th><th>Responsable</th><th>Échéance</th><th>Priorité</th><th>Sous-tâches</th></tr></thead>
                        <tbody>
                          {items.map((i) => (
                            <tr key={i.id}>
                              <td>{i.name}</td>
                              <td><span className="pill" style={{ background: `var(--st-${i.status})` }}>{LABEL[i.status]}</span></td>
                              <td>{i.owner ?? "—"}</td>
                              <td>
                                {fmt(i.due)}
                                {i.baselineDue && i.due && i.due !== i.baselineDue && <span className="slip" title="Date du plan de référence"> (prévu {fmt(i.baselineDue)})</span>}
                              </td>
                              <td>{i.priority}</td>
                              <td>{i.subtasks.length ? `${i.subtasks.filter((s) => s.done).length}/${i.subtasks.length}` : "—"}</td>
                            </tr>
                          ))}
                          {!items.length && <tr><td colSpan={6} className="muted">Aucune tâche.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
              <div className="notifs">
                Automatisations : {board.automations.map((a) => `${LABEL[a.onStatus]} → prévenir ${a.notify}`).join(" · ") || "aucune"}
                {board.notifications.length > 0 && <><br />Dernière notification : {board.notifications[0].text}</>}
              </div>
            </>
          )}
        </main>

        <aside className="chat" aria-label="Assistant">
          <div className="head"><strong>Assistant</strong><div className="muted">{board ? `Projet : ${board.name}` : "Claude via OpenRouter"}</div></div>
          <div className="log" ref={logRef} aria-live="polite">
            {msgs.length === 0 && <div className="msg assistant">Bonjour ! Je connais le contexte de ce projet. Demandez-moi un résumé, ce qui a glissé, de modifier des tâches ou de créer une automatisation.</div>}
            {msgs.map((m, k) => (
              <div key={k} className={`msg ${m.role}`}>
                {m.text}
                {m.actions && m.actions.length > 0 && <div className="acts">{m.actions.map((a) => `✓ ${a}`).join("\n")}</div>}
              </div>
            ))}
            {busy && <div className="msg assistant muted">Je réfléchis…</div>}
          </div>
          <div className="sugg">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)} disabled={busy || !board}>{s}</button>)}</div>
          <form onSubmit={onSubmit}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Votre demande…" aria-label="Message à l'assistant" />
            <button className="btn" disabled={busy || !board}>Envoyer</button>
          </form>
        </aside>
      </div>
    </div>
  );
}
