/** Types de vue partagés entre le serveur, l'assistant et l'interface. */
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/db/schema";

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
  members: { name: string; role: string }[];
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
