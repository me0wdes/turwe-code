import { Settings2 } from "../icons";
import type { PermissionMode } from "../types";
import { Dropdown, Menu, MenuChoice } from "./Dropdown";

const modes: { value: PermissionMode; label: string; detail: string }[] = [
  {value:'plan',label:'План',detail:'Исследование без правок. Выполнение после утверждения плана.'},
  {
    value: "ask",
    label: "Спрашивать",
    detail: "Подтверждать каждый вызов инструмента, включая чтение.",
  },
  {
    value: "auto",
    label: "Авто",
    detail:
      "Чтение — сразу. Изменения и неизвестные действия — с подтверждением.",
  },
  {
    value: "bypass",
    label: "Bypass",
    detail:
      "Выполнять доступные инструменты без подтверждений, включая изменения.",
  },
];
export function PermissionMenu({
  value,
  onChange,
  disabled,
}: {
  value: PermissionMode;
  onChange: (value: PermissionMode) => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown
      label="Режим подтверждений"
      className={`permission-trigger ${value}`}
      contentClassName="permission-menu"
      disabled={disabled}
      trigger={
        <>
          <Settings2 size={13} active={value === "bypass"} />
          <span>{modes.find((m) => m.value === value)?.label || "Авто"}</span>
        </>
      }
    >
      <Menu.Label className="dropdown-label">
        Подтверждения · этот чат
      </Menu.Label>
      <Menu.RadioGroup
        value={value}
        onValueChange={(value) => onChange(value as PermissionMode)}
      >
        {modes.map((mode) => (
          <MenuChoice key={mode.value} value={mode.value} detail={mode.detail}>
            {mode.label}
          </MenuChoice>
        ))}
      </Menu.RadioGroup>
      <Menu.Separator className="dropdown-separator" />
      <div className="dropdown-note">
        Вопросы агента всегда ждут вашего ответа.
        <br />
        Новые чаты начинают в режиме «Авто».
      </div>
    </Dropdown>
  );
}
