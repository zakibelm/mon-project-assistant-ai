"use client";
import { useState } from "react";
import { PROBLEM_LABEL, PROBLEM_TYPES, type Item, type ProblemType } from "@/lib/board/types";

/** Étoiles de 1 à 5. Cliquables pour le responsable de la tâche et le chef de projet. */
export function Stars({ value, onRate, disabled }: { value: number | null; onRate?: (n: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  if (!onRate) return <span className="stars ro" aria-label={value ? `Évaluée ${value} sur 5` : "Pas encore évaluée"}>{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= shown ? "on" : ""}>★</span>)}</span>;
  return (
    <span className="stars" role="group" aria-label="Évaluer la note de 1 à 5" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={n <= shown ? "on" : ""} disabled={disabled} aria-pressed={value === n}
          aria-label={`Évaluer ${n} sur 5`} onMouseEnter={() => setHover(n)} onClick={() => onRate(n)}>★</button>
      ))}
    </span>
  );
}

export const RATING_HELP = "Évaluation du retard et de son explication, de 1 (peu fiable ou peu utile) à 5 (cause réelle, leçon importante). Proposée par le responsable ou le chef de projet ; elle pèse dans les leçons apprises une fois validée.";
export const VALIDATE_HELP = "Case réservée au chef de projet : valide la note et son évaluation. Seules les notes validées servent à l'apprentissage. Toute modification ultérieure décoche la case.";

/** Cellule « Notes » : résumé de la note, ou rappel si une explication est attendue. */
export function NoteCell({ item, canEdit, open, onToggle }: { item: Item; canEdit: boolean; open: boolean; onToggle: () => void }) {
  if (item.note) {
    return (
      <button className="note-btn" onClick={onToggle} aria-expanded={open}>
        <span className="ptype">{item.note.problemType ? PROBLEM_LABEL[item.note.problemType] : "Note"}</span>
        <span className="excerpt">{item.note.problem}</span>
      </button>
    );
  }
  if (item.late) return <button className="note-btn due" onClick={onToggle} aria-expanded={open}>Explication attendue</button>;
  if (canEdit) return <button className="note-btn add" onClick={onToggle} aria-expanded={open}>+ Ajouter</button>;
  return <span className="muted">—</span>;
}

/** Cellule « Évaluation » : étoiles modifiables par le responsable et le chef de projet. */
export function RatingCell({ item, canEdit, busy, onRate }: { item: Item; canEdit: boolean; busy: boolean; onRate: (n: number) => void }) {
  if (!item.note) return <span className="muted">—</span>;
  return (
    <span className="rating-cell" title={RATING_HELP}>
      <Stars value={item.note.rating} onRate={canEdit ? onRate : undefined} disabled={busy} />
      {!item.note.rating && <span className="pending">à évaluer</span>}
    </span>
  );
}

/** Cellule « Validé » : case à cocher, active seulement pour le chef de projet. */
export function ValidateCell({ item, isManager, busy, onValidate }: { item: Item; isManager: boolean; busy: boolean; onValidate: (v: boolean) => void }) {
  if (!item.note) return <span className="muted">—</span>;
  const ready = item.note.rating !== null;
  const title = !isManager ? `${VALIDATE_HELP} (lecture seule pour vous)` : !ready ? "Évaluez d'abord la note de 1 à 5." : VALIDATE_HELP;
  return (
    <label className={`validate-box ${item.note.validated ? "on" : ""}`} title={title}>
      <input type="checkbox" checked={item.note.validated} disabled={!isManager || busy || (!ready && !item.note.validated)}
        onChange={(e) => onValidate(e.target.checked)} aria-label={`Valider la note de « ${item.name} »`} />
      <span>{item.note.validated ? "Validé" : isManager ? "Valider" : "Non validé"}</span>
    </label>
  );
}

/** Éditeur déplié sous la tâche : type de problème, problème, résolution, puis évaluation par le chef de projet. */
export function NoteEditor({ item, canEdit, isManager, busy, error, onSave, onRate, onValidate }: {
  item: Item; canEdit: boolean; isManager: boolean; busy: boolean; error: string | null;
  onSave: (n: { problemType: ProblemType; problem: string; resolution: string }) => void;
  onRate: (n: number | null) => void;
  onValidate: (v: boolean) => void;
}) {
  const [type, setType] = useState<ProblemType>(item.note?.problemType ?? "autre");
  const [problem, setProblem] = useState(item.note?.problem ?? "");
  const [resolution, setResolution] = useState(item.note?.resolution ?? "");
  const dirty = type !== (item.note?.problemType ?? "autre") || problem !== (item.note?.problem ?? "") || resolution !== (item.note?.resolution ?? "");
  const id = item.id;
  return (
    <div className="note-editor">
      <div className="note-grid">
        <label>Type de problème
          <select id={`nt-${id}`} value={type} disabled={!canEdit} onChange={(e) => setType(e.target.value as ProblemType)}>
            {PROBLEM_TYPES.map((p) => <option key={p} value={p}>{PROBLEM_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="wide">Problème : que s&apos;est-il passé ?
          <textarea id={`np-${id}`} rows={3} value={problem} disabled={!canEdit} onChange={(e) => setProblem(e.target.value)}
            placeholder="Ex. Le fournisseur a livré l'accès avec 5 jours de retard." />
        </label>
        <label className="wide">Résolution : comment l&apos;avez-vous résolu (ou comment le résoudre) ?
          <textarea id={`nr-${id}`} rows={3} value={resolution} disabled={!canEdit} onChange={(e) => setResolution(e.target.value)}
            placeholder="Ex. Relance quotidienne et accès provisoire demandé en parallèle." />
        </label>
      </div>
      <div className="note-foot">
        <span className="muted">
          {item.note?.author ? `Note de ${item.note.author}` : canEdit ? "Rédigée par le responsable de la tâche (ou le chef de projet)." : "Seul le responsable de la tâche ou le chef de projet peut écrire la note."}
          {item.note?.rating ? ` · évaluée ${item.note.rating}/5 par ${item.note.ratedBy}` : item.note ? " · pas encore évaluée" : ""}
          {item.note?.validated ? ` · validée par ${item.note.validatedBy}` : item.note ? " · pas encore validée" : ""}
        </span>
        {canEdit && (
          <button className="btn primary" disabled={busy || !dirty || problem.trim().length < 5}
            onClick={() => onSave({ problemType: type, problem: problem.trim(), resolution: resolution.trim() })}>
            {item.note ? "Enregistrer la note" : "Ajouter la note"}
          </button>
        )}
      </div>
      {canEdit && item.note?.validated && dirty && <p className="warn">Modifier la note décoche sa validation : le chef de projet devra la revalider.</p>}
      {item.note && (
        <div className="validate">
          <strong>Évaluation</strong>
          <Stars value={item.note.rating} onRate={canEdit ? (n) => onRate(n) : undefined} disabled={busy} />
          <ValidateCell item={item} isManager={isManager} busy={busy} onValidate={onValidate} />
          <span className="muted">{RATING_HELP}</span>
        </div>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}
