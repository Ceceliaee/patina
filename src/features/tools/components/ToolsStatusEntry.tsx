import { useEffect, useMemo, useState } from "react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import { buildToolsViewModelLabels } from "../services/toolsLabels.ts";
import { toolsRuntimeSnapshotStore } from "../services/toolsRuntimeSnapshotStore.ts";
import { buildToolsStatusChipViewModels } from "../services/toolsViewModel.ts";
import type { ToolsOpenTarget } from "../types.ts";
import ToolStatusButtons from "./ToolStatusButtons.tsx";

interface ToolsStatusEntryProps {
  onOpenSection: (target: ToolsOpenTarget) => void;
}

function hasToolsStatusChip(snapshot: ToolsRuntimeSnapshot | null) {
  return Boolean(
    snapshot
    && (
      snapshot.currentPomodoro?.status === "running"
      || snapshot.freeFocusTasks.some(task => task.status === "running")
      || snapshot.reminders.some(reminder => reminder.status === "scheduled")
    ),
  );
}

export default function ToolsStatusEntry({
  onOpenSection,
}: ToolsStatusEntryProps) {
  const uiText = useLocaleText();
  const [snapshot, setSnapshot] = useState<ToolsRuntimeSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const labels = useMemo(() => buildToolsViewModelLabels(uiText), [uiText]);
  const shouldRefreshClock = hasToolsStatusChip(snapshot);

  useEffect(() => {
    if (!shouldRefreshClock) {
      return undefined;
    }

    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [shouldRefreshClock]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = toolsRuntimeSnapshotStore.subscribe((nextSnapshot) => {
      if (!cancelled) {
        setNowMs(Date.now());
        setSnapshot(nextSnapshot);
      }
    });

    void toolsRuntimeSnapshotStore.refreshSnapshot()
      .catch((error) => {
        console.warn("load tools runtime snapshot failed", error);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const statusChips = useMemo(() => (
    snapshot
      ? buildToolsStatusChipViewModels(snapshot, nowMs, labels)
      : []
  ), [labels, nowMs, snapshot]);

  return <ToolStatusButtons entries={statusChips} onOpenSection={onOpenSection} />;
}
