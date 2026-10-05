import type { Project, Session } from "../src/types";
export function requireProject(
  state: { projects: Project[] },
  projectId?: string | null,
): Project;
export function findEmptySession(
  sessions: Session[],
  projectId: string | null,
): Session | undefined;
