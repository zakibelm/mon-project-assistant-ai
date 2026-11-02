// Test de la couche de données.
// Par défaut sur un PostgreSQL embarqué en mémoire (PGlite) : npm run test:db
// Sur un vrai serveur PostgreSQL (base vide, dédiée aux tests) :
//   TEST_DATABASE_URL=postgresql://user@host:5432/base_de_test npm run test:db
import assert from "node:assert/strict";

// Documents clients du seed écrits dans un dossier temporaire, jamais dans le dépôt.
const fsT = await import("node:fs"), osT = await import("node:os"), pathT = await import("node:path");
process.env.RAG_CLIENT_DIR = fsT.mkdtempSync(pathT.join(osT.tmpdir(), "rag-client-"));
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

const { computeBrief } = await import("../lib/brief");
const db = await getDb();

// 0. Point du jour sur les données de démonstration, au 2 novembre 2026 (avant toute modification)
const brief = await computeBrief(db, DEMO_ORG_ID, "Zaki", "2026-11-02");
assert.equal(brief.headline, "1 point à traiter aujourd'hui, 2 à surveiller.");
assert.deepEqual(brief.items.map((i) => [i.severity, i.kind]), [[3, "blocked"], [2, "deliverable"], [2, "overload"]]);
const blocked = brief.items[0];
assert.match(blocked.detail, /accès au registrar/, "le dernier message est cité");
assert.ok(blocked.actions.every((a) => a.type === "ask" && a.projectId === "prj_site" && a.prompt.length > 20));
assert.match(brief.items[2].title, /Sami porte 4 tâches ouvertes sur 2 projets/);
assert.deepEqual(brief.pulse.map((p) => [p.id, p.state]), [["prj_site", "late"], ["prj_crm", "watch"]]);
// Plus tard, la tâche « Choisir les photos » (todo, 06/11) devient une échéance proche, puis un retard
const later = await computeBrief(db, DEMO_ORG_ID, "Zaki", "2026-11-04");
assert.ok(later.items.some((i) => i.kind === "due_soon" && i.title.includes("Choisir les photos")));
const late = await computeBrief(db, DEMO_ORG_ID, "Zaki", "2026-11-09");
assert.ok(late.items.some((i) => i.kind === "overdue" && i.title.includes("Choisir les photos") && i.title.includes("3 jours")));
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

// 11. Création d'un projet à partir d'un brouillon : membres existants réutilisés, nouveaux créés, plan de référence figé
const before = await db.select().from(s.members);
const { projectId, tasks: nTasks } = await repo.createProjectFromDraft(db, DEMO_ORG_ID, actor, {
  name: "Application clinique", description: "Prise de rendez-vous en ligne.", start_date: "2026-11-09", end_date: "2026-12-18",
  deliverables: [{ name: "Maquettes validées", due: "2026-11-27" }], stakeholders: [{ name: "Mme Roy", role: "valide les écrans" }],
  team: [{ name: "léa", role: "design" }, { name: "Karim", role: "développement" }],
  groups: [{ name: "Conception", tasks: [
    { name: "Dessiner les maquettes", owner: "léa", due: "2026-11-20", priority: "Haute", subtasks: ["Accueil", "Réservation"] },
    { name: "Obtenir l'accès à l'API", owner: "Karim", due: "2026-11-16", priority: "Haute", subtasks: [] },
  ] }],
});
assert.equal(nTasks, 2);
const after2 = await db.select().from(s.members);
assert.equal(after2.length, before.length + 1, "Léa réutilisée (casse ignorée), Karim créé");
const clinic = (await repo.getBoard(db, projectId))!;
assert.deepEqual(clinic.members.map((m) => m.name).sort(), ["Karim", "Léa"]);
assert.ok(clinic.items.every((i) => i.baselineDue === i.due), "plan de référence figé");
assert.equal(clinic.items.find((i) => i.name === "Dessiner les maquettes")!.owner, "Léa");
assert.equal(clinic.items[0].subtasks.length, 2);
assert.equal((await repo.getTaskHistory(db, clinic.items[0].id))[0].kind, "created");
assert.equal((await repo.listProjects(db, DEMO_ORG_ID)).length, 3);

// 12. Notes, évaluation et validation (case réservée au chef de projet)
const sami = await repo.memberIdByName(db, DEMO_ORG_ID, "Sami");
const ines = await repo.memberIdByName(db, DEMO_ORG_ID, "Inès");
const asSami = { memberId: sami, kind: "member" as const }, asInes = { memberId: ines, kind: "member" as const }, asZaki = actor;
const crmBoard = (await repo.getBoard(db, "prj_crm"))!;
const exportTask = crmBoard.items.find((i) => i.name === "Exporter les contacts")!;
assert.equal(exportTask.note!.rating, 3);
assert.equal(exportTask.note!.validated, false, "note du seed en attente de validation");
assert.equal((await repo.listValidatedNotes(db, DEMO_ORG_ID)).length, 2);
await assert.rejects(repo.setTaskNote(db, "prj_crm", asInes, exportTask.id, { problemType: "autre", problem: "Pas ma tâche", resolution: "" }), /responsable de la tâche ou le chef de projet/);
await assert.rejects(repo.setTaskValidation(db, "prj_crm", asSami, exportTask.id, true), /Seul le chef de projet/);
await repo.setTaskValidation(db, "prj_crm", asZaki, exportTask.id, true);
assert.equal((await repo.listValidatedNotes(db, DEMO_ORG_ID)).length, 3, "validée par le chef de projet");
const r1 = await repo.setTaskRating(db, "prj_crm", asSami, exportTask.id, 4); // le responsable corrige son évaluation
assert.equal(r1.unvalidated, true, "toute modification décoche la validation");
assert.equal((await repo.listValidatedNotes(db, DEMO_ORG_ID)).length, 2);
await repo.setTaskValidation(db, "prj_crm", asZaki, exportTask.id, true);
const n1 = await repo.setTaskNote(db, "prj_crm", asSami, exportTask.id, { problemType: "probleme_technique", problem: "Limite d'export à 1 000 contacts.", resolution: "Export en tranches." });
assert.equal(n1.unvalidated, true);
await assert.rejects(repo.setTaskRating(db, "prj_crm", asSami, exportTask.id, 6), /entier de 1 à 5/);
const doublons = crmBoard.items.find((i) => i.name === "Nettoyer les doublons")!;
await assert.rejects(repo.setTaskRating(db, "prj_crm", asZaki, doublons.id, 3), /pas encore de note/);
await repo.setTaskNote(db, "prj_crm", asZaki, doublons.id, { problemType: "surcharge", problem: "Inès était sur deux projets.", resolution: "" });
await assert.rejects(repo.setTaskValidation(db, "prj_crm", asZaki, doublons.id, true), /note et une évaluation/);
const evts = await repo.getTaskHistory(db, exportTask.id);
assert.ok(["note", "rating", "validated"].every((f) => evts.some((e) => e.field === f)), "notes, évaluations et validations journalisées");
const stats = repo.problemStats(await repo.listValidatedNotes(db, DEMO_ORG_ID));
assert.deepEqual(stats.map((x) => x.problemType), ["dependance_externe", "sous_estimation"]);
await repo.saveLessons(db, DEMO_ORG_ID, null, [{ problemType: "dependance_externe", title: "T", problem: "P", resolution: "R", recommendation: "Rec", weight: 4, sourceTaskIds: ["x"] }]);
await repo.saveLessons(db, DEMO_ORG_ID, null, [{ problemType: "sous_estimation", title: "T2", problem: "P", resolution: "R", recommendation: "Rec", weight: 2, sourceTaskIds: ["y"] }]);
assert.deepEqual((await repo.listLessons(db, DEMO_ORG_ID, null)).map((l) => l.title), ["T2"], "une nouvelle synthèse remplace la précédente");

// 13. Chiffrement de la clé d'IA : aller-retour, et refus d'un texte altéré
const { encryptSecret, decryptSecret } = await import("../lib/secrets");
const enc = encryptSecret("sk-or-v1-secret-1234");
assert.ok(!enc.includes("secret"), "la clé n'apparaît pas en clair");
assert.equal(decryptSecret(enc), "sk-or-v1-secret-1234");
assert.notEqual(encryptSecret("sk-or-v1-secret-1234"), enc, "chiffrement non déterministe (IV aléatoire)");
const parts = enc.split(":"); parts[3] = Buffer.from("altéré").toString("base64");
assert.throws(() => decryptSecret(parts.join(":")), /déchiffrer/);

console.log(`OK (${process.env.DATABASE_URL ? "PostgreSQL" : "PGlite"}) : 14 vérifications de la base passées (point du jour, création de projet, notes et validation, chiffrement de la clé, multi-projets, historique, glissement, automatisations, garde-fous, quota)`);
process.exit(0);
