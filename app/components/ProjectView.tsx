"use client";
import type { Board, Status } from "@/lib/board/types";
import Chat, { Msg } from "./Chat";

const LABEL: Record<Status, string> = { todo: "À faire", doing: "En cours", block: "Bloqué", done: "Terminé" };
const fmt = (d: string | null) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : "—");

export default function ProjectView({ board, msgs, busy, onSend, onAssign }: {
  board: Board | null; msgs: Msg[]; busy: boolean; onSend: (text: string) => void;
  onAssign: (taskId: string, owner: string | null) => void;
}) {
  if (!board) return <p className="muted" style={{ padding: 24 }}>Chargement du projet…</p>;
  return (
    <div className="layout">
      <main style={{ minWidth: 0 }}>
        <div className="phead">
          <h1>{board.name}</h1>
          <p>{board.description}</p>
          <div className="tags">
            {board.deliverables.map((d) => <span className="tag" key={d.name}>Livrable · {d.name} · {fmt(d.due)}</span>)}
          </div>
          <div className="tags">
            {board.members.map((m) => <span className="tag" key={m.name}>{m.name} · {m.role}</span>)}
          </div>
        </div>
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
                        <td>
                          {/* Seuls les membres de l'équipe du projet sont proposés. */}
                          <select className="owner" value={i.owner ?? ""} data-empty={!i.owner}
                            onChange={(e) => onAssign(i.id, e.target.value || null)} aria-label={`Responsable de « ${i.name} »`}>
                            <option value="">— à assigner</option>
                            {board.members.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                          </select>
                        </td>
                        <td className="mono">
                          {fmt(i.due)}
                          {i.baselineDue && i.due && i.due !== i.baselineDue && <span className="slip" title="Date du plan de référence"> (prévu {fmt(i.baselineDue)})</span>}
                        </td>
                        <td>{i.priority}</td>
                        <td className="mono">{i.subtasks.length ? `${i.subtasks.filter((s) => s.done).length}/${i.subtasks.length}` : "—"}</td>
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
      </main>
      <Chat projectName={board.name} msgs={msgs} busy={busy} onSend={onSend} />
    </div>
  );
}
