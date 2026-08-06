import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Heart, X } from "lucide-react";
import wechatRewardDarkUrl from "../assets/wechat-reward-dark.png";
import wechatRewardLightUrl from "../assets/wechat-reward-light.png";
import kofiButtonUrl from "../assets/kofi-button.png";
import QuietDialog from "../../../shared/components/QuietDialog";



interface AboutSupportDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenKofi: () => void;
}

export default function AboutSupportDialog({
  open,
  onClose,
  onOpenKofi,
}: AboutSupportDialogProps) {
  const UI_TEXT = useLocaleText();
  const copy = UI_TEXT.about.supportDialog;

  return (
    <QuietDialog
      open={open}
      title={UI_TEXT.update.support}
      description={copy.description}
      onClose={onClose}
      surfaceClassName="about-support-dialog-surface"
    >
      <button
        type="button"
        className="qp-dialog-close-button about-support-dialog-close"
        aria-label={UI_TEXT.common.close}
        onClick={onClose}
      >
        <X size={16} aria-hidden />
      </button>
      <div className="about-support-dialog-body">
        <section className="about-support-card">
          <div className="about-support-card-heading">
            <Heart size={15} aria-hidden />
            <h4>{copy.wechatTitle}</h4>
          </div>
          <div className="about-wechat-reward-frame">
            <img
              className="about-wechat-reward-image about-wechat-reward-image-light"
              src={wechatRewardLightUrl}
              alt={copy.wechatAlt}
              data-reward-theme="light"
              draggable={false}
            />
            <img
              className="about-wechat-reward-image about-wechat-reward-image-dark"
              src={wechatRewardDarkUrl}
              alt={copy.wechatAlt}
              data-reward-theme="dark"
              draggable={false}
            />
          </div>
        </section>

        <section className="about-support-card about-support-kofi-card">
          <div className="about-support-card-heading">
            <Heart size={15} aria-hidden />
            <h4>{copy.kofiTitle}</h4>
          </div>
          <div className="about-kofi-button-frame">
            <button
              type="button"
              className="about-kofi-button"
              aria-label={copy.openKofi}
              onClick={onOpenKofi}
            >
              <img
                src={kofiButtonUrl}
                alt=""
                draggable={false}
              />
            </button>
          </div>
        </section>
      </div>
    </QuietDialog>
  );
}
