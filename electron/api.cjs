function normalizeBaseUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Введите корректный адрес API");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("API должен использовать HTTPS без ключа в адресе");
  return url.href.replace(/\/+$/, "");
}
function safeError(error, key = "") {
  let text = String(error?.message || error || "Неизвестная ошибка");
  if (key) text = text.replaceAll(key, "[скрыто]");
  return text.replace(/sk-[a-zA-Z0-9_-]+/g, "[скрыто]").slice(0, 500);
}
async function errorFrom(response, key) {
  let detail = "";
  try {
    const data = await response.json();
    detail = data?.error?.message || data?.message || "";
  } catch {}
  return new Error(
    `API: HTTP ${response.status}${detail ? ` — ${safeError(detail, key)}` : ""}`,
  );
}
async function getModels({ baseUrl, key, fetchImpl = fetch }) {
  if (!key) throw new Error("Добавьте ключ API в настройках");
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw await errorFrom(response, key);
  const data = await response.json();
  if (!Array.isArray(data.data))
    throw new Error("API вернул неизвестный формат списка моделей");
  const models = new Map();
  for (const item of data.data) {
    const id = item?.id;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 200 ||
      /[\s\x00-\x1f\x7f]/.test(id)
    )
      continue;
    const label = item.display_name || item.name;
    if (!models.has(id))
      models.set(id, {
        id,
        name:
          typeof label === "string" && label.trim()
            ? label.trim().slice(0, 200)
            : id,
      });
  }
  return [...models.values()];
}
async function streamChat({
  baseUrl,
  key,
  model,
  effort,
  messages,
  tools = [],
  signal,
  onDelta,
  fetchImpl = fetch,
}) {
  if (!key) throw new Error("Добавьте ключ API в настройках");
  const timeout = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, timeout.signal])
    : timeout.signal;
  let timer;
  function resetTimer() {
    clearTimeout(timer);
    timer = setTimeout(
      () => timeout.abort(new Error("API не отвечает больше 90 секунд")),
      90000,
    );
    timer.unref?.();
  }
  resetTimer();
  let received = 0;
  let finishReason;
  const calls = new Map();
  function collect(parts, complete = false) {
    if (!parts) return;
    if (!Array.isArray(parts) || parts.length > 16)
      throw new Error("API вернул некорректные вызовы инструментов");
    parts.forEach((part, position) => {
      const index = complete ? position : part.index;
      if (!Number.isInteger(index) || index < 0 || index > 15)
        throw new Error("Некорректный индекс инструмента");
      const call = calls.get(index) || {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (part.type && part.type !== "function")
        throw new Error("Неизвестный тип инструмента");
      for (const [target, field, fragment] of [
        [call, "id", part.id],
        [call.function, "name", part.function?.name],
        [call.function, "arguments", part.function?.arguments],
      ]) {
        if (fragment == null) continue;
        if (typeof fragment !== "string")
          throw new Error("Некорректный вызов инструмента");
        target[field] += fragment;
        if (target[field].length > (field === "arguments" ? 100000 : 200))
          throw new Error("Вызов инструмента превысил допустимый размер");
      }
      calls.set(index, call);
    });
  }
  function result() {
    // Chat Completions uses finish_reason; some compatible gateways also
    // forward Anthropic stop-reason names. Neither a cutoff nor a server-tool
    // pause is a completed response. Never execute a partial tool batch.
    if (["length", "max_tokens"].includes(finishReason))
      throw new Error("Ответ остановлен по лимиту длины. Полученный текст сохранён; инструменты из незавершённого ответа не выполнялись. Продолжите запрос.");
    if (finishReason === "model_context_window_exceeded")
      throw new Error("Достигнут лимит контекста модели. Сожмите контекст в меню модели и продолжите запрос.");
    if (["content_filter", "refusal"].includes(finishReason))
      throw new Error("Провайдер остановил ответ по своим правилам. Полученный текст сохранён; действия не выполнялись.");
    if (finishReason === "pause_turn")
      throw new Error("Провайдер поставил серверный инструмент на паузу. Этот ответ требует продолжения через Anthropic Messages API; текущий коннектор использует Chat Completions.");
    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call);
    if (["tool_calls", "function_call", "tool_use"].includes(finishReason) && !toolCalls.length)
      throw new Error("API сообщил о вызове инструмента, но не передал его параметры. Действие не было выполнено; повторите запрос.");
    const ids = new Set();
    for (const call of toolCalls) {
      if (
        !call.id ||
        ids.has(call.id) ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(call.function.name)
      )
        throw new Error("API вернул незавершённый вызов инструмента");
      ids.add(call.id);
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new Error();
      } catch {
        throw new Error("API вернул некорректные аргументы инструмента");
      }
    }
    if (!received && !toolCalls.length)
      throw new Error("API вернул пустой ответ");
    return { toolCalls, finishReason };
  }
  function deliver(text) {
    if (typeof text !== "string") return;
    received += text.length;
    if (received > 2_000_000)
      throw new Error("Ответ превысил допустимый размер");
    if (text) onDelta(text);
  }
  try {
    combined.throwIfAborted();
    const response = await fetchImpl(
      `${normalizeBaseUrl(baseUrl)}/chat/completions`,
      {
        method: "POST",
        redirect: "error",
        signal: combined,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          ...(['low','medium','high'].includes(effort) ? { reasoning_effort: effort } : {}),
          messages,
          stream: true,
          ...(tools.length
            ? {
                tools: tools.map(({ type, function: fn }) => ({
                  type,
                  function: fn,
                })),
                tool_choice: "auto",
              }
            : {}),
        }),
      },
    );
    if (!response.ok) throw await errorFrom(response, key);
    if (response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.json();
      if (body.error) throw new Error(safeError(body.error.message, key));
      deliver(body.choices?.[0]?.message?.content);
      collect(body.choices?.[0]?.message?.tool_calls, true);
      finishReason = body.choices?.[0]?.finish_reason;
      return result();
    }
    if (!response.body) throw new Error("API не вернул поток ответа");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "",
      completed = false,
      done = false;
    function event(frame) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      if (data === "[DONE]") {
        completed = true;
        done = true;
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new Error("API вернул некорректный формат потока");
      }
      if (parsed.error) throw new Error(safeError(parsed.error.message, key));
      const choice = parsed.choices?.[0];
      deliver(choice?.delta?.content);
      collect(choice?.delta?.tool_calls);
      if (choice?.finish_reason != null) {
        completed = true;
        finishReason = choice.finish_reason;
      }
    }
    for await (const chunk of response.body) {
      combined.throwIfAborted();
      resetTimer();
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 1_000_000)
        throw new Error("Слишком большой фрагмент ответа API");
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (done) break;
      }
      if (done) break;
    }
    if (!done && buffer.trim()) event(buffer + decoder.decode());
    combined.throwIfAborted();
    if (!completed)
      throw new Error(
        "Поток ответа прерван. Полученный текст сохранён; можно повторить запрос.",
      );
    return result();
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { normalizeBaseUrl, safeError, getModels, streamChat };
