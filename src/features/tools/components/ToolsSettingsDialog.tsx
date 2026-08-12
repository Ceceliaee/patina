import { X } from "lucide-react";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ToolsSettingsDialog({ open, onClose }: Props) {
  const UI_TEXT = useLocaleText();

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
      <div className="tools-settings-empty" role="status">
        {UI_TEXT.tools.settingsEmpty}
      </div>
    </QuietDialog>
  );
}
