import { useEffect, useMemo, useState } from "react";
import { AlarmClock, BellRing, Timer } from "lucide-react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import { buildToolsViewModelLabels } from "../services/toolsLabels.ts";
import { toolsRuntimeSnapshotStore } from "../services/toolsRuntimeSnapshotStore.ts";
import { buildToolsStatusChipViewModels } from "../services/toolsViewModel.ts";
import type { ToolStatusChipViewModel, ToolsOpenTarget } from "../types.ts";
import ToolsStatusChip from "./ToolsStatusChip.tsx";

interface ToolsStatusEntryProps {
  onOpenSection: (target: ToolsOpenTarget) => void;
}

function resolveStatusIcon(statusChip: ToolStatusChipViewModel) {
  if (statusChip.targetSection === "pomodoro") return AlarmClock;
  if (statusChip.targetSection === "timer") return Timer;
  return BellRing;
}

function hasToolsStatusChip(snapshot: ToolsRuntimeSnapshot | null) {
  return Boolean(
    snapshot
    && (
      snapshot.currentPomodoro?.status === "running"
      || snapshot.currentTimer?.status === "running"
      || snapshot.nextReminderAt !== null
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

  if (statusChips.length === 0) {
    return null;
  }

  return (
    <div
      className="tools-status-entry-titlebar"
      data-titlebar-tools-status=""
      role="group"
      aria-label={uiText.tools.title}
    >
      {statusChips.map((statusChip) => (
        <ToolsStatusChip
          key={`${statusChip.targetSection}:${statusChip.targetTimerMode ?? "default"}`}
          label={statusChip.label}
          icon={resolveStatusIcon(statusChip)}
          onClick={() => onOpenSection({
            section: statusChip.targetSection,
            timerMode: statusChip.targetTimerMode,
          })}
          className="tools-status-entry-titlebar-item"
          iconOnly
          tooltipPlacement="bottom"
        />
      ))}
    </div>
  );
}
