"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { Board, Status } from "@/lib/board/types";

const LABEL: Record<Status, string> = { todo: "À faire", doing: "En cours", block: "Bloqué", done: "Terminé" };
const fmt = (d: string | null) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : "—");
const SUGGESTIONS = [
  "Résume le projet",
  "Qu'est-ce qui bloque ?",
  "Planifie un événement client pour fin novembre",
  "Quand une tâche est terminée, préviens Léa",
];

interface Msg { role: "user" | "assistant" | "error"; text: string; actions?: string[] }
interface Usage { requests: number; input: number; output: number; cacheRead: number }

export default function Home() {
  const [board, setBoard] = useState<Board | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/board").then((r) => r.json()).then((d) => { setBoard(d.board); setUsage(d.usage); });
  }, []);
  useEffect(() => { logRef.current?.scrollTo(0, 1e6); }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history = msgs.filter((m) => m.role !== "error").map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boardId: "board_site", message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setBoard(data.board);
      setUsage(data.usage);
      setMsgs((m) => [...m, { role: "assistant", text: data.reply, actions: data.actions }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "error", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(input); };

  return (
    <div className="wrap">
      <header>
        <div>
          <div className="muted">Espace « Agence »</div>
          <h1>{board?.name ?? "Chargement…"}</h1>
        </div>
        {usage && (
          <div className="muted">
            Aujourd&apos;hui : {usage.requests} demande(s) · {usage.input + usage.cacheRead} tokens lus ({usage.cacheRead} depuis le cache) · {usage.output} écrits
          </div>
        )}
      </header>

      <div className="layout">
        <main>
          {board?.groups.map((g) => {
            const items = board.items.filter((i) => i.groupId === g.id);
            return (
              <section className="group" key={g.id}>
                <h2>{g.name} <span className="muted">{items.length}</span></h2>
                <div className="tscroll">
                  <table>
                    <thead><tr><th>Tâche</th><th>Statut</th><th>Responsable</th><th>Échéance</th><th>Priorité</th><th>Sous-tâches</th></tr></thead>
                    <tbody>
                      {items.map((i) => (
                        <tr key={i.id}>
                          <td>{i.name}</td>
                          <td><span className="pill" style={{ background: `var(--st-${i.status})` }}>{LABEL[i.status]}</span></td>
                          <td>{i.owner ?? "—"}</td>
                          <td>{fmt(i.due)}</td>
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
          {board && (
            <div className="notifs">
              Automatisations : {board.automations.map((a) => `${LABEL[a.onStatus]} → prévenir ${a.notify}`).join(" · ") || "aucune"}
              {board.notifications.length > 0 && <><br />Dernière notification : {board.notifications[0].text}</>}
            </div>
          )}
        </main>

        <aside className="chat" aria-label="Assistant">
          <div className="head"><strong>Assistant</strong><div className="muted">Claude via OpenRouter</div></div>
          <div className="log" ref={logRef} aria-live="polite">
            {msgs.length === 0 && <div className="msg assistant">Bonjour ! Demandez-moi de résumer le projet, de planifier un nouveau projet, de modifier des tâches ou de créer une automatisation.</div>}
            {msgs.map((m, k) => (
              <div key={k} className={`msg ${m.role}`}>
                {m.text}
                {m.actions && m.actions.length > 0 && <div className="acts">{m.actions.map((a) => `✓ ${a}`).join("\n")}</div>}
              </div>
            ))}
            {busy && <div className="msg assistant muted">Je réfléchis…</div>}
          </div>
          <div className="sugg">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)} disabled={busy}>{s}</button>)}</div>
          <form onSubmit={onSubmit}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Votre demande…" aria-label="Message à l'assistant" />
            <button className="btn" disabled={busy}>Envoyer</button>
          </form>
        </aside>
      </div>
    </div>
  );
}
