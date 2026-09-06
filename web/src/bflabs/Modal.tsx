import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /**
   * When false, Escape / backdrop / close-button dismissal is suppressed. Use
   * this to block dismissal during an in-flight save. Defaults to true.
   */
  dismissible?: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, className, dismissible = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  const getFocusable = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  // Remember and restore focus around open/close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusables = getFocusable();
    (focusables[0] ?? panelRef.current)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open, getFocusable]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Keyboard: Escape closes, Tab traps focus.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = getFocusable();
      if (focusables.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose, getFocusable]);

  if (!open) return null;

  return createPortal(
    <div
      className={cx("bf-modal", className)}
      data-slot="modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="bf-modal__backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        className="bf-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="bf-modal__header">
          <h2 className="bf-modal__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="bf-modal__close"
            onClick={requestClose}
            aria-label="Close dialog"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="square"
              />
            </svg>
          </button>
        </div>
        <div className="bf-modal__body">{children}</div>
        {footer ? <div className="bf-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
