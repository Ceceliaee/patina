import { Globe2 } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietSegmentedFilter, { type QuietSegmentedFilterOption } from "../../../shared/components/QuietSegmentedFilter";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { formatDuration } from "../services/historyFormatting.ts";
import type { DayDistributionMode } from "../services/historyLayoutPreferenceStorage.ts";

export interface HistoryDayDistributionItem {
  key: string;
  label: string;
  subtitle?: string;
  duration: number;
  percentage: number;
  color: string;
  iconSrc?: string;
  category?: AppCategory;
  kind?: "app" | "category" | "web";
}

interface HistoryDayDistributionPanelProps {
  title: string;
  mode: DayDistributionMode;
  modeOptions: QuietSegmentedFilterOption<DayDistributionMode>[];
  items: HistoryDayDistributionItem[];
  showQuietPlaceholder: boolean;
  placeholderMessage: string;
  onModeChange: (mode: DayDistributionMode) => void;
}

function formatDistributionPercentage(percentage: number) {
  if (!Number.isFinite(percentage)) return "0%";

  const boundedPercentage = Math.min(100, Math.max(0, percentage));
  return `${Math.round(boundedPercentage)}%`;
}

export default function HistoryDayDistributionPanel({
  title,
  mode,
  modeOptions,
  items,
  showQuietPlaceholder,
  placeholderMessage,
  onModeChange,
}: HistoryDayDistributionPanelProps) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{title}</h3>
        <QuietSegmentedFilter
          value={mode}
          options={modeOptions}
          onChange={onModeChange}
          className="history-day-distribution-mode-switch"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 pt-2">
        {showQuietPlaceholder ? (
          <p
            className="text-[var(--qp-text-tertiary)] text-xs text-center mt-8"
            role="status"
          >
            {placeholderMessage}
          </p>
        ) : items.length === 0 ? (
          <p className="text-[var(--qp-text-tertiary)] text-xs text-center mt-8">{UI_TEXT.history.noData}</p>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium leading-[1.2] text-[var(--qp-text-secondary)]">
                    {item.iconSrc ? (
                      <img src={item.iconSrc} className="h-3.5 w-3.5 shrink-0 object-contain" alt="" />
                    ) : item.kind === "web" ? (
                      <Globe2 size={14} className="shrink-0 text-[var(--qp-text-tertiary)]" aria-hidden="true" />
                    ) : (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 leading-[1.2]">
                      <span className="block truncate text-xs font-medium leading-[1.2]">{item.label}</span>
                      {item.subtitle && (
                        <span className="mt-0.5 block truncate text-[10px] font-normal text-[var(--qp-text-tertiary)]">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium leading-[1.2] text-[var(--qp-text-tertiary)] tabular-nums">
                    <span>{formatDuration(item.duration)}</span>
                    <span className="font-normal opacity-70"> · {formatDistributionPercentage(item.percentage)}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--qp-track-muted)] rounded-full overflow-hidden">
                  <div
                    className="history-day-distribution-progress h-full rounded-full"
                    style={{
                      backgroundColor: item.color,
                      width: `${item.percentage}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
