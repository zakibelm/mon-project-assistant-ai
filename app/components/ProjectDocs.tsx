"use client";
import { useCallback, useEffect, useState } from "react";

interface Doc { source: string; file: string; title: string; tags: string[]; sections: number; size: number; updatedAt: string }
interface Hit { source: string; title: string; heading: string; text: string; score: number }

/**
 * Documents du projet (base de connaissances client, rag-client/<dossier>/) :
 * liste, ajout d'un texte ou d'un fichier .md/.txt, recherche de test.
 * L'assistant de ce projet cherche ici, et seulement ici, pour les questions sur le projet.
 */
export default function ProjectDocs({ projectId }: { projectId: string }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);

  const load = useCallback(async (query?: string) => {
    const d = await fetch(`/api/projects/${projectId}/documents${query ? `?q=${encodeURIComponent(query)}` : ""}`).then((r) => r.json());
    setFolder(d.folder); setDocs(d.docs ?? []); if (query !== undefined) setHits(d.results ?? []);
  }, [projectId]);
  useEffect(() => { setHits(null); setMsg(null); load(); }, [load]);

  async function add() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, content }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setDocs(d.docs); setName(""); setContent(""); setAdding(false);
      setMsg({ ok: true, text: `Document ajouté : ${d.folder}/${d.file}. L'assistant du projet peut maintenant s'en servir.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(md|txt)$/i.test(f.name)) { setMsg({ ok: false, text: "Seuls les fichiers texte .md ou .txt sont acceptés pour l'instant (copiez le texte d'un PDF ou d'un Word)." }); return; }
    if (f.size > 200 * 1024) { setMsg({ ok: false, text: "Fichier trop volumineux (200 Ko au maximum)." }); return; }
    const r = new FileReader();
    r.onload = () => { setContent(String(r.result ?? "")); if (!name) setName(f.name); setMsg(null); };
    r.readAsText(f, "utf-8");
  }

  if (!docs) return <p className="muted">Chargement des documents…</p>;
  if (!folder) return <p className="muted">Ce projet n&apos;a pas de dossier de documents.</p>;
  return (
    <div className="pdocs">
      <p className="muted small" style={{ margin: 0 }}>
        Tous les éléments du projet (comptes rendus, échanges avec le client, exigences, décisions). L&apos;assistant de ce projet y cherche pour les questions sur le projet, et seulement dans ce dossier. Dossier : <span className="mono">{folder}/</span>
      </p>
      <ul className="kdocs">
        {docs.map((d) => (
          <li key={d.source}><strong>{d.title}</strong> <span className="muted small">· <span className="mono">{d.file}</span> · {d.sections} extrait{d.sections > 1 ? "s" : ""} · {Math.max(1, Math.round(d.size / 1024))} Ko · {new Date(d.updatedAt).toLocaleDateString("fr-CA")}</span></li>
        ))}
        {docs.length === 0 && <li className="muted">Aucun document pour l&apos;instant.</li>}
      </ul>

      {!adding ? (
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => { setAdding(true); setMsg(null); }}>+ Ajouter un document</button>
      ) : (
        <div className="doc-form">
          <label className="sfield">Nom du document
            <input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Compte rendu du 5 novembre" />
          </label>
          <label className="sfield">Contenu (texte collé, ou fichier .md / .txt)
            <textarea id="doc-content" rows={8} value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="Collez ici le compte rendu, l'échange avec le client, les exigences…" />
          </label>
          <div className="settings-actions">
            <label className="btn file-btn">Importer un fichier .md / .txt<input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={(e) => pickFile(e.target.files?.[0])} /></label>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => { setAdding(false); setMsg(null); }}>Annuler</button>
            <button className="btn primary" onClick={add} disabled={busy}>{busy ? "Ajout…" : "Ajouter au dossier du projet"}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Pas de mots de passe ni de clés d&apos;accès : les extraits pertinents sont envoyés au modèle d&apos;IA.</p>
        </div>
      )}
      {msg && <p className={`test-result ${msg.ok ? "ok" : "ko"}`} role="status">{msg.text}</p>}

      <div className="ksearch">
        <input id="pdoc-q" placeholder="Tester une question sur ce projet, ex. « qui détient les accès au domaine ? »" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) load(q.trim()); }} aria-label="Question de test sur les documents du projet" />
        <button className="btn" onClick={() => q.trim() && load(q.trim())} disabled={!q.trim()}>Chercher</button>
      </div>
      {hits && (hits.length === 0 ? <p className="muted small">Aucun extrait pertinent dans les documents de ce projet.</p> : (
        <ol className="khits">
          {hits.map((h) => (
            <li key={h.source + h.heading}><strong>{h.heading}</strong> <span className="muted small">· <span className="mono">{h.source}</span> · pertinence {h.score}</span>
              <p>{h.text.length > 320 ? h.text.slice(0, 320) + "…" : h.text}</p></li>
          ))}
        </ol>
      ))}
    </div>
  );
}
