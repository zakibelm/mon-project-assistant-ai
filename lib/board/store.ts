/**
 * Stockage du board.
 *
 * Version MVP : en mémoire dans le processus serveur (perdu au redémarrage).
 * Toutes les écritures passent par les fonctions de ce module, ce qui permettra
 * de les remplacer par PostgreSQL sans toucher aux outils de l'assistant.
 */
import { randomUUID } from "crypto";
import { Board, Item, Priority, Status, STATUS_LABEL } from "./types";

const now = () => new Date().toISOString();
const shortId = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

function seed(): Board {
  const item = (
    id: string, groupId: string, name: string, status: Status, owner: string,
    due: string, priority: Priority, subtasks: [string, boolean][] = [],
  ): Item => ({
    id, groupId, name, status, owner, due, priority,
    subtasks: subtasks.map(([text, done]) => ({ text, done })),
    comments: [],
  });
  const board: Board = {
    id: "board_site",
    workspaceId: "ws_agence",
    name: "Lancement du site web",
    members: ["Zaki", "Sami", "Léa", "Inès"],
    groups: [
      { id: "g_semaine", name: "Cette semaine" },
      { id: "g_prochaine", name: "Semaine prochaine" },
      { id: "g_plustard", name: "Plus tard" },
    ],
    items: [
      item("t1", "g_semaine", "Valider la maquette de la page d'accueil", "done", "Léa", "2026-11-03", "Haute", [["Version mobile", true], ["Version bureau", true], ["Retour client", true]]),
      item("t2", "g_semaine", "Rédiger les textes des pages services", "doing", "Zaki", "2026-11-05", "Haute", [["Conseil", true], ["Formation", false], ["Accompagnement", false], ["Relecture SEO", false]]),
      item("t3", "g_semaine", "Configurer le nom de domaine et le SSL", "block", "Sami", "2026-11-04", "Moyenne", [["Accès registrar", false], ["Certificat SSL", false]]),
      item("t4", "g_semaine", "Choisir les photos de l'équipe", "todo", "Inès", "2026-11-06", "Basse"),
      item("t5", "g_prochaine", "Intégrer le formulaire de contact", "todo", "Sami", "2026-11-10", "Moyenne", [["Champs", false], ["Anti-spam", false], ["E-mail de confirmation", false]]),
      item("t6", "g_prochaine", "Mettre en place Google Analytics", "todo", "Zaki", "2026-11-11", "Basse"),
      item("t7", "g_prochaine", "Relire l'ensemble des pages", "todo", "Léa", "2026-11-12", "Moyenne"),
      item("t8", "g_plustard", "Préparer l'annonce sur LinkedIn", "todo", "Inès", "2026-11-18", "Basse"),
    ],
    automations: [{ id: "a1", onStatus: "block", notify: "Zaki" }],
    notifications: [],
  };
  board.items[2].comments.push({ author: "Sami", text: "Il me manque les accès au registrar. @Zaki tu peux me les transmettre ?", at: "2026-11-02T11:30:00Z" });
  return board;
}

// Conservé sur globalThis pour survivre au rechargement à chaud de Next en dev.
const g = globalThis as unknown as { __boards?: Map<string, Board> };
const boards = (g.__boards ??= new Map([["board_site", seed()]]));

export function getBoard(boardId: string): Board | undefined {
  return boards.get(boardId);
}

export class BoardError extends Error {}

function mustItem(board: Board, itemId: string): Item {
  const it = board.items.find((i) => i.id === itemId);
  if (!it) throw new BoardError(`Tâche introuvable : ${itemId}`);
  return it;
}
function checkOwner(board: Board, owner: string | null | undefined) {
  if (owner && !board.members.includes(owner)) {
    throw new BoardError(`« ${owner} » n'est pas membre du board. Membres : ${board.members.join(", ")}`);
  }
}
function checkGroup(board: Board, groupId: string) {
  if (!board.groups.some((g) => g.id === groupId)) throw new BoardError(`Groupe introuvable : ${groupId}`);
}

function setStatus(board: Board, it: Item, status: Status) {
  if (it.status === status) return;
  it.status = status;
  for (const a of board.automations.filter((a) => a.onStatus === status)) {
    board.notifications.unshift({
      text: `« ${it.name} » est passée à ${STATUS_LABEL[status]}. ${a.notify} est prévenu(e).`,
      at: now(), read: false,
    });
  }
}

export function createGroup(board: Board, name: string) {
  const group = { id: shortId("g"), name };
  board.groups.push(group);
  return group;
}

export function createItem(board: Board, input: {
  name: string; groupId: string; owner?: string | null; due?: string | null;
  priority?: Priority; subtasks?: string[];
}): Item {
  checkGroup(board, input.groupId);
  checkOwner(board, input.owner);
  const it: Item = {
    id: shortId("t"), groupId: input.groupId, name: input.name, status: "todo",
    owner: input.owner ?? null, due: input.due ?? null, priority: input.priority ?? "Moyenne",
    subtasks: (input.subtasks ?? []).map((text) => ({ text, done: false })), comments: [],
  };
  board.items.push(it);
  return it;
}

export function updateItem(board: Board, itemId: string, patch: {
  name?: string; status?: Status; owner?: string | null; due?: string | null;
  priority?: Priority; groupId?: string;
}): Item {
  const it = mustItem(board, itemId);
  if (patch.groupId !== undefined) { checkGroup(board, patch.groupId); it.groupId = patch.groupId; }
  if (patch.owner !== undefined) { checkOwner(board, patch.owner); it.owner = patch.owner; }
  if (patch.name !== undefined) it.name = patch.name;
  if (patch.due !== undefined) it.due = patch.due;
  if (patch.priority !== undefined) it.priority = patch.priority;
  if (patch.status !== undefined) setStatus(board, it, patch.status);
  return it;
}

export function deleteItem(board: Board, itemId: string): Item {
  const it = mustItem(board, itemId);
  board.items = board.items.filter((i) => i.id !== itemId);
  return it;
}

export function addComment(board: Board, itemId: string, author: string, text: string) {
  const it = mustItem(board, itemId);
  const c = { author, text, at: now() };
  it.comments.push(c);
  for (const m of board.members) {
    if (m !== author && text.includes(`@${m}`)) {
      board.notifications.unshift({ text: `${m} a été mentionné(e) par ${author} dans « ${it.name} ».`, at: now(), read: false });
    }
  }
  return c;
}

export function createAutomation(board: Board, onStatus: Status, notify: string) {
  checkOwner(board, notify);
  const a = { id: shortId("a"), onStatus, notify };
  board.automations.push(a);
  return a;
}
