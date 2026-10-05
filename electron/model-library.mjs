import catalogue from "./model-catalogue.json" with { type: "json" };

const endpointKey = (url) => url.replace(/\/+$/, "");
export const DEFAULT_MODEL = catalogue.defaultModel;
export function approvalModel(models, selected = "") {
  if (selected) return models.find((model) => model.id === selected)?.id || "";
  for (const family of ["haiku", "sonnet"])
    for (const model of models)
      if (new RegExp(`(?:^|[^a-z])${family}(?:$|[^a-z])`, "i").test(model.id)) return model.id;
  return "";
}
export function modelPresets(baseUrl = "") {
  return endpointKey(baseUrl) === catalogue.baseUrl
    ? catalogue.models.map((model) => ({ ...model }))
    : [];
}
export function validateModel(input) {
  if (
    !input ||
    typeof input.id !== "string" ||
    !input.id.trim() ||
    input.id.length > 200 ||
    /[\s\x00-\x1f\x7f]/.test(input.id.trim())
  )
    throw new Error("Введите ID модели без пробелов, не длиннее 200 символов");
  if (
    input.name != null &&
    (typeof input.name !== "string" ||
      input.name.length > 200 ||
      /[\x00-\x1f\x7f]/.test(input.name))
  )
    throw new Error("Введите название не длиннее 200 символов");
  return { id: input.id.trim(), name: input.name?.trim() || input.id.trim() };
}
function replaceSelection(session, model) {
  if (session.model === model) return;
  for (const message of session.messages)
    if (message.role === "assistant" && !message.model)
      message.model = session.model;
  session.model = model;
}

export function createModelLibrary(state, save = () => {}) {
  if (
    !state.modelLibraries ||
    typeof state.modelLibraries !== "object" ||
    Array.isArray(state.modelLibraries)
  )
    state.modelLibraries = {};
  function ensure(baseUrl, migrate = false) {
    const key = endpointKey(baseUrl);
    if (!Object.hasOwn(state.modelLibraries, key)) {
      const models = modelPresets(key);
      if (migrate) {
        for (const id of [
          state.settings.model,
          ...state.sessions.map((s) => s.model),
        ]) {
          try {
            const model = validateModel({ id });
            if (!models.some((m) => m.id === model.id)) models.push(model);
          } catch {}
        }
      }
      state.modelLibraries[key] = {
        models,
        defaultModel:
          models.some((m) => m.id === state.settings.model) && migrate
            ? state.settings.model
            : models[0]?.id || "",
      };
    }
    return state.modelLibraries[key];
  }
  const initial = ensure(state.settings.baseUrl, true);
  state.settings.model = initial.defaultModel;
  state.settings.approvalModel = initial.approvalModel || "";
  function current(expected = state.settings.baseUrl) {
    if (endpointKey(expected) !== endpointKey(state.settings.baseUrl))
      throw new Error(
        "Изменилось подключение. Повторите поиск для текущего API.",
      );
    return ensure(state.settings.baseUrl, true);
  }
  return {
    list: () => current().models.map((model) => ({ ...model })),
    add(baseUrl, input) {
      const library = current(baseUrl),
        model = validateModel(input);
      if (library.models.some((m) => m.id === model.id))
        throw new Error("Эта модель уже есть в вашем списке");
      if (library.models.length >= 200)
        throw new Error("В списке уже 200 моделей");
      library.models.push(model);
      if (!library.defaultModel) {
        library.defaultModel = model.id;
        state.settings.model = model.id;
        for (const session of state.sessions)
          if (!session.model) session.model = model.id;
      }
      save();
    },
    selectDefault(baseUrl, id) {
      const library = current(baseUrl);
      if (!library.models.some((m) => m.id === id))
        throw new Error("Сначала добавьте модель в свой список");
      library.defaultModel = id;
      state.settings.model = id;
      save();
    },
    selectApproval(baseUrl, id) {
      const library = current(baseUrl);
      if (typeof id !== "string" || (id && !library.models.some((m) => m.id === id)))
        throw new Error("Сначала добавьте проверяющую модель в свой список");
      library.approvalModel = id;
      state.settings.approvalModel = id;
      save();
    },
    remove(baseUrl, id) {
      const library = current(baseUrl);
      if (!library.models.some((m) => m.id === id))
        throw new Error("Модель не найдена");
      if (library.models.length === 1)
        throw new Error("Оставьте хотя бы одну модель");
      library.models = library.models.filter((m) => m.id !== id);
      if (library.approvalModel === id) library.approvalModel = "";
      state.settings.approvalModel = library.approvalModel || "";
      if (library.defaultModel === id)
        library.defaultModel = library.models[0].id;
      state.settings.model = library.defaultModel;
      for (const session of state.sessions)
        if (session.model === id)
          replaceSelection(session, library.defaultModel);
      save();
    },
    switchProvider(baseUrl) {
      const key = endpointKey(baseUrl),
        library = ensure(key);
      state.settings.baseUrl = key;
      state.settings.model = library.defaultModel;
      state.settings.approvalModel = library.approvalModel || "";
      for (const session of state.sessions)
        if (!library.models.some((m) => m.id === session.model))
          replaceSelection(session, library.defaultModel);
      save();
    },
  };
}
