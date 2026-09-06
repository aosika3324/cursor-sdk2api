import {
  cloneElement,
  isValidElement,
  useId,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cx } from "./cx";

export type FieldProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** The control to render. Its id/aria-* attributes are wired automatically. */
  children: ReactNode;
};

type ControlAriaProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

export function Field({ label, hint, error, className, children, ...props }: FieldProps) {
  const reactId = useId();
  const controlId = `${reactId}-control`;
  const hintId = `${reactId}-hint`;
  const errorId = `${reactId}-error`;

  const describedBy = cx(hint ? hintId : undefined, error ? errorId : undefined) || undefined;

  let control = children;
  if (isValidElement(children)) {
    const child = children as ReactElement<ControlAriaProps>;
    const existingDescribedBy = child.props["aria-describedby"];
    control = cloneElement(child, {
      id: child.props.id ?? controlId,
      "aria-describedby": cx(existingDescribedBy, describedBy) || undefined,
      "aria-invalid": error ? true : child.props["aria-invalid"],
    });
  }

  const controlIdForLabel = isValidElement(children)
    ? ((children as ReactElement<ControlAriaProps>).props.id ?? controlId)
    : controlId;

  return (
    <div
      className={cx("bf-field", error ? "bf-field--error" : undefined, className)}
      data-slot="field"
      {...props}
    >
      <label className="bf-field__label" htmlFor={controlIdForLabel}>
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p className="bf-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="bf-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
