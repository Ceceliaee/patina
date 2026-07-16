import QuietDialog from "./QuietDialog";
import QuietButton from "./QuietButton";

interface QuietPromptDialogProps {
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
            tone="primary"
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
        type="text"
        value={value}
        autoFocus
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
