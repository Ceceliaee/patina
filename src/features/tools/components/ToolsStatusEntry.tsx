import { useEffect, useMemo, useState } from "react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import { buildToolsViewModelLabels } from "../services/toolsLabels.ts";
import { toolsRuntimeSnapshotStore } from "../services/toolsRuntimeSnapshotStore.ts";
import { buildToolsStatusChipViewModels, earliestScheduledReminder } from "../services/toolsViewModel.ts";
import { startStatusClock } from "../services/toolStatusEntries.ts";
import type { ToolsOpenTarget } from "../types.ts";
import ToolStatusButtons from "./ToolStatusButtons.tsx";

interface ToolsStatusEntryProps {
  onOpenSection: (target: ToolsOpenTarget) => void;
}

export default function ToolsStatusEntry({
  onOpenSection,
}: ToolsStatusEntryProps) {
  const uiText = useLocaleText();
  const [snapshot, setSnapshot] = useState<ToolsRuntimeSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const labels = useMemo(() => buildToolsViewModelLabels(uiText), [uiText]);
  const reminder = useMemo(() => snapshot ? earliestScheduledReminder(snapshot) : null, [snapshot]);
  const due = reminder?.scheduledAt ?? null;
  const running = snapshot?.currentPomodoro?.status === "running"
    || Boolean(snapshot?.freeFocusTasks.some(task => task.status === "running"));

  useEffect(() => {
    if (running || due !== null) return startStatusClock(running, due, setNowMs);
  }, [running, due]);

  useEffect(() => {
    const unsubscribe = toolsRuntimeSnapshotStore.subscribe((nextSnapshot) => {
      setNowMs(Date.now());
      setSnapshot(nextSnapshot);
    });

    void toolsRuntimeSnapshotStore.refreshSnapshot()
      .catch((error) => {
        console.warn("load tools runtime snapshot failed", error);
      });

    return unsubscribe;
  }, []);

  const statusChips = useMemo(() => (
    snapshot
      ? buildToolsStatusChipViewModels(snapshot, nowMs, labels, reminder)
      : []
  ), [labels, nowMs, snapshot, reminder]);

  return <ToolStatusButtons entries={statusChips} onOpenSection={onOpenSection} />;
}
