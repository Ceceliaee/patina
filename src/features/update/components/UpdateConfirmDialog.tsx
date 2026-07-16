import QuietDialog from "../../../shared/components/QuietDialog";
import QuietButton, { type QuietButtonTone } from "../../../shared/components/QuietButton";
import type { UpdateSnapshot } from "../../../shared/types/update";
import {
  buildUpdateConfirmDialogModel,
  type UpdateActionModel,
} from "../services/updateViewModel";
import UpdateProgressBar from "./UpdateProgressBar";
import { UI_TEXT } from "../../../shared/copy/index.ts";

interface UpdateConfirmDialogProps {
  open: boolean;
  snapshot: UpdateSnapshot;
  installing: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRetryCheck: () => void;
  onOpenReleasePage: () => void;
  onOpenAssetDownload: () => void;
}

function resolveButtonTone(action: UpdateActionModel): QuietButtonTone {
  return action.emphasis === "secondary" ? "secondary" : "primary";
}

export default function UpdateConfirmDialog({
  open,
  snapshot,
  installing,
  onClose,
  onConfirm,
  onRetryCheck,
  onOpenReleasePage,
  onOpenAssetDownload,
}: UpdateConfirmDialogProps) {
  const viewModel = buildUpdateConfirmDialogModel(snapshot);

  const handleAction = (action: UpdateActionModel | null) => {
    if (!action || action.disabled) return;
    switch (action.action) {
      case "open_confirm":
        onConfirm();
        return;
      case "check":
        onRetryCheck();
        return;
      case "open_release_page":
        onOpenReleasePage();
        return;
      case "open_download_url":
        onOpenAssetDownload();
    }
  };

  return (
    <QuietDialog
      open={open}
      title={viewModel.title}
      onClose={onClose}
      actions={(
        <>
          <QuietButton
            onClick={onClose}
            className="qp-dialog-action"
          >
            {UI_TEXT.update.later}
          </QuietButton>
          {viewModel.secondaryAction ? (
            <QuietButton
              tone={resolveButtonTone(viewModel.secondaryAction)}
              onClick={() => handleAction(viewModel.secondaryAction)}
              disabled={viewModel.secondaryAction.disabled}
              className="qp-dialog-action"
            >
              {viewModel.secondaryAction.label}
            </QuietButton>
          ) : null}
          {viewModel.primaryAction ? (
            <QuietButton
              tone={resolveButtonTone(viewModel.primaryAction)}
              onClick={() => handleAction(viewModel.primaryAction)}
              disabled={installing || viewModel.primaryAction.disabled}
              busy={installing && viewModel.primaryAction.action === "open_confirm"}
              className="qp-dialog-action"
            >
              {installing && viewModel.primaryAction.action === "open_confirm"
                ? UI_TEXT.update.processing
                : viewModel.primaryAction.label}
            </QuietButton>
          ) : null}
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{viewModel.versionCompareLabel}</p>
        <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">{viewModel.confirmDescription}</p>
        {viewModel.progress ? (
          <UpdateProgressBar
            percent={viewModel.progress.percent}
            label={viewModel.progress.label}
            valueText={viewModel.progress.valueText}
            indeterminate={viewModel.progress.indeterminate}
          />
        ) : null}
        {viewModel.notesPreview ? (
          <div className="qp-subpanel">
            <p className="text-xs font-semibold text-[var(--qp-text-tertiary)]">{UI_TEXT.update.releaseNotes}</p>
            <p
              className="mt-1 break-words text-xs leading-relaxed text-[var(--qp-text-tertiary)]"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {viewModel.notesPreview}
            </p>
          </div>
        ) : null}
      </div>
    </QuietDialog>
  );
}
