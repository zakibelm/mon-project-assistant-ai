"use client";
import { useState } from "react";
import type { ProjectDraft } from "@/lib/ai/draft";

const EXAMPLE = `Bonjour,

On lance la refonte de l'application de prise de rendez-vous de la clinique Saint-Laurent. Objectif : permettre la réservation en ligne et réduire les appels au secrétariat de 30 %.

Démarrage le 9 novembre, mise en production visée le 18 décembre, avant les fêtes. Léa s'occupe du design, Karim du développement mobile et Nadia des tests.

La directrice de la clinique, Mme Roy, valide les écrans. Le fournisseur du logiciel de gestion des rendez-vous doit nous ouvrir son API, c'est le point sensible.

Livrables attendus : maquettes validées fin novembre, version de test le 11 décembre, mise en ligne le 18 décembre.`;

const EMPTY: ProjectDraft = {
  name: "", description: "", start_date: null, end_date: null, deliverables: [], stakeholders: [],
  team: [{ name: "Membre 1", role: "chef de projet" }], groups: [{ name: "Phase 1", tasks: [] }], questions: [],
};
const PRIOS = ["Haute", "Moyenne", "Basse"] as const;

export default function NewProject({ onCreated, onCancel }: { onCreated: (projectId: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [busy, setBusy] = useState<"draft" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy("draft"); setError(null);
    try {
      const res = await fetch("/api/projects/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraft(data.draft);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function create() {
    if (!draft) return;
    setBusy("create"); setError(null);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated(data.projectId);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  /* ---------- étape 1 : le texte ---------- */
  if (!draft) {
    return (
      <section className="hero intake">
        <div className="date">Nouveau projet</div>
        <h1>Racontez-moi le projet.</h1>
        <p className="headline">Collez un brief, un courriel ou vos notes de réunion. Je prépare le contexte, l&apos;équipe et un plan complet que vous relirez avant de créer le projet.</p>
        <div className="intake-box">
          <textarea id="intake" value={text} onChange={(e) => setText(e.target.value)} rows={10}
            placeholder="Objectif, dates, livrables, qui fait quoi, contraintes… Écrivez comme à un collègue."
            aria-label="Description du projet" disabled={busy === "draft"} />
          <div className="intake-actions">
            <button className="btn ghost light" onClick={() => setText(EXAMPLE)} disabled={busy === "draft"}>Essayer avec un exemple</button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost light" onClick={() => setDraft(EMPTY)} disabled={busy === "draft"}>Remplir moi-même</button>
            <button className="go" onClick={prepare} disabled={busy === "draft" || text.trim().length < 20}>
              {busy === "draft" ? "Je lis et je planifie…" : "Préparer le projet"}
            </button>
          </div>
        </div>
        {error && <p className="intake-error" role="alert">{error}</p>}
        <button className="btn ghost light" style={{ marginTop: 14 }} onClick={onCancel}>← Retour à Aujourd&apos;hui</button>
      </section>
    );
  }

  /* ---------- étape 2 : relecture ---------- */
  const set = (patch: Partial<ProjectDraft>) => setDraft({ ...draft, ...patch });
  const setTask = (gi: number, ti: number, patch: Partial<ProjectDraft["groups"][number]["tasks"][number]>) =>
    set({ groups: draft.groups.map((g, i) => i !== gi ? g : { ...g, tasks: g.tasks.map((t, j) => j !== ti ? t : { ...t, ...patch }) }) });
  const taskCount = draft.groups.reduce((n, g) => n + g.tasks.length, 0);
  const unassigned = draft.groups.flatMap((g) => g.tasks).filter((t) => !t.owner).length;

  return (
    <div className="review">
      <div className="review-head">
        <div>
          <div className="muted">Relisez et corrigez : rien n&apos;est enregistré avant votre validation.</div>
          <input className="title-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nom du projet" aria-label="Nom du projet" />
        </div>
        <div className="review-cta">
          <button className="btn" onClick={() => { setDraft(null); setError(null); }}>Recommencer</button>
          <button className="btn primary big" onClick={create} disabled={busy === "create" || !draft.name.trim() || !taskCount}>
            {busy === "create" ? "Création…" : `Créer le projet et figer le plan (${taskCount} tâches)`}
          </button>
        </div>
      </div>
      {error && <p className="msg error" role="alert">{error}</p>}

      {draft.questions.length > 0 && (
        <aside className="questions">
          <strong>À préciser</strong>
          <ul>{draft.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </aside>
      )}

      <div className="review-grid">
        <section className="panel">
          <h2>Contexte</h2>
          <label className="field">Objectif et périmètre
            <textarea id="desc" rows={4} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="row2">
            <label className="field">Début<input id="start" type="date" value={draft.start_date ?? ""} onChange={(e) => set({ start_date: e.target.value || null })} /></label>
            <label className="field">Fin<input id="end" type="date" value={draft.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value || null })} /></label>
          </div>
          <h3>Livrables</h3>
          {draft.deliverables.map((d, i) => (
            <div className="line" key={i}>
              <input value={d.name} onChange={(e) => set({ deliverables: draft.deliverables.map((x, k) => k === i ? { ...x, name: e.target.value } : x) })} aria-label="Livrable" />
              <input type="date" value={d.due ?? ""} onChange={(e) => set({ deliverables: draft.deliverables.map((x, k) => k === i ? { ...x, due: e.target.value || null } : x) })} aria-label="Date du livrable" />
              <button className="x" onClick={() => set({ deliverables: draft.deliverables.filter((_, k) => k !== i) })} aria-label="Retirer">✕</button>
            </div>
          ))}
          <button className="add" onClick={() => set({ deliverables: [...draft.deliverables, { name: "Nouveau livrable", due: null }] })}>+ Livrable</button>
          <h3>Parties prenantes</h3>
          {draft.stakeholders.map((d, i) => (
            <div className="line" key={i}>
              <input value={d.name} onChange={(e) => set({ stakeholders: draft.stakeholders.map((x, k) => k === i ? { ...x, name: e.target.value } : x) })} aria-label="Partie prenante" />
              <input value={d.role} onChange={(e) => set({ stakeholders: draft.stakeholders.map((x, k) => k === i ? { ...x, role: e.target.value } : x) })} aria-label="Rôle" placeholder="Rôle" />
              <button className="x" onClick={() => set({ stakeholders: draft.stakeholders.filter((_, k) => k !== i) })} aria-label="Retirer">✕</button>
            </div>
          ))}
          <button className="add" onClick={() => set({ stakeholders: [...draft.stakeholders, { name: "", role: "" }] })}>+ Partie prenante</button>
          <h3>Équipe</h3>
          {draft.team.map((m, i) => (
            <div className="line" key={i}>
              <input value={m.name} onChange={(e) => {
                const old = m.name, name = e.target.value;
                set({
                  team: draft.team.map((x, k) => k === i ? { ...x, name } : x),
                  groups: draft.groups.map((g) => ({ ...g, tasks: g.tasks.map((t) => t.owner === old ? { ...t, owner: name } : t) })),
                });
              }} aria-label="Membre" />
              <input value={m.role} onChange={(e) => set({ team: draft.team.map((x, k) => k === i ? { ...x, role: e.target.value } : x) })} aria-label="Rôle" placeholder="Rôle" />
              <button className="x" disabled={draft.team.length === 1} onClick={() => set({
                team: draft.team.filter((_, k) => k !== i),
                groups: draft.groups.map((g) => ({ ...g, tasks: g.tasks.map((t) => t.owner === m.name ? { ...t, owner: null } : t) })),
              })} aria-label="Retirer">✕</button>
            </div>
          ))}
          <button className="add" onClick={() => set({ team: [...draft.team, { name: `Membre ${draft.team.length + 1}`, role: "membre" }] })}>+ Membre</button>
        </section>

        <section className="panel plan">
          <h2>Plan <span className="muted">{taskCount} tâches{unassigned ? ` · ${unassigned} sans responsable` : ""}</span></h2>
          {draft.groups.map((g, gi) => (
            <div className="pgroup" key={gi}>
              <div className="line">
                <input className="gname" value={g.name} onChange={(e) => set({ groups: draft.groups.map((x, k) => k === gi ? { ...x, name: e.target.value } : x) })} aria-label="Nom de la phase" />
                <button className="x" onClick={() => set({ groups: draft.groups.filter((_, k) => k !== gi) })} disabled={draft.groups.length === 1} aria-label="Retirer la phase">✕</button>
              </div>
              <div className="tscroll">
                <table>
                  <tbody>
                    {g.tasks.map((t, ti) => (
                      <tr key={ti}>
                        <td>
                          <input className="cell" value={t.name} onChange={(e) => setTask(gi, ti, { name: e.target.value })} aria-label="Tâche" />
                          {t.subtasks.length > 0 && <div className="muted subs">{t.subtasks.join(" · ")}</div>}
                        </td>
                        <td className="c-owner">
                          <select className="cell" value={t.owner ?? ""} onChange={(e) => setTask(gi, ti, { owner: e.target.value || null })} aria-label="Responsable" data-empty={!t.owner}>
                            <option value="">— à assigner</option>
                            {draft.team.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                          </select>
                        </td>
                        <td className="c-due"><input className="cell mono" type="date" value={t.due ?? ""} onChange={(e) => setTask(gi, ti, { due: e.target.value || null })} aria-label="Échéance" /></td>
                        <td className="c-prio">
                          <select className="cell" value={t.priority} onChange={(e) => setTask(gi, ti, { priority: e.target.value as (typeof PRIOS)[number] })} aria-label="Priorité">
                            {PRIOS.map((p) => <option key={p}>{p}</option>)}
                          </select>
                        </td>
                        <td className="c-x"><button className="x" onClick={() => set({ groups: draft.groups.map((x, k) => k === gi ? { ...x, tasks: x.tasks.filter((_, j) => j !== ti) } : x) })} aria-label="Retirer la tâche">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="add" onClick={() => set({ groups: draft.groups.map((x, k) => k === gi ? { ...x, tasks: [...x.tasks, { name: "Nouvelle tâche", owner: null, due: draft.end_date, priority: "Moyenne", subtasks: [] }] } : x) })}>+ Tâche</button>
            </div>
          ))}
          <button className="add" onClick={() => set({ groups: [...draft.groups, { name: `Phase ${draft.groups.length + 1}`, tasks: [] }] })}>+ Phase</button>
        </section>
      </div>
    </div>
  );
}
