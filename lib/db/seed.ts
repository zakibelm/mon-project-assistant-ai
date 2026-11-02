/**
 * Données de démonstration : une organisation (PMO), quatre membres partagés
 * entre deux projets. Les prénoms sont fictifs. Ne fait rien si la base contient
 * déjà une organisation.
 */
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { clientRoot, ensureProjectFolder, projectFiche } from "@/lib/rag/index";
import type { Db } from "./client";
import * as s from "./schema";

export const DEMO_ORG_ID = "org_demo";

export async function seedDemo(db: Db) {
  const existing = await db.select({ id: s.organizations.id }).from(s.organizations).limit(1);
  if (existing.length) return;
  seedDemoDocuments();

  await db.transaction(async (tx) => {
    await tx.insert(s.organizations).values({ id: DEMO_ORG_ID, name: "PMO Démo" });
    const people = ["Zaki", "Sami", "Léa", "Inès"];
    const m: Record<string, string> = {};
    for (const name of people) {
      const [row] = await tx.insert(s.members).values({ orgId: DEMO_ORG_ID, displayName: name }).returning({ id: s.members.id });
      m[name] = row.id;
    }
    const [pf] = await tx.insert(s.portfolios).values({ orgId: DEMO_ORG_ID, name: "Projets clients" }).returning({ id: s.portfolios.id });

    type T = [name: string, status: (typeof s.TASK_STATUSES)[number], owner: string, due: string, prio: (typeof s.TASK_PRIORITIES)[number], subs?: [string, boolean][]];
    async function project(p: {
      id: string; docsDir: string; name: string; description: string; start: string; end: string;
      members: [string, string][]; deliverables: [string, string][]; stakeholders: [string, string][];
      groups: { name: string; tasks: T[] }[]; automations?: [string, string][];
    }) {
      await tx.insert(s.projects).values({ id: p.id, orgId: DEMO_ORG_ID, portfolioId: pf.id, name: p.name, description: p.description, startDate: p.start, endDate: p.end, docsDir: p.docsDir });
      await tx.insert(s.projectMembers).values(p.members.map(([n, role]) => ({ projectId: p.id, memberId: m[n], role })));
      await tx.insert(s.deliverables).values(p.deliverables.map(([name, dueDate]) => ({ projectId: p.id, name, dueDate })));
      await tx.insert(s.stakeholders).values(p.stakeholders.map(([name, role]) => ({ projectId: p.id, name, role })));
      for (const [gi, g] of p.groups.entries()) {
        const [grp] = await tx.insert(s.taskGroups).values({ projectId: p.id, name: g.name, position: gi }).returning({ id: s.taskGroups.id });
        for (const [ti, [name, status, owner, due, priority, subs]] of g.tasks.entries()) {
          const [t] = await tx.insert(s.tasks).values({
            projectId: p.id, groupId: grp.id, name, status, ownerId: m[owner], dueDate: due, baselineDueDate: due, priority, position: ti,
            completedAt: status === "done" ? new Date(`${due}T15:00:00Z`) : null,
          }).returning({ id: s.tasks.id });
          if (subs?.length) await tx.insert(s.subtasks).values(subs.map(([text, done], k) => ({ taskId: t.id, text, done, position: k })));
          if (name.startsWith("Configurer le nom de domaine")) {
            await tx.insert(s.comments).values({ taskId: t.id, authorId: m.Sami, body: "Il me manque les accès au registrar. @Zaki tu peux me les transmettre ?" });
          }
        }
      }
      for (const [status, who] of p.automations ?? []) {
        await tx.insert(s.automations).values({ projectId: p.id, onStatus: status as (typeof s.TASK_STATUSES)[number], notifyMemberId: m[who] });
      }
    }

    await project({
      id: "prj_site", docsDir: "lancement-du-site-web", name: "Lancement du site web",
      description: "Refonte et mise en ligne du site vitrine de l'agence, avec pages services et formulaire de contact.",
      start: "2026-10-26", end: "2026-11-20",
      members: [["Zaki", "chef de projet"], ["Sami", "développeur"], ["Léa", "designer"], ["Inès", "communication"]],
      deliverables: [["Site en ligne", "2026-11-14"], ["Annonce publique", "2026-11-20"]],
      stakeholders: [["Direction de l'agence", "valide le contenu"], ["Ancien prestataire web", "détient les accès au domaine"]],
      groups: [
        { name: "Cette semaine", tasks: [
          ["Valider la maquette de la page d'accueil", "done", "Léa", "2026-11-03", "Haute", [["Version mobile", true], ["Version bureau", true], ["Retour client", true]]],
          ["Rédiger les textes des pages services", "doing", "Zaki", "2026-11-05", "Haute", [["Conseil", true], ["Formation", false], ["Accompagnement", false], ["Relecture SEO", false]]],
          ["Configurer le nom de domaine et le SSL", "block", "Sami", "2026-11-04", "Moyenne", [["Accès registrar", false], ["Certificat SSL", false]]],
          ["Choisir les photos de l'équipe", "todo", "Inès", "2026-11-06", "Basse"],
        ] },
        { name: "Semaine prochaine", tasks: [
          ["Intégrer le formulaire de contact", "todo", "Sami", "2026-11-10", "Moyenne", [["Champs", false], ["Anti-spam", false], ["E-mail de confirmation", false]]],
          ["Mettre en place Google Analytics", "todo", "Zaki", "2026-11-11", "Basse"],
          ["Relire l'ensemble des pages", "todo", "Léa", "2026-11-12", "Moyenne"],
        ] },
        { name: "Plus tard", tasks: [["Préparer l'annonce sur LinkedIn", "todo", "Inès", "2026-11-18", "Basse"]] },
      ],
      automations: [["block", "Zaki"]],
    });

    await project({
      id: "prj_crm", docsDir: "migration-du-crm", name: "Migration du CRM",
      description: "Passage de l'ancien CRM à un nouvel outil, avec reprise des contacts et formation de l'équipe commerciale.",
      start: "2026-10-19", end: "2026-12-11",
      members: [["Zaki", "chef de projet"], ["Sami", "développeur"], ["Inès", "référente métier"]],
      deliverables: [["Données migrées", "2026-11-27"], ["Équipe formée", "2026-12-11"]],
      stakeholders: [["Équipe commerciale", "utilisatrice finale"], ["Éditeur du nouveau CRM", "support technique"]],
      groups: [
        { name: "Préparation", tasks: [
          ["Inventorier les champs de l'ancien CRM", "done", "Inès", "2026-10-30", "Haute"],
          ["Exporter les contacts", "doing", "Sami", "2026-11-04", "Haute"],
        ] },
        { name: "Migration", tasks: [
          ["Nettoyer les doublons", "todo", "Inès", "2026-11-13", "Moyenne"],
          ["Importer et vérifier les données", "todo", "Sami", "2026-11-25", "Haute"],
        ] },
        { name: "Formation", tasks: [["Former l'équipe commerciale", "todo", "Zaki", "2026-12-09", "Moyenne"]] },
      ],
    });

    // Notes d'explication : deux évaluées et validées par le chef de projet, une évaluée par son auteur et en attente de validation.
    async function note(projectId: string, task: string, author: string, problemType: (typeof s.PROBLEM_TYPES)[number], problem: string, resolution: string, rating: number, validated: boolean) {
      await tx.update(s.tasks).set({
        problemType, noteProblem: problem, noteResolution: resolution, noteAuthorId: m[author], noteUpdatedAt: new Date(),
        rating, ratedById: validated ? m.Zaki : m[author], ratedAt: new Date(),
        validated, validatedById: validated ? m.Zaki : null, validatedAt: validated ? new Date() : null,
      }).where(and(eq(s.tasks.projectId, projectId), eq(s.tasks.name, task)));
    }
    await note("prj_site", "Valider la maquette de la page d'accueil", "Léa", "dependance_externe",
      "Le client a mis 4 jours à donner son retour sur la maquette, ce qui a repoussé la validation.",
      "Relance quotidienne puis validation en visioconférence de 30 minutes avec le client.", 4, true);
    await note("prj_crm", "Inventorier les champs de l'ancien CRM", "Inès", "sous_estimation",
      "Il y avait trois fois plus de champs personnalisés que prévu.", "Une demi-journée ajoutée et tri des champs inutilisés avec l'équipe commerciale.", 2, true);
    await note("prj_crm", "Exporter les contacts", "Sami", "probleme_technique",
      "L'ancien CRM limite l'export à 1 000 contacts par fichier.", "Export en 6 tranches, puis fusion des fichiers avec un script.", 3, false);
  });
}

/** Documents d'exemple des deux projets de démonstration (rag-client/), créés s'ils n'existent pas. */
function seedDemoDocuments() {
  try {
    ensureProjectFolder("lancement-du-site-web", projectFiche({
      name: "Lancement du site web", start: "2026-10-26", end: "2026-11-20",
      description: "Refonte et mise en ligne du site vitrine de l'agence, avec pages services et formulaire de contact.",
      deliverables: [{ name: "Site en ligne", due: "2026-11-14" }, { name: "Annonce publique", due: "2026-11-20" }],
      stakeholders: [{ name: "Direction de l'agence", role: "valide le contenu" }, { name: "Ancien prestataire web", role: "détient les accès au domaine" }],
      team: [{ name: "Zaki", role: "chef de projet" }, { name: "Sami", role: "développeur" }, { name: "Léa", role: "designer" }, { name: "Inès", role: "communication" }],
    }));
    ensureProjectFolder("migration-du-crm", projectFiche({
      name: "Migration du CRM", start: "2026-10-19", end: "2026-12-11",
      description: "Passage de l'ancien CRM à un nouvel outil, avec reprise des contacts et formation de l'équipe commerciale.",
      deliverables: [{ name: "Données migrées", due: "2026-11-27" }, { name: "Équipe formée", due: "2026-12-11" }],
      stakeholders: [{ name: "Équipe commerciale", role: "utilisatrice finale" }, { name: "Éditeur du nouveau CRM", role: "support technique" }],
      team: [{ name: "Zaki", role: "chef de projet" }, { name: "Sami", role: "développeur" }, { name: "Inès", role: "référente métier" }],
    }));
    const write = (dir: string, file: string, text: string) => {
      const f = path.join(/*turbopackIgnore: true*/ clientRoot(), dir, file);
      if (!fs.existsSync(f)) fs.writeFileSync(f, text, { mode: 0o640 });
    };
    write("lancement-du-site-web", "compte-rendu-2026-10-28.md", `---
titre: Compte rendu de réunion du 28 octobre (exemple)
tags: réunion, décisions, domaine, registrar, accès, maquette, client
source: Exemple de démonstration
---

## Participants

Zaki (chef de projet), Léa (design), Sami (développement), Mme Durand (directrice de l'agence, cliente).

## Décisions

- La maquette de la page d'accueil sera validée par Mme Durand en visioconférence, pas par courriel.
- Le site garde le nom de domaine actuel ; aucun changement d'adresse.
- La page « Formation » est reportée après la mise en ligne.

## Accès au nom de domaine

Les accès au registrar (le fournisseur du nom de domaine) sont détenus par l'ancien prestataire web, M. Roy, de l'agence Pixelnord. Mme Durand doit lui écrire pour autoriser le transfert des accès à Sami. Délai annoncé par M. Roy : 3 jours ouvrables après autorisation.

## Points ouverts

- Qui rédige les mentions légales ? (Zaki demande à Mme Durand)
- Budget photo de l'équipe : à confirmer avant le 5 novembre.
`);
    write("migration-du-crm", "exigences-client.md", `---
titre: Exigences de l'équipe commerciale (exemple)
tags: exigences, champs, doublons, formation, contacts, export
source: Exemple de démonstration
---

## Données à reprendre

Tous les contacts actifs des 3 dernières années (environ 6 000), avec leur historique d'échanges. Les contacts inactifs depuis plus de 3 ans ne sont pas repris : ils sont archivés dans un fichier à part.

## Doublons

Un contact est un doublon s'il a la même adresse courriel. En cas de doublon, garder la fiche la plus récemment modifiée et fusionner les notes.

## Formation

Deux sessions de 2 heures pour les 8 commerciaux, en présentiel, la semaine du 7 décembre. Prévoir un aide-mémoire d'une page.
`);
  } catch (e) { console.error("[rag-client] documents d'exemple non créés", e); }
}
