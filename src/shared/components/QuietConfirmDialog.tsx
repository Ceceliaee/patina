import QuietDialog from "./QuietDialog";
import QuietButton from "./QuietButton";
import { UI_TEXT } from "../copy/index.ts";

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
  return (
    <QuietDialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      actions={(
        <>
          <QuietButton
            onClick={onCancel}
            className="qp-dialog-action"
          >
            {cancelLabel}
          </QuietButton>
          <QuietButton
            tone={danger ? "danger" : "primary"}
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
