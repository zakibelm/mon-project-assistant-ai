export const STATUSES = ["todo", "doing", "block", "done"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "À faire",
  doing: "En cours",
  block: "Bloqué",
  done: "Terminé",
};

export const PRIORITIES = ["Haute", "Moyenne", "Basse"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Subtask { text: string; done: boolean }
export interface Comment { author: string; text: string; at: string }

export interface Item {
  id: string;
  groupId: string;
  name: string;
  status: Status;
  owner: string | null;
  due: string | null; // AAAA-MM-JJ
  priority: Priority;
  subtasks: Subtask[];
  comments: Comment[];
}

export interface Group { id: string; name: string }

export interface Automation { id: string; onStatus: Status; notify: string }

export interface Notification { text: string; at: string; read: boolean }

export interface Board {
  id: string;
  workspaceId: string;
  name: string;
  members: string[];
  groups: Group[];
  items: Item[];
  automations: Automation[];
  notifications: Notification[];
}
