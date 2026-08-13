import { useLocaleText } from "../../../shared/i18n/index.ts";
import { getCategoryToken } from "../../../shared/classification/categoryTokens.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, } from "react";
import { Layers3, Monitor, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors";
import { formatDashboardDuration } from "../services/dashboardFormatting";
import type { DashboardReadModel } from "../services/dashboardReadModel";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import HourlyActivityChart from "../../../shared/charts/HourlyActivityChart";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import type { HourlyActivityChartMode } from "../../../shared/settings/appSettings.ts";
import DestinationDetailDialogEntry from "../../destination/components/DestinationDetailDialogEntry.tsx";
import { useDestinationDetailLauncher } from "../../destination/hooks/useDestinationDetailLauncher.ts";
import { createDestinationDetailTarget } from "../../destination/types.ts";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import QuickClassificationEntry from "../../classification/components/QuickClassificationEntry.tsx";
import QuickClassificationStatus from "../../classification/components/QuickClassificationStatus.tsx";
import { useQuickClassificationLauncher } from "../../classification/hooks/useQuickClassificationLauncher.ts";
import {
  createQuickAppClassificationTarget,
  getQuickClassificationTargetKey,
} from "../../classification/types.ts";

interface Props {
  dashboard: DashboardReadModel;
  icons: Record<string, string>;
  hourlyActivityChartMode: HourlyActivityChartMode;
  onHourlyActivityChartModeChange: (mode: HourlyActivityChartMode) => void;
  runtime: {
    refreshKey: number;
    mappingVersion: number;
    mergeThresholdSecs: number;
    trackerHealth: TrackerHealthSnapshot;
  };
  onOverridesChanged: () => void;
  onQuickActionError: (message: string) => void;
}

const FOCUS_CATEGORY_LIMIT = 4;
const FOCUS_CATEGORY_EXPANDED_LIMIT = 6;
const FOCUS_CATEGORY_EXPANDED_WIDTH = 440;
const DONUT_CENTER = 56;
const DONUT_RADIUS = 42;
const DONUT_STROKE_WIDTH = 16;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const DONUT_GAP_DEGREES = 4;

function buildFocusCategoryDist(
  categoryDist: DashboardReadModel["categoryDist"],
  limit: number,
  otherLabel: string,
) {
  const visible = categoryDist.slice(0, limit);
  const rest = categoryDist.slice(limit);
  const restValue = rest.reduce((sum, item) => sum + item.value, 0);

  if (restValue <= 0) {
    return visible;
  }

  return [
    ...visible,
    {
      category: "other" as const,
      name: otherLabel,
      value: restValue,
      color: "var(--qp-text-tertiary)",
    },
  ];
}

function DashboardFocusDonut({
  categoryDist,
}: {
  categoryDist: DashboardReadModel["categoryDist"];
}) {
  const UI_TEXT = useLocaleText();
  const total = categoryDist.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  let consumed = 0;

  return (
    <svg
      aria-label={UI_TEXT.dashboard.focusShare}
      className="block h-full w-full"
      role="img"
      viewBox="0 0 112 112"
    >
      <circle
        cx={DONUT_CENTER}
        cy={DONUT_CENTER}
        fill="none"
        r={DONUT_RADIUS}
        stroke="var(--qp-track-muted)"
        strokeWidth={DONUT_STROKE_WIDTH}
      />
      {total > 0 ? categoryDist.map((item) => {
        const fraction = Math.max(0, item.value) / total;
        const segmentLength = fraction * DONUT_CIRCUMFERENCE;
        const gapLength = Math.min(
          segmentLength,
          DONUT_CIRCUMFERENCE * DONUT_GAP_DEGREES / 360,
        );
        const dashLength = Math.max(0, segmentLength - gapLength);
        const dashOffset = -consumed;
        consumed += segmentLength;
        return (
          <circle
            key={item.name}
            cx={DONUT_CENTER}
            cy={DONUT_CENTER}
            fill="none"
            r={DONUT_RADIUS}
            stroke={item.color || "var(--qp-accent-default)"}
            strokeDasharray={`${dashLength} ${DONUT_CIRCUMFERENCE - dashLength}`}
            strokeDashoffset={dashOffset}
            strokeWidth={DONUT_STROKE_WIDTH}
            transform={`rotate(-90 ${DONUT_CENTER} ${DONUT_CENTER})`}
          />
        );
      }) : null}
    </svg>
  );
}

export default function Dashboard({
  dashboard,
  icons,
  hourlyActivityChartMode,
  onHourlyActivityChartModeChange,
  runtime,
  onOverridesChanged,
  onQuickActionError,
}: Props) {
  const UI_TEXT = useLocaleText();
  const { refreshKey, mappingVersion, mergeThresholdSecs, trackerHealth } = runtime;
  const detail = useDestinationDetailLauncher();
  const quickClassification = useQuickClassificationLauncher();
  const iconThemeColors = useIconThemeColors(icons);
  const {
    totalTrackedTime,
    dayDeltaTrackedTime,
    topApplications,
    hourlyActivity,
    hourlyCategoryActivity,
    categoryDist,
  } = dashboard;
  const dayDeltaDirection = dayDeltaTrackedTime > 0
    ? "increase"
    : dayDeltaTrackedTime < 0
      ? "decrease"
      : "same";
  const dayDeltaLabel = UI_TEXT.dashboard.comparedWithYesterday(
    formatDashboardDuration(Math.abs(dayDeltaTrackedTime)),
    dayDeltaDirection,
  );
  const DayDeltaIcon = dayDeltaDirection === "increase"
    ? TrendingUp
    : dayDeltaDirection === "decrease"
      ? TrendingDown
      : Minus;
  const focusCardRef = useRef<HTMLDivElement | null>(null);
  const topAppsListRef = useRef<HTMLDivElement | null>(null);
  const [focusCategoryLimit, setFocusCategoryLimit] = useState(FOCUS_CATEGORY_LIMIT);
  const [topAppsListOverflows, setTopAppsListOverflows] = useState(false);
  const [quickOverrides, setQuickOverrides] = useState<Record<string, AppOverride | null>>({});
  const localizedCategoryDist = useMemo(
    () => categoryDist.map((item) => ({
      ...item,
      name: item.name || getCategoryToken(item.category, UI_TEXT).label,
    })),
    [categoryDist, UI_TEXT],
  );
  const visibleCategoryDist = buildFocusCategoryDist(
    localizedCategoryDist,
    focusCategoryLimit,
    UI_TEXT.categories.other,
  );

  useEffect(() => {
    const card = focusCardRef.current;
    if (!card) return;

    const updateLimit = (width: number) => {
      setFocusCategoryLimit(
        width >= FOCUS_CATEGORY_EXPANDED_WIDTH ? FOCUS_CATEGORY_EXPANDED_LIMIT : FOCUS_CATEGORY_LIMIT,
      );
    };

    updateLimit(card.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      updateLimit(entry.contentRect.width);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const list = topAppsListRef.current;
    if (!list) return;

    const updateOverflow = () => {
      setTopAppsListOverflows(list.scrollHeight > list.clientHeight + 1);
    };
    updateOverflow();

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(list);
    return () => observer.disconnect();
  }, [topApplications.length]);
  const quickClassificationRequest = quickClassification.request;

  return (
    <div className="flex flex-col gap-4 md:gap-5 h-full overflow-hidden">
      <QuietPageHeader
        icon={<Monitor size={18} />}
        title={UI_TEXT.dashboard.title}
        subtitle={UI_TEXT.dashboard.subtitle}
      />

      <div className="flex gap-4 md:gap-5 flex-1 min-h-0 overflow-hidden dashboard-workspace">
        <div className="w-5/12 flex flex-col gap-4 md:gap-5 min-h-0 dashboard-left-column qp-scroll-region">
          <div
            ref={focusCardRef}
            className="qp-panel p-5 relative overflow-hidden shrink-0 min-h-[250px] dashboard-focus-card"
          >
            <div className="dashboard-card-header">
              <h3 className="text-[var(--qp-text-primary)] font-semibold text-sm">{UI_TEXT.dashboard.focusShare}</h3>
            </div>
            <div className="dashboard-focus-layout">
              <div className="relative w-full h-[185px] dashboard-focus-chart">
                <DashboardFocusDonut categoryDist={visibleCategoryDist} />
                <div className="dashboard-focus-total-center absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[22px] font-semibold text-[var(--qp-text-primary)] tabular-nums">
                    {formatDashboardDuration(totalTrackedTime)}
                  </span>
                  <span className="max-w-[88px] truncate text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">
                    {UI_TEXT.dashboard.total}
                  </span>
                </div>
              </div>

              <div className="dashboard-focus-ranking" aria-label={UI_TEXT.dashboard.focusShare}>
                {visibleCategoryDist.map((cat) => (
                  <div key={cat.name} className="dashboard-focus-ranking-row">
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className="dashboard-focus-ranking-dot"
                        style={{ backgroundColor: cat.color || "var(--qp-accent-default)" }}
                      />
                      <span className="truncate font-semibold text-[var(--qp-text-secondary)]">{cat.name}</span>
                    </div>
                    <span className="text-[var(--qp-text-primary)] font-semibold tabular-nums">
                      {formatDashboardDuration(cat.value)}
                    </span>
                  </div>
                ))}
                {visibleCategoryDist.length === 0 && (
                  <div className="text-xs font-medium text-[var(--qp-text-tertiary)]">{UI_TEXT.dashboard.emptyState}</div>
                )}
              </div>
            </div>
            <p className="dashboard-focus-delta text-[11px] font-medium text-[var(--qp-text-tertiary)]">
              <DayDeltaIcon size={12} strokeWidth={2} />
              {dayDeltaLabel}
            </p>
          </div>

          <div className="qp-panel p-5 flex min-h-0 flex-col overflow-hidden dashboard-pulse-card">
            <div className="dashboard-card-header">
              <h3 className="text-[var(--qp-text-primary)] font-semibold text-sm">
                {UI_TEXT.dashboard.hourlyActivity}
              </h3>
              <QuietIconAction
                icon={<Layers3 size={15} />}
                title={hourlyActivityChartMode === "category"
                  ? UI_TEXT.dashboard.showTotalHourlyActivity
                  : UI_TEXT.dashboard.showHourlyActivityByCategory}
                pressed={hourlyActivityChartMode === "category"}
                className="hourly-chart-mode-toggle dashboard-pulse-mode-toggle"
                showTooltip={false}
                onClick={() => onHourlyActivityChartModeChange(
                  hourlyActivityChartMode === "category" ? "total" : "category",
                )}
              />
            </div>
            <div className="flex-1 min-h-[170px] pt-3 dashboard-pulse-chart">
              <HourlyActivityChart
                mode={hourlyActivityChartMode}
                hourlyActivity={hourlyActivity}
                hourlyCategoryActivity={hourlyCategoryActivity}
                margin={{ top: 6, right: 12, left: 10, bottom: 4 }}
                padding={{ left: 12, right: 12 }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 qp-panel p-5 flex flex-col overflow-hidden min-h-0">
          <header className="dashboard-card-header mb-4">
            <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.dashboard.topApps}</h3>
            <div className="qp-chip px-2.5 py-1 text-[10px] font-semibold text-[var(--qp-text-secondary)]">
              {UI_TEXT.dashboard.topAppsBadge(topApplications.length)}
            </div>
          </header>

          <div
            ref={topAppsListRef}
            className={`dashboard-top-apps-list flex-1 overflow-y-auto space-y-2.5 qp-scroll-region ${topAppsListOverflows ? "pr-1 md:pr-2" : ""}`.trim()}
          >
            {topApplications.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-[var(--qp-text-tertiary)] gap-2">
                <Monitor size={32} className="opacity-40" />
                <p className="text-sm font-medium mt-2">{UI_TEXT.dashboard.emptyState}</p>
              </div>
            )}
            {topApplications.map((app) => (
              (() => {
                const hasQuickOverride = Object.prototype.hasOwnProperty.call(quickOverrides, app.exeName);
                const appOverride = hasQuickOverride
                  ? quickOverrides[app.exeName]
                  : AppClassification.getUserOverride(app.exeName);
                const overrideColor = appOverride?.color;
                const effectiveCategory = hasQuickOverride
                  ? appOverride?.category ?? "other"
                  : AppClassification.mapApp(app.exeName, { appName: app.name }).category;
                const isUnclassified = effectiveCategory === "other";
                const displayName = appOverride?.displayName?.trim() || app.name;
                const accentColor = overrideColor ?? iconThemeColors[app.exeName] ?? app.color;
                const createDetailRequest = () => ({
                    target: createDestinationDetailTarget({
                      mode: "app",
                      key: app.exeName,
                      identityKeys: [app.exeName],
                      displayName,
                      secondaryText: app.exeName,
                      iconUrl: icons[app.exeName] ?? null,
                      color: accentColor,
                    }),
                    initialDateKey: formatLocalDateKey(new Date()),
                  });
                const prepareDetail = (returnFocusTo: HTMLElement | null) => {
                  detail.prepare(createDetailRequest(), { returnFocusTo });
                };
                const openDetail = (returnFocusTo: HTMLElement | null) => {
                  if (detail.openPrepared()) return;
                  detail.open(createDetailRequest(), { returnFocusTo });
                };
                const quickTarget = createQuickAppClassificationTarget({
                  exeName: app.exeName,
                  displayName,
                  category: effectiveCategory,
                });

                return (
                  <div
                    key={app.exeName}
                    className="flex items-center justify-between px-3.5 py-3 border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] rounded-[10px] hover:border-[var(--qp-border-strong)] hover:bg-[var(--qp-bg-panel)] transition-colors cursor-default"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <button
                        type="button"
                        className="dashboard-top-app-detail-trigger w-10 h-10 bg-[var(--qp-bg-panel)] rounded-[8px] flex items-center justify-center border border-[var(--qp-border-subtle)] overflow-hidden p-2"
                        style={{
                          boxShadow: `0 0 0 2px ${accentColor}22`,
                        }}
                        aria-label={UI_TEXT.destinationDetail.open(displayName)}
                        aria-keyshortcuts="Enter Shift+F10"
                        aria-haspopup="menu"
                        aria-expanded={quickClassification.request?.target.kind === "app"
                          && quickClassification.request.target.exeName === app.exeName}
                        onPointerEnter={quickClassification.preload}
                        onFocus={quickClassification.preload}
                        onPointerDown={(event) => {
                          if (event.button === 0) prepareDetail(event.currentTarget);
                        }}
                        onDoubleClick={(event) => openDetail(event.currentTarget)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          quickClassification.openAtPointer(
                            quickTarget,
                            {
                            clientX: event.clientX,
                            clientY: event.clientY,
                            },
                            event.currentTarget,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            prepareDetail(event.currentTarget);
                            openDetail(event.currentTarget);
                            return;
                          }
                          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                            event.preventDefault();
                            quickClassification.openAtElement(quickTarget, event.currentTarget);
                          }
                        }}
                      >
                        {icons[app.exeName] ? (
                          <img src={icons[app.exeName]} className="w-full h-full object-contain" alt="" />
                        ) : (
                          <div className="text-xs font-semibold opacity-40 text-[var(--qp-text-secondary)]">{app.categoryInitial}</div>
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="dashboard-top-app-name-row font-semibold text-[var(--qp-text-primary)] text-sm">
                          <span className="truncate">{displayName}</span>
                          <QuickClassificationStatus unclassified={isUnclassified} />
                        </div>
                        <div className="dashboard-top-app-meta text-[10px] text-[var(--qp-text-tertiary)] font-medium mt-0.5 tabular-nums">
                          <span>{UI_TEXT.dashboard.sharePrefix} {app.percentage}%</span>
                        </div>
                      </div>
                    </div>

                      <div className="text-right ml-4 flex-shrink-0">
                      <div className="dashboard-top-app-duration font-semibold text-[var(--qp-text-primary)] text-sm tabular-nums">
                        {formatDashboardDuration(app.duration)}
                      </div>
                      <div className="w-20 h-1.5 bg-[var(--qp-track-muted)] rounded-full mt-2.5 overflow-hidden">
                        <div
                          className="dashboard-top-app-progress h-full rounded-full"
                          style={{
                            backgroundColor: accentColor,
                            width: `${app.percentage}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()
            ))}
          </div>
        </div>
      </div>
      {detail.request ? (
        <DestinationDetailDialogEntry
          key={`${detail.request.target.mode}:${detail.request.target.key}`}
          target={detail.request.target}
          initialDateKey={detail.request.initialDateKey}
          runtime={{ refreshKey, mappingVersion, mergeThresholdSecs, trackerHealth }}
          onClose={detail.close}
        />
      ) : null}
      {quickClassificationRequest ? (
        <QuickClassificationEntry
          key={`${getQuickClassificationTargetKey(quickClassificationRequest.target)}:${quickClassificationRequest.anchor.clientX}:${quickClassificationRequest.anchor.clientY}`}
          request={quickClassificationRequest}
          onClose={quickClassification.close}
          onSaved={(target, override) => {
            if (target.kind !== "app") return;
            setQuickOverrides((current) => ({
              ...current,
              [target.exeName]: override as AppOverride | null,
            }));
            onOverridesChanged();
          }}
          onError={onQuickActionError}
        />
      ) : null}
    </div>
  );
}
