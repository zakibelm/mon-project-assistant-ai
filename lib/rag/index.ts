/**
 * Base de connaissances métier (RAG) : les fichiers Markdown du dossier rag/.
 *
 * Chaque section « ## » d'un document est un extrait. La recherche est plein texte (BM25),
 * faite en mémoire, sans service externe ni coût : suffisant pour quelques centaines
 * d'extraits. Évolution possible : des plongements vectoriels (pgvector) si la base grossit.
 * Les fichiers sont relus quand ils changent (vérification au plus une fois par minute).
 */
import fs from "fs";
import path from "path";

export interface Extract {
  id: string;
  source: string; // chemin relatif, ex. rag/methodes/gestion-des-retards.md
  title: string;
  tags: string[];
  heading: string;
  text: string;
}
export interface Hit extends Extract { score: number }
export interface KnowledgeDoc { source: string; title: string; tags: string[]; origin: string; sections: number }

const STOP = new Set(("le la les l de des du d un une et ou a au aux en pour par sur dans est sont que qui qu ne pas plus ce cet cette ces " +
  "son sa ses leur leurs il elle on nous vous ils elles se s y avec sans mais donc comme tout tous toute toutes etre avoir fait faire " +
  "si ni car quand dont c j m n t me te lui eux mon ma mes ton ta tes notre nos votre vos quel quelle quels quelles est-ce").split(" "));

export function tokens(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w))
    // Racinisation légère : on garde le début du mot (« répond », « réponse » → « repon »).
    .map((w) => (/^\d+$/.test(w) ? w : w.slice(0, 5)));
}

function parse(file: string, root: string): { doc: KnowledgeDoc; extracts: Extract[] } | null {
  const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  let body = raw, meta: Record<string, string> = {};
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    body = raw.slice(fm[0].length);
    for (const line of fm[1].split("\n")) { const m = line.match(/^(\w+)\s*:\s*(.*)$/); if (m) meta[m[1].toLowerCase()] = m[2].trim(); }
  }
  const source = path.join("rag", path.relative(root, file)).split(path.sep).join("/");
  const title = meta.titre || meta.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file, ".md");
  const tags = (meta.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const extracts: Extract[] = [];
  const parts = body.split(/^##\s+/m);
  const intro = parts.shift()?.replace(/^#\s+.+$/m, "").trim();
  if (intro && intro.length > 40) extracts.push({ id: `${source}#intro`, source, title, tags, heading: title, text: intro });
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const heading = (nl < 0 ? p : p.slice(0, nl)).trim();
    const text = (nl < 0 ? "" : p.slice(nl + 1)).trim();
    if (!text) continue;
    extracts.push({ id: `${source}#${tokens(heading).join("-") || extracts.length}`, source, title, tags, heading, text: text.slice(0, 2500) });
  }
  if (!extracts.length) return null;
  return { doc: { source, title, tags, origin: meta.source || "", sections: extracts.length }, extracts };
}

interface Index {
  docs: KnowledgeDoc[]; extracts: Extract[];
  tf: Map<string, number>[]; len: number[]; avg: number; df: Map<string, number>;
  signature: string; checkedAt: number;
}
let cache: Index | null = null;

export const ragDir = () => process.env.RAG_DIR || path.join(process.cwd(), "rag");

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(f));
    else if (e.name.endsWith(".md") && e.name.toLowerCase() !== "readme.md") out.push(f);
  }
  return out.sort();
}

function build(): Index {
  const root = ragDir(), files = listFiles(root);
  const signature = files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join("|");
  if (cache && cache.signature === signature) { cache.checkedAt = Date.now(); return cache; }
  const docs: KnowledgeDoc[] = [], extracts: Extract[] = [];
  for (const f of files) {
    try { const r = parse(f, root); if (r) { docs.push(r.doc); extracts.push(...r.extracts); } }
    catch (e) { console.error("[rag] lecture impossible", f, e); }
  }
  const tf: Map<string, number>[] = [], len: number[] = [], df = new Map<string, number>();
  for (const x of extracts) {
    // Le titre, les mots-clés et l'intitulé de section pèsent plus que le corps du texte.
    const words = [...tokens(x.text), ...tokens(x.heading), ...tokens(x.heading), ...tokens(x.heading), ...tokens(x.title), ...tokens(x.tags.join(" "))];
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
    tf.push(m); len.push(words.length);
    for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const avg = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  cache = { docs, extracts, tf, len, avg, df, signature, checkedAt: Date.now() };
  return cache;
}

function index(): Index {
  if (cache && Date.now() - cache.checkedAt < 60_000) return cache;
  return build();
}

/** Force la relecture du dossier (tests, ou après un ajout de document). */
export function reloadKnowledge() { cache = null; return build(); }

export function listKnowledge(): KnowledgeDoc[] { return index().docs; }

/** Recherche BM25 : les k extraits les plus pertinents pour la question. */
export function searchKnowledge(query: string, k = 4): Hit[] {
  const ix = index();
  const q = [...new Set(tokens(query))];
  if (!q.length || !ix.extracts.length) return [];
  const N = ix.extracts.length, k1 = 1.4, b = 0.75;
  const scored = ix.extracts.map((x, i) => {
    let score = 0;
    for (const w of q) {
      const f = ix.tf[i].get(w); if (!f) continue;
      const idf = Math.log(1 + (N - (ix.df.get(w) ?? 0) + 0.5) / ((ix.df.get(w) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * ix.len[i]) / ix.avg)));
    }
    return { ...x, score: Math.round(score * 100) / 100 };
  });
  return scored.filter((h) => h.score > 0.5).sort((a, b2) => b2.score - a.score).slice(0, k);
}

/** Mise en forme des extraits pour un prompt, avec leur source. */
export function formatExtracts(hits: Hit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${h.source} — ${h.title} › ${h.heading}\n${h.text}`).join("\n\n");
}
