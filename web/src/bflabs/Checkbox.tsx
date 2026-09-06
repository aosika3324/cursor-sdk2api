import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { CheckIcon } from "./icons";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, disabled, ...props }, ref) => (
    <label className={cx("bf-checkbox", disabled && "bf-checkbox--disabled")} data-slot="checkbox">
      <span className="bf-checkbox__box">
        <input
          ref={ref}
          type="checkbox"
          className="bf-checkbox__input"
          disabled={disabled}
          {...props}
        />
        <CheckIcon className="bf-checkbox__mark" />
      </span>
      {label ? <span className="bf-checkbox__label">{label}</span> : null}
    </label>
  ),
);

Checkbox.displayName = "Checkbox";
