import { forwardRef, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cx("bf-input", className)}
      data-slot="input"
      {...props}
    />
  ),
);

Input.displayName = "Input";
