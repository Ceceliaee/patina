import type { ComponentProps } from "react";
import QuickAppClassificationEntry from "../../classification/components/QuickAppClassificationEntry.tsx";
import { useQuickAppClassificationLauncher } from "../../classification/hooks/useQuickAppClassificationLauncher.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import HistoryDayDistributionPanel from "./HistoryDayDistributionPanel.tsx";

type PanelProps = ComponentProps<typeof HistoryDayDistributionPanel>;
type OwnedPanelProp =
  | "activeQuickClassificationExeName"
  | "onQuickClassificationOpen"
  | "onQuickClassificationPreload";

interface Props {
  panelProps: Omit<PanelProps, OwnedPanelProp>;
  onError: (message: string) => void;
  onSaved: (override: AppOverride | null) => void;
}

export default function HistoryDayDistributionQuickActions({
  panelProps,
  onError,
  onSaved,
}: Props) {
  const launcher = useQuickAppClassificationLauncher();
  const request = launcher.request;

  return (
    <>
      <HistoryDayDistributionPanel
        {...panelProps}
        activeQuickClassificationExeName={request?.target.exeName}
        onQuickClassificationPreload={launcher.preload}
        onQuickClassificationOpen={launcher.openAtPointer}
      />
      {request ? (
        <QuickAppClassificationEntry
          key={`${request.target.exeName}:${request.anchor.clientX}:${request.anchor.clientY}`}
          request={request}
          onClose={launcher.close}
          onSaved={onSaved}
          onError={onError}
        />
      ) : null}
    </>
  );
}
