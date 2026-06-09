import { Heart, X } from "lucide-react";
import wechatRewardDarkUrl from "../assets/wechat-reward-dark.png";
import wechatRewardLightUrl from "../assets/wechat-reward-light.png";
import kofiButtonUrl from "../assets/kofi-button.png";
import QuietDialog from "../../../shared/components/QuietDialog";
import { getUiTextLanguage, UI_TEXT } from "../../../shared/copy/uiText.ts";

const SUPPORT_DIALOG_COPY = {
  "zh-CN": {
    description: "如果 Patina 对你有帮助，可以选择一种方式支持持续维护。",
    wechatTitle: "微信赞赏码",
    wechatHint: "使用微信扫一扫赞赏。",
    wechatAlt: "微信赞赏码",
    kofiTitle: "Ko-fi",
    kofiHint: "通过 Ko-fi 打开赞助页面。",
    openKofi: "打开 Ko-fi",
  },
  "en-US": {
    description: "If Patina helps you, choose a way to support ongoing maintenance.",
    wechatTitle: "WeChat reward code",
    wechatHint: "Scan with WeChat to send a reward.",
    wechatAlt: "WeChat reward code",
    kofiTitle: "Ko-fi",
    kofiHint: "Open the Ko-fi sponsor page.",
    openKofi: "Open Ko-fi",
  },
} as const;

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
  const copy = SUPPORT_DIALOG_COPY[getUiTextLanguage()];

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
        className="about-support-dialog-close"
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
          <p>{copy.wechatHint}</p>
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
          <p>{copy.kofiHint}</p>
        </section>
      </div>
    </QuietDialog>
  );
}
