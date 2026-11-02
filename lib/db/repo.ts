/**
 * Accès aux données des projets. Toutes les écritures sur les tâches passent ici,
 * ce qui garantit qu'elles sont journalisées dans task_events.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";
import { Board, Priority, ProjectSummary, Status, STATUS_LABEL } from "@/lib/board/types";

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
    projectId: p.id, orgId: p.orgId, name: p.name, description: p.description, startDate: p.startDate, endDate: p.endDate,
    members: team.map((m) => ({ name: m.name, role: m.role })),
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
    })),
    automations: autos,
    notifications: notifs.map((n) => ({ text: n.body, at: n.createdAt.toISOString(), read: n.read })),
  };
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
