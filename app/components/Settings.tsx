"use client";
import { useEffect, useState } from "react";

interface View {
  keySource: "settings" | "env" | null; keyLast4: string | null;
  model: string; modelSource: "settings" | "env" | "default"; dailyLimit: number;
  models: readonly { id: string; label: string; note: string }[];
  updatedAt: string | null; updatedBy: string | null;
}
interface Usage { requests: number; input: number; output: number; cacheRead: number }
type Test = { ok: true; model: string; ms: number; reply: string } | { ok: false; error: string; model?: string };
interface KDoc { source: string; title: string; tags: string[]; origin: string; sections: number }
interface KHit { source: string; title: string; heading: string; text: string; score: number }

/** Base de connaissances métier (dossier rag/) : documents chargés et recherche de test. */
function Knowledge() {
  const [docs, setDocs] = useState<KDoc[] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<KHit[] | null>(null);
  const load = (extra = "") => fetch(`/api/knowledge${extra}`).then((r) => r.json());
  useEffect(() => { load().then((d) => setDocs(d.docs)); }, []);
  const search = async () => { if (!q.trim()) return; const d = await load(`?q=${encodeURIComponent(q.trim())}`); setDocs(d.docs); setHits(d.results); };
  return (
    <section className="panel sgroup">
      <h2>Base de connaissances <span className="muted small">dossier rag/</span></h2>
      <p className="muted small" style={{ margin: 0 }}>Documents métier (méthodes, règles du PMO, glossaire) que l&apos;IA consulte et cite avant de répondre. Pour en ajouter : un fichier Markdown dans le dossier <span className="mono">rag/</span> du serveur (voir <span className="mono">rag/README.md</span>).</p>
      {!docs ? <p className="muted small">Chargement…</p> : docs.length === 0 ? <p className="warn-text">Aucun document : le dossier rag/ est vide ou introuvable.</p> : (
        <ul className="kdocs">
          {docs.map((d) => (
            <li key={d.source}><strong>{d.title}</strong> <span className="muted small">· {d.sections} extrait{d.sections > 1 ? "s" : ""} · <span className="mono">{d.source}</span></span>
              {d.tags.length > 0 && <div className="muted small">{d.tags.join(", ")}</div>}</li>
          ))}
        </ul>
      )}
      <div className="ksearch">
        <input id="k-q" placeholder="Tester une question, ex. « le fournisseur ne répond pas »" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }} aria-label="Question de test pour la base de connaissances" />
        <button className="btn" onClick={search} disabled={!q.trim()}>Chercher</button>
        <button className="btn ghost" onClick={() => load("?reload=1").then((d) => setDocs(d.docs))} title="Relire le dossier après un ajout">Relire le dossier</button>
      </div>
      {hits && (hits.length === 0 ? <p className="muted small">Aucun extrait pertinent.</p> : (
        <ol className="khits">
          {hits.map((h) => (
            <li key={h.source + h.heading}><strong>{h.heading}</strong> <span className="muted small">· {h.title} · <span className="mono">{h.source}</span> · pertinence {h.score}</span>
              <p>{h.text.length > 320 ? h.text.slice(0, 320) + "…" : h.text}</p></li>
          ))}
        </ol>
      ))}
    </section>
  );
}

/** Paramètres de l'IA : clé OpenRouter (chiffrée, jamais réaffichée), modèle, limite quotidienne, test de connexion. */
export default function Settings() {
  const [view, setView] = useState<View | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [custom, setCustom] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<Test | null>(null);

  const apply = (v: View) => {
    setView(v);
    const known = v.models.some((m) => m.id === v.model);
    setModel(known ? v.model : "autre"); setCustom(known ? "" : v.model);
    setLimit(String(v.dailyLimit));
  };
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => { apply(d.settings); setCanEdit(d.canEdit); setUsage(d.usage); });
  }, []);

  const chosenModel = model === "autre" ? custom.trim() : model;
  const dirty = !!view && (key.trim() !== "" || chosenModel !== view.model || Number(limit) !== view.dailyLimit);

  async function save(body: Record<string, unknown>, kind: "save" | "delete") {
    setBusy(kind); setMsg(null); setTest(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      apply(d.settings); setKey("");
      setMsg({ ok: true, text: kind === "delete" ? "Clé supprimée." : "Paramètres enregistrés." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }
  const onSave = () => {
    const body: Record<string, unknown> = { model: chosenModel, dailyLimit: Number(limit) };
    if (key.trim()) body.key = key.trim();
    save(body, "save");
  };
  async function onTest() {
    setBusy("test"); setTest(null); setMsg(null);
    try {
      const body: Record<string, unknown> = { model: chosenModel };
      if (key.trim()) body.key = key.trim();
      const res = await fetch("/api/settings/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setTest(await res.json());
    } catch { setTest({ ok: false, error: "Le serveur n'a pas répondu." }); } finally { setBusy(null); }
  }

  if (!view) return <p className="muted" style={{ padding: 24 }}>Chargement des paramètres…</p>;
  const keyLine = view.keySource === "settings"
    ? <>Clé enregistrée, <strong>chiffrée</strong>, se termine par <span className="mono">…{view.keyLast4}</span>{view.updatedBy ? ` · modifiée par ${view.updatedBy}` : ""}</>
    : view.keySource === "env"
      ? <>Clé du serveur (fichier <span className="mono">.env</span>), se termine par <span className="mono">…{view.keyLast4}</span>. Une clé saisie ici la remplacera.</>
      : <span className="warn-text">Aucune clé : l&apos;assistant, le cadrage et les leçons apprises sont désactivés.</span>;

  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Paramètres</h1>
        <p className="muted">Modèle d&apos;IA et clé OpenRouter utilisés par l&apos;assistant, le cadrage des projets et les leçons apprises.</p>
      </div>
      {!canEdit && <p className="msg error">Lecture seule : seul un chef de projet peut modifier ces paramètres.</p>}

      <section className="panel sgroup">
        <h2>Clé OpenRouter</h2>
        <p className="kline">{keyLine}</p>
        <label className="sfield">{view.keySource ? "Remplacer la clé" : "Clé"}
          <input id="or-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-or-…" value={key}
            onChange={(e) => setKey(e.target.value)} disabled={!canEdit} />
        </label>
        <p className="muted small">Créez une clé sur <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>. Elle est chiffrée avant d&apos;être enregistrée et n&apos;est jamais réaffichée : seuls ses 4 derniers caractères le sont.</p>
        {view.keySource === "settings" && canEdit && (
          <button className="btn ghost danger" disabled={!!busy} onClick={() => save({ key: null }, "delete")}>
            {busy === "delete" ? "Suppression…" : "Supprimer la clé enregistrée"}
          </button>
        )}
      </section>

      <section className="panel sgroup">
        <h2>Modèle</h2>
        <div className="models" role="radiogroup" aria-label="Modèle d'IA">
          {view.models.map((m) => (
            <label key={m.id} className={`mcard ${model === m.id ? "on" : ""}`}>
              <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} disabled={!canEdit} />
              <span><strong>{m.label}</strong><span className="muted">{m.note}</span><span className="mono small">{m.id}</span></span>
            </label>
          ))}
          <label className={`mcard ${model === "autre" ? "on" : ""}`}>
            <input type="radio" name="model" value="autre" checked={model === "autre"} onChange={() => setModel("autre")} disabled={!canEdit} />
            <span><strong>Autre modèle OpenRouter</strong>
              <input id="model-custom" className="mono" placeholder="fournisseur/modèle" value={custom} onFocus={() => setModel("autre")}
                onChange={(e) => setCustom(e.target.value)} disabled={!canEdit} /></span>
          </label>
        </div>
      </section>

      <section className="panel sgroup">
        <h2>Limite quotidienne</h2>
        <label className="sfield inline">Demandes à l&apos;IA par jour, pour toute l&apos;organisation
          <input id="limit" type="number" min={1} max={10000} value={limit} onChange={(e) => setLimit(e.target.value)} disabled={!canEdit} />
        </label>
        {usage && <p className="muted small">Aujourd&apos;hui : {usage.requests} demande(s), {usage.input + usage.cacheRead} tokens lus (dont {usage.cacheRead} depuis le cache), {usage.output} écrits.</p>}
      </section>

      <Knowledge />

      <div className="settings-actions">
        <button className="btn" onClick={onTest} disabled={!!busy || (!view.keySource && !key.trim()) || !chosenModel}>
          {busy === "test" ? "Test en cours…" : "Tester la connexion"}
        </button>
        <button className="btn primary" onClick={onSave} disabled={!canEdit || !!busy || !dirty || !chosenModel}>
          {busy === "save" ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
      {test && (
        <p className={`test-result ${test.ok ? "ok" : "ko"}`} role="status">
          {test.ok ? `Connexion réussie avec ${test.model} en ${(test.ms / 1000).toFixed(1)} s${test.reply ? ` (réponse : « ${test.reply} »)` : ""}.` : test.error}
          {test.ok && key.trim() && " Pensez à enregistrer la clé."}
        </p>
      )}
      {msg && <p className={`test-result ${msg.ok ? "ok" : "ko"}`} role="status">{msg.text}</p>}
    </div>
  );
}
