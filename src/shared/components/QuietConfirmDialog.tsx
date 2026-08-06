import { useLocaleText } from "../i18n/index.ts";
import { useRef } from "react";
import QuietDialog from "./QuietDialog";
import QuietButton from "./QuietButton";

interface QuietConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function QuietConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  confirmDisabled = false,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: QuietConfirmDialogProps) {
  const UI_TEXT = useLocaleText();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <QuietDialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      initialFocusRef={cancelButtonRef}
      actions={(
        <>
          <QuietButton
            ref={cancelButtonRef}
            size="large"
            onClick={onCancel}
            className="qp-dialog-action"
          >
            {cancelLabel}
          </QuietButton>
          <QuietButton
            tone={danger ? "danger" : "primary"}
            size="large"
            onClick={onConfirm}
            disabled={confirmDisabled}
            busy={confirmLoading}
            className="qp-dialog-action"
          >
            {confirmLoading ? UI_TEXT.common.processing : confirmLabel}
          </QuietButton>
        </>
      )}
    />
  );
}
