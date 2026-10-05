// Some providers end a turn after a short action preamble without requesting
// the action. Recover once; never turn prose into a fabricated tool call.
function isActionPreamble(content) {
  const text = content.trim();
  if (!text || text.length > 600 || /[\n`?]|https?:\/\//i.test(text))
    return false;
  if (
    /\b(?:if|after|once|when|would|could)\b|(?:после|если|когда|подтверждени|разрешени)/i.test(
      text,
    )
  )
    return false;
  const last = text
    .split(/(?<=[.!])\s+|\s+[—–]\s+/u)
    .at(-1)
    .trim();
  return (
    /^(?:(?:я|сейчас|сначала|теперь|затем|далее|ещё|еще|потом)\s+)*(?:ищу|поищу|найду|проверю|проверяю|посмотрю|сверю|узнаю|изучу|изучаю|открою|прочитаю|запущу|выполню|исправлю|обновлю|создам|скачаю|установлю|попробую\s+(?:найти|проверить|поискать))(?:\s|[,.:!—–-]|$)/iu.test(
      last,
    ) ||
    /^(?:(?:now|first|next)\s*,?\s*)?(?:I(?:'ll| will| am|'m)|let me)\s+(?:search|look|check|verify|inspect|read|open|run|find|update|create|install|download|fix)\b/i.test(
      last,
    )
  );
}

const ACTION_CONTINUATION =
  "Предыдущая реплика — только обещание действия, а не результат. Продолжи текущую задачу: вызови доступный инструмент, если действие нужно, затем дай содержательный ответ по его фактическому результату. Если инструмент не подходит или данных недостаточно, прямо объясни ограничение либо задай нужный вопрос. Не имитируй поиск, команды или результаты. Уже выполненные действия не повторяй; используй их сохранённые результаты. Не обходи отклонённые действия и текущие разрешения.";

module.exports = { isActionPreamble, ACTION_CONTINUATION };
