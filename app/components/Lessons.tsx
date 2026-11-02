"use client";
import { useCallback, useEffect, useState } from "react";
import { PROBLEM_LABEL, type ProblemType } from "@/lib/board/types";
import { Stars } from "./NoteCells";

interface Note { taskId: string; projectName: string; task: string; owner: string | null; problemType: ProblemType; problem: string; resolution: string; rating: number }
interface Stat { problemType: ProblemType; count: number; weight: number; average: number }
interface Lesson { id: string; problemType: ProblemType; title: string; problem: string; resolution: string; recommendation: string; weight: number; sourceTaskIds: string[]; createdAt: string }
interface Data { notes: Note[]; stats: Stat[]; lessons: Lesson[] }

/** Leçons apprises : notes validées par les chefs de projet, statistiques par type de problème, synthèse par l'IA. */
export default function Lessons({ projects }: { projects: { id: string; name: string }[] }) {
  const [scope, setScope] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    const d = await fetch(`/api/lessons${scope ? `?projectId=${scope}` : ""}`).then((r) => r.json());
    setData(d);
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  async function synthesize() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/lessons", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: scope || null }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setData(d);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const max = Math.max(1, ...(data?.stats.map((s) => s.weight) ?? [1]));
  const taskName = new Map(data?.notes.map((n) => [n.taskId, `${n.task} (${n.projectName})`]) ?? []);

  return (
    <div className="lessons">
      <div className="lessons-head">
        <div>
          <h1>Leçons apprises</h1>
          <p className="muted">À partir des notes de retard <strong>validées par les chefs de projet</strong>, pondérées par leur évaluation de 1 à 5.</p>
        </div>
        <div className="lessons-cta">
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Portée de l'analyse">
            <option value="">Tous les projets</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn primary" onClick={synthesize} disabled={busy || !data?.notes.length}>
            {busy ? "Analyse en cours…" : "Synthétiser avec l'IA"}
          </button>
        </div>
      </div>
      {error && <p className="msg error" role="alert">{error}</p>}
      {!data && <p className="muted">Chargement…</p>}

      {data && (
        <div className="lessons-grid">
          <section className="panel">
            <h2>Par type de problème <span className="muted">sans IA</span></h2>
            {data.stats.length === 0 && <p className="muted">Aucune note validée. Dans un projet, ouvrez la note d&apos;une tâche en retard, évaluez-la, puis cochez « Validé ».</p>}
            {data.stats.map((s) => (
              <div className="stat" key={s.problemType}>
                <div className="stat-row"><span>{PROBLEM_LABEL[s.problemType]}</span><span className="mono muted">{s.count} note{s.count > 1 ? "s" : ""} · moyenne {s.average}/5</span></div>
                <div className="track"><span className="fill" style={{ width: `${(s.weight / max) * 100}%` }} /></div>
              </div>
            ))}
            <h2 style={{ marginTop: 20 }}>Notes validées <span className="muted">{data.notes.length}</span></h2>
            <ul className="vnotes">
              {data.notes.map((n) => (
                <li key={n.taskId}>
                  <div className="vtop"><span className="ptype">{PROBLEM_LABEL[n.problemType]}</span><Stars value={n.rating} /></div>
                  <strong>{n.task}</strong> <span className="muted">· {n.projectName}{n.owner ? ` · ${n.owner}` : ""}</span>
                  <p><b>Problème :</b> {n.problem}</p>
                  {n.resolution && <p><b>Résolution :</b> {n.resolution}</p>}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Leçons <span className="muted">{data.lessons.length ? `synthèse du ${new Date(data.lessons[0].createdAt).toLocaleDateString("fr-CA")}` : "aucune synthèse pour l'instant"}</span></h2>
            {data.lessons.length === 0 && <p className="muted">Lancez « Synthétiser avec l&apos;IA » : l&apos;assistant regroupe les notes validées par type de problème et en tire la résolution qui a marché et une recommandation pour les prochains projets.</p>}
            {data.lessons.map((l) => (
              <article className="lesson" key={l.id}>
                <div className="vtop"><span className="ptype">{PROBLEM_LABEL[l.problemType]}</span><span className="mono muted" title="Moyenne des évaluations des notes sources">poids {l.weight}/5</span></div>
                <h3>{l.title}</h3>
                <p><b>Problème type :</b> {l.problem}</p>
                <p><b>Ce qui a marché :</b> {l.resolution}</p>
                <p className="reco"><b>À faire dès le cadrage :</b> {l.recommendation}</p>
                <p className="muted">Sources : {l.sourceTaskIds.map((id) => taskName.get(id) ?? id).join(" · ")}</p>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
