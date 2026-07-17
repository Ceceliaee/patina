import {
  FileText,
  Heart,
  MessageSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import appIconUrl from "../../../../src-tauri/icons/icon.png";
import type { UpdateSnapshot } from "../../../shared/types/update";
import QuietButton from "../../../shared/components/QuietButton";
import UpdateStatusPanel from "../../update/components/UpdateStatusPanel";
import { UI_TEXT } from "../../../shared/copy/index.ts";

type AboutPanelProps = {
  appVersion: string;
  effectiveUpdateSnapshot: UpdateSnapshot;
  updateChecking: boolean;
  updateInstalling: boolean;
  updateDialogOpen: boolean;
  onCheckForUpdates?: () => void;
  onOpenUpdateDialog?: () => void;
  onOpenUpdateReleasePage?: () => void;
  onOpenUpdateDownload?: () => void;
  onOpenReleaseNotes: () => void;
  onOpenRepository: () => void;
  onOpenFeedback: () => void;
  onOpenSupportDialog: () => void;
};

type AboutLinkButtonProps = {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
};

function AboutLinkButton({
  icon,
  label,
  onClick,
}: AboutLinkButtonProps) {
  return (
    <QuietButton
      size="compact"
      className="about-pill-action"
      onClick={onClick}
    >
      <span className="about-pill-icon" aria-hidden>
        {icon}
      </span>
      <span className="about-pill-label">{label}</span>
    </QuietButton>
  );
}

export default function AboutPanel({
  appVersion,
  effectiveUpdateSnapshot,
  updateChecking,
  updateInstalling,
  updateDialogOpen,
  onCheckForUpdates,
  onOpenUpdateDialog,
  onOpenUpdateReleasePage,
  onOpenUpdateDownload,
  onOpenReleaseNotes,
  onOpenRepository,
  onOpenFeedback,
  onOpenSupportDialog,
}: AboutPanelProps) {
  return (
    <div className="about-center-workbench">
      <section className="qp-panel about-center-panel">
        <div className="about-center-profile">
          <div className="about-center-icon-shell" aria-hidden>
            <img src={appIconUrl} alt="" draggable={false} />
          </div>
          <div className="about-center-title-row">
            <h2>Patina</h2>
            <span className="about-center-version-chip">{`v${appVersion}`}</span>
          </div>
          <p>{UI_TEXT.about.description}</p>
        </div>

        <div className="about-pill-row">
          <AboutLinkButton
            icon={<span className="about-github-mark" />}
            label={(
              <>
                GitHub <span className="about-github-star-label">Star</span>
              </>
            )}
            onClick={onOpenRepository}
          />
          <AboutLinkButton
            icon={<FileText size={14} />}
            label={UI_TEXT.update.releaseNotes}
            onClick={onOpenReleaseNotes}
          />
          <AboutLinkButton
            icon={<MessageSquare size={14} />}
            label={UI_TEXT.update.feedback}
            onClick={onOpenFeedback}
          />
          <AboutLinkButton
            icon={<Heart className="about-support-pill-heart" size={14} />}
            label={UI_TEXT.update.support}
            onClick={onOpenSupportDialog}
          />
        </div>

        <UpdateStatusPanel
          className="about-center-update"
          variant="compact"
          snapshot={effectiveUpdateSnapshot}
          checking={updateChecking}
          installing={updateInstalling}
          suppressProgress={updateDialogOpen}
          showSupportLinks={false}
          onCheckUpdates={() => onCheckForUpdates?.()}
          onOpenConfirmDialog={() => onOpenUpdateDialog?.()}
          onOpenUpdateReleasePage={() => onOpenUpdateReleasePage?.()}
          onOpenUpdateDownload={() => onOpenUpdateDownload?.()}
          onOpenReleaseNotes={onOpenReleaseNotes}
          onOpenFeedback={onOpenFeedback}
          onOpenSupport={onOpenSupportDialog}
        />
      </section>
    </div>
  );
}
