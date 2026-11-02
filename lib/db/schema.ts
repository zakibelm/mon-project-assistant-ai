/**
 * Schéma multi-projets (outil de PMO).
 *
 * Organisation → membres (partagés entre projets), portefeuilles → projets → tâches.
 * Chaque changement de tâche est journalisé dans task_events : c'est la base du suivi
 * (retards par rapport au plan de référence) et, plus tard, de l'apprentissage.
 */
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const members = pgTable("members", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  email: text("email"),
  createdAt: createdAt(),
}, (t) => [index("members_org_idx").on(t.orgId)]);

export const portfolios = pgTable("portfolios", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const projects = pgTable("projects", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").references(() => portfolios.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  status: text("status", { enum: ["draft", "active", "on_hold", "closed"] }).notNull().default("active"),
  /** Dossier des documents du projet dans rag-client/ (base de connaissances client). */
  docsDir: text("docs_dir").unique(),
  createdAt: createdAt(),
}, (t) => [index("projects_org_idx").on(t.orgId)]);

export const projectMembers = pgTable("project_members", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("membre"),
}, (t) => [primaryKey({ columns: [t.projectId, t.memberId] })]);

export const deliverables = pgTable("deliverables", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dueDate: date("due_date", { mode: "string" }),
});

export const stakeholders = pgTable("stakeholders", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
});

export const taskGroups = pgTable("task_groups", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

export const TASK_STATUSES = ["todo", "doing", "block", "done"] as const;

/** Types de problème à l'origine d'un retard (servent à regrouper les leçons apprises). */
export const PROBLEM_TYPES = [
  "dependance_externe", "sous_estimation", "information_manquante", "changement_perimetre",
  "surcharge", "probleme_technique", "autre",
] as const;
export const TASK_PRIORITIES = ["Haute", "Moyenne", "Basse"] as const;

export const tasks = pgTable("tasks", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => taskGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
  ownerId: text("owner_id").references(() => members.id, { onDelete: "set null" }),
  dueDate: date("due_date", { mode: "string" }),
  /** Date prévue dans le plan de référence : sert à mesurer les retards. */
  baselineDueDate: date("baseline_due_date", { mode: "string" }),
  priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("Moyenne"),
  position: integer("position").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /* Note d'explication (rédigée par le responsable de la tâche) */
  problemType: text("problem_type", { enum: PROBLEM_TYPES }),
  noteProblem: text("note_problem"),
  noteResolution: text("note_resolution"),
  noteAuthorId: text("note_author_id").references(() => members.id, { onDelete: "set null" }),
  noteUpdatedAt: timestamp("note_updated_at", { withTimezone: true }),
  /* Évaluation de 1 à 5, proposée par le responsable ou le chef de projet */
  rating: integer("rating"),
  ratedById: text("rated_by_id").references(() => members.id, { onDelete: "set null" }),
  ratedAt: timestamp("rated_at", { withTimezone: true }),
  /* Validation par le chef de projet (case à cocher) : seules les notes validées servent à l'apprentissage */
  validated: boolean("validated").notNull().default(false),
  validatedById: text("validated_by_id").references(() => members.id, { onDelete: "set null" }),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tasks_project_idx").on(t.projectId), index("tasks_owner_idx").on(t.ownerId),
  check("tasks_rating_range", sql`${t.rating} is null or ${t.rating} between 1 and 5`),
]);

export const subtasks = pgTable("subtasks", {
  id: id(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  done: boolean("done").notNull().default(false),
  position: integer("position").notNull().default(0),
});

export const comments = pgTable("comments", {
  id: id(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => members.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("comments_task_idx").on(t.taskId)]);

/**
 * Historique des tâches. Pas de clé étrangère vers tasks : l'historique d'une tâche
 * supprimée doit rester consultable.
 */
export const taskEvents = pgTable("task_events", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(),
  actorId: text("actor_id").references(() => members.id, { onDelete: "set null" }),
  /** member : action directe ; assistant : action de l'IA pour le compte de actorId ; system : automatisme. */
  actorKind: text("actor_kind", { enum: ["member", "assistant", "system"] }).notNull(),
  kind: text("kind", { enum: ["created", "updated", "deleted"] }).notNull(),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: createdAt(),
}, (t) => [index("task_events_task_idx").on(t.taskId), index("task_events_project_idx").on(t.projectId, t.createdAt)]);

export const automations = pgTable("automations", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  onStatus: text("on_status", { enum: TASK_STATUSES }).notNull(),
  notifyMemberId: text("notify_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const notifications = pgTable("notifications", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => members.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("notifications_member_idx").on(t.memberId, t.read)]);

/** Leçons apprises, synthétisées par l'IA à partir des notes validées. */
export const lessons = pgTable("lessons", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** null = synthèse sur tous les projets. */
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  problemType: text("problem_type", { enum: PROBLEM_TYPES }).notNull(),
  title: text("title").notNull(),
  problem: text("problem").notNull(),
  resolution: text("resolution").notNull(),
  recommendation: text("recommendation").notNull(),
  /** Poids moyen des notes sources (évaluation de 1 à 5). */
  weight: real("weight").notNull(),
  sourceTaskIds: jsonb("source_task_ids").$type<string[]>().notNull(),
  createdAt: createdAt(),
}, (t) => [index("lessons_org_idx").on(t.orgId, t.createdAt)]);

/** Paramètres de l'organisation. La clé d'IA est chiffrée (AES-256-GCM) et n'est jamais renvoyée au navigateur. */
export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  openrouterKeyEnc: text("openrouter_key_enc"),
  openrouterKeyLast4: text("openrouter_key_last4"),
  aiModel: text("ai_model"),
  aiDailyLimit: integer("ai_daily_limit"),
  updatedById: text("updated_by_id").references(() => members.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Usage de l'IA par organisation et par jour (limite quotidienne et suivi des coûts). */
export const aiUsage = pgTable("ai_usage", {
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  day: date("day", { mode: "string" }).notNull(),
  requests: integer("requests").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.orgId, t.day] })]);
