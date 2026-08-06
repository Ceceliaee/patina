import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Globe2, Monitor } from "lucide-react";

import QuietSegmentedFilter, { type QuietSegmentedFilterOption } from "../../../shared/components/QuietSegmentedFilter";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { DestinationDetailTarget } from "../../destination/types.ts";
import {
  createHistoryAppDetailTarget,
  createHistoryWebDetailTarget,
} from "../hooks/useHistoryDestinationDetailEntry.tsx";
import { formatDuration } from "../services/historyFormatting.ts";
import type { DayDistributionMode } from "../services/historyLayoutPreferenceStorage.ts";
import QuickAppClassificationStatus from "../../classification/components/QuickAppClassificationStatus.tsx";
import type {
  QuickAppClassificationAnchor,
  QuickAppClassificationTarget,
} from "../../classification/types.ts";

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
  quickClassificationTarget?: QuickAppClassificationTarget;
  unclassified?: boolean;
}

interface HistoryDayDistributionPanelProps {
  title: string;
  mode: DayDistributionMode;
  modeOptions: QuietSegmentedFilterOption<DayDistributionMode>[];
  items: HistoryDayDistributionItem[];
  showQuietPlaceholder: boolean;
  placeholderMessage: string;
  onModeChange: (mode: DayDistributionMode) => void;
  onDestinationDetailIntentStart?: (
    target: DestinationDetailTarget,
    trigger: HTMLButtonElement,
  ) => void;
  onDestinationDetailOpen?: (
    target: DestinationDetailTarget,
    trigger: HTMLButtonElement,
  ) => void;
  activeQuickClassificationExeName?: string | null;
  onQuickClassificationPreload?: () => void;
  onQuickClassificationOpen?: (
    target: QuickAppClassificationTarget,
    anchor: QuickAppClassificationAnchor,
    trigger: HTMLButtonElement,
  ) => void;
}

function formatDistributionPercentage(percentage: number) {
  if (!Number.isFinite(percentage)) return "0%";

  const boundedPercentage = Math.min(100, Math.max(0, percentage));
  return `${Math.round(boundedPercentage)}%`;
}

function createDistributionDetailTarget(
  item: HistoryDayDistributionItem,
): DestinationDetailTarget | undefined {
  if (item.kind === "app") {
    return createHistoryAppDetailTarget(
      item.key,
      item.label,
      item.iconSrc ?? null,
      item.color,
    );
  }

  if (item.kind === "web") {
    return createHistoryWebDetailTarget(
      item.key,
      item.label,
      item.key,
      item.iconSrc ?? null,
      item.color,
    );
  }

  return undefined;
}

export default function HistoryDayDistributionPanel({
  title,
  mode,
  modeOptions,
  items,
  showQuietPlaceholder,
  placeholderMessage,
  onModeChange,
  onDestinationDetailIntentStart,
  onDestinationDetailOpen,
  activeQuickClassificationExeName,
  onQuickClassificationPreload,
  onQuickClassificationOpen,
}: HistoryDayDistributionPanelProps) {
  const UI_TEXT = useLocaleText();
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
            {items.map((item) => {
              const detailTarget = createDistributionDetailTarget(item);

              return (
                <div key={item.key} className="space-y-1.5">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium leading-[1.2] text-[var(--qp-text-secondary)]">
                    {detailTarget ? (
                      <button
                        type="button"
                        className="history-day-distribution-detail-trigger"
                        aria-label={UI_TEXT.destinationDetail.open(item.label)}
                        aria-keyshortcuts={item.quickClassificationTarget ? "Enter Shift+F10" : "Enter"}
                        aria-haspopup={item.quickClassificationTarget ? "menu" : undefined}
                        aria-expanded={item.quickClassificationTarget
                          ? activeQuickClassificationExeName === item.quickClassificationTarget.exeName
                          : undefined}
                        onPointerEnter={item.quickClassificationTarget
                          ? onQuickClassificationPreload
                          : undefined}
                        onFocus={item.quickClassificationTarget
                          ? onQuickClassificationPreload
                          : undefined}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          onDestinationDetailIntentStart?.(
                            detailTarget,
                            event.currentTarget,
                          );
                        }}
                        onDoubleClick={(event) => {
                          onDestinationDetailOpen?.(
                            detailTarget,
                            event.currentTarget,
                          );
                        }}
                        onContextMenu={item.quickClassificationTarget ? (event) => {
                          event.preventDefault();
                          onQuickClassificationOpen?.(
                            item.quickClassificationTarget!,
                            { clientX: event.clientX, clientY: event.clientY },
                            event.currentTarget,
                          );
                        } : undefined}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onDestinationDetailIntentStart?.(
                              detailTarget,
                              event.currentTarget,
                            );
                            onDestinationDetailOpen?.(
                              detailTarget,
                              event.currentTarget,
                            );
                            return;
                          }
                          if (
                            item.quickClassificationTarget
                            && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
                          ) {
                            event.preventDefault();
                            const bounds = event.currentTarget.getBoundingClientRect();
                            onQuickClassificationOpen?.(
                              item.quickClassificationTarget,
                              {
                                clientX: bounds.left + bounds.width / 2,
                                clientY: bounds.top + bounds.height / 2,
                              },
                              event.currentTarget,
                            );
                          }
                        }}
                      >
                        {item.iconSrc ? (
                          <img src={item.iconSrc} className="h-3.5 w-3.5 object-contain" alt="" />
                        ) : item.kind === "web" ? (
                          <Globe2 size={14} className="text-[var(--qp-text-tertiary)]" aria-hidden="true" />
                        ) : (
                          <Monitor size={14} className="text-[var(--qp-text-tertiary)]" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 leading-[1.2]">
                      <span className="history-day-distribution-name-row">
                        <span className="truncate text-xs font-medium leading-[1.2]">{item.label}</span>
                        <QuickAppClassificationStatus
                          density="dense"
                          unclassified={Boolean(item.unclassified)}
                        />
                      </span>
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
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
