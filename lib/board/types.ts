/** Types de vue partagés entre le serveur, l'assistant et l'interface. */
import { PROBLEM_TYPES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/db/schema";

export { PROBLEM_TYPES };
export type ProblemType = (typeof PROBLEM_TYPES)[number];
export const PROBLEM_LABEL: Record<ProblemType, string> = {
  dependance_externe: "Dépendance externe",
  sous_estimation: "Sous-estimation",
  information_manquante: "Information manquante",
  changement_perimetre: "Changement de périmètre",
  surcharge: "Surcharge",
  probleme_technique: "Problème technique",
  autre: "Autre",
};

/** Note d'explication d'une tâche et son évaluation par le chef de projet. */
export interface TaskNote {
  problemType: ProblemType | null;
  problem: string;
  resolution: string;
  author: string | null;
  updatedAt: string | null;
  /** 1 à 5, proposée par le responsable ou le chef de projet ; null = pas encore évaluée. */
  rating: number | null;
  ratedBy: string | null;
  /** Case cochée par le chef de projet : la note et son évaluation servent à l'apprentissage. */
  validated: boolean;
  validatedBy: string | null;
}

export const STATUSES = TASK_STATUSES;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "À faire",
  doing: "En cours",
  block: "Bloqué",
  done: "Terminé",
};

export const PRIORITIES = TASK_PRIORITIES;
export type Priority = (typeof PRIORITIES)[number];

export interface Subtask { text: string; done: boolean }
export interface Comment { author: string | null; text: string; at: string }

export interface Item {
  id: string;
  groupId: string;
  name: string;
  status: Status;
  owner: string | null;
  due: string | null; // AAAA-MM-JJ
  baselineDue: string | null;
  priority: Priority;
  subtasks: Subtask[];
  comments: Comment[];
  note: TaskNote | null;
  /** En retard (échéance dépassée, ou terminée / reportée après la date du plan de référence) : une explication est attendue. */
  late: boolean;
}

export interface Group { id: string; name: string }
export interface Automation { id: string; onStatus: Status; notify: string }
export interface Notification { text: string; at: string; read: boolean }

export interface Board {
  projectId: string;
  orgId: string;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  /** Dossier des documents du projet dans rag-client/. */
  docsDir: string | null;
  members: { name: string; role: string; isManager: boolean }[];
  deliverables: { name: string; due: string | null }[];
  stakeholders: { name: string; role: string }[];
  groups: Group[];
  items: Item[];
  automations: Automation[];
  notifications: Notification[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  endDate: string | null;
  total: number;
  done: number;
  blocked: number;
  /** Non terminées et dont l'échéance est passée. */
  overdue: number;
  /** Échéance actuelle postérieure à la date du plan de référence. */
  slipped: number;
}
