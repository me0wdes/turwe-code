import { useState } from "react";
import { motion } from "motion/react";
import {
  Sparkles,
  Plus,
  Upload,
  Search,
  FileText,
  ArrowUpRight,
  FolderSearch,
  Pencil,
  Trash2,
} from "../icons";
import type { AppState, Skill } from "../types";
import { bridge, unwrap } from "../bridge";
import { Modal, IconButton } from "./Primitives";
import { ProjectMenu } from "./Dropdown";
import { fluid } from "../motion";
import { GithubSkillDialog } from "./GithubSkillDialog";
const template =
  "---\nname: my-skill\ndescription: Когда и для чего использовать этот скилл\n---\n\nОпиши, как AI должен выполнять задачу.\n\nЗадача пользователя: $ARGUMENTS\n";
export function SkillsPage({
  state,
  initialProject,
  onChooseProject,
  onUse,
  notify,
  onState,
}: {
  state: AppState;
  initialProject: string | null;
  onChooseProject: () => Promise<string | null>;
  onUse: (skill: Skill) => Promise<void>;
  notify: (message: string) => void;
  onState: (s: AppState) => void;
}) {
  const [scope, setScope] = useState(initialProject),
    [query, setQuery] = useState(""),
    [editor, setEditor] = useState<Skill | "new" | null>(null),
    [source, setSource] = useState(template),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [githubOpen, setGithubOpen] = useState(false),
    [deleting, setDeleting] = useState<Skill | null>(null);
  const project = state.projects.find((p) => p.id === scope);
  const visible = state.skills.filter(
    (s) =>
      (!scope || !s.projectId || s.projectId === scope) &&
      `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function action(work: () => Promise<unknown>, message?: string) {
    setError("");
    setBusy(true);
    try {
      await work();
      onState(await unwrap(bridge.bootstrap()));
      if (message) notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(skill: Skill | "new") {
    setEditor(skill);
    setSource(skill === "new" ? template : skill.source);
    setError("");
  }
  return (
    <motion.section
      className="skills-page"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={fluid.moderate}
    >
      <header className="skills-header">
        <div>
          <div className="eyebrow">
            <Sparkles size={14} />
            Ваша библиотека
          </div>
          <h1>Скиллы</h1>
          <p>
            Один раз объясните подход.
            <br />
            Подключайте к проекту или вызывайте в чате.
          </p>
        </div>
        <div className="skills-actions">
          <button
            className="secondary-button"
            onClick={() => setGithubOpen(true)}
          >
            <ArrowUpRight size={15} />С GitHub
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void action(
                () => unwrap(bridge.importSkill(scope)),
                "Библиотека обновлена",
              )
            }
          >
            <Upload size={15} />
            Импорт SKILL.md
          </button>
          <button className="primary-button" onClick={() => edit("new")}>
            <Plus size={16} />
            Создать скилл
          </button>
        </div>
      </header>
      <GithubSkillDialog
        key={scope || "personal"}
        open={githubOpen}
        onOpenChange={setGithubOpen}
        state={state}
        projectId={scope}
        onState={onState}
        notify={notify}
      />
      <div className="skills-controls">
        <div className="skills-search">
          <Search size={16} />
          <input
            aria-label="Поиск скиллов"
            placeholder="Найти скилл…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ProjectMenu
          label="Скиллы проекта"
          all
          projects={state.projects}
          value={scope}
          onChange={setScope}
          onChoose={() =>
            void action(async () => {
              const id = await onChooseProject();
              if (id) setScope(id);
            })
          }
        />
        {project && (
          <button
            className="icon-button"
            aria-label="Найти скиллы в папке проекта"
            title="Импорт из .claude/skills и .agents/skills"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const result = await unwrap(bridge.discoverSkills(project.id));
                notify(`Импортировано: ${result.imported.length}`);
                if (result.errors.length)
                  throw new Error(result.errors.join("\n"));
              })
            }
          >
            <FolderSearch size={18} />
          </button>
        )}
      </div>
      <p className="skills-scope-hint">
        {project ? (
          <>
            Подключённые инструкции применяются к сообщениям в{" "}
            <strong>{project.name}</strong>. Скиллы «Только по вызову»
            запускаются через @имя.
          </>
        ) : (
          <>
            Выберите проект, чтобы подключить к нему скиллы. Без подключения они
            доступны через <strong>@имя</strong> или <strong>/имя</strong>.
          </>
        )}
      </p>
      {error && !editor && !deleting && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="skills-grid">
        {visible.map((skill) => {
          const assigned = project?.skillIds?.includes(skill.id),
            incompatible = !!skill.unsupported.length;
          const sourceProject = state.projects.find(
            (p) => p.id === skill.projectId,
          );
          return (
            <article
              className={`skill-card ${assigned ? "assigned" : ""}`}
              key={skill.id}
            >
              <div className="skill-card-top">
                <span className="skill-symbol">
                  <Sparkles size={20} active={!!assigned} />
                </span>
                <span className="skill-origin">
                  {sourceProject?.name || "Личная библиотека"}
                </span>
                <IconButton
                  label={`Редактировать ${skill.name}`}
                  onClick={() => edit(skill)}
                >
                  <Pencil size={14} />
                </IconButton>
              </div>
              <button className="skill-card-title" onClick={() => edit(skill)}>
                {skill.name}
                <ArrowUpRight size={14} />
              </button>
              <p>{skill.description || "Инструкции для AI"}</p>
              <div className="skill-badges">
                {skill.manualOnly && <span>Только по вызову</span>}
                {!skill.userInvocable && <span>Только для проекта</span>}
                {!!skill.references.length && (
                  <span>{skill.references.length} файлов справки</span>
                )}
                {incompatible && (
                  <span className="error-text">
                    Нужен запуск команд или агент
                  </span>
                )}
              </div>
              <div className="skill-card-footer">
                {project ? (
                  <label className="skill-assignment">
                    <span>
                      {assigned ? "Подключён к проекту" : "Подключить"}
                    </span>
                    <button
                      role="switch"
                      aria-label={`Подключить ${skill.name} к ${project.name}`}
                      aria-checked={!!assigned}
                      className="switch"
                      disabled={busy || incompatible}
                      onClick={() =>
                        void action(() =>
                          unwrap(
                            bridge.assignSkill(project.id, skill.id, !assigned),
                          ),
                        )
                      }
                    >
                      <span />
                    </button>
                  </label>
                ) : (
                  <button
                    className="skill-use"
                    disabled={!skill.userInvocable || incompatible}
                    onClick={() => void action(() => onUse(skill))}
                  >
                    @{skill.name}
                    <ArrowUpRight size={13} />
                  </button>
                )}
                <IconButton
                  label={`Удалить ${skill.name}`}
                  onClick={() => {
                    setDeleting(skill);
                    setError("");
                  }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="skills-empty">
          <span className="skills-empty-icon">
            <FileText size={30} />
          </span>
          <h2>
            {query ? "Ничего не найдено" : "Ваши приёмы, сохранённые в скиллах"}
          </h2>
          <p>
            {query
              ? "Попробуйте другое название или описание."
              : "Стиль кода, правила ревью, тон текста — всё, что вы обычно объясняете заново."}
          </p>
          {!query && (
            <button className="secondary-button" onClick={() => edit("new")}>
              <Plus size={15} />
              Создать первый скилл
            </button>
          )}
        </div>
      )}
      <footer className="skills-footnote">
        <FileText size={14} />
        <span>
          Совместимые инструкции SKILL.md и локальная справка. Скрипты,
          инструменты и отдельные агенты пока не запускаются.
        </span>
      </footer>
      <Modal
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
        title={editor === "new" ? "Новый скилл" : editor?.name || "Скилл"}
        description="Имя — для вызова в чате. Описание — для поиска. Ниже блока --- укажите инструкции."
        className="skill-editor"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              await unwrap(
                bridge.saveSkill({
                  id: editor && editor !== "new" ? editor.id : undefined,
                  source,
                  projectId: scope,
                }),
              );
              setEditor(null);
            }, "Скилл сохранён");
          }}
        >
          <div className="skill-editor-body">
            <div className="skill-editor-caption">
              <FileText size={14} />
              <span>SKILL.md</span>
              <small>
                {editor && editor !== "new" && editor.references.length
                  ? `${editor.references.length} файлов справки сохранено`
                  : project?.name || "Личная библиотека"}
              </small>
            </div>
            <textarea
              aria-label="Содержимое SKILL.md"
              spellCheck={false}
              value={source}
              maxLength={64000}
              onChange={(e) => setSource(e.target.value)}
            />
            <p className="field-hint">
              $ARGUMENTS подставит текст после вызова. Для ручного запуска
              добавьте в начало disable-model-invocation: true.
            </p>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="dialog-footer">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              Отмена
            </button>
            <button
              className="primary-button"
              disabled={busy || !source.trim()}
            >
              {busy ? "Сохраняем…" : "Сохранить скилл"}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Удалить скилл?"
        description={`${deleting?.name || "Скилл"} будет отключён от всех проектов. В отправленных сообщениях инструкции сохранятся.`}
        className="rename-dialog"
      >
        <div className="dialog-footer">
          <button
            className="secondary-button"
            onClick={() => setDeleting(null)}
          >
            Отмена
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (deleting) await unwrap(bridge.deleteSkill(deleting.id));
                setDeleting(null);
              }, "Скилл удалён")
            }
          >
            Удалить
          </button>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </Modal>
    </motion.section>
  );
}
