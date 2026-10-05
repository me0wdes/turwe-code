import { useState } from "react";
import type { AppState, GithubInspection } from "../types";
import { bridge, unwrap } from "../bridge";
import { Modal } from "./Primitives";
import { ProjectMenu, Dropdown, Menu, MenuChoice } from "./Dropdown";
import { Upload } from "../icons";
export function GithubSkillDialog({
  open,
  onOpenChange,
  state,
  projectId,
  onState,
  notify,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: AppState;
  projectId: string | null;
  onState: (s: AppState) => void;
  notify: (s: string) => void;
}) {
  const [url, setUrl] = useState(""),
    [scope, setScope] = useState(projectId),
    [result, setResult] = useState<GithubInspection | null>(null),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function inspect() {
    setError("");
    setBusy(true);
    try {
      const data = await unwrap(bridge.inspectGithub(url.trim()));
      setResult(data);
      setSelected(data.candidates.length === 1 ? data.candidates[0].path : "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function install() {
    if (!result || !selected) return;
    setError("");
    setBusy(true);
    try {
      const installed = await unwrap(
        bridge.installGithub({
          url: `https://github.com/${result.repo}/tree/${result.revision}`,
          skillPath: selected,
          projectId: scope,
        }),
      );
      onState(await unwrap(bridge.bootstrap()));
      notify(
        installed.unsupported.length
          ? `Скилл добавлен с ограничениями: ${installed.unsupported.join(", ")}`
          : `Установлен @${installed.name}`,
      );
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
      title="Установить с GitHub"
      description="Вставьте ссылку на репозиторий или папку со SKILL.md."
      className="github-dialog"
    >
      <label className="form-field">
        Ссылка на GitHub
        <input
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setResult(null);
            setSelected("");
          }}
          placeholder="https://github.com/owner/repository"
          disabled={busy}
        />
      </label>
      <div className="github-scope">
        <span>Установить для</span>
        <ProjectMenu
          projects={state.projects}
          value={scope}
          onChange={setScope}
          disabled={busy}
          onChoose={() => {
            void unwrap(bridge.chooseProject())
              .then(async (p) => {
                if (p) {
                  setScope(p.id);
                  onState(await unwrap(bridge.bootstrap()));
                }
              })
              .catch((e) => setError(e.message));
          }}
        />
      </div>
      <p className="field-hint">
        {scope
          ? "Скилл будет подключён к выбранному проекту."
          : "Без проекта — личная библиотека. Вызовите скилл через @имя."}
      </p>
      {result && (
        <div className="github-result">
          <span className="eyebrow">
            {result.repo} · {result.revision.slice(0, 7)}
          </span>
          <Dropdown
            label="Выберите скилл"
            className="wide-trigger"
            trigger={
              <span>
                {selected
                  ? result.candidates.find((c) => c.path === selected)?.name
                  : "Выберите скилл"}
              </span>
            }
          >
            <Menu.RadioGroup value={selected} onValueChange={setSelected}>
              {result.candidates.map((c) => (
                <MenuChoice key={c.path} value={c.path} detail={c.path}>
                  {c.name}
                </MenuChoice>
              ))}
            </Menu.RadioGroup>
          </Dropdown>
          <p className="field-hint">
            Копируются инструкции и текстовые справки. Скрипты из репозитория не
            запускаются.
          </p>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <span className="muted">Публичные репозитории</span>
        <button
          className="primary-button"
          disabled={busy || !url.trim() || (!!result && !selected)}
          onClick={() => void (result ? install() : inspect())}
        >
          <Upload size={15} />
          {busy ? "Подождите…" : result ? "Установить скилл" : "Найти скиллы"}
        </button>
      </div>
    </Modal>
  );
}
