import { useLocaleText } from "../../../shared/i18n/index.ts";
import { RefreshCw } from "lucide-react";
import QuietButton from "../../../shared/components/QuietButton";
import type { UpdateSnapshot } from "../../../shared/types/update";
import {
  buildUpdateStatusPanelModel,
  type UpdateActionModel,
} from "../services/updateViewModel";
import UpdateProgressBar from "./UpdateProgressBar";

interface UpdateStatusPanelProps {
  snapshot: UpdateSnapshot;
  checking: boolean;
  installing: boolean;
  suppressProgress?: boolean;
  className?: string;
  onCheckUpdates: () => void;
  onOpenConfirmDialog: () => void;
  onOpenUpdateReleasePage: () => void;
  onOpenUpdateDownload: () => void;
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
  className,
  onCheckUpdates,
  onOpenConfirmDialog,
  onOpenUpdateReleasePage,
  onOpenUpdateDownload,
}: UpdateStatusPanelProps) {
  const UI_TEXT = useLocaleText();
  const viewModel = buildUpdateStatusPanelModel(snapshot, checking, installing, UI_TEXT);

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
