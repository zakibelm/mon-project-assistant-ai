/**
 * Accès aux données des projets. Toutes les écritures sur les tâches passent ici,
 * ce qui garantit qu'elles sont journalisées dans task_events.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";
import { Board, Priority, ProblemType, ProjectSummary, Status, STATUS_LABEL } from "@/lib/board/types";

import { ensureProjectFolder, projectFiche, slugify } from "@/lib/rag/index";

/** Le chef de projet est le membre dont le rôle dans le projet contient « chef de projet ». */
export const isManagerRole = (role: string) => /chef de projet/i.test(role);

export class BoardError extends Error {}

/** Qui agit : un membre directement, ou l'assistant pour le compte d'un membre. */
export interface Actor { memberId: string | null; kind: "member" | "assistant" | "system" }

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ lectures */

export async function listProjects(db: Db, orgId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: s.projects.id, name: s.projects.name, status: s.projects.status, endDate: s.projects.endDate,
      total: sql<number>`count(${s.tasks.id})::int`,
      done: sql<number>`count(${s.tasks.id}) filter (where ${s.tasks.status} = 'done')::int`,
      blocked: sql<number>`count(${s.tasks.id}) filter (where ${s.tasks.status} = 'block')::int`,
      overdue: sql<number>`count(${s.tasks.id}) filter (where ${s.tasks.status} <> 'done' and ${s.tasks.dueDate} < ${today()})::int`,
      slipped: sql<number>`count(${s.tasks.id}) filter (where ${s.tasks.dueDate} > ${s.tasks.baselineDueDate})::int`,
    })
    .from(s.projects)
    .leftJoin(s.tasks, eq(s.tasks.projectId, s.projects.id))
    .where(eq(s.projects.orgId, orgId))
    .groupBy(s.projects.id)
    .orderBy(asc(s.projects.name));
  return rows;
}

export async function getBoard(db: Db, projectId: string): Promise<Board | null> {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  if (!p) return null;

  const [team, deliverables, stakeholders, groups, tasks, autos, notifs] = await Promise.all([
    db.select({ id: s.members.id, name: s.members.displayName, role: s.projectMembers.role })
      .from(s.projectMembers).innerJoin(s.members, eq(s.members.id, s.projectMembers.memberId))
      .where(eq(s.projectMembers.projectId, projectId)).orderBy(asc(s.members.displayName)),
    db.select().from(s.deliverables).where(eq(s.deliverables.projectId, projectId)).orderBy(asc(s.deliverables.dueDate)),
    db.select().from(s.stakeholders).where(eq(s.stakeholders.projectId, projectId)),
    db.select().from(s.taskGroups).where(eq(s.taskGroups.projectId, projectId)).orderBy(asc(s.taskGroups.position)),
    db.select().from(s.tasks).where(eq(s.tasks.projectId, projectId)).orderBy(asc(s.tasks.position), asc(s.tasks.createdAt)),
    db.select({ id: s.automations.id, onStatus: s.automations.onStatus, notify: s.members.displayName })
      .from(s.automations).innerJoin(s.members, eq(s.members.id, s.automations.notifyMemberId))
      .where(eq(s.automations.projectId, projectId)),
    db.select().from(s.notifications).where(eq(s.notifications.projectId, projectId)).orderBy(desc(s.notifications.createdAt)).limit(20),
  ]);

  const taskIds = tasks.map((t) => t.id);
  const [subs, coms, allMembers] = await Promise.all([
    taskIds.length ? db.select().from(s.subtasks).where(inArray(s.subtasks.taskId, taskIds)).orderBy(asc(s.subtasks.position)) : [],
    taskIds.length ? db.select().from(s.comments).where(inArray(s.comments.taskId, taskIds)).orderBy(asc(s.comments.createdAt)) : [],
    db.select({ id: s.members.id, name: s.members.displayName }).from(s.members).where(eq(s.members.orgId, p.orgId)),
  ]);
  const nameOf = new Map(allMembers.map((m) => [m.id, m.name]));

  return {
    projectId: p.id, orgId: p.orgId, name: p.name, description: p.description, startDate: p.startDate, endDate: p.endDate, docsDir: p.docsDir,
    members: team.map((m) => ({ name: m.name, role: m.role, isManager: isManagerRole(m.role) })),
    deliverables: deliverables.map((d) => ({ name: d.name, due: d.dueDate })),
    stakeholders: stakeholders.map((x) => ({ name: x.name, role: x.role })),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    items: tasks.map((t) => ({
      id: t.id, groupId: t.groupId, name: t.name, status: t.status,
      owner: t.ownerId ? nameOf.get(t.ownerId) ?? null : null,
      due: t.dueDate, baselineDue: t.baselineDueDate, priority: t.priority,
      subtasks: subs.filter((x) => x.taskId === t.id).map((x) => ({ text: x.text, done: x.done })),
      comments: coms.filter((c) => c.taskId === t.id).map((c) => ({
        author: c.authorId ? nameOf.get(c.authorId) ?? null : null, text: c.body, at: c.createdAt.toISOString(),
      })),
      note: t.noteProblem ? {
        problemType: t.problemType, problem: t.noteProblem, resolution: t.noteResolution ?? "",
        author: t.noteAuthorId ? nameOf.get(t.noteAuthorId) ?? null : null,
        updatedAt: t.noteUpdatedAt?.toISOString() ?? null,
        rating: t.rating, ratedBy: t.ratedById ? nameOf.get(t.ratedById) ?? null : null,
        validated: t.validated, validatedBy: t.validatedById ? nameOf.get(t.validatedById) ?? null : null,
      } : null,
      late: isLate(t),
    })),
    automations: autos,
    notifications: notifs.map((n) => ({ text: n.body, at: n.createdAt.toISOString(), read: n.read })),
  };
}

/** Une tâche est en retard si son échéance est dépassée, ou si elle a été terminée ou reportée après la date du plan de référence. */
export function isLate(t: { status: string; dueDate: string | null; baselineDueDate: string | null; completedAt: Date | null }) {
  const d = today();
  if (t.status !== "done" && t.dueDate && t.dueDate < d) return true;
  if (t.baselineDueDate && t.dueDate && t.dueDate > t.baselineDueDate) return true;
  if (t.status === "done" && t.completedAt && t.baselineDueDate && t.completedAt.toISOString().slice(0, 10) > t.baselineDueDate) return true;
  return false;
}

export async function getTaskHistory(db: Db, taskId: string) {
  return db.select().from(s.taskEvents).where(eq(s.taskEvents.taskId, taskId)).orderBy(asc(s.taskEvents.createdAt));
}

/** Membre par prénom affiché, limité aux membres du projet. */
async function projectMemberByName(db: Db, projectId: string, name: string) {
  const team = await db.select({ id: s.members.id, name: s.members.displayName })
    .from(s.projectMembers).innerJoin(s.members, eq(s.members.id, s.projectMembers.memberId))
    .where(eq(s.projectMembers.projectId, projectId));
  const found = team.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
  if (!found) throw new BoardError(`« ${name} » n'est pas membre du projet. Membres : ${team.map((m) => m.name).join(", ")}`);
  return found;
}

async function mustTask(db: Db, projectId: string, taskId: string) {
  const [t] = await db.select().from(s.tasks).where(and(eq(s.tasks.id, taskId), eq(s.tasks.projectId, projectId)));
  if (!t) throw new BoardError(`Tâche introuvable : ${taskId}`);
  return t;
}

async function mustGroup(db: Db, projectId: string, groupId: string) {
  const [g] = await db.select().from(s.taskGroups).where(and(eq(s.taskGroups.id, groupId), eq(s.taskGroups.projectId, projectId)));
  if (!g) throw new BoardError(`Groupe introuvable : ${groupId}`);
  return g;
}

/* ---------------------------------------------------------------- écritures */

export async function createGroup(db: Db, projectId: string, name: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.taskGroups).where(eq(s.taskGroups.projectId, projectId));
  const [g] = await db.insert(s.taskGroups).values({ projectId, name, position: n }).returning();
  return { id: g.id, name: g.name };
}

export interface NewTask {
  name: string; groupId: string; owner?: string | null; due?: string | null; priority?: Priority; subtasks?: string[];
}

export async function createTasks(db: Db, projectId: string, actor: Actor, input: NewTask[]) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const created: { id: string; name: string }[] = [];
    for (const i of input) {
      await mustGroup(t, projectId, i.groupId);
      const ownerId = i.owner ? (await projectMemberByName(t, projectId, i.owner)).id : null;
      const [{ n }] = await t.select({ n: sql<number>`count(*)::int` }).from(s.tasks).where(eq(s.tasks.groupId, i.groupId));
      const [row] = await t.insert(s.tasks).values({
        projectId, groupId: i.groupId, name: i.name, ownerId, dueDate: i.due ?? null,
        // Le plan de référence est figé explicitement en phase B ; d'ici là, la date initiale sert de référence.
        baselineDueDate: i.due ?? null, priority: i.priority ?? "Moyenne", position: n,
      }).returning({ id: s.tasks.id, name: s.tasks.name });
      if (i.subtasks?.length) await t.insert(s.subtasks).values(i.subtasks.map((text, k) => ({ taskId: row.id, text, position: k })));
      await t.insert(s.taskEvents).values({ projectId, taskId: row.id, actorId: actor.memberId, actorKind: actor.kind, kind: "created", newValue: i.name });
      created.push(row);
    }
    return created;
  });
}

export interface TaskPatch {
  name?: string; status?: Status; owner?: string | null; due?: string | null; priority?: Priority; groupId?: string;
}

export async function updateTask(db: Db, projectId: string, actor: Actor, taskId: string, patch: TaskPatch) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const cur = await mustTask(t, projectId, taskId);
    const next: Partial<typeof s.tasks.$inferInsert> = {};
    const events: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    if (patch.groupId !== undefined && patch.groupId !== cur.groupId) {
      await mustGroup(t, projectId, patch.groupId);
      next.groupId = patch.groupId; events.push({ field: "group", oldValue: cur.groupId, newValue: patch.groupId });
    }
    if (patch.owner !== undefined) {
      const ownerId = patch.owner ? (await projectMemberByName(t, projectId, patch.owner)).id : null;
      if (ownerId !== cur.ownerId) { next.ownerId = ownerId; events.push({ field: "owner", oldValue: cur.ownerId, newValue: ownerId }); }
    }
    if (patch.name !== undefined && patch.name !== cur.name) { next.name = patch.name; events.push({ field: "name", oldValue: cur.name, newValue: patch.name }); }
    if (patch.due !== undefined && patch.due !== cur.dueDate) { next.dueDate = patch.due; events.push({ field: "due_date", oldValue: cur.dueDate, newValue: patch.due }); }
    if (patch.priority !== undefined && patch.priority !== cur.priority) { next.priority = patch.priority; events.push({ field: "priority", oldValue: cur.priority, newValue: patch.priority }); }
    if (patch.status !== undefined && patch.status !== cur.status) {
      next.status = patch.status;
      next.completedAt = patch.status === "done" ? new Date() : null;
      events.push({ field: "status", oldValue: cur.status, newValue: patch.status });
    }
    if (!events.length) return { id: cur.id, name: cur.name, changed: false };

    await t.update(s.tasks).set({ ...next, updatedAt: new Date() }).where(eq(s.tasks.id, taskId));
    await t.insert(s.taskEvents).values(events.map((e) => ({ projectId, taskId, actorId: actor.memberId, actorKind: actor.kind, kind: "updated" as const, ...e })));

    if (next.status) {
      const rules = await t.select({ notify: s.automations.notifyMemberId, name: s.members.displayName })
        .from(s.automations).innerJoin(s.members, eq(s.members.id, s.automations.notifyMemberId))
        .where(and(eq(s.automations.projectId, projectId), eq(s.automations.onStatus, next.status)));
      if (rules.length) {
        const [p] = await t.select({ orgId: s.projects.orgId }).from(s.projects).where(eq(s.projects.id, projectId));
        await t.insert(s.notifications).values(rules.map((r) => ({
          orgId: p.orgId, projectId, memberId: r.notify,
          body: `« ${next.name ?? cur.name} » est passée à ${STATUS_LABEL[next.status!]}. ${r.name} est prévenu(e).`,
        })));
      }
    }
    return { id: cur.id, name: next.name ?? cur.name, changed: true };
  });
}

export async function deleteTask(db: Db, projectId: string, actor: Actor, taskId: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const cur = await mustTask(t, projectId, taskId);
    await t.delete(s.tasks).where(eq(s.tasks.id, taskId));
    await t.insert(s.taskEvents).values({ projectId, taskId, actorId: actor.memberId, actorKind: actor.kind, kind: "deleted", oldValue: cur.name });
    return { id: cur.id, name: cur.name };
  });
}

export async function addComment(db: Db, projectId: string, actor: Actor, taskId: string, body: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const cur = await mustTask(t, projectId, taskId);
    await t.insert(s.comments).values({ taskId, authorId: actor.memberId, body });
    const team = await t.select({ id: s.members.id, name: s.members.displayName, orgId: s.members.orgId })
      .from(s.projectMembers).innerJoin(s.members, eq(s.members.id, s.projectMembers.memberId))
      .where(eq(s.projectMembers.projectId, projectId));
    const author = team.find((m) => m.id === actor.memberId)?.name ?? "Quelqu'un";
    const mentioned = team.filter((m) => m.id !== actor.memberId && body.includes(`@${m.name}`));
    if (mentioned.length) {
      await t.insert(s.notifications).values(mentioned.map((m) => ({
        orgId: m.orgId, projectId, memberId: m.id, body: `${m.name} a été mentionné(e) par ${author} dans « ${cur.name} ».`,
      })));
    }
  });
}

export async function createAutomation(db: Db, projectId: string, onStatus: Status, notify: string) {
  const who = await projectMemberByName(db, projectId, notify);
  const [a] = await db.insert(s.automations).values({ projectId, onStatus, notifyMemberId: who.id }).returning({ id: s.automations.id });
  return { id: a.id, onStatus, notify: who.name };
}

/* ------------------------------------------- notes d'explication et évaluation */

async function projectRole(db: Db, projectId: string, memberId: string | null) {
  if (!memberId) return null;
  const [r] = await db.select({ role: s.projectMembers.role }).from(s.projectMembers)
    .where(and(eq(s.projectMembers.projectId, projectId), eq(s.projectMembers.memberId, memberId)));
  return r?.role ?? null;
}

export interface NoteInput { problemType: ProblemType; problem: string; resolution: string }

const UNVALIDATE = { validated: false, validatedById: null, validatedAt: null } as const;

async function canWriteNote(db: Db, projectId: string, actor: Actor, ownerId: string | null) {
  const role = await projectRole(db, projectId, actor.memberId);
  return { manager: !!(role && isManagerRole(role)), owner: !!actor.memberId && ownerId === actor.memberId };
}

/**
 * Écrit la note d'explication d'une tâche. Réservé au responsable de la tâche et au chef de projet.
 * Une note modifiée après validation est décochée : le chef de projet doit la revalider.
 */
export async function setTaskNote(db: Db, projectId: string, actor: Actor, taskId: string, n: NoteInput) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const cur = await mustTask(t, projectId, taskId);
    const who = await canWriteNote(t, projectId, actor, cur.ownerId);
    if (!who.owner && !who.manager) throw new BoardError("Seul le responsable de la tâche ou le chef de projet peut écrire la note.");
    const changed = cur.noteProblem !== n.problem || (cur.noteResolution ?? "") !== n.resolution || cur.problemType !== n.problemType;
    if (!changed) return { unvalidated: false };
    const unvalidated = cur.validated;
    await t.update(s.tasks).set({
      problemType: n.problemType, noteProblem: n.problem, noteResolution: n.resolution,
      noteAuthorId: actor.memberId, noteUpdatedAt: new Date(), ...(unvalidated ? UNVALIDATE : {}), updatedAt: new Date(),
    }).where(eq(s.tasks.id, taskId));
    await t.insert(s.taskEvents).values([
      { projectId, taskId, actorId: actor.memberId, actorKind: actor.kind, kind: "updated" as const, field: "note", oldValue: cur.noteProblem, newValue: n.problem },
      ...(unvalidated ? [{ projectId, taskId, actorId: actor.memberId, actorKind: "system" as const, kind: "updated" as const, field: "validated", oldValue: "true", newValue: "false" }] : []),
    ]);
    return { unvalidated };
  });
}

/** Propose ou corrige l'évaluation de 1 à 5 (responsable ou chef de projet). Toute modification décoche la validation. */
export async function setTaskRating(db: Db, projectId: string, actor: Actor, taskId: string, rating: number | null) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const cur = await mustTask(t, projectId, taskId);
    const who = await canWriteNote(t, projectId, actor, cur.ownerId);
    if (!who.owner && !who.manager) throw new BoardError("Seul le responsable de la tâche ou le chef de projet peut évaluer.");
    if (!cur.noteProblem) throw new BoardError("Il n'y a pas encore de note à évaluer pour cette tâche.");
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new BoardError("L'évaluation doit être un entier de 1 à 5.");
    if (rating === cur.rating) return { unvalidated: false };
    const unvalidated = cur.validated;
    await t.update(s.tasks).set({
      rating, ratedById: rating === null ? null : actor.memberId, ratedAt: rating === null ? null : new Date(),
      ...(unvalidated ? UNVALIDATE : {}), updatedAt: new Date(),
    }).where(eq(s.tasks.id, taskId));
    await t.insert(s.taskEvents).values({ projectId, taskId, actorId: actor.memberId, actorKind: actor.kind, kind: "updated", field: "rating",
      oldValue: cur.rating === null ? null : String(cur.rating), newValue: rating === null ? null : String(rating) });
    return { unvalidated };
  });
}

/** Coche ou décoche la validation. Réservé au chef de projet ; il faut une note et une évaluation. */
export async function setTaskValidation(db: Db, projectId: string, actor: Actor, taskId: string, validated: boolean) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const cur = await mustTask(t, projectId, taskId);
    const who = await canWriteNote(t, projectId, actor, cur.ownerId);
    if (!who.manager) throw new BoardError("Seul le chef de projet peut valider une évaluation.");
    if (validated && (!cur.noteProblem || cur.rating === null)) throw new BoardError("Pour valider, il faut une note et une évaluation de 1 à 5.");
    if (validated === cur.validated) return;
    await t.update(s.tasks).set(validated
      ? { validated: true, validatedById: actor.memberId, validatedAt: new Date(), updatedAt: new Date() }
      : { ...UNVALIDATE, updatedAt: new Date() }).where(eq(s.tasks.id, taskId));
    await t.insert(s.taskEvents).values({ projectId, taskId, actorId: actor.memberId, actorKind: actor.kind, kind: "updated", field: "validated",
      oldValue: String(cur.validated), newValue: String(validated) });
  });
}

/* --------------------------------------------------------- leçons apprises */

export interface ValidatedNote {
  taskId: string; projectId: string; projectName: string; task: string; owner: string | null;
  problemType: ProblemType; problem: string; resolution: string; rating: number;
  baselineDue: string | null; due: string | null; status: Status;
}

/** Notes validées par le chef de projet (case cochée), d'un projet ou de toute l'organisation. */
export async function listValidatedNotes(db: Db, orgId: string, projectId?: string): Promise<ValidatedNote[]> {
  const rows = await db.select({
    taskId: s.tasks.id, projectId: s.tasks.projectId, projectName: s.projects.name, task: s.tasks.name, ownerId: s.tasks.ownerId,
    problemType: s.tasks.problemType, problem: s.tasks.noteProblem, resolution: s.tasks.noteResolution, rating: s.tasks.rating,
    baselineDue: s.tasks.baselineDueDate, due: s.tasks.dueDate, status: s.tasks.status,
  }).from(s.tasks).innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
    .where(and(eq(s.projects.orgId, orgId), eq(s.tasks.validated, true), sql`${s.tasks.rating} is not null`, sql`${s.tasks.noteProblem} is not null`,
      projectId ? eq(s.tasks.projectId, projectId) : sql`true`))
    .orderBy(desc(s.tasks.rating));
  const people = await db.select({ id: s.members.id, name: s.members.displayName }).from(s.members).where(eq(s.members.orgId, orgId));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    ...r, owner: r.ownerId ? nameOf.get(r.ownerId) ?? null : null, problemType: r.problemType ?? "autre",
    problem: r.problem!, resolution: r.resolution ?? "", rating: r.rating!,
  }));
}

/** Statistiques sans IA : par type de problème, nombre de notes et poids (somme et moyenne des évaluations). */
export function problemStats(notes: ValidatedNote[]) {
  const by = new Map<ProblemType, { count: number; weight: number }>();
  for (const n of notes) {
    const x = by.get(n.problemType) ?? { count: 0, weight: 0 };
    by.set(n.problemType, { count: x.count + 1, weight: x.weight + n.rating });
  }
  return [...by.entries()].map(([problemType, v]) => ({ problemType, count: v.count, weight: v.weight, average: Math.round((v.weight / v.count) * 10) / 10 }))
    .sort((a, b) => b.weight - a.weight);
}

export interface LessonInput {
  problemType: ProblemType; title: string; problem: string; resolution: string; recommendation: string; weight: number; sourceTaskIds: string[];
}

/** Remplace les leçons d'une portée (un projet, ou toute l'organisation si projectId est null). */
export async function saveLessons(db: Db, orgId: string, projectId: string | null, list: LessonInput[]) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.delete(s.lessons).where(and(eq(s.lessons.orgId, orgId), projectId ? eq(s.lessons.projectId, projectId) : sql`${s.lessons.projectId} is null`));
    if (list.length) await t.insert(s.lessons).values(list.map((l) => ({ orgId, projectId, ...l })));
  });
}

export async function listLessons(db: Db, orgId: string, projectId: string | null) {
  return db.select().from(s.lessons)
    .where(and(eq(s.lessons.orgId, orgId), projectId ? eq(s.lessons.projectId, projectId) : sql`${s.lessons.projectId} is null`))
    .orderBy(desc(s.lessons.weight));
}

/* ------------------------------------------------------- création de projet */

export interface ProjectInput {
  name: string; description: string; start_date: string | null; end_date: string | null;
  deliverables: { name: string; due: string | null }[];
  stakeholders: { name: string; role: string }[];
  team: { name: string; role: string }[];
  groups: { name: string; tasks: { name: string; owner: string | null; due: string | null; priority: Priority; subtasks: string[] }[] }[];
}

/**
 * Crée un projet complet à partir d'un brouillon validé. Les membres déjà connus du
 * PMO (même nom) sont réutilisés, les autres sont créés. Les échéances deviennent
 * le plan de référence.
 */
export async function createProjectFromDraft(db: Db, orgId: string, actor: Actor, d: ProjectInput) {
  const base = slugify(d.name);
  const taken = new Set((await db.select({ dir: s.projects.docsDir }).from(s.projects)).map((r) => r.dir));
  let docsDir = base;
  for (let i = 2; taken.has(docsDir); i++) docsDir = `${base}-${i}`;
  const result = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [p] = await t.insert(s.projects).values({
      orgId, name: d.name, description: d.description, startDate: d.start_date, endDate: d.end_date, docsDir,
    }).returning({ id: s.projects.id });

    const existing = await t.select({ id: s.members.id, name: s.members.displayName }).from(s.members).where(eq(s.members.orgId, orgId));
    const idByName = new Map<string, string>();
    for (const m of d.team) {
      const key = m.name.trim().toLowerCase();
      if ([...idByName.keys()].includes(key)) continue;
      let id = existing.find((e) => e.name.toLowerCase() === key)?.id;
      if (!id) [{ id }] = await t.insert(s.members).values({ orgId, displayName: m.name.trim() }).returning({ id: s.members.id });
      idByName.set(key, id!);
      await t.insert(s.projectMembers).values({ projectId: p.id, memberId: id!, role: m.role || "membre" });
    }
    if (d.deliverables.length) await t.insert(s.deliverables).values(d.deliverables.map((x) => ({ projectId: p.id, name: x.name, dueDate: x.due })));
    if (d.stakeholders.length) await t.insert(s.stakeholders).values(d.stakeholders.map((x) => ({ projectId: p.id, name: x.name, role: x.role })));

    let created = 0;
    for (const [gi, g] of d.groups.entries()) {
      const [grp] = await t.insert(s.taskGroups).values({ projectId: p.id, name: g.name, position: gi }).returning({ id: s.taskGroups.id });
      for (const [ti, task] of g.tasks.entries()) {
        const [row] = await t.insert(s.tasks).values({
          projectId: p.id, groupId: grp.id, name: task.name, priority: task.priority, position: ti,
          ownerId: task.owner ? idByName.get(task.owner.trim().toLowerCase()) ?? null : null,
          dueDate: task.due, baselineDueDate: task.due,
        }).returning({ id: s.tasks.id });
        if (task.subtasks.length) await t.insert(s.subtasks).values(task.subtasks.map((text, k) => ({ taskId: row.id, text, position: k })));
        await t.insert(s.taskEvents).values({ projectId: p.id, taskId: row.id, actorId: actor.memberId, actorKind: actor.kind, kind: "created", newValue: task.name });
        created++;
      }
    }
    return { projectId: p.id, tasks: created, docsDir };
  });
  // Dossier du projet dans la base de connaissances client, avec sa fiche (hors transaction : c'est un fichier).
  try {
    ensureProjectFolder(docsDir, projectFiche({ name: d.name, description: d.description, start: d.start_date, end: d.end_date,
      deliverables: d.deliverables, stakeholders: d.stakeholders, team: d.team }));
  } catch (e) { console.error("[rag-client] dossier non créé", docsDir, e); }
  return result;
}

/* ------------------------------------------------------------- usage de l'IA */

export async function countAiRequest(db: Db, orgId: string, limit: number) {
  // Incrément atomique : deux demandes simultanées ne peuvent pas dépasser la limite ensemble.
  const rows = await db.insert(s.aiUsage).values({ orgId, day: today(), requests: 1 })
    .onConflictDoUpdate({
      target: [s.aiUsage.orgId, s.aiUsage.day],
      set: { requests: sql`${s.aiUsage.requests} + 1` },
      setWhere: sql`${s.aiUsage.requests} < ${limit}`,
    })
    .returning({ requests: s.aiUsage.requests });
  return { ok: rows.length > 0, used: rows[0]?.requests ?? limit, limit };
}

export async function recordAiTokens(db: Db, orgId: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  await db.update(s.aiUsage).set({
    inputTokens: sql`${s.aiUsage.inputTokens} + ${u.input}`,
    outputTokens: sql`${s.aiUsage.outputTokens} + ${u.output}`,
    cacheReadTokens: sql`${s.aiUsage.cacheReadTokens} + ${u.cacheRead}`,
    cacheWriteTokens: sql`${s.aiUsage.cacheWriteTokens} + ${u.cacheWrite}`,
  }).where(and(eq(s.aiUsage.orgId, orgId), eq(s.aiUsage.day, today())));
}

export async function getAiUsage(db: Db, orgId: string) {
  const [u] = await db.select().from(s.aiUsage).where(and(eq(s.aiUsage.orgId, orgId), eq(s.aiUsage.day, today())));
  return {
    requests: u?.requests ?? 0, input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0,
    cacheRead: u?.cacheReadTokens ?? 0, cacheWrite: u?.cacheWriteTokens ?? 0,
  };
}

export async function memberIdByName(db: Db, orgId: string, name: string) {
  const [m] = await db.select({ id: s.members.id }).from(s.members).where(and(eq(s.members.orgId, orgId), eq(s.members.displayName, name)));
  return m?.id ?? null;
}
