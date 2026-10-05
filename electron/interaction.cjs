const PERMISSION_MODES = ["ask", "simple", "auto", "bypass", "plan"];
function normalizeMode(mode) {
  return PERMISSION_MODES.includes(mode) ? mode : "auto";
}
function needsApproval(mode, tool) {
  if (tool.interaction === "question") return false;
  if (mode === "bypass" || mode === "auto") return false;
  if (mode === "ask" || mode === "simple" || tool.requiresApproval) return true;
  return tool.readOnly !== true && tool.mcp?.readOnly !== true;
}
function boundedText(value, max, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error("Некорректный текст вопроса или ответа");
  return value.trim();
}
function validateQuestions(input) {
  const items = input?.questions;
  if (!Array.isArray(items) || items.length < 1 || items.length > 3)
    throw new Error("Нужно от одного до трёх вопросов");
  const ids = new Set();
  return items.map((item) => {
    const id = boundedText(item?.id, 64),
      question = boundedText(item?.question, 2000);
    if (ids.has(id))
      throw new Error("Идентификаторы вопросов должны отличаться");
    ids.add(id);
    if (item.multiSelect !== undefined && typeof item.multiSelect !== "boolean")
      throw new Error("Некорректный режим выбора");
    const options = item.options ?? [];
    if (!Array.isArray(options) || options.length > 6)
      throw new Error("Допустимо до шести вариантов");
    const labels = new Set();
    return {
      id,
      question,
      multiSelect: item.multiSelect === true,
      options: options.map((option) => {
        const label = boundedText(option?.label, 200);
        if (labels.has(label)) throw new Error("Варианты должны отличаться");
        labels.add(label);
        return {
          label,
          ...(option.description === undefined
            ? {}
            : { description: boundedText(option.description, 500, false) }),
        };
      }),
    };
  });
}
function validateAnswers(questions, response) {
  if (
    !response ||
    !Array.isArray(response.answers) ||
    (response.skipped !== undefined && typeof response.skipped !== "boolean")
  )
    throw new Error("Некорректный ответ на вопросы");
  if (response.skipped) {
    if (response.answers.length)
      throw new Error("Пропущенный опрос не должен содержать ответов");
    return { skipped: true, answers: [] };
  }
  if (response.answers.length !== questions.length)
    throw new Error("Ответьте на каждый вопрос");
  const answers = questions.map((question) => {
    const matching = response.answers.filter((a) => a?.id === question.id);
    if (matching.length !== 1)
      throw new Error("Ответ не соответствует вопросу");
    const answer = matching[0],
      selected = answer.selected ?? [],
      text = boundedText(answer.text ?? "", 8000, false);
    if (
      !Array.isArray(selected) ||
      selected.length > (question.multiSelect ? question.options.length : 1) ||
      new Set(selected).size !== selected.length ||
      selected.some((label) => !question.options.some((o) => o.label === label))
    )
      throw new Error("Выберите варианты из вопроса");
    if (!selected.length && !text)
      throw new Error("Выберите вариант или напишите свой ответ");
    return { id: question.id, selected, text };
  });
  return { answers };
}
const questionDefinition = {
  type: "function",
  label: "Вопрос к вам",
  interaction: "question",
  function: {
    name: "ask_user",
    description:
      "Ask the user 1–3 concise questions when a meaningful choice or missing information is needed. The app displays an interactive form, pauses until the user answers or skips, and returns the real answers. Never invent answers. Free text is always available. Do not use this for tool permissions: the app handles them separately.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "question"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 64 },
              question: { type: "string", minLength: 1, maxLength: 2000 },
              multiSelect: { type: "boolean" },
              options: {
                type: "array",
                maxItems: 6,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label"],
                  properties: {
                    label: { type: "string", minLength: 1, maxLength: 200 },
                    description: { type: "string", maxLength: 500 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
module.exports = {
  PERMISSION_MODES,
  normalizeMode,
  needsApproval,
  validateQuestions,
  validateAnswers,
  questionDefinition,
};
