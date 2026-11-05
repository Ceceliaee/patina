import { AlarmClock, BellRing } from "lucide-react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToolStatusChipViewModel, ToolsOpenTarget } from "../types.ts";
import ToolsStatusChip from "./ToolsStatusChip.tsx";

export default function ToolStatusButtons({ entries, onOpenSection }: {
  entries: ToolStatusChipViewModel[];
  onOpenSection: (target: ToolsOpenTarget) => void;
}) {
  const text = useLocaleText();
  if (!entries.length) return null;
  return <div className="tools-status-entry-titlebar" data-titlebar-tools-status="" role="group" aria-label={text.tools.title}>
    {entries.map(entry => <ToolsStatusChip key={entry.targetSection} label={entry.label}
      icon={entry.targetSection === "pomodoro" ? AlarmClock : BellRing}
      onClick={() => onOpenSection({ section: entry.targetSection })}
      className="tools-status-entry-titlebar-item" iconOnly tooltipPlacement="bottom" />)}
  </div>;
}
