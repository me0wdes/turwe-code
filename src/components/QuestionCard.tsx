import { useState } from "react";
import { Check, MessageSquare, ChevronDown, ChevronRight } from "../icons";
import type { ToolCall, QuestionAnswer, QuestionResponse } from "../types";

// Keep unfinished choices when switching between active chats, without putting them in model history.
const drafts = new Map<string, QuestionAnswer[]>();
export function QuestionCard({
  call,
  draftKey,
  onAnswer,
}: {
  call: ToolCall;
  draftKey: string;
  onAnswer: (response: QuestionResponse) => Promise<void>;
}) {
  const questions = call.questions || [];
  const [answers, setAnswers] = useState<QuestionAnswer[]>(
    () =>
      drafts.get(draftKey) ||
      questions.map((q) => ({ id: q.id, selected: [], text: "" })),
  );
  const [busy, setBusy] = useState(false),
    [step, setStep] = useState(0),
    [error, setError] = useState("");
  function update(id: string, patch: Partial<QuestionAnswer>) {
    const next = answers.map((a) => (a.id === id ? { ...a, ...patch } : a));
    setAnswers(next);
    drafts.set(draftKey, next);
    if (drafts.size > 100) drafts.delete(drafts.keys().next().value!);
  }
  async function submit(skipped = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onAnswer(skipped ? { skipped: true, answers: [] } : { answers });
      drafts.delete(draftKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (call.status !== "question")
    return (
      <details className="question-card answered">
        <summary>
          <MessageSquare size={15} active={!!call.response} />
          <span>
            {call.response?.skipped
              ? "Вопросы пропущены"
              : call.response
                ? "Ваш ответ сохранён"
                : "Опрос остановлен"}
          </span>
          <ChevronDown size={13} />
        </summary>
        <div className="question-receipt">
          {questions.map((q) => {
            const answer = call.response?.answers.find((a) => a.id === q.id);
            return (
              <div key={q.id}>
                <strong>{q.question}</strong>
                <p>
                  {answer
                    ? [...answer.selected, answer.text]
                        .filter(Boolean)
                        .join(" · ")
                    : "Ответ не отправлен"}
                </p>
              </div>
            );
          })}
        </div>
      </details>
    );
  return (
    <form
      className="question-card"
      aria-label="Вопросы агента"
      onSubmit={(e) => {
        e.preventDefault();
        if (step < questions.length - 1) setStep(step + 1);
        else void submit();
      }}
    >
      <div className="question-card-heading">
        <MessageSquare size={16} />
        <strong>Нужен ваш ответ</strong>
        {questions.length > 1 && (
          <div className="question-steps" aria-label="Вопросы">
            {questions.map((q, index) => (
              <button
                key={q.id}
                type="button"
                aria-label={`Вопрос ${index + 1}`}
                aria-pressed={step === index}
                disabled={busy}
                title={q.question}
                onClick={() => setStep(index)}
              >
                {index !== step &&
                (answers[index].selected.length ||
                  answers[index].text.trim()) ? (
                  <Check size={11} />
                ) : (
                  index + 1
                )}
              </button>
            ))}
          </div>
        )}
        <span className="status-dot attention" />
      </div>
      {questions.map((q, index) => {
        if (index !== step) return null;
        const answer = answers[index];
        return (
          <fieldset key={q.id} disabled={busy}>
            <legend>{q.question}</legend>
            {!!q.options.length && (
              <>
                <p className="question-instruction">
                  {q.multiSelect
                    ? "Можно выбрать несколько"
                    : "Выберите один вариант или напишите свой"}
                  {!!answer.selected.length && (
                    <button
                      type="button"
                      className="question-clear"
                      onClick={() => update(q.id, { selected: [] })}
                    >
                      Снять выбор
                    </button>
                  )}
                </p>
                <div className="question-options">
                  {q.options.map((option) => {
                    const selected = answer.selected.includes(option.label);
                    return (
                      <label
                        key={option.label}
                        className={`question-option ${selected ? "selected" : ""}`}
                      >
                        <input
                          type={q.multiSelect ? "checkbox" : "radio"}
                          name={`${draftKey}-${q.id}`}
                          checked={selected}
                          onChange={() =>
                            update(q.id, {
                              selected: q.multiSelect
                                ? selected
                                  ? answer.selected.filter(
                                      (v) => v !== option.label,
                                    )
                                  : [...answer.selected, option.label]
                                : [option.label],
                            })
                          }
                        />
                        <span
                          className={`question-check ${q.multiSelect ? "multiple" : "single"}`}
                        >
                          <Check size={12} />
                        </span>
                        <span>
                          <strong>{option.label}</strong>
                          {option.description && (
                            <small>{option.description}</small>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <textarea
              aria-label={`Свой ответ: ${q.question}`}
              placeholder={
                q.options.length
                  ? "Свой ответ или дополнение…"
                  : "Напишите ответ…"
              }
              value={answer.text}
              maxLength={8000}
              rows={2}
              onChange={(e) => update(q.id, { text: e.target.value })}
            />
          </fieldset>
        );
      })}
      {error && (
        <p className="question-error" role="alert">
          {error}
        </p>
      )}
      <div className="question-actions">
        <button
          type="button"
          className="quiet-control"
          disabled={busy}
          onClick={() => void submit(true)}
        >
          Пропустить опрос
        </button>
        <button
          className="primary-button"
          disabled={
            busy ||
            (step === questions.length - 1
              ? answers.some((a) => !a.selected.length && !a.text.trim())
              : !answers[step].selected.length && !answers[step].text.trim())
          }
        >
          {busy
            ? "Отправляем…"
            : step < questions.length - 1
              ? "Далее"
              : "Отправить ответ"}
          {step < questions.length - 1 ? (
            <ChevronRight size={14} />
          ) : (
            <Check size={14} />
          )}
        </button>
      </div>
    </form>
  );
}
