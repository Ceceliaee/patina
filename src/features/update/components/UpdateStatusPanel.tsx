import { RefreshCw } from "lucide-react";
import QuietButton from "../../../shared/components/QuietButton";
import type { UpdateSnapshot } from "../../../shared/types/update";
import {
  buildUpdateStatusPanelModel,
  type UpdateActionModel,
} from "../services/updateViewModel";
import UpdateProgressBar from "./UpdateProgressBar";
import { UI_TEXT } from "../../../shared/copy/index.ts";

interface UpdateStatusPanelProps {
  snapshot: UpdateSnapshot;
  checking: boolean;
  installing: boolean;
  suppressProgress?: boolean;
  showSupportLinks?: boolean;
  variant?: "default" | "compact";
  className?: string;
  onCheckUpdates: () => void;
  onOpenConfirmDialog: () => void;
  onOpenUpdateReleasePage: () => void;
  onOpenUpdateDownload: () => void;
  onOpenReleaseNotes: () => void;
  onOpenFeedback: () => void;
  onOpenSupport: () => void;
}

function renderActionLabel(action: UpdateActionModel) {
  return (
    <>
      {action.loading ? <RefreshCw size={12} className="animate-spin" /> : null}
      {action.label}
    </>
  );
}

export default function UpdateStatusPanel({
  snapshot,
  checking,
  installing,
  suppressProgress = false,
  showSupportLinks = true,
  variant = "default",
  className,
  onCheckUpdates,
  onOpenConfirmDialog,
  onOpenUpdateReleasePage,
  onOpenUpdateDownload,
  onOpenReleaseNotes,
  onOpenFeedback,
  onOpenSupport,
}: UpdateStatusPanelProps) {
  const viewModel = buildUpdateStatusPanelModel(snapshot, checking, installing);

  const handleAction = (action: UpdateActionModel) => {
    if (action.disabled) return;
    switch (action.action) {
      case "open_confirm":
        onOpenConfirmDialog();
        return;
      case "open_release_page":
        onOpenUpdateReleasePage();
        return;
      case "open_download_url":
        onOpenUpdateDownload();
        return;
      case "check":
      default:
        onCheckUpdates();
    }
  };

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {viewModel.secondaryAction ? (
        <QuietButton
          size="regular"
          onClick={() => handleAction(viewModel.secondaryAction!)}
          disabled={viewModel.secondaryAction.disabled}
        >
          {renderActionLabel(viewModel.secondaryAction)}
        </QuietButton>
      ) : null}
      <QuietButton
        tone="primary"
        size="regular"
        onClick={() => handleAction(viewModel.primaryAction)}
        disabled={viewModel.primaryAction.disabled}
        busy={viewModel.primaryAction.loading}
      >
        {renderActionLabel(viewModel.primaryAction)}
      </QuietButton>
    </div>
  );

  if (variant === "compact") {
    return (
      <div className={`qp-subpanel update-status-compact ${className ?? ""}`.trim()}>
        <div className="update-status-compact-main">
          <div className="update-status-compact-copy">
            <p className="update-status-compact-title">{UI_TEXT.update.appUpdate}</p>
            <p className="update-status-compact-state">{viewModel.statusTitle}</p>
            {viewModel.statusDetail ? (
              <p className="update-status-compact-detail">{viewModel.statusDetail}</p>
            ) : null}
          </div>
          {actions}
        </div>
        {viewModel.progress && !suppressProgress ? (
          <UpdateProgressBar
            className="mt-3"
            percent={viewModel.progress.percent}
            label={viewModel.progress.label}
            valueText={viewModel.progress.valueText}
            indeterminate={viewModel.progress.indeterminate}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`qp-subpanel ${className ?? ""}`.trim()}>
      <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.update.appUpdate}</p>
      <p className="mt-2 text-sm font-semibold text-[var(--qp-text-primary)]">{viewModel.statusTitle}</p>
      {viewModel.statusDetail ? (
        <p className="mt-1 text-xs leading-relaxed break-words text-[var(--qp-text-secondary)]">
          {viewModel.statusDetail}
        </p>
      ) : null}
      {viewModel.progress && !suppressProgress ? (
        <UpdateProgressBar
          className="mt-3"
          percent={viewModel.progress.percent}
          label={viewModel.progress.label}
          valueText={viewModel.progress.valueText}
          indeterminate={viewModel.progress.indeterminate}
        />
      ) : null}

      <div className={`mt-4 flex flex-wrap items-end gap-3 ${showSupportLinks ? "justify-between" : "justify-end"}`}>
        {showSupportLinks ? (
          <div className="flex items-center gap-1.5 text-xs text-[var(--qp-text-tertiary)]">
            <button
              type="button"
              onClick={onOpenReleaseNotes}
              className="text-xs text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)]"
            >
              {UI_TEXT.update.releaseNotes}
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={onOpenFeedback}
              className="text-xs text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)]"
            >
              {UI_TEXT.update.feedback}
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={onOpenSupport}
              className="text-xs text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)]"
            >
              {UI_TEXT.update.support}
            </button>
          </div>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
