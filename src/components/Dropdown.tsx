import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Folder, FolderPlus, Settings2 } from "../icons";
import type { ReactNode } from "react";
import type { ModelOption, Project } from "../types";
import { ModelControls, type ModelControlsProps } from "./ModelControls";
export function Dropdown({
  label,
  children,
  trigger,
  disabled,
  className = "",
  contentClassName = "",
  align = "start",
}: {
  label: string;
  children: ReactNode;
  trigger: ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  align?: "start" | "end";
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          className={`dropdown-trigger ${className}`}
          aria-label={label}
          disabled={disabled}
        >
          {trigger}
          <ChevronDown size={12} className="dropdown-chevron" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className={`dropdown-content ${contentClassName}`}
          sideOffset={7}
          collisionPadding={12}
          align={align}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function MenuChoice({
  value,
  children,
  detail,
  disabled,
}: {
  value: string;
  children: ReactNode;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <Menu.RadioItem
      value={value}
      disabled={disabled}
      className="dropdown-item"
      textValue={typeof children === "string" ? children : undefined}
    >
      <span className="dropdown-item-copy">
        <span>{children}</span>
        {detail && <small>{detail}</small>}
      </span>
      <Menu.ItemIndicator className="dropdown-check">
        <Check size={14} />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
}
export function ProjectMenu({
  projects,
  value,
  onChange,
  onChoose,
  disabled,
  label = "Проект",
  all = false,
  allowNone = true,
}: {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
  onChoose: () => void;
  disabled?: boolean;
  label?: string;
  all?: boolean;
  allowNone?: boolean;
}) {
  const current = projects.find((p) => p.id === value);
  return (
    <Dropdown
      label={label}
      disabled={disabled}
      trigger={
        <>
          <Folder size={14} active={!!current} />
          <span className="dropdown-value">
            {current?.name || (all ? "Вся библиотека" : "Выбрать проект")}
          </span>
        </>
      }
    >
      <Menu.Label className="dropdown-label">
        {all ? "Скиллы проекта" : "Папка проекта"}
      </Menu.Label>
      <Menu.RadioGroup
        value={value || ""}
        onValueChange={(id) => onChange(id || null)}
      >
        {allowNone && (
          <MenuChoice value="">
            {all ? "Вся библиотека" : "Без проекта"}
          </MenuChoice>
        )}
        {projects.map((p) => (
          <MenuChoice key={p.id} value={p.id} detail={p.path}>
            {p.name}
          </MenuChoice>
        ))}
      </Menu.RadioGroup>
      <Menu.Separator className="dropdown-separator" />
      <Menu.Item className="dropdown-item" onSelect={onChoose}>
        <FolderPlus size={15} />
        Выбрать или создать папку…
      </Menu.Item>
    </Dropdown>
  );
}
export function ModelMenu({
  models,
  value,
  onChange,
  onManage,
  disabled,
  wide = false,
  ...controls
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  onManage?: () => void;
  disabled?: boolean;
  wide?: boolean;
} & ModelControlsProps) {
  const current = models.find((model) => model.id === value);
  const hasControls = !!(controls.onEffort || controls.onCompact);
  return (
    <Dropdown
      label={wide ? "Модель по умолчанию" : "Модель"}
      className={wide ? "wide-trigger" : "model-trigger"}
      disabled={disabled && !hasControls}
      align="end"
      contentClassName={hasControls ? "model-controls-menu" : ""}
      trigger={
        <span className="dropdown-value">
          {current?.name || value || "Выбрать модель"}
        </span>
      }
    >
      <Menu.Label className="dropdown-label">Мои модели</Menu.Label>
      {!models.length && (
        <div className="dropdown-note">Добавьте модель в настройках.</div>
      )}
      <Menu.RadioGroup
        className="model-menu-options"
        value={value}
        onValueChange={onChange}
      >
        {models.map((model) => (
          <MenuChoice
            key={model.id}
            value={model.id}
            disabled={disabled || controls.compacting}
            detail={model.name !== model.id ? model.id : undefined}
          >
            {model.name}
          </MenuChoice>
        ))}
      </Menu.RadioGroup>
      {onManage && (
        <>
          <Menu.Separator className="dropdown-separator" />
          <Menu.Item className="dropdown-item" onSelect={onManage}>
            <Settings2 size={14} />
            Управление моделями…
          </Menu.Item>
        </>
      )}
      {hasControls && <ModelControls {...controls} disabled={disabled} />}
    </Dropdown>
  );
}
export { Menu };
