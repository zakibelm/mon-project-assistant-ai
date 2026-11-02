// Exporte les extraits de rag-metier/ en JSON (pour la démo interactive, qui n'a pas accès au serveur).
const { reloadKnowledge } = await import("../lib/rag/index");
const ix = reloadKnowledge();
process.stdout.write(JSON.stringify({
  docs: ix.docs.map((d) => ({ source: d.source, title: d.title, tags: d.tags, sections: d.sections })),
  extracts: ix.extracts.map((x) => ({ source: x.source, title: x.title, tags: x.tags, heading: x.heading, text: x.text })),
}));
