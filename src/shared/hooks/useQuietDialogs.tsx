import { useLocaleText } from "../i18n/index.ts";
import { useCallback, useMemo, useState } from "react";
import QuietConfirmDialog from "../components/QuietConfirmDialog";
import QuietPromptDialog from "../components/QuietPromptDialog";

interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptDialogOptions {
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState extends ConfirmDialogOptions {
  open: boolean;
  resolve: (value: boolean) => void;
}

interface PromptState extends PromptDialogOptions {
  open: boolean;
  value: string;
  resolve: (value: string | null) => void;
}

export function useQuietDialogs() {
  const UI_TEXT = useLocaleText();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => (
    new Promise<boolean>((resolve) => {
      setConfirmState({
        ...options,
        open: true,
        resolve,
      });
    })
  ), []);

  const prompt = useCallback((options: PromptDialogOptions): Promise<string | null> => (
    new Promise<string | null>((resolve) => {
      setPromptState({
        ...options,
        value: options.initialValue ?? "",
        open: true,
        resolve,
      });
    })
  ), []);

  const dialogs = useMemo(() => (
    <>
      {confirmState && (
        <QuietConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel ?? UI_TEXT.dialog.confirm}
          cancelLabel={confirmState.cancelLabel ?? UI_TEXT.dialog.cancel}
          danger={confirmState.danger}
          onCancel={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
          onConfirm={() => {
            confirmState.resolve(true);
            setConfirmState(null);
          }}
        />
      )}

      {promptState && (
        <QuietPromptDialog
          open={promptState.open}
          title={promptState.title}
          description={promptState.description}
          value={promptState.value}
          placeholder={promptState.placeholder}
          confirmLabel={promptState.confirmLabel ?? UI_TEXT.dialog.confirm}
          cancelLabel={promptState.cancelLabel ?? UI_TEXT.dialog.cancel}
          confirmDisabled={!promptState.value.trim()}
          onChange={(value) => setPromptState((current) => (current ? { ...current, value } : current))}
          onCancel={() => {
            promptState.resolve(null);
            setPromptState(null);
          }}
          onConfirm={() => {
            const value = promptState.value.trim();
            if (!value) return;
            promptState.resolve(value);
            setPromptState(null);
          }}
        />
      )}
    </>
  ), [confirmState, promptState, UI_TEXT]);

  return {
    confirm,
    prompt,
    dialogs,
  };
}
