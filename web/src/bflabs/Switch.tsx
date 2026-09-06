import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
};

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, disabled, ...props }, ref) => (
    <label className={cx("bf-switch", disabled && "bf-switch--disabled")} data-slot="switch">
      <span className="bf-switch__track">
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          className="bf-switch__input"
          disabled={disabled}
          {...props}
        />
        <span className="bf-switch__thumb" aria-hidden="true" />
      </span>
      {label ? <span className="bf-switch__label">{label}</span> : null}
    </label>
  ),
);

Switch.displayName = "Switch";
