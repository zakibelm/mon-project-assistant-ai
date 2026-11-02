"use client";
import { FormEvent, useEffect, useState } from "react";
import type { Brief, BriefAction, BriefItem } from "@/lib/brief";

const KIND: Record<BriefItem["kind"], string> = {
  blocked: "Bloqué", overdue: "En retard", due_soon: "Échéance proche",
  slipped: "Glissement", overload: "Surcharge", deliverable: "Livrable",
};
const STATE = { ok: "Dans les temps", watch: "À surveiller", late: "En retard" } as const;

function longDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" });
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}

/** Garde en mémoire, pour la journée, les points déjà traités (confort par navigateur). */
function useHandled(day: string | undefined) {
  const key = day ? `brief-handled-${day}` : null;
  const [handled, setHandled] = useState<string[]>([]);
  useEffect(() => {
    if (!key) return;
    try { setHandled(JSON.parse(localStorage.getItem(key) || "[]")); } catch { setHandled([]); }
  }, [key]);
  const mark = (id: string) => setHandled((h) => {
    const next = h.includes(id) ? h : [...h, id];
    try { if (key) localStorage.setItem(key, JSON.stringify(next)); } catch {}
    return next;
  });
  const reset = () => { setHandled([]); try { if (key) localStorage.removeItem(key); } catch {} };
  return { handled, mark, reset };
}

export default function Today({ brief, onAct, onOpen, onNew }: {
  brief: Brief | null;
  onAct: (action: BriefAction) => void;
  onOpen: (projectId: string) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("");
  const { handled, mark, reset } = useHandled(brief?.today);

  useEffect(() => {
    // Par défaut, la question vise le projet le plus à risque.
    if (brief && !scope) setScope(brief.items[0]?.projectId ?? brief.pulse[0]?.id ?? "");
  }, [brief, scope]);

  if (!brief) return <p className="muted" style={{ padding: 24 }}>Je prépare votre point du jour…</p>;
  if (!brief.pulse.length) {
    return (
      <section className="hero">
        <div className="date">{longDate(brief.today)}</div>
        <h1>{greeting()} {brief.user}.</h1>
        <p className="headline">Aucun projet pour l&apos;instant. Racontez-moi le premier : je prépare le contexte et le plan, vous validez.</p>
        <div className="ask" style={{ display: "inline-flex" }}><button className="go" onClick={onNew}>Créer mon premier projet</button></div>
      </section>
    );
  }

  const todo = brief.items.filter((i) => !handled.includes(i.id));
  const urgent = todo.filter((i) => i.severity === 3);
  const later = todo.filter((i) => i.severity < 3);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim() && scope) { onAct({ type: "ask", label: "", projectId: scope, prompt: q.trim() }); setQ(""); }
  };
  const act = (item: BriefItem, a: BriefAction) => { mark(item.id); onAct(a); };

  const card = (item: BriefItem) => (
    <article className="card" data-sev={item.severity} key={item.id}>
      <div className="stripe" />
      <div className="body">
        <div style={{ minWidth: 0 }}>
          <div className="meta"><span className="kind">{KIND[item.kind]}</span><span>· {item.projectName}</span></div>
          <h3>{item.title}</h3>
          <p>{item.detail}</p>
        </div>
        <div className="acts">
          {item.actions.map((a, k) => (
            <button key={k} className={`btn ${k === 0 ? "primary" : ""}`} onClick={() => act(item, a)}>{a.label}</button>
          ))}
          <button className="btn ghost" onClick={() => mark(item.id)} title="Masquer jusqu'à demain">Plus tard</button>
        </div>
      </div>
    </article>
  );

  return (
    <>
      <section className="hero">
        <div className="date">{longDate(brief.today)}</div>
        <h1>{greeting()} {brief.user}.</h1>
        <p className="headline">{handled.length && !todo.length ? "Vous avez traité tous les points du jour." : brief.headline}</p>
        <form className="ask" onSubmit={submit}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Demandez à l'assistant : « Prépare le plan de la semaine », « Qui est surchargé ? »…" aria-label="Question à l'assistant" />
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Projet concerné">
            {brief.pulse.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="go" disabled={!q.trim() || !scope}>Demander</button>
        </form>
        <button className="btn ghost light" style={{ marginTop: 14 }} onClick={onNew}>+ Démarrer un nouveau projet à partir d&apos;un brief</button>
      </section>

      <div className="pulse" aria-label="Portefeuille">
        {brief.pulse.map((p) => {
          const progress = p.total ? p.done / p.total : 0;
          const expected = p.pace ? Math.min(1, progress / p.pace) : null;
          return (
            <button key={p.id} className="pcard" onClick={() => onOpen(p.id)}>
              <span className="row"><span className="name">{p.name}</span><span className={`chip ${p.state}`}>{STATE[p.state]}</span></span>
              <span className="track" role="img" aria-label={`${p.done} tâches terminées sur ${p.total}`}>
                <span className="fill" style={{ width: `${progress * 100}%` }} />
                {expected !== null && <span className="expect" style={{ left: `calc(${expected * 100}% - 1px)` }} title="Avancement attendu aujourd'hui" />}
              </span>
              <span className="legend">
                <span className="mono">{p.done}/{p.total} terminées</span>
                <span>{p.pace !== null ? (p.pace >= 1 ? "en avance sur le rythme" : `${Math.round(p.pace * 100)} % du rythme attendu`) : ""}{p.endDate ? ` · fin ${p.endDate.slice(8)}/${p.endDate.slice(5, 7)}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="section-h">
        <h2>À décider aujourd&apos;hui</h2>
        <span className="muted">{urgent.length ? `${urgent.length} point${urgent.length > 1 ? "s" : ""}` : "Rien d'urgent"}</span>
      </div>
      {urgent.length ? <div className="cards">{urgent.map(card)}</div> : <div className="empty">Aucun blocage ni retard à traiter. Belle journée.</div>}

      {later.length > 0 && (
        <>
          <div className="section-h"><h2>À surveiller cette semaine</h2><span className="muted">{later.length} point{later.length > 1 ? "s" : ""}</span></div>
          <div className="cards">{later.map(card)}</div>
        </>
      )}
      {handled.length > 0 && (
        <p className="done-note">{handled.length} point{handled.length > 1 ? "s" : ""} traité{handled.length > 1 ? "s" : ""} ou reporté{handled.length > 1 ? "s" : ""} aujourd&apos;hui. <button className="btn ghost" onClick={reset}>Tout réafficher</button></p>
      )}
    </>
  );
}
