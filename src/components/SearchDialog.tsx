import { useState } from "react";
import { Search, MessageSquare, Archive } from "../icons";
import type { AppState } from "../types";
import { Modal } from "./Primitives";
export function SearchDialog({
  state,
  open,
  onClose,
  onSelect,
}: {
  state: AppState;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = state.sessions
    .filter((s) =>
      [s.title, s.draft, ...s.messages.map((m) => m.content)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .slice(0, 40);
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title="Поиск сессий"
      className="search-dialog"
      instant
    >
      <label className="search-input">
        <Search size={18} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название или текст сообщения…"
          aria-label="Поиск по истории"
        />
      </label>
      <div className="search-results">
        {results.length ? (
          results.map((s) => (
            <button
              key={s.id}
              className="search-result"
              onClick={() => {
                onSelect(s.id);
                onClose();
              }}
            >
              {s.archived ? <Archive size={16} /> : <MessageSquare size={16} />}
              <span>
                <strong>{s.title}</strong>
                <small>
                  {state.projects.find((p) => p.id === s.projectId)?.name ||
                    "Без проекта"}
                  {s.archived ? " · Архив" : ""}
                </small>
              </span>
              <small>{new Date(s.updatedAt).toLocaleDateString("ru")}</small>
            </button>
          ))
        ) : (
          <div className="search-empty">
            {query ? "Ничего не найдено" : "У вас пока нет сессий"}
          </div>
        )}
      </div>
      <div className="search-footer">
        Поиск по локальной истории
        <span>
          <kbd>Esc</kbd> закрыть
        </span>
      </div>
    </Modal>
  );
}
