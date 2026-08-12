import { useLocaleText } from "../../../shared/i18n/index.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import QuietDialog from "../../../shared/components/QuietDialog";

import qqChannelDarkUrl from "../assets/qq-channel-dark.jpg";
import qqChannelLightUrl from "../assets/qq-channel-light.jpg";
import githubIssuesButtonBlackUrl from "../assets/github-issues-button-black.svg";
import githubIssuesButtonWhiteUrl from "../assets/github-issues-button-white.svg";

interface AboutFeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenGitHub: () => Promise<boolean>;
}

export default function AboutFeedbackDialog({
  open,
  onClose,
  onOpenGitHub,
}: AboutFeedbackDialogProps) {
  const UI_TEXT = useLocaleText();
  const copy = UI_TEXT.about.feedbackDialog;
  const githubButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const [openingGitHub, setOpeningGitHub] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const close = useCallback(() => {
    setOpeningGitHub(false);
    onClose();
  }, [onClose]);

  const openGitHub = useCallback(async () => {
    if (openingGitHub) return;
    setOpeningGitHub(true);
    const opened = await onOpenGitHub();
    if (!mountedRef.current) return;
    if (opened) {
      close();
    } else {
      setOpeningGitHub(false);
    }
  }, [close, onOpenGitHub, openingGitHub]);

  return (
    <QuietDialog
      open={open}
      title={copy.title}
      description={copy.description}
      onClose={close}
      initialFocusRef={githubButtonRef}
      surfaceClassName="about-feedback-dialog-surface qp-scroll-region"
    >
      <button
        type="button"
        className="qp-dialog-close-button about-feedback-dialog-close"
        aria-label={UI_TEXT.common.close}
        onClick={close}
      >
        <X size={16} aria-hidden />
      </button>
      <div className="about-feedback-dialog-body">
        <section className="about-feedback-card">
          <div className="about-feedback-card-heading">
            <span className="about-qq-channel-mark" aria-hidden />
            <h4>{copy.qqTitle}</h4>
          </div>
          <div className="about-qq-channel-frame">
            <img className="about-qq-channel-image about-qq-channel-image-light" src={qqChannelLightUrl} alt={copy.qqQrAlt} data-qq-theme="light" draggable={false} />
            <img className="about-qq-channel-image about-qq-channel-image-dark" src={qqChannelDarkUrl} alt={copy.qqQrAlt} data-qq-theme="dark" draggable={false} />
          </div>
        </section>

        <section className="about-feedback-card">
          <div className="about-feedback-card-heading">
            <span className="about-github-mark" aria-hidden />
            <h4>{copy.githubTitle}</h4>
          </div>
          <div className="about-feedback-github-frame">
            <button
              ref={githubButtonRef}
              type="button"
              className="qp-button-secondary about-feedback-github-action"
              disabled={openingGitHub}
              aria-busy={openingGitHub}
              aria-label={copy.githubAction}
              onClick={() => void openGitHub()}
            >
              {openingGitHub ? (
                <span className="about-feedback-github-opening">{copy.githubOpening}</span>
              ) : (
                <>
                  <img className="about-feedback-github-image about-feedback-github-image-black" src={githubIssuesButtonBlackUrl} alt="" data-github-button-theme="black" draggable={false} />
                  <img className="about-feedback-github-image about-feedback-github-image-white" src={githubIssuesButtonWhiteUrl} alt="" data-github-button-theme="white" draggable={false} />
                </>
              )}
            </button>
          </div>
        </section>
      </div>
    </QuietDialog>
  );
}
