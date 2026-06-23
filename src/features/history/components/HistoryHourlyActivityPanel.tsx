import { Layers3 } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import HourlyActivityChart from "../../../shared/charts/HourlyActivityChart";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import type {
  HourlyActivityPoint,
  HourlyCategoryActivity,
} from "../../../shared/lib/hourlyActivityCompiler.ts";
import type { HourlyActivityChartMode } from "../../../shared/settings/appSettings.ts";

interface HistoryHourlyActivityPanelProps {
  mode: HourlyActivityChartMode;
  hourlyActivity: HourlyActivityPoint[];
  hourlyCategoryActivity: HourlyCategoryActivity;
  showQuietPlaceholder: boolean;
  actionLabel: string;
  onToggleMode: () => void;
}

export default function HistoryHourlyActivityPanel({
  mode,
  hourlyActivity,
  hourlyCategoryActivity,
  showQuietPlaceholder,
  actionLabel,
  onToggleMode,
}: HistoryHourlyActivityPanelProps) {
  return (
    <div className="qp-panel p-5 history-pulse-card history-pulse-card-primary">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.history.dailyHourlyActivity}</h3>
        <QuietIconAction
          icon={<Layers3 size={15} />}
          title={actionLabel}
          pressed={mode === "category"}
          className="hourly-chart-mode-toggle history-pulse-mode-toggle"
          showTooltip={false}
          onClick={onToggleMode}
        />
      </div>
      <div
        className="pt-3 history-pulse-chart"
        aria-hidden={showQuietPlaceholder ? "true" : undefined}
      >
        <HourlyActivityChart
          mode={mode}
          hourlyActivity={hourlyActivity}
          hourlyCategoryActivity={hourlyCategoryActivity}
          margin={{ top: 4, right: 15, left: 0, bottom: 0 }}
          padding={{ left: 10, right: 10 }}
        />
      </div>
    </div>
  );
}
