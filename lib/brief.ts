/**
 * Point du jour : ce qui demande l'attention du PMO, sur tout le portefeuille.
 *
 * Calculé directement depuis la base (aucun appel à l'IA) : il s'affiche instantanément
 * et ne coûte rien. Chaque point propose des actions ; les actions « ask » confient la
 * suite à l'assistant avec une consigne déjà rédigée.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

export type BriefKind = "blocked" | "overdue" | "due_soon" | "slipped" | "overload" | "deliverable";

export type BriefAction =
  | { type: "ask"; label: string; projectId: string; prompt: string }
  | { type: "open"; label: string; projectId: string };

export interface BriefItem {
  id: string;
  kind: BriefKind;
  /** 3 = à traiter aujourd'hui, 2 = cette semaine, 1 = à surveiller. */
  severity: 1 | 2 | 3;
  projectId: string;
  projectName: string;
  title: string;
  detail: string;
  actions: BriefAction[];
}

export interface ProjectPulse {
  id: string;
  name: string;
  endDate: string | null;
  total: number;
  done: number;
  /** Avancement réel / avancement attendu à la date du jour (1 = dans les temps). */
  pace: number | null;
  state: "ok" | "watch" | "late";
}

export interface Brief {
  today: string;
  user: string;
  headline: string;
  items: BriefItem[];
  pulse: ProjectPulse[];
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const fmt = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

export async function computeBrief(db: Db, orgId: string, user: string, today = new Date().toISOString().slice(0, 10)): Promise<Brief> {
  const projects = await db.select().from(s.projects)
    .where(and(eq(s.projects.orgId, orgId), inArray(s.projects.status, ["active", "on_hold"])));
  const ids = projects.map((p) => p.id);
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  if (!ids.length) return { today, user, headline: "Aucun projet actif.", items: [], pulse: [] };

  const [tasks, members, deliverables, lastComments] = await Promise.all([
    db.select().from(s.tasks).where(inArray(s.tasks.projectId, ids)),
    db.select({ id: s.members.id, name: s.members.displayName }).from(s.members).where(eq(s.members.orgId, orgId)),
    db.select().from(s.deliverables).where(inArray(s.deliverables.projectId, ids)),
    db.select({ taskId: s.comments.taskId, body: s.comments.body, at: s.comments.createdAt })
      .from(s.comments).innerJoin(s.tasks, eq(s.tasks.id, s.comments.taskId))
      .where(inArray(s.tasks.projectId, ids)).orderBy(desc(s.comments.createdAt)),
  ]);
  const who = new Map(members.map((m) => [m.id, m.name]));
  const lastComment = new Map<string, string>();
  for (const c of lastComments) if (!lastComment.has(c.taskId)) lastComment.set(c.taskId, c.body);

  const items: BriefItem[] = [];
  const open = tasks.filter((t) => t.status !== "done");

  for (const t of open) {
    const owner = t.ownerId ? who.get(t.ownerId) ?? "—" : "personne";
    const project = pname.get(t.projectId)!;
    const base = { projectId: t.projectId, projectName: project };

    if (t.status === "block") {
      const said = lastComment.get(t.id);
      items.push({
        ...base, id: `blocked:${t.id}`, kind: "blocked", severity: 3,
        title: `« ${t.name} » est bloquée`,
        detail: `${owner}${t.dueDate ? `, échéance ${fmt(t.dueDate)}` : ""}.${said ? ` Dernier message : « ${said} »` : ""}`,
        actions: [
          { type: "ask", label: "Proposer une solution", projectId: t.projectId,
            prompt: `La tâche « ${t.name} » est bloquée. Analyse la cause d'après son dernier message et le contexte du projet, propose 2 solutions concrètes, et dis-moi l'effet sur les autres tâches si le blocage dure encore 3 jours.` },
          { type: "ask", label: `Relancer ${owner}`, projectId: t.projectId,
            prompt: `Ajoute un commentaire courtois sur la tâche « ${t.name} » pour relancer ${owner} : demande où en est le blocage et ce dont il ou elle a besoin pour avancer.` },
        ],
      });
      continue;
    }
    if (t.dueDate && t.dueDate < today) {
      const late = days(t.dueDate, today);
      items.push({
        ...base, id: `overdue:${t.id}`, kind: "overdue", severity: 3,
        title: `« ${t.name} » a ${late} jour${late > 1 ? "s" : ""} de retard`,
        detail: `${owner}, prévue le ${fmt(t.dueDate)}.`,
        actions: [
          { type: "ask", label: "Demander la cause", projectId: t.projectId,
            prompt: `La tâche « ${t.name} » est en retard depuis le ${fmt(t.dueDate)}. Ajoute un commentaire non accusateur pour demander à ${owner} la cause du retard et une nouvelle date réaliste.` },
          { type: "ask", label: "Évaluer l'impact", projectId: t.projectId,
            prompt: `La tâche « ${t.name} » est en retard. Quelles tâches et quels livrables sont touchés, et que proposes-tu ?` },
        ],
      });
      continue;
    }
    if (t.dueDate && days(today, t.dueDate) <= 3 && t.status === "todo") {
      items.push({
        ...base, id: `due:${t.id}`, kind: "due_soon", severity: 2,
        title: `« ${t.name} » n'a pas commencé`,
        detail: `${owner}, échéance ${fmt(t.dueDate)} (dans ${days(today, t.dueDate)} jour${days(today, t.dueDate) > 1 ? "s" : ""}).`,
        actions: [
          { type: "ask", label: `Vérifier avec ${owner}`, projectId: t.projectId,
            prompt: `Ajoute un commentaire sur « ${t.name} » pour demander à ${owner} si l'échéance du ${fmt(t.dueDate)} tient toujours.` },
        ],
      });
    }
    if (t.dueDate && t.baselineDueDate && t.dueDate > t.baselineDueDate) {
      const slip = days(t.baselineDueDate, t.dueDate);
      items.push({
        ...base, id: `slip:${t.id}`, kind: "slipped", severity: slip >= 5 ? 2 : 1,
        title: `« ${t.name} » a glissé de ${slip} jour${slip > 1 ? "s" : ""}`,
        detail: `Prévue le ${fmt(t.baselineDueDate)} dans le plan de référence, maintenant le ${fmt(t.dueDate)}.`,
        actions: [{ type: "ask", label: "Voir les conséquences", projectId: t.projectId,
          prompt: `« ${t.name} » a glissé du ${fmt(t.baselineDueDate)} au ${fmt(t.dueDate)}. Quelles conséquences sur le reste du plan et les livrables ?` }],
      });
    }
  }

  // Surcharge : une même personne sur beaucoup de tâches ouvertes, tous projets confondus.
  const byOwner = new Map<string, typeof open>();
  for (const t of open) if (t.ownerId) byOwner.set(t.ownerId, [...(byOwner.get(t.ownerId) ?? []), t]);
  for (const [ownerId, list] of byOwner) {
    if (list.length < 4) continue;
    const projs = [...new Set(list.map((t) => t.projectId))];
    const name = who.get(ownerId) ?? "—";
    items.push({
      id: `overload:${ownerId}`, kind: "overload", severity: projs.length > 1 ? 2 : 1,
      projectId: projs[0], projectName: projs.map((p) => pname.get(p)).join(" · "),
      title: `${name} porte ${list.length} tâches ouvertes${projs.length > 1 ? ` sur ${projs.length} projets` : ""}`,
      detail: list.slice(0, 4).map((t) => t.name).join(" · ") + (list.length > 4 ? "…" : ""),
      actions: [{ type: "ask", label: "Proposer un rééquilibrage", projectId: projs[0],
        prompt: `${name} a ${list.length} tâches ouvertes${projs.length > 1 ? " sur plusieurs projets" : ""}. Propose comment rééquilibrer sa charge dans ce projet (réassignation ou nouvelles dates), sans rien modifier avant mon accord.` }],
    });
  }

  // Livrables proches avec du travail encore ouvert.
  for (const d of deliverables) {
    if (!d.dueDate || d.dueDate < today || days(today, d.dueDate) > 14) continue;
    const remaining = open.filter((t) => t.projectId === d.projectId && (!t.dueDate || t.dueDate <= d.dueDate!)).length;
    if (!remaining) continue;
    const left = days(today, d.dueDate);
    items.push({
      id: `deliv:${d.id}`, kind: "deliverable", severity: left <= 5 ? 3 : 2,
      projectId: d.projectId, projectName: pname.get(d.projectId)!,
      title: `Livrable « ${d.name} » dans ${left} jour${left > 1 ? "s" : ""}`,
      detail: `${remaining} tâche${remaining > 1 ? "s" : ""} encore ouverte${remaining > 1 ? "s" : ""} avant le ${fmt(d.dueDate)}.`,
      actions: [{ type: "ask", label: "Est-ce tenable ?", projectId: d.projectId,
        prompt: `Le livrable « ${d.name} » est prévu le ${fmt(d.dueDate)}. Avec les tâches ouvertes et les blocages actuels, est-ce tenable ? Donne un verdict clair et ce qu'il faudrait faire.` }],
    });
  }

  items.sort((a, b) => b.severity - a.severity || a.kind.localeCompare(b.kind));

  const pulse: ProjectPulse[] = projects.map((p) => {
    const ts = tasks.filter((t) => t.projectId === p.id);
    const done = ts.filter((t) => t.status === "done").length;
    let pace: number | null = null;
    if (p.startDate && p.endDate && ts.length) {
      const expected = Math.min(1, Math.max(0.02, days(p.startDate, today) / Math.max(1, days(p.startDate, p.endDate))));
      pace = Math.round((done / ts.length / expected) * 100) / 100;
    }
    const hot = items.filter((i) => i.projectId === p.id && i.severity === 3).length;
    const state: ProjectPulse["state"] = hot > 0 ? "late" : (pace !== null && pace < 0.8) || items.some((i) => i.projectId === p.id) ? "watch" : "ok";
    return { id: p.id, name: p.name, endDate: p.endDate, total: ts.length, done, pace, state };
  });

  const urgent = items.filter((i) => i.severity === 3).length;
  const headline = !items.length
    ? "Rien ne demande votre attention aujourd'hui. Tout avance comme prévu."
    : urgent
      ? `${urgent} point${urgent > 1 ? "s" : ""} à traiter aujourd'hui, ${items.length - urgent} à surveiller.`
      : `Rien d'urgent. ${items.length} point${items.length > 1 ? "s" : ""} à surveiller cette semaine.`;

  return { today, user, headline, items, pulse };
}
