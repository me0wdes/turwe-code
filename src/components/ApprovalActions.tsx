import * as Menu from "@radix-ui/react-dropdown-menu";
import { Dropdown } from "./Dropdown";
import type { ApprovalChoice, ToolCall } from "../types";

export function ApprovalActions({
  call,
  onApprove,
  onceLabel = "Разрешить один раз",
}: {
  call: ToolCall;
  onApprove: (id: string, allowed: boolean, choice?: ApprovalChoice) => void;
  onceLabel?: string;
}) {
  const tool = call.toolName || call.name;
  const manual = call.approvalScope?.manual;
  return (
    <div className="approval-actions">
      <button
        className="secondary-button"
        onClick={() => onApprove(call.id, false)}
      >
        Отклонить
      </button>
      <button
        className="primary-button"
        onClick={() => onApprove(call.id, true)}
      >
        {onceLabel}
      </button>
      <Dropdown
        label="Сохранить разрешение"
        trigger="Всегда разрешать…"
        className="secondary-button"
        contentClassName="approval-scope-menu"
        align="end"
      >
        <Menu.Label className="dropdown-label">
          Разрешение для {tool}
        </Menu.Label>
        <Menu.Item
          className="dropdown-item"
          disabled={!call.approvalScope?.projectName}
          onSelect={() => onApprove(call.id, true, "project")}
        >
          <span className="dropdown-item-copy">
            <span>Всегда в этом проекте</span>
            <small>
              {call.approvalScope?.projectName
                ? `Любые вызовы ${tool} · ${call.approvalScope.projectName}`
                : "Сначала выберите проект"}
            </small>
          </span>
        </Menu.Item>
        <Menu.Item
          className="dropdown-item"
          onSelect={() => onApprove(call.id, true, "global")}
        >
          <span className="dropdown-item-copy">
            <span>Всегда во всех проектах</span>
            <small>Любые вызовы {tool}, включая новые чаты</small>
          </span>
        </Menu.Item>
        {manual && (
          <p className="approval-scope-hint">
            Постоянное разрешение переключит этот чат в упрощённый режим.
          </p>
        )}
        <Menu.Separator className="dropdown-separator" />
        <Menu.Item
          className="dropdown-item"
          onSelect={() => onApprove(call.id, true, true)}
        >
          <span className="dropdown-item-copy">
            <span>Запомнить только этот вызов</span>
            <small>
              С теми же параметрами
              {manual ? "; ручной режим продолжит спрашивать" : ""}
            </small>
          </span>
        </Menu.Item>
        <p className="approval-scope-hint">
          Сохраняется после перезапуска. Отозвать можно в «Доступ и LSP».
        </p>
      </Dropdown>
    </div>
  );
}
