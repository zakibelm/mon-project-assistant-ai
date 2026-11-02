import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { projects, tasks } from "@/lib/db/schema";

/** Projet d'une tâche, si elle appartient à l'organisation courante. */
export async function taskProject(db: Db, taskId: string, orgId: string) {
  const [row] = await db.select({ projectId: tasks.projectId, orgId: projects.orgId })
    .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(eq(tasks.id, taskId));
  return row && row.orgId === orgId ? row.projectId : null;
}
