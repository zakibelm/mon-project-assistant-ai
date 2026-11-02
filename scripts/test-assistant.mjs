// Test de bout en bout de /api/assistant SANS appeler de vrai modèle :
// un faux serveur imite le point d'entrée Messages d'OpenRouter, et l'app Next
// tourne avec AI_BASE_URL pointé dessus. Usage : npm run build && npm run test:assistant
import { spawn } from "node:child_process";
import http from "node:http";
import assert from "node:assert/strict";

const MOCK_PORT = 4555, APP_PORT = 3999;
const seen = [];
let scenario = "plan";

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body || "{}");
    seen.push({ path: req.url, auth: req.headers.authorization, title: req.headers["x-title"], body: json });
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const usage = { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 };
    const msg = (content, stop_reason) => send(200, { id: "msg_" + seen.length, type: "message", role: "assistant", model: json.model, content, stop_reason, stop_sequence: null, usage });

    if (scenario === "unauthorized") return send(401, { type: "error", error: { type: "authentication_error", message: "bad key" } });

    const last = json.messages.at(-1);
    const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
    if (scenario === "plan") {
      if (!results.length) return msg([{ type: "text", text: "Je crée le groupe." }, { type: "tool_use", id: "tu_1", name: "create_group", input: { name: "Événement client" } }], "tool_use");
      if (results[0].tool_use_id === "tu_1") {
        const gid = JSON.parse(results[0].content).id;
        return msg([
          { type: "tool_use", id: "tu_2", name: "create_items", input: { items: [
            { name: "Réserver le lieu", group_id: gid, owner: "Inès", due: "2026-11-13", priority: "Haute", subtasks: ["3 devis", "Visite"] },
            { name: "Envoyer les invitations", group_id: gid, owner: "Léa", due: "2026-11-16" },
          ] } },
          // Entrée invalide volontaire : doit revenir en is_error sans casser la boucle.
          { type: "tool_use", id: "tu_3", name: "update_item", input: { item_id: "t3", status: "pas-un-statut" } },
        ], "tool_use");
      }
      return msg([{ type: "text", text: "Projet planifié : 2 tâches créées." }], "end_turn");
    }
    if (scenario === "refusal") return msg([], "refusal");
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, r));

const app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
  env: { ...process.env, PGLITE_DIR: "memory://", DATABASE_URL: "", OPENROUTER_API_KEY: "sk-or-test", AI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let logs = ""; app.stdout.on("data", (d) => (logs += d)); app.stderr.on("data", (d) => (logs += d));
const base = `http://127.0.0.1:${APP_PORT}`;
for (let i = 0; i < 60; i++) { try { await fetch(base + "/api/projects"); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const ask = (message) => fetch(base + "/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "prj_site", message }) }).then(async (r) => ({ status: r.status, data: await r.json() }));

try {
  // 1. Planification avec outils
  const r1 = await ask("Planifie un événement client");
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.reply, "Projet planifié : 2 tâches créées.");
  assert.deepEqual(r1.data.actions, ["Groupe créé : Événement client", "2 tâche(s) créée(s)"]);
  const g = r1.data.board.groups.find((x) => x.name === "Événement client");
  assert.ok(g, "groupe créé");
  const createdItems = r1.data.board.items.filter((i) => i.groupId === g.id);
  assert.equal(createdItems.length, 2);
  assert.equal(createdItems.find((i) => i.name === "Réserver le lieu").baselineDue, "2026-11-13");
  assert.equal(r1.data.board.items.find((i) => i.name.startsWith("Configurer le nom de domaine")).status, "block", "entrée invalide non appliquée");

  // Historique : la création est journalisée comme faite par l'assistant
  const hist = await fetch(`${base}/api/tasks/${createdItems[0].id}/history`).then((r) => r.json());
  assert.equal(hist.events[0].kind, "created");
  assert.equal(hist.events[0].actorKind, "assistant");

  // Portefeuille : le projet compte les nouvelles tâches
  const pf = await fetch(base + "/api/projects").then((r) => r.json());
  assert.equal(pf.projects.find((p) => p.id === "prj_site").total, 10);

  // Requête envoyée au « OpenRouter » : chemin, auth, modèle, cache, outils
  const first = seen[0];
  assert.equal(first.path, "/v1/messages");
  assert.equal(first.auth, "Bearer sk-or-test");
  assert.equal(first.title, "Assistant Projet");
  assert.equal(first.body.model, "anthropic/claude-opus-5.5");
  assert.deepEqual(first.body.system[0].cache_control, { type: "ephemeral" });
  const ctx = first.body.messages.at(-1).content[0].text;
  assert.match(ctx, /"deliverables":\[\{"name":"Site en ligne"/, "le contexte du projet est envoyé au modèle");
  assert.deepEqual(first.body.tools.map((t) => t.name), ["create_group", "create_items", "update_item", "delete_item", "add_comment", "create_automation"]);
  const third = seen[2].body.messages.at(-1).content;
  assert.equal(third.find((b) => b.tool_use_id === "tu_3").is_error, true, "erreur de validation renvoyée au modèle");
  assert.equal(seen.length, 3);
  assert.equal(r1.data.usage.cacheRead, 4500);

  // 2. Refus du filtre de sécurité
  scenario = "refusal";
  const r2 = await ask("…");
  assert.equal(r2.status, 200);
  assert.match(r2.data.reply, /reformuler/);

  // 3. Clé refusée par OpenRouter
  scenario = "unauthorized";
  const r3 = await ask("Résume");
  assert.equal(r3.status, 502);
  assert.match(r3.data.error, /Clé OpenRouter refusée/);

  // 4. Requête invalide
  const r4 = await fetch(base + "/api/assistant", { method: "POST", body: "{}" });
  assert.equal(r4.status, 400);
  const r5 = await fetch(base + "/api/assistant", { method: "POST", body: JSON.stringify({ projectId: "inconnu", message: "x" }) });
  assert.equal(r5.status, 404);

  console.log("OK : 5 scénarios passés (planification avec outils et historique, refus, clé refusée, requête invalide, projet inconnu)");
} catch (e) {
  console.error(e.message, "\n--- logs app ---\n", logs.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-app.pid); } catch {}
  mock.close();
  process.exit();
}
