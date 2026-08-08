import type { ComponentProps } from "react";
import QuickClassificationEntry from "../../classification/components/QuickClassificationEntry.tsx";
import { useQuickClassificationLauncher } from "../../classification/hooks/useQuickClassificationLauncher.ts";
import { getQuickClassificationTargetKey } from "../../classification/types.ts";
import HistoryDayDistributionPanel from "./HistoryDayDistributionPanel.tsx";

type PanelProps = ComponentProps<typeof HistoryDayDistributionPanel>;
type OwnedPanelProp =
  | "activeQuickClassificationTargetKey"
  | "onQuickClassificationOpen"
  | "onQuickClassificationPreload";

interface Props {
  panelProps: Omit<PanelProps, OwnedPanelProp>;
  onError: (message: string) => void;
  onSaved: () => void;
}

export default function HistoryDayDistributionQuickActions({
  panelProps,
  onError,
  onSaved,
}: Props) {
  const launcher = useQuickClassificationLauncher();
  const request = launcher.request;

  return (
    <>
      <HistoryDayDistributionPanel
        {...panelProps}
        activeQuickClassificationTargetKey={request
          ? getQuickClassificationTargetKey(request.target)
          : null}
        onQuickClassificationPreload={launcher.preload}
        onQuickClassificationOpen={launcher.openAtPointer}
      />
      {request ? (
        <QuickClassificationEntry
          key={`${getQuickClassificationTargetKey(request.target)}:${request.anchor.clientX}:${request.anchor.clientY}`}
          request={request}
          onClose={launcher.close}
          onSaved={onSaved}
          onError={onError}
        />
      ) : null}
    </>
  );
}
