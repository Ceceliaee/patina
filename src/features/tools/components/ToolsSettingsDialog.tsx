import { X } from "lucide-react";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietActionRow from "../../../shared/components/QuietActionRow.tsx";
import { useToolPresentation } from "../hooks/useToolPresentation.ts";
import { toolPresentationStore } from "../services/toolPresentationStore.ts";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ToolsSettingsDialog({ open, onClose }: Props) {
  const UI_TEXT = useLocaleText();
  const { snapshot, busy, failed } = useToolPresentation();
  const preferences = snapshot?.preferences;

  return (
    <QuietDialog
      open={open}
      onClose={onClose}
      title={UI_TEXT.tools.settingsTitle}
      headerAside={(
        <QuietIconAction
          icon={<X size={16} aria-hidden />}
          ariaLabel={UI_TEXT.common.close}
          title={UI_TEXT.common.close}
          onClick={onClose}
          showTooltip={false}
          className="qp-dialog-close-button"
        />
      )}
      surfaceClassName="tools-settings-dialog"
    >
      <section className="tools-notification-settings" aria-label={UI_TEXT.tools.notificationGroup} aria-busy={busy}>
        <h4>{UI_TEXT.tools.notificationGroup}</h4>
        <QuietActionRow className="tools-notification-settings-rows">
          <div className="tools-notification-setting-row">
            <span>{UI_TEXT.tools.notificationDelivery}</span>
            <QuietSegmentedFilter variant="control" value={preferences?.delivery ?? "notification"} ariaLabel={UI_TEXT.tools.notificationDelivery}
              options={[{ value: "notification", label: UI_TEXT.tools.notificationSoftware, disabled: busy || !preferences },
                { value: "dialog", label: UI_TEXT.tools.notificationDialog, disabled: busy || !preferences }]}
              onChange={delivery => { void toolPresentationStore.save({ delivery }); }} />
          </div>
          <div className="tools-notification-setting-row">
            <span>{UI_TEXT.tools.notificationSound}</span>
            <QuietSelect density="compact" value={preferences?.sound ?? "default"} ariaLabel={UI_TEXT.tools.notificationSound} disabled={busy || !preferences}
              options={[{ value: "default", label: UI_TEXT.tools.notificationSoundDefault }, { value: "bell", label: UI_TEXT.tools.notificationSoundBell },
                { value: "clear", label: UI_TEXT.tools.notificationSoundClear }, { value: "none", label: UI_TEXT.tools.notificationSoundNone }]}
              onChange={sound => { void toolPresentationStore.save({ sound }); }} />
          </div>
        </QuietActionRow>
        {failed || snapshot?.error ? <div role="alert" className="tools-validation-message">
          <p>{snapshot?.error ? UI_TEXT.tools.notificationDisplayFailed : UI_TEXT.tools.notificationSaveFailed}</p>
          <QuietButton onClick={() => { void toolPresentationStore.refresh(true); }}>{UI_TEXT.common.retry}</QuietButton>
        </div> : null}
      </section>
    </QuietDialog>
  );
}
