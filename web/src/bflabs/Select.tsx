import { forwardRef, type SelectHTMLAttributes } from "react";
import { cx } from "./cx";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <span className="bf-select" data-slot="select">
      <select ref={ref} className={cx("bf-select__control", className)} {...props}>
        {children}
      </select>
      <span className="bf-select__chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
      </span>
    </span>
  ),
);

Select.displayName = "Select";
