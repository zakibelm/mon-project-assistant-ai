"use client";
import { FormEvent, useEffect, useState } from "react";
import type { Brief, BriefAction, BriefItem, BriefTask } from "@/lib/brief";

const KIND: Record<BriefItem["kind"], string> = {
  blocked: "Bloqué", overdue: "En retard", due_soon: "Échéance proche",
  slipped: "Glissement", overload: "Surcharge", deliverable: "Livrable",
};
const STATE = { ok: "Dans les temps", watch: "À surveiller", late: "En retard" } as const;
const STATUS = { todo: "À faire", doing: "En cours", block: "Bloqué", done: "Terminé" } as const;
const fmt = (d: string | null) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : "—");

function longDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" });
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}

/** Garde en mémoire, pour la journée, les points masqués avec « Plus tard » (confort par navigateur). */
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

type Patch = { owner?: string | null; status?: BriefTask["status"]; due?: string | null };
async function patchTask(id: string, patch: Patch) {
  const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "La modification a échoué.");
}
async function postComment(id: string, body: string) {
  const res = await fetch(`/api/tasks/${id}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Le message n'a pas été envoyé.");
}

/** Un point résolu reste affiché quelques secondes, avec la possibilité d'annuler. */
interface Resolved { item: BriefItem; summary: string; undo?: () => Promise<void> }

export default function Today({ brief, onAct, onOpen, onNew, onChanged }: {
  brief: Brief | null;
  onAct: (action: BriefAction) => void;
  onOpen: (projectId: string) => void;
  onNew: () => void;
  /** À appeler après une modification, pour recalculer le point du jour. */
  onChanged: () => Promise<unknown> | void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const { handled, mark, reset } = useHandled(brief?.today);

  useEffect(() => {
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

  const me = brief.user;
  // Les points résolus restent visibles (avec « Annuler ») même si le point du jour recalculé ne les contient plus.
  const live = brief.items.filter((i) => !handled.includes(i.id) && !resolved[i.id]);
  const shown = [...live, ...Object.values(resolved).map((r) => r.item)];
  const order = new Map(brief.items.map((i, k) => [i.id, k]));
  shown.sort((a, b) => b.severity - a.severity || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const urgent = shown.filter((i) => i.severity === 3);
  const later = shown.filter((i) => i.severity < 3);
  const remaining = live.length;

  /** Exécute une résolution directe, sans IA, puis recalcule le point du jour. */
  async function resolve(item: BriefItem, summary: string, run: () => Promise<void>, undo?: () => Promise<void>) {
    setBusy(item.id); setError(null);
    try {
      await run();
      setResolved((r) => ({ ...r, [item.id]: { item, summary, undo } }));
      setOpen(null);
      await onChanged();
      setTimeout(() => setResolved((r) => { const n = { ...r }; delete n[item.id]; return n; }), 8000);
    } catch (e) {
      setError({ id: item.id, text: (e as Error).message });
    } finally { setBusy(null); }
  }
  async function cancel(id: string) {
    const r = resolved[id]; if (!r?.undo) return;
    setBusy(id);
    try { await r.undo(); setResolved((x) => { const n = { ...x }; delete n[id]; return n; }); await onChanged(); }
    catch (e) { setError({ id, text: (e as Error).message }); }
    finally { setBusy(null); }
  }

  const change = (item: BriefItem, t: BriefTask, patch: Patch, summary: string) => {
    const before: Patch = {};
    for (const k of Object.keys(patch) as (keyof Patch)[]) (before as Record<string, unknown>)[k] = t[k];
    return resolve(item, summary, () => patchTask(t.id, patch), () => patchTask(t.id, before));
  };
  const nudge = (item: BriefItem, t: BriefTask, text: string) =>
    resolve(item, `Relance envoyée à ${t.owner} dans le fil de la tâche.`, () => postComment(t.id, text));

  /** Actions directes selon le type de point. Chaque bouton agit tout de suite ; l'assistant reste en option. */
  function quick(item: BriefItem) {
    const t = item.task;
    const b = (key: string, label: string, onClick: () => void, primary = false) =>
      <button key={key} data-quick={key} className={`btn ${primary ? "primary" : ""}`} disabled={busy === item.id} onClick={onClick}>{label}</button>;
    const reschedule = t && b("date", "Nouvelle date", () => setOpen(open === item.id ? null : item.id));
    switch (item.kind) {
      case "blocked": return [
        t && t.team.includes(me) && t.owner !== me && b("take", "Je m'en occupe", () => change(item, t, { owner: me, status: "doing" }, `Vous reprenez « ${t.name} », passée En cours.`), true),
        t && b("unblock", "C'est débloqué", () => change(item, t, { status: "doing" }, `« ${t.name} » est repassée En cours.`), !(t.team.includes(me) && t.owner !== me)),
        reschedule,
        t?.owner && t.owner !== me && b("nudge", `Relancer ${t.owner}`, () => nudge(item, t, `@${t.owner} où en es-tu sur « ${t.name} » ? De quoi as-tu besoin pour avancer ?`)),
      ];
      case "overdue": return [
        t && b("done", "C'est terminé", () => change(item, t, { status: "done" }, `« ${t.name} » est marquée Terminée.`), true),
        reschedule,
        t?.owner && t.owner !== me && b("why", "Demander la cause", () => nudge(item, t, `@${t.owner} « ${t.name} » a dépassé son échéance du ${fmt(t.due)}. Qu'est-ce qui l'a retardée, et quelle nouvelle date te paraît réaliste ? (pas de reproche : c'est pour mieux planifier)`)),
      ];
      case "due_soon": return [
        t && b("start", "Marquer En cours", () => change(item, t, { status: "doing" }, `« ${t.name} » est passée En cours.`), true),
        t?.owner && t.owner !== me && b("nudge", `Vérifier avec ${t.owner}`, () => nudge(item, t, `@${t.owner} l'échéance du ${fmt(t.due)} pour « ${t.name} » tient-elle toujours ?`)),
        reschedule,
      ];
      case "slipped": return [
        b("ack", "Accepter le glissement", () => { mark(item.id); }, true),
        reschedule,
      ];
      case "overload": return [b("open", open === item.id ? "Fermer" : "Rééquilibrer", () => setOpen(open === item.id ? null : item.id), true)];
      case "deliverable": return [b("open", open === item.id ? "Fermer" : "Voir les tâches", () => setOpen(open === item.id ? null : item.id), true)];
    }
  }

  /** Panneau déplié sous la carte : nouvelle date, ou réassignation des tâches concernées. */
  function panel(item: BriefItem) {
    if (open !== item.id) return null;
    if (item.task && (item.kind === "blocked" || item.kind === "overdue" || item.kind === "due_soon" || item.kind === "slipped")) {
      const t = item.task;
      const v = dates[item.id] ?? t.due ?? brief!.today;
      return (
        <div className="resolve">
          <label>Nouvelle échéance pour « {t.name} »
            <input type="date" id={`due-${item.id}`} value={v} min={brief!.today} onChange={(e) => setDates({ ...dates, [item.id]: e.target.value })} />
          </label>
          <button className="btn primary" disabled={!v || v === t.due || busy === item.id}
            onClick={() => change(item, t, { due: v }, `Échéance de « ${t.name} » passée au ${fmt(v)}. L'écart avec le plan de référence reste visible.`)}>Valider</button>
        </div>
      );
    }
    const list = item.tasks ?? [];
    return (
      <div className="resolve list">
        {list.map((t) => (
          <div className="rrow" key={t.id}>
            <span className="rname">{t.name}<span className="muted"> · {STATUS[t.status]} · {fmt(t.due)}</span></span>
            <select data-task-name={t.name} value={t.owner ?? ""} aria-label={`Responsable de « ${t.name} »`} disabled={busy === item.id}
              onChange={(e) => change(item, t, { owner: e.target.value || null }, `« ${t.name} » est confiée à ${e.target.value || "personne"}.`)}>
              <option value="">— à assigner</option>
              {t.team.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        ))}
        <p className="muted" style={{ margin: 0 }}>Choisir un autre membre de l&apos;équipe du projet applique le changement tout de suite.</p>
      </div>
    );
  }

  const card = (item: BriefItem) => {
    const r = resolved[item.id];
    if (r) {
      return (
        <article className="card resolved" data-sev={item.severity} data-kind={item.kind} key={item.id}>
          <div className="stripe" />
          <div className="body">
            <div style={{ minWidth: 0 }}><div className="meta"><span className="kind">✓ Réglé</span><span>· {item.projectName}</span></div><p className="done-line">{r.summary}</p></div>
            <div className="acts">{r.undo && <button className="btn ghost" disabled={busy === item.id} onClick={() => cancel(item.id)}>Annuler</button>}</div>
          </div>
        </article>
      );
    }
    const ask = item.actions.find((a) => a.type === "ask");
    return (
      <article className="card" data-sev={item.severity} data-kind={item.kind} key={item.id}>
        <div className="stripe" />
        <div className="body">
          <div style={{ minWidth: 0 }}>
            <div className="meta"><span className="kind">{KIND[item.kind]}</span><span>· {item.projectName}</span></div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </div>
          <div className="acts">
            {quick(item)}
            <button className="btn ghost" onClick={() => mark(item.id)} title="Masquer jusqu'à demain">Plus tard</button>
          </div>
          {panel(item)}
          {error?.id === item.id && <p className="card-error" role="alert">{error.text}</p>}
          {ask && <button className="ai-link" onClick={() => onAct(ask)}>Ou demander à l&apos;assistant : « {ask.label} »</button>}
        </div>
      </article>
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim() && scope) { onAct({ type: "ask", label: "", projectId: scope, prompt: q.trim() }); setQ(""); }
  };

  return (
    <>
      <section className="hero">
        <div className="date">{longDate(brief.today)}</div>
        <h1>{greeting()} {brief.user}.</h1>
        <p className="headline">{remaining === 0 ? "Vous avez traité tous les points du jour." : brief.headline}</p>
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
                <span>{p.pace !== null ? (p.pace >= 1 ? "en avance sur le rythme" : `${Math.round(p.pace * 100)} % du rythme attendu`) : ""}{p.endDate ? ` · fin ${fmt(p.endDate)}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="section-h">
        <h2>À décider aujourd&apos;hui</h2>
        <span className="muted">{urgent.length ? `${urgent.filter((i) => !resolved[i.id]).length} à traiter` : "Rien d'urgent"}</span>
      </div>
      {urgent.length ? <div className="cards">{urgent.map(card)}</div> : <div className="empty">Aucun blocage ni retard à traiter. Belle journée.</div>}

      {later.length > 0 && (
        <>
          <div className="section-h"><h2>À surveiller cette semaine</h2><span className="muted">{later.filter((i) => !resolved[i.id]).length} à traiter</span></div>
          <div className="cards">{later.map(card)}</div>
        </>
      )}
      {handled.length > 0 && (
        <p className="done-note">{handled.length} point{handled.length > 1 ? "s" : ""} masqué{handled.length > 1 ? "s" : ""} aujourd&apos;hui. <button className="btn ghost" onClick={reset}>Tout réafficher</button></p>
      )}
    </>
  );
}
