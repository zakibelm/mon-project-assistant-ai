/**
 * Bases de connaissances (RAG) : fichiers Markdown ou texte, découpés en extraits et
 * cherchés en plein texte (BM25), en mémoire, sans service externe ni coût.
 *
 * - rag-metier/ : connaissances métier communes (méthodes, règles du PMO, glossaire).
 * - rag-client/<dossier-du-projet>/ : un dossier par projet, avec tous ses éléments
 *   (fiche projet, comptes rendus, échanges, spécifications). Cloisonné : une recherche
 *   sur un projet ne lit que le dossier de ce projet.
 *
 * Chaque section « ## » est un extrait ; un texte sans sections est découpé en paragraphes.
 * Les fichiers sont relus quand ils changent (vérification au plus une fois par minute).
 * Évolution possible : recherche par le sens (plongements, pgvector) si les bases grossissent.
 */
import fs from "fs";
import path from "path";

export interface Extract { id: string; source: string; title: string; tags: string[]; heading: string; text: string }
export interface Hit extends Extract { score: number }
export interface KnowledgeDoc { source: string; file: string; title: string; tags: string[]; origin: string; sections: number; size: number; updatedAt: string }

const STOP = new Set(("le la les l de des du d un une et ou a au aux en pour par sur dans est sont que qui qu ne pas plus ce cet cette ces " +
  "son sa ses leur leurs il elle on nous vous ils elles se s y avec sans mais donc comme tout tous toute toutes etre avoir fait faire " +
  "si ni car quand dont c j m n t me te lui eux mon ma mes ton ta tes notre nos votre vos quel quelle quels quelles est-ce").split(" "));

export function tokens(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w))
    // Racinisation légère : on garde le début du mot (« répond », « réponse » → « repon »).
    .map((w) => (/^\d+$/.test(w) ? w : w.slice(0, 5)));
}

/* ------------------------------------------------------------------ dossiers */

export const metierDir = () => process.env.RAG_METIER_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "rag-metier");
export const clientRoot = () => process.env.RAG_CLIENT_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "rag-client");

/** Nom de dossier sûr pour un projet (lettres, chiffres, tirets). */
export function slugify(name: string) {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "projet";
}
function projectDir(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new Error("Dossier de projet invalide.");
  return path.join(/*turbopackIgnore: true*/ clientRoot(), slug);
}

/* ------------------------------------------------------------------ lecture */

function parse(file: string, label: string): { doc: KnowledgeDoc; extracts: Extract[] } | null {
  const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const st = fs.statSync(file);
  let body = raw;
  const meta: Record<string, string> = {};
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    body = raw.slice(fm[0].length);
    for (const line of fm[1].split("\n")) { const m = line.match(/^(\w+)\s*:\s*(.*)$/); if (m) meta[m[1].toLowerCase()] = m[2].trim(); }
  }
  const title = meta.titre || meta.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file).replace(/\.(md|txt)$/, "");
  const tags = (meta.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const extracts: Extract[] = [];
  const push = (heading: string, text: string) =>
    extracts.push({ id: `${label}#${extracts.length}`, source: label, title, tags, heading, text: text.slice(0, 2500) });

  if (/^##\s+/m.test(body)) {
    const parts = body.split(/^##\s+/m);
    const intro = parts.shift()?.replace(/^#\s+.+$/m, "").trim();
    if (intro && intro.length > 40) push(title, intro);
    for (const p of parts) {
      const nl = p.indexOf("\n");
      const heading = (nl < 0 ? p : p.slice(0, nl)).trim(), text = (nl < 0 ? "" : p.slice(nl + 1)).trim();
      if (text) push(heading, text);
    }
  } else {
    // Texte sans sections (ex. compte rendu collé tel quel) : paragraphes regroupés par blocs d'environ 1 200 caractères.
    let buf = "", n = 0;
    for (const para of body.replace(/^#\s+.+$/m, "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
      if (buf && buf.length + para.length > 1200) { push(`${title} (partie ${++n})`, buf); buf = ""; }
      buf += (buf ? "\n\n" : "") + para;
    }
    if (buf) push(n ? `${title} (partie ${++n})` : title, buf);
  }
  if (!extracts.length) return null;
  return {
    doc: { source: label, file: path.basename(file), title, tags, origin: meta.source || "", sections: extracts.length, size: st.size, updatedAt: st.mtime.toISOString() },
    extracts,
  };
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(/*turbopackIgnore: true*/ dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(f));
    else if (/\.(md|txt)$/i.test(e.name) && e.name.toLowerCase() !== "readme.md") out.push(f);
  }
  return out.sort();
}

interface Index {
  docs: KnowledgeDoc[]; extracts: Extract[];
  tf: Map<string, number>[]; len: number[]; avg: number; df: Map<string, number>;
  /** Mots du titre et des mots-clés du document de chaque extrait (bonus, hors calcul de rareté). */
  meta: Set<string>[];
  signature: string; checkedAt: number;
}
const caches = new Map<string, Index>();

function build(dir: string, labelRoot: string): Index {
  const files = listFiles(dir);
  const signature = files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join("|");
  const old = caches.get(dir);
  if (old && old.signature === signature) { old.checkedAt = Date.now(); return old; }
  const docs: KnowledgeDoc[] = [], extracts: Extract[] = [];
  for (const f of files) {
    try {
      const label = path.join(/*turbopackIgnore: true*/ labelRoot, path.relative(dir, f)).split(path.sep).join("/");
      const r = parse(f, label);
      if (r) { docs.push(r.doc); extracts.push(...r.extracts); }
    } catch (e) { console.error("[rag] lecture impossible", f, e); }
  }
  const tf: Map<string, number>[] = [], len: number[] = [], df = new Map<string, number>(), meta: Set<string>[] = [];
  for (const x of extracts) {
    // L'intitulé de section pèse plus que le corps du texte. Le titre et les mots-clés du document ne sont pas
    // recopiés dans chaque extrait (sinon, dans un petit dossier, ces mots seraient partout et ne distingueraient plus rien) :
    // ils donnent un petit bonus à la recherche.
    meta.push(new Set([...tokens(x.title), ...tokens(x.tags.join(" "))]));
    const words = [...tokens(x.text), ...tokens(x.heading), ...tokens(x.heading), ...tokens(x.heading)];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
    tf.push(m); len.push(words.length);
    for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const ix = { docs, extracts, tf, len, df, meta, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length), signature, checkedAt: Date.now() };
  caches.set(dir, ix);
  return ix;
}

function index(dir: string, labelRoot: string): Index {
  const c = caches.get(dir);
  if (c && Date.now() - c.checkedAt < 60_000) return c;
  return build(dir, labelRoot);
}

function search(ix: Index, query: string, k: number): Hit[] {
  const q = [...new Set(tokens(query))];
  if (!q.length || !ix.extracts.length) return [];
  const N = ix.extracts.length, k1 = 1.4, b = 0.75;
  return ix.extracts.map((x, i) => {
    let score = 0;
    for (const w of q) {
      if (ix.meta[i].has(w)) score += 0.4;
      const f = ix.tf[i].get(w); if (!f) continue;
      const d = ix.df.get(w) ?? 0;
      score += Math.log(1 + (N - d + 0.5) / (d + 0.5)) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * ix.len[i]) / ix.avg)));
    }
    return { ...x, score: Math.round(score * 100) / 100 };
  }).filter((h) => h.score > 0.5).sort((a, c) => c.score - a.score).slice(0, k);
}

/* ------------------------------------------------------------------ base métier */

export function listKnowledge(): KnowledgeDoc[] { return index(metierDir(), "rag-metier").docs; }
export function searchKnowledge(query: string, k = 4): Hit[] { return search(index(metierDir(), "rag-metier"), query, k); }

/* ---------------------------------------------------- dossiers projet (client) */

export function listProjectDocs(slug: string): KnowledgeDoc[] { return index(projectDir(slug), `rag-client/${slug}`).docs; }
/** Cherche uniquement dans le dossier de ce projet (jamais dans celui d'un autre client). */
export function searchProjectDocs(slug: string, query: string, k = 4): Hit[] { return search(index(projectDir(slug), `rag-client/${slug}`), query, k); }

/** Force la relecture des dossiers (tests, ou après un ajout de document). */
export function reloadKnowledge() { caches.clear(); return build(metierDir(), "rag-metier"); }

export const MAX_DOC_BYTES = 200 * 1024;

/** Nom de fichier sûr : lettres, chiffres, tirets, extension .md ou .txt ; pas de chemin. */
export function safeFileName(name: string) {
  const ext = /\.txt$/i.test(name) ? ".txt" : ".md";
  const base = slugify(path.basename(name).replace(/\.(md|txt|markdown)$/i, ""));
  return `${base}${ext}`;
}

/** Ajoute un document au dossier d'un projet ; ne remplace jamais un fichier existant. */
export function writeProjectDoc(slug: string, name: string, content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) throw new Error("Document trop volumineux (200 Ko au maximum).");
  const dir = projectDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  let file = safeFileName(name);
  for (let i = 2; fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, file)); i++) file = file.replace(/(-\d+)?(\.\w+)$/, `-${i}$2`);
  fs.writeFileSync(path.join(/*turbopackIgnore: true*/ dir, file), content, { mode: 0o640 });
  caches.delete(dir);
  return file;
}

/** Crée le dossier d'un projet avec sa fiche (sans écraser une fiche existante). */
export function ensureProjectFolder(slug: string, fiche: string) {
  const dir = projectDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(/*turbopackIgnore: true*/ dir, "fiche-projet.md");
  if (!fs.existsSync(f)) fs.writeFileSync(f, fiche, { mode: 0o640 });
  caches.delete(dir);
}

/** Mise en forme des extraits pour un prompt, avec leur source. */
export function formatExtracts(hits: Hit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${h.source} — ${h.title} › ${h.heading}\n${h.text}`).join("\n\n");
}

/** Fiche projet générée à la création : le premier document du dossier. */
export function projectFiche(p: {
  name: string; description: string; start: string | null; end: string | null;
  deliverables: { name: string; due: string | null }[]; stakeholders: { name: string; role: string }[]; team: { name: string; role: string }[];
}) {
  const d = (x: string | null) => x ?? "à préciser";
  return `---
titre: Fiche projet — ${p.name}
tags: fiche, contexte, objectif, livrables, parties prenantes, équipe
source: Générée à la création du projet
---

# ${p.name}

## Objectif et périmètre

${p.description || "À préciser."}

## Dates

Début : ${d(p.start)}. Fin prévue : ${d(p.end)}.

## Livrables

${p.deliverables.map((x) => `- ${x.name} : ${d(x.due)}`).join("\n") || "À préciser."}

## Parties prenantes

${p.stakeholders.map((x) => `- ${x.name}${x.role ? ` : ${x.role}` : ""}`).join("\n") || "À préciser."}

## Équipe

${p.team.map((x) => `- ${x.name} : ${x.role}`).join("\n") || "À préciser."}
`;
}
