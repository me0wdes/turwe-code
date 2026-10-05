import type { SVGProps } from "react";
import { geometry } from "./geometry";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  active?: boolean;
};

export function createIcon(name: keyof typeof geometry) {
  return function Icon({
    size = 24,
    active,
    className = "",
    ...props
  }: IconProps) {
    const pair = geometry[name];
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        overflow="hidden"
        aria-hidden="true"
        focusable="false"
        {...props}
        className={`mishanaer-icon ${className}`}
        data-icon={name}
        data-icon-active={active || undefined}
      >
        <g className="icon-stroke">
          {pair.stroke.map((attributes, index) => (
            <path key={index} {...attributes} />
          ))}
        </g>
        <g className="icon-filled">
          {pair.filled.map((attributes, index) => (
            <path key={index} {...attributes} />
          ))}
        </g>
      </svg>
    );
  };
}
