import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cx("bf-textarea", className)}
      data-slot="textarea"
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
