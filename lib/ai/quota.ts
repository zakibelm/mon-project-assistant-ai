/**
 * Limite d'usage par espace et par jour, plus un suivi des tokens.
 * MVP en mémoire : à remplacer par une table `ai_usage` en base.
 */
interface Day { date: string; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number }
const g = globalThis as unknown as { __aiUsage?: Map<string, Day> };
const usage = (g.__aiUsage ??= new Map());
const today = () => new Date().toISOString().slice(0, 10);

function day(workspaceId: string): Day {
  let d = usage.get(workspaceId);
  if (!d || d.date !== today()) {
    d = { date: today(), requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    usage.set(workspaceId, d);
  }
  return d;
}

export function checkAndCount(workspaceId: string): { ok: boolean; limit: number; used: number } {
  const limit = Number(process.env.AI_DAILY_LIMIT || 200);
  const d = day(workspaceId);
  if (d.requests >= limit) return { ok: false, limit, used: d.requests };
  d.requests++;
  return { ok: true, limit, used: d.requests };
}

export function recordTokens(workspaceId: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const d = day(workspaceId);
  d.input += u.input; d.output += u.output; d.cacheRead += u.cacheRead; d.cacheWrite += u.cacheWrite;
}

export function getUsage(workspaceId: string) {
  return { ...day(workspaceId) };
}
