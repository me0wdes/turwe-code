const LIMITS = { parallel: 3, total: 6, depth: 2 };
function agentsIn(messages) {
  return (messages || []).flatMap((message) =>
    (message.agents || []).flatMap((agent) => [
      agent,
      ...agentsIn(agent.messages),
    ]),
  );
}
function validateTasks(input, allowedModels) {
  if (
    !Array.isArray(input?.tasks) ||
    input.tasks.length < 1 ||
    input.tasks.length > 3
  )
    throw new Error("Можно передать от одной до трёх задач");
  return input.tasks.map((task) => {
    if (
      typeof task?.title !== "string" ||
      !task.title.trim() ||
      task.title.length > 100 ||
      typeof task.task !== "string" ||
      !task.task.trim() ||
      task.task.length > 12000
    )
      throw new Error("Укажите название и задачу субагента");
    if (task.model !== undefined && !allowedModels.includes(task.model))
      throw new Error("Модель субагента отсутствует в сохранённом списке");
    return {
      title: task.title.trim(),
      task: task.task.trim(),
      model: task.model,
      profileId:
        typeof task.profileId === "string" ? task.profileId : undefined,
      worktree: task.worktree === true,
      allowedTools: Array.isArray(task.allowedTools)
        ? task.allowedTools.map(String)
        : undefined,
    };
  });
}
const delegationDefinition = {
  type: "function",
  label: "Субагенты",
  interaction: "delegate",
  readOnly: true,
  function: {
    name: "delegate_tasks",
    description:
      "Delegate 1–3 independent subtasks to real parallel subagents with separate contexts. Each receives the selected project, user attachments and skill instructions, and inherits the user's permission mode. Write a complete task brief including constraints and needed facts: other conversation history is NOT copied. Use for substantial separable work or when the user asks for agents; do simple tasks yourself. The tool waits for all children and returns their actual results or failures; synthesize those results. Do not assign overlapping mutations. Up to 6 agents per answer and 2 nesting levels. Never restart a stopped or denied task unless the user asks. Omit model to inherit the parent's model.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["tasks"],
      properties: {
        background: {
          type: "boolean",
          description:
            "Run agents in background and continue the main chat. Read their results later with AgentStatus.",
        },
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "task"],
            properties: {
              title: {
                type: "string",
                maxLength: 100,
                description:
                  "Short user-visible task title in the user's language",
              },
              task: {
                type: "string",
                maxLength: 12000,
                description: "Self-contained instructions and expected result",
              },
              model: {
                type: "string",
                description:
                  "Optional exact model ID from the user's saved list; omit normally",
              },
              profileId: {
                type: "string",
                description: "Specialist profile ID from the system catalogue",
              },
              worktree: {
                type: "boolean",
                description: "Create an isolated Git worktree for file changes",
              },
            },
          },
        },
      },
    },
  },
};
function createRequestGate(limit = LIMITS.parallel) {
  let active = 0;
  const queue = [];
  function drain() {
    while (active < limit && queue.length) {
      const item = queue.shift();
      item.signal.removeEventListener("abort", item.cancel);
      if (item.signal.aborted) {
        item.reject(item.signal.reason);
        continue;
      }
      active++;
      let released = false;
      item.resolve(() => {
        if (!released) {
          released = true;
          active--;
          drain();
        }
      });
    }
  }
  return {
    acquire(signal) {
      signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        const item = {
          signal,
          resolve,
          reject,
          cancel: () => {
            const index = queue.indexOf(item);
            if (index >= 0) queue.splice(index, 1);
            reject(signal.reason);
          },
        };
        signal.addEventListener("abort", item.cancel, { once: true });
        queue.push(item);
        drain();
      });
    },
  };
}
function interruptAgents(messages) {
  for (const agent of agentsIn(messages)) {
    let interrupted = false;
    for (const message of agent.messages || []) {
      if (
        [
          "queued",
          "connecting",
          "streaming",
          "working",
          "approval",
          "question",
        ].includes(message.status)
      ) {
        message.status = "stopped";
        interrupted = true;
      }
      for (const round of message.toolRounds || [])
        for (const call of round.calls || [])
          if (
            ["queued", "running", "approval", "question"].includes(call.status)
          ) {
            call.status = "stopped";
            call.result ||=
              "Работа субагента прервана закрытием приложения. Перед повторением проверь фактическое состояние.";
          }
    }
    if (interrupted) agent.finishedAt = new Date().toISOString();
  }
}
function delegationOutput(children) {
  const truncate = (text, limit) => {
    text = String(text || "");
    return text.length > limit
      ? text.slice(0, limit) +
          "\n[Результат сокращён; полная история сохранена в панели агента.]"
      : text;
  };
  const results = children.map((child) => {
    const last = child.messages.at(-1);
    return {
      id: child.id,
      title: child.title,
      model: child.model,
      status: last?.status || "stopped",
      result: truncate(last?.finalContent || last?.content, 24000),
      ...(last?.error ? { error: last.error } : {}),
      tools: child.messages
        .flatMap((message) =>
          (message.toolRounds || []).flatMap((round) => round.calls),
        )
        .map((call) => ({
          name: call.name,
          status: call.status,
          result: truncate(call.result, 2000),
        })),
    };
  });
  let text = JSON.stringify({ agents: results });
  // Keep the result valid JSON within the controller's tool-output limit.
  let limit = 12000;
  while (text.length > 90000 && limit >= 64) {
    for (const result of results) {
      result.result = truncate(result.result, limit);
      for (const call of result.tools)
        call.result = truncate(call.result, Math.min(limit, 1000));
    }
    text = JSON.stringify({ agents: results });
    limit = Math.floor(limit / 2);
  }
  return {
    text,
    isError: results.every((result) => result.status !== "complete"),
  };
}
function recoverDelegations(messages) {
  for (const message of messages || []) {
    for (const child of message.agents || [])
      recoverDelegations(child.messages);
    for (const call of (message.toolRounds || []).flatMap(
      (round) => round.calls,
    )) {
      if (
        call.name !== "delegate_tasks" ||
        !call.agentIds?.length ||
        call.status !== "stopped"
      )
        continue;
      const children = (message.agents || []).filter((child) =>
        call.agentIds.includes(child.id),
      );
      if (children.length) call.result = delegationOutput(children).text;
    }
  }
}
module.exports = {
  LIMITS,
  agentsIn,
  validateTasks,
  delegationDefinition,
  createRequestGate,
  interruptAgents,
  delegationOutput,
  recoverDelegations,
};
