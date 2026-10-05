import { Settings2 } from "../icons";
import type { PermissionMode } from "../types";
import { Dropdown, Menu, MenuChoice } from "./Dropdown";

const modes: { value: PermissionMode; label: string; detail: string }[] = [
  {
    value: "ask",
    label: "Ручной",
    detail: "Подтверждать каждый вызов инструмента, включая чтение.",
  },
  {
    value: "simple",
    label: "Упрощённый",
    detail: "Запомненные разрешения — сразу. Новые действия — с вашим подтверждением.",
  },
  {
    value: "auto",
    label: "Авто",
    detail:
      "Запомненные разрешения — сразу. Остальное проверяет отдельная модель. Её решения не запоминаются.",
  },
  {
    value: "bypass",
    label: "Ебашим на все бабки",
    detail:
      "Все доступные действия сразу: без подтверждений, проверки моделью и правил разрешений проекта.",
  },
  { value: "plan", label: "План", detail: "Исследование без правок. Выполнение после утверждения плана." },
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
        {modes.filter((mode) => mode.value !== "plan").map((mode) => (
          <MenuChoice key={mode.value} value={mode.value} detail={mode.detail}>
            {mode.label}
          </MenuChoice>
        ))}
        <Menu.Separator className="dropdown-separator" />
        <MenuChoice value="plan" detail={modes.at(-1)!.detail}>План</MenuChoice>
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
