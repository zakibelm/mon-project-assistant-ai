// Test de la couche de données.
// Par défaut sur un PostgreSQL embarqué en mémoire (PGlite) : npm run test:db
// Sur un vrai serveur PostgreSQL (base vide, dédiée aux tests) :
//   TEST_DATABASE_URL=postgresql://user@host:5432/base_de_test npm run test:db
import assert from "node:assert/strict";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.SEED_DEMO = "1";
} else {
  process.env.PGLITE_DIR = "memory://";
  delete process.env.DATABASE_URL;
}

const { getDb } = await import("../lib/db/client");
const repo = await import("../lib/db/repo");
const { seedDemo, DEMO_ORG_ID } = await import("../lib/db/seed");
const s = await import("../lib/db/schema");

const db = await getDb();
const zaki = await repo.memberIdByName(db, DEMO_ORG_ID, "Zaki");
const actor = { memberId: zaki, kind: "member" as const };

// 1. Multi-projets : deux projets dans la même organisation, membres partagés
const list = await repo.listProjects(db, DEMO_ORG_ID);
assert.deepEqual(list.map((p) => p.name), ["Lancement du site web", "Migration du CRM"]);
const site = (await repo.getBoard(db, "prj_site"))!;
const crm = (await repo.getBoard(db, "prj_crm"))!;
assert.ok(site.members.some((m) => m.name === "Sami") && crm.members.some((m) => m.name === "Sami"), "Sami est sur les deux projets");
assert.equal(site.deliverables.length, 2);
assert.equal(site.items.length, 8);

// 2. Le seed ne s'exécute qu'une fois
await seedDemo(db);
assert.equal((await repo.listProjects(db, DEMO_ORG_ID)).length, 2);

// 3. Création journalisée
const [g] = site.groups;
const [created] = await repo.createTasks(db, "prj_site", { memberId: zaki, kind: "assistant" }, [{ name: "Rédiger la FAQ", groupId: g.id, owner: "Sami", due: "2026-11-07" }]);
let hist = await repo.getTaskHistory(db, created.id);
assert.equal(hist.length, 1);
assert.equal(hist[0].kind, "created");
assert.equal(hist[0].actorKind, "assistant");

// 4. Modification : un événement par champ changé ; glissement mesuré par rapport à la référence
await repo.updateTask(db, "prj_site", actor, created.id, { due: "2026-11-12", status: "doing", owner: "Sami" });
hist = await repo.getTaskHistory(db, created.id);
assert.deepEqual(hist.slice(1).map((e) => e.field).sort(), ["due_date", "status"], "owner inchangé : pas d'événement");
const after = (await repo.getBoard(db, "prj_site"))!.items.find((i) => i.id === created.id)!;
assert.equal(after.baselineDue, "2026-11-07");
assert.equal(after.due, "2026-11-12");
assert.equal((await repo.listProjects(db, DEMO_ORG_ID)).find((p) => p.id === "prj_site")!.slipped, 1);

// 5. Automatisation déclenchée par le changement de statut (règle seed : Bloqué → prévenir Zaki)
await repo.updateTask(db, "prj_site", actor, created.id, { status: "block" });
const notifs = (await repo.getBoard(db, "prj_site"))!.notifications;
assert.match(notifs[0].text, /Rédiger la FAQ.*Bloqué.*Zaki/);

// 6. Terminé : date de fin enregistrée
await repo.updateTask(db, "prj_site", actor, created.id, { status: "done" });
const [row] = await db.select().from(s.tasks).where((await import("drizzle-orm")).eq(s.tasks.id, created.id));
assert.ok(row.completedAt instanceof Date);

// 7. Garde-fous : membre hors projet, tâche d'un autre projet
await assert.rejects(repo.updateTask(db, "prj_crm", actor, created.id, { status: "todo" }), /Tâche introuvable/);
await assert.rejects(repo.createTasks(db, "prj_crm", actor, [{ name: "X", groupId: crm.groups[0].id, owner: "Léa" }]), /n'est pas membre du projet/);

// 8. Suppression : l'historique survit à la tâche
await repo.deleteTask(db, "prj_site", actor, created.id);
hist = await repo.getTaskHistory(db, created.id);
assert.equal(hist.at(-1)!.kind, "deleted");

// 9. Mention → notification
await repo.addComment(db, "prj_site", actor, site.items[0].id, "Merci @Léa pour la maquette");
assert.match((await repo.getBoard(db, "prj_site"))!.notifications[0].text, /Léa a été mentionné\(e\) par Zaki/);

// 10. Limite quotidienne d'IA : atomique
for (let k = 0; k < 3; k++) assert.equal((await repo.countAiRequest(db, DEMO_ORG_ID, 3)).ok, true);
assert.equal((await repo.countAiRequest(db, DEMO_ORG_ID, 3)).ok, false);
await repo.recordAiTokens(db, DEMO_ORG_ID, { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 });
assert.deepEqual(await repo.getAiUsage(db, DEMO_ORG_ID), { requests: 3, input: 10, output: 5, cacheRead: 100, cacheWrite: 0 });

console.log(`OK (${process.env.DATABASE_URL ? "PostgreSQL" : "PGlite"}) : 10 vérifications de la base passées (multi-projets, historique, glissement, automatisations, garde-fous, quota)`);
process.exit(0);
