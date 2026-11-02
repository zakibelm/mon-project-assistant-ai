// Mesure de deux tâches types sur une version donnée.
// usage : node measure.cjs <url> <variant: base|inline> <label>
const { chromium } = require("playwright");
const [url, variant, label] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let clicks = 0, typed = 0, screens = 0, lastScreen = null;
  const click = async (sel) => { clicks++; await p.click(sel); await p.waitForTimeout(150); await track(); };
  const type = async (sel, txt) => { typed++; await p.fill(sel, txt); await p.press(sel, "Enter"); await p.waitForTimeout(150); };
  const track = async () => { const s = await p.textContent('.nav [aria-current="page"]').catch(() => null); if (s !== lastScreen) { if (lastScreen !== null) screens++; lastScreen = s; } };
  const aiCalls = async () => Number(await (await fetch("http://127.0.0.1:4557/")).text());
  await fetch("http://127.0.0.1:4557/reset", { method: "POST" });
  const api = async () => (await (await fetch(url + "/api/projects/prj_site")).json()).board.items;
  await p.goto(url); await p.waitForSelector(".card"); await track();
  const ai0 = await aiCalls();
  const results = {};
  const waitReply = async (n) => { try { await p.waitForFunction((k) => document.querySelectorAll(".msg.assistant:not(.muted), .msg.error").length >= k, n, { timeout: 15000 }); } catch {} await p.waitForTimeout(200); };

  let t0;
  // T2 : rééquilibrer Sami en confiant « Intégrer le formulaire de contact » à Léa
  t0 = Date.now();
  try {
    if (variant === "base") {
      await click('.card:has-text("porte") .acts .btn.primary');          // « Proposer un rééquilibrage »
      await waitReply(1);
      await type('.chat form input', "Confie « Intégrer le formulaire de contact » à Léa");
      await waitReply(2);
      await click('.nav button:has-text("Aujourd")');
    } else {
      await click('.card[data-kind="overload"] [data-quick="open"]');      // « Rééquilibrer »
      clicks++; await p.selectOption('.card[data-kind="overload"] select[data-task-name="Intégrer le formulaire de contact"]', "Léa"); await p.waitForTimeout(150);
      await p.waitForSelector('.card[data-kind="overload"].resolved', { timeout: 5000 });
    }
  } catch (e) { errs.push("T2: " + e.message.split("\n")[0]); }
  const form = (await api()).find((i) => i.name === "Intégrer le formulaire de contact");
  results.T2 = { ok: form.owner === "Léa", ms: Date.now() - t0 };

  // T1 : débloquer la tâche SSL en la reprenant soi-même (responsable Zaki, statut En cours)
  t0 = Date.now();
  try {
    if (variant === "base") {
      if (await p.$('.nav [aria-current="page"]:has-text("Aujourd")') === null) await click('.nav button:has-text("Aujourd")');
      await click('.card[data-sev="3"] .acts .btn.primary');            // « Proposer une solution »
      await waitReply(1);
      await type('.chat form input', "Assigne-moi cette tâche et passe-la en cours");
      await waitReply(2);
      await click('.nav button:has-text("Aujourd")');
    } else {
      await click('.card[data-kind="blocked"] [data-quick="take"]');      // « Je m'en occupe »
      await p.waitForSelector('.card[data-kind="blocked"].resolved', { timeout: 5000 });
    }
  } catch (e) { errs.push("T1: " + e.message.split("\n")[0]); }
  let ssl = (await api()).find((i) => i.name.startsWith("Configurer le nom de domaine"));
  results.T1 = { ok: ssl.owner === "Zaki" && ssl.status === "doing", ms: Date.now() - t0 };

  const ai = (await aiCalls()) - ai0;
  console.log(JSON.stringify({ label, T1: results.T1, T2: results.T2, done: [results.T1.ok, results.T2.ok].filter(Boolean).length + "/2", clicks, typedMessages: typed, screenChanges: screens, aiCalls: ai, errors: errs }));
  await b.close();
})();
