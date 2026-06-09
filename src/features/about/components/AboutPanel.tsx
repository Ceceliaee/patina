import {
  FileText,
  Heart,
  MessageCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import appIconUrl from "../../../../src-tauri/icons/icon.png";
import type { UpdateSnapshot } from "../../../shared/types/update";
import UpdateStatusPanel from "../../update/components/UpdateStatusPanel";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";

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
  label: string;
  accent?: "default" | "support";
  onClick: () => void;
};

function AboutLinkButton({
  icon,
  label,
  accent = "default",
  onClick,
}: AboutLinkButtonProps) {
  return (
    <button
      type="button"
      className={`about-pill-action about-pill-action-${accent}`}
      onClick={onClick}
    >
      <span className="about-pill-icon" aria-hidden>
        {icon}
      </span>
      <span className="about-pill-label">{label}</span>
    </button>
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
            label="GitHub Star"
            onClick={onOpenRepository}
          />
          <AboutLinkButton
            icon={<FileText size={14} />}
            label={UI_TEXT.update.releaseNotes}
            onClick={onOpenReleaseNotes}
          />
          <AboutLinkButton
            icon={<MessageCircle size={14} />}
            label={UI_TEXT.update.feedback}
            onClick={onOpenFeedback}
          />
          <AboutLinkButton
            icon={<Heart size={14} />}
            label={UI_TEXT.update.support}
            accent="support"
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
          onOpenSupportReadme={onOpenSupportDialog}
        />
      </section>
    </div>
  );
}
