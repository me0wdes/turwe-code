export function requireProject(state, projectId) {
  if (!projectId) throw new Error("Укажите существующий проект или начните чат без проекта");
  const project = state.projects.find((item) => item.id === projectId);
  if (!project)
    throw new Error("Проект не найден. Выберите папку проекта заново");
  return project;
}

// Reuse only an untouched draft. Branches, agents and any saved work stay separate.
export function findEmptySession(sessions, projectId) {
  return sessions.find(
    (session) =>
      session.projectId === projectId &&
      !session.archived &&
      session.title === "Новая сессия" &&
      !session.draft &&
      !session.messages?.length &&
      !session.draftAttachments?.length &&
      !session.queuedInputs?.length &&
      !session.parentSessionId &&
      !session.rootSessionId &&
      !session.worktreePath &&
      !session.compaction &&
      !session.plan?.text &&
      !session.tasks?.length,
  );
}
