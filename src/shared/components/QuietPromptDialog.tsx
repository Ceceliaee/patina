import { useRef } from "react";
import QuietDialog from "./QuietDialog";
import QuietButton from "./QuietButton";

interface QuietPromptDialogProps {
  surfaceClassName?: string;
  open: boolean;
  title: string;
  description?: string;
  value: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmDisabled?: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function QuietPromptDialog({
  surfaceClassName,
  open,
  title,
  description,
  value,
  placeholder,
  confirmLabel,
  cancelLabel,
  confirmDisabled = false,
  onChange,
  onCancel,
  onConfirm,
}: QuietPromptDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <QuietDialog
      surfaceClassName={surfaceClassName}
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      initialFocusRef={inputRef}
      actions={(
        <>
          <QuietButton
            size="large"
            onClick={onCancel}
            className="qp-dialog-action"
          >
            {cancelLabel}
          </QuietButton>
          <QuietButton
            tone="primary"
            size="large"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="qp-dialog-action"
          >
            {confirmLabel}
          </QuietButton>
        </>
      )}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !confirmDisabled) {
            event.preventDefault();
            onConfirm();
          }
        }}
        className="qp-input qp-dialog-input"
      />
    </QuietDialog>
  );
}
