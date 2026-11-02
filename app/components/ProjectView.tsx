"use client";
import { Fragment, useState } from "react";
import type { Board, ProblemType, Status } from "@/lib/board/types";
import Chat, { Msg } from "./Chat";
import { NoteCell, NoteEditor, RatingCell, RATING_HELP, ValidateCell, VALIDATE_HELP } from "./NoteCells";

const LABEL: Record<Status, string> = { todo: "À faire", doing: "En cours", block: "Bloqué", done: "Terminé" };
const fmt = (d: string | null) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : "—");

export default function ProjectView({ board, me, msgs, busy, onSend, onAssign, onSaveNote, onRate, onValidate }: {
  board: Board | null; me: string | null; msgs: Msg[]; busy: boolean; onSend: (text: string) => void;
  onAssign: (taskId: string, owner: string | null) => void;
  onSaveNote: (taskId: string, note: { problemType: ProblemType; problem: string; resolution: string }) => Promise<string | null>;
  onRate: (taskId: string, rating: number | null) => Promise<string | null>;
  onValidate: (taskId: string, validated: boolean) => Promise<string | null>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [needRate, setNeedRate] = useState<string | null>(null);
  if (!board) return <p className="muted" style={{ padding: 24 }}>Chargement du projet…</p>;
  const isManager = !!board.members.find((m) => m.name === me)?.isManager;
  const run = async (id: string, fn: () => Promise<string | null>) => {
    setSaving(id); setError(null);
    const err = await fn();
    if (err) setError({ id, text: err });
    setSaving(null);
  };
  /** Cocher « Validé » sans évaluation : on ouvre la note et on explique quoi faire, au lieu d'une case grisée muette. */
  const validate = (i: (typeof board.items)[number], v: boolean) => {
    if (v && !i.note?.rating) {
      setOpen(i.id); setNeedRate(i.id);
      setError({ id: i.id, text: "Donnez d'abord une évaluation de 1 à 5 avec les étoiles, puis cochez « Validé »." });
      return;
    }
    setNeedRate(null);
    run(i.id, () => onValidate(i.id, v));
  };
  const rate = (id: string, n: number | null) => { setNeedRate(null); run(id, () => onRate(id, n)); };
  const pending = board.items.filter((i) => i.note && !i.note.validated).length;
  const expected = board.items.filter((i) => i.late && !i.note).length;
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
          {(expected > 0 || (isManager && pending > 0)) && (
            <p className="note-summary">
              {expected > 0 && <span>{expected} retard{expected > 1 ? "s" : ""} sans explication. </span>}
              {isManager && pending > 0 && <span>{pending} note{pending > 1 ? "s" : ""} à valider.</span>}
            </p>
          )}
        </div>
        {board.groups.map((g) => {
          const items = board.items.filter((i) => i.groupId === g.id);
          return (
            <section className="group" key={g.id}>
              <h3>{g.name} <span className="muted">{items.length}</span></h3>
              <div className="tscroll">
                <table className="wide">
                  <thead><tr><th>Tâche</th><th>Statut</th><th>Responsable</th><th>Échéance</th><th>Notes</th><th title={RATING_HELP}>Évaluation</th><th title={VALIDATE_HELP}>Validé</th></tr></thead>
                  <tbody>
                    {items.map((i) => {
                      const canEdit = i.owner === me || isManager;
                      return (
                      <Fragment key={i.id}>
                      <tr>
                        <td>{i.name}<span className="tmeta">Priorité {i.priority.toLowerCase()}{i.subtasks.length ? ` · ${i.subtasks.filter((x) => x.done).length}/${i.subtasks.length} sous-tâches` : ""}</span></td>
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
                        <td className="c-note"><NoteCell item={i} canEdit={canEdit} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} /></td>
                        <td><RatingCell item={i} canEdit={canEdit} busy={saving === i.id} onRate={(n) => rate(i.id, n)} /></td>
                        <td><ValidateCell item={i} isManager={isManager} busy={saving === i.id} onValidate={(v) => validate(i, v)} /></td>
                      </tr>
                      </Fragment>
                      );
                    })}
                    {!items.length && <tr><td colSpan={7} className="muted">Aucune tâche.</td></tr>}
                  </tbody>
                </table>
              </div>
              {(() => {
                // L'éditeur s'ouvre sous le tableau du groupe (et non dans le tableau défilant), pour rester entièrement visible.
                const i = items.find((x) => x.id === open);
                if (!i) return null;
                const canEdit = i.owner === me || isManager;
                return (
                  <div className="note-panel" role="region" aria-label={`Note de la tâche « ${i.name} »`}>
                    <div className="note-panel-head"><strong>Note · {i.name}</strong><button className="x" onClick={() => setOpen(null)} aria-label="Fermer la note">✕</button></div>
                    <NoteEditor key={`${i.id}-${i.note?.problem ?? ""}`} item={i} canEdit={canEdit} isManager={isManager} busy={saving === i.id}
                      error={error?.id === i.id ? error.text : null} needRating={needRate === i.id}
                      onSave={(n) => run(i.id, () => onSaveNote(i.id, n))} onRate={(n) => rate(i.id, n)}
                      onValidate={(v) => validate(i, v)} />
                  </div>
                );
              })()}
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
