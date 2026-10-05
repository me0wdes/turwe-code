import { Dropdown, Menu, MenuChoice } from "./Dropdown";
import type { Effort } from "../types";
import { Sparkles } from "../icons";
import { effortOptions as options } from "./ModelControls";
export function EffortMenu({
  value = "auto",
  onChange,
  disabled,
}: {
  value?: Effort;
  onChange: (value: Effort) => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown
      label="Глубина рассуждений"
      disabled={disabled}
      trigger={
        <>
          <Sparkles size={14} />
          <span>Effort: {options.find((o) => o.value === value)?.name}</span>
        </>
      }
    >
      <Menu.RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as Effort)}
      >
        {options.map((o) => (
          <MenuChoice key={o.value} value={o.value} detail={o.detail}>
            {o.name}
          </MenuChoice>
        ))}
      </Menu.RadioGroup>
      <div className="dropdown-note">
        Поддержка зависит от модели и API-провайдера.
      </div>
    </Dropdown>
  );
}
