import type { ReactNode } from "react";
import { Button } from "../bflabs/Button";
import { Modal } from "../bflabs/Modal";
import { useI18n } from "../state/I18nContext";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useI18n().t.editModal;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="quiet" size="sm" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="bf-button--danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Modal>
  );
}
