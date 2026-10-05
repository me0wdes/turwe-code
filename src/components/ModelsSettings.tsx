import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, LoaderCircle, Plus, Search, Trash2 } from "../icons";
import type { AppState, ModelOption, Result } from "../types";
import { bridge, unwrap } from "../bridge";
import { ModelMenu } from "./Dropdown";
import { IconButton } from "./Primitives";
import { fluid } from "../motion";

export function ModelsSettings({
  state,
  onState,
  onConnection,
}: {
  state: AppState;
  onState: (state: AppState) => void;
  onConnection: () => void;
}) {
  const [adding, setAdding] = useState(false),
    [id, setId] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [found, setFound] = useState<ModelOption[] | null>(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const request = useRef(0);
  const endpoint = state.settings.baseUrl;
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function change(action: Promise<Result<AppState>>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      onState(await unwrap(action));
      setNotice(message);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function discover() {
    if (!state.hasKey) {
      setError("Сначала добавьте ключ API в разделе «Подключение».");
      return;
    }
    const current = ++request.current;
    setSearching(true);
    setError("");
    setNotice("");
    setFound(null);
    setQuery("");
    try {
      const result = await unwrap(bridge.getModels());
      if (request.current === current && result.baseUrl === endpoint)
        setFound(result.models);
    } catch (error) {
      if (request.current === current) setError((error as Error).message);
    } finally {
      if (request.current === current) setSearching(false);
    }
  }
  const results =
    found?.filter((model) =>
      (model.name + " " + model.id).toLowerCase().includes(query.toLowerCase()),
    ) || [];
  return (
    <div className="models-settings">
      <div className="models-intro">
        <h3>Мои модели</h3>
        <p>Только этот список появляется при выборе модели в чате.</p>
      </div>
      <div className="model-default-field">
        <span>Модель по умолчанию</span>
        <ModelMenu
          wide
          models={state.models}
          value={state.settings.model}
          disabled={busy || !state.models.length}
          onChange={(id) =>
            void change(
              bridge.setDefaultModel(endpoint, id),
              "Модель для новых чатов изменена",
            )
          }
        />
        <p className="field-hint">
          Для новых чатов. В текущем чате модель выбирается отдельно.
        </p>
      </div>
      <div className="saved-model-list" aria-label="Сохранённые модели">
        {state.models.map((model) => (
          <div className="saved-model-row" key={model.id}>
            <div className="model-row-copy">
              <strong>{model.name}</strong>
              <code>{model.id}</code>
            </div>
            {state.settings.model === model.id && (
              <span className="model-default-badge">
                <Check size={12} />
                Основная
              </span>
            )}
            <IconButton
              label={`Удалить ${model.name}`}
              disabled={busy || state.models.length === 1}
              onClick={() =>
                void change(
                  bridge.removeModel(endpoint, model.id),
                  "Модель удалена из списка",
                )
              }
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
        {!state.models.length && (
          <p className="models-empty">
            Пока нет моделей. Добавьте свою по ID или найдите доступные на
            сервере.
          </p>
        )}
      </div>
      <div className="model-actions">
        <button
          className="secondary-button"
          aria-expanded={adding}
          onClick={() => {
            setAdding((value) => !value);
            setError("");
          }}
        >
          <Plus size={14} />
          Добавить свою
        </button>
        <button
          className="secondary-button"
          disabled={searching || busy}
          onClick={() => void discover()}
        >
          {searching ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Search size={14} />
          )}
          {searching ? "Ищем модели…" : "Найти модели"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {adding && (
          <motion.form
            className="custom-model-form"
            key="custom-model"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={fluid.moderate}
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await change(
                  bridge.addModel(endpoint, { id, name }),
                  "Модель добавлена",
                )
              ) {
                setId("");
                setName("");
                setAdding(false);
              }
            }}
          >
            <div className="custom-model-fields">
              <label className="field-label">
                ID модели
                <input
                  autoFocus
                  required
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  placeholder="Например, claude-sonnet-5"
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
              <label className="field-label">
                Название <span className="optional-label">необязательно</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Как показывать в списке"
                  maxLength={200}
                  disabled={busy}
                />
              </label>
              <p className="field-hint">
                Точный ID от провайдера. Добавление в список не проверяет
                доступность модели.
              </p>
              <div className="custom-model-buttons">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setAdding(false)}
                >
                  Отмена
                </button>
                <button
                  className="primary-button"
                  disabled={busy || !id.trim()}
                  type="submit"
                >
                  {busy ? "Добавляем…" : "Добавить модель"}
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      {(searching || found !== null) && (
        <section
          className="model-discovery"
          aria-label="Результаты поиска"
          aria-busy={searching}
        >
          <div className="model-discovery-heading">
            <h4>Найдено на сервере</h4>
            {found !== null && <span>{found.length}</span>}
          </div>
          {searching && (
            <p className="field-hint" role="status">
              Получаем список доступных моделей…
            </p>
          )}
          {found !== null && found.length === 0 && (
            <p className="models-empty" role="status">
              Сервер вернул пустой список моделей. Сохранённые модели остаются
              доступны. Другие модели можно добавить вручную по точному ID.
            </p>
          )}
          {!!found?.length && (
            <>
              <p className="field-hint">
                Выберите, какие модели добавить в свой список.
              </p>
              {found.length > 6 && (
                <label className="discovery-filter">
                  <Search size={14} />
                  <input
                    aria-label="Фильтр найденных моделей"
                    placeholder="Поиск по названию или ID"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              )}
              <div className="discovered-model-list">
                {results.map((model) => {
                  const added = state.models.some(
                    (saved) => saved.id === model.id,
                  );
                  return (
                    <div className="discovered-model-row" key={model.id}>
                      <div className="model-row-copy">
                        <strong>{model.name}</strong>
                        <code>{model.id}</code>
                      </div>
                      <button
                        className={added ? "model-added" : "secondary-button"}
                        disabled={busy || added}
                        aria-label={
                          added
                            ? `${model.name} уже добавлена`
                            : `Добавить ${model.name}`
                        }
                        onClick={() =>
                          void change(
                            bridge.addModel(endpoint, model),
                            "Модель добавлена",
                          )
                        }
                      >
                        {added ? <Check size={13} /> : <Plus size={13} />}
                        {added ? "Добавлена" : "Добавить"}
                      </button>
                    </div>
                  );
                })}
                {!results.length && (
                  <p className="field-hint">
                    По этому запросу ничего не найдено.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
          {!state.hasKey && (
            <button className="text-button" onClick={onConnection}>
              Открыть подключение
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="connection-success" role="status">
          {notice}
        </p>
      )}
      <p className="model-provider-note">
        Список для <span>{endpoint.replace(/^https:\/\//, "")}</span>
      </p>
    </div>
  );
}
