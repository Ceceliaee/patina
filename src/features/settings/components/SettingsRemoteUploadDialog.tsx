import { useRef, useState } from "react";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietButton from "../../../shared/components/QuietButton";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { RemoteBackupState } from "../hooks/useRemoteBackupState.ts";
import type { PersistedRemoteBackupConfig } from "../services/remoteBackupService.ts";
import { formatRemoteBackupTargetSummary } from "../services/remoteBackupTargetSummary.ts";
import { defaultRemoteBackupFileName, isValidRemoteBackupFileName } from "../services/remoteBackupUploadDraft.ts";

export default function SettingsRemoteUploadDialog({ target, remoteBackup, onClose }: {
  target: PersistedRemoteBackupConfig;
  remoteBackup: RemoteBackupState;
  onClose: () => void;
}) {
  const text = useLocaleText();
  const inputRef = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  const [fileName, setFileName] = useState(defaultRemoteBackupFileName);
  const [error, setError] = useState<string | null>(null);
  const invalid = !isValidRemoteBackupFileName(fileName);
  const feedback = invalid ? text.settings.webDavInvalidFileName : error;
  const close = () => { if (!submitted.current) onClose(); };
  const submit = async () => {
    if (submitted.current || invalid) return;
    submitted.current = true;
    setError(null);
    try {
      const message = await remoteBackup.uploadBackup(fileName, target);
      if (message) setError(message);
      else onClose();
    } finally { submitted.current = false; }
  };
  return (
    <QuietDialog open title={text.settings.webDavUploadTitle}
      description={text.settings.webDavUploadDescription} onClose={close}
      closeOnBackdrop={!remoteBackup.isUploading} initialFocusRef={inputRef}
      actions={<>
        <QuietButton size="large" disabled={remoteBackup.isUploading} onClick={close}>{text.common.cancel}</QuietButton>
        <QuietButton size="large" tone="primary" disabled={invalid || remoteBackup.isUploading}
          busy={remoteBackup.isUploading} onClick={() => void submit()}>{text.settings.webDavUploadAction}</QuietButton>
      </>}
    >
      <div className="grid gap-4">
        <p className="break-all text-sm">{formatRemoteBackupTargetSummary(target)}</p>
        <label className="grid gap-1.5 text-sm">
          {text.settings.webDavFileName}
          <input ref={inputRef} className="qp-input h-9 w-full" value={fileName}
            disabled={remoteBackup.isUploading} aria-invalid={invalid}
            aria-describedby={feedback ? "webdav-upload-feedback" : undefined}
            onFocus={(event) => event.target.setSelectionRange(0, Math.max(0, event.target.value.length - 4))}
            onChange={(event) => { setFileName(event.target.value); setError(null); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
            }} />
        </label>
        {feedback ? <p id="webdav-upload-feedback" role={invalid || error ? "alert" : "status"} className="text-sm">
          {feedback}
        </p> : null}
      </div>
    </QuietDialog>
  );
}
