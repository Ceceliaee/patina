import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import { useState, type CSSProperties } from "react";
import { Minus, Plus, X } from "lucide-react";
import QuietDatePicker from "../../../shared/components/QuietDatePicker.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import {
  addLocalDays,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from "../../../shared/lib/localDate.ts";
import {
  getAdjacentDestinationDetailDateKey,
} from "../services/destinationDetailState.ts";
import type { DestinationDetailRuntimeContext, DestinationDetailTarget } from "../types.ts";
import {
  getInitialDestinationDetailTimelineViewport,
  type DestinationDetailTimelineViewport,
} from "../services/destinationDetailTimelineViewport.ts";
import {
  clampDetailMinSecs,
  DETAIL_MIN_SECS_RANGE,
  readDetailMinSecs,
  readDestinationDetailTimelineZoomHours,
  rememberDestinationDetailTimelineZoomHours,
  saveDetailMinSecs,
} from "../services/destinationDetailPreferenceStorage.ts";
import { useDestinationDetail } from "../hooks/useDestinationDetail.ts";
import DestinationDetailTimeline from "./DestinationDetailTimeline.tsx";
import DestinationDetailRecords from "./DestinationDetailRecords.tsx";

interface Props {
  target: DestinationDetailTarget;
  initialDateKey: string;
  runtime: DestinationDetailRuntimeContext;
  onClose: () => void;
}

function formatDateControlLabel(dateKey: string, text: UiText, locale: string) {
  const date = parseLocalDateKey(dateKey);
  if (!date) return dateKey;
  const today = startOfLocalDay(new Date());
  if (dateKey === formatLocalDateKey(today)) return text.date.today;
  if (dateKey === formatLocalDateKey(addLocalDays(today, -1))) {
    return text.date.yesterday;
  }
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

export default function DestinationDetailDialog({
  target,
  initialDateKey,
  runtime,
  onClose,
}: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = UI_TEXT.destinationDetail;
  const [timelineZoomHours, setTimelineZoomHours] = useState(
    readDestinationDetailTimelineZoomHours,
  );
  const [minSessionSecs, setMinSessionSecs] = useState(readDetailMinSecs);
  const minSessionMinutes = minSessionSecs / 60;
  const canDecreaseMinSession =
    minSessionSecs > DETAIL_MIN_SECS_RANGE.min;
  const canIncreaseMinSession =
    minSessionSecs < DETAIL_MIN_SECS_RANGE.max;
  const updateMinSessionMinutes = (nextMinutes: number) => {
    const nextSecs = clampDetailMinSecs(nextMinutes * 60);
    setMinSessionSecs(nextSecs);
    saveDetailMinSecs(nextSecs);
  };
  const detail = useDestinationDetail({
    target,
    initialDateKey,
    refreshKey: runtime.refreshKey,
    mappingVersion: runtime.mappingVersion,
    mergeThresholdSecs: runtime.mergeThresholdSecs,
    trackerHealth: runtime.trackerHealth,
  });
  const dayBelongsToTarget = detail.day.requestKey.startsWith(
    `${target.mode}:${target.key}:`,
  );
  const retainedDay = dayBelongsToTarget ? detail.day.viewModel : null;
  const matchingDay = retainedDay?.dateKey === detail.focusedDateKey
    ? retainedDay
    : null;
  const displayDay = matchingDay ?? retainedDay;
  const previousDateKey = getAdjacentDestinationDetailDateKey(
    detail.focusedDateKey,
    -1,
  );
  const nextDateKey = getAdjacentDestinationDetailDateKey(
    detail.focusedDateKey,
    1,
  );
  const timelineIdentity = displayDay
    ? `${target.mode}:${target.key}:${displayDay.dateKey}`
    : null;
  const initialTimelineViewport = displayDay
    ? getInitialDestinationDetailTimelineViewport(
      displayDay,
      detail.nowMs,
      timelineZoomHours,
    )
    : null;
  const [timelineViewportState, setTimelineViewportState] = useState<{
    identity: string;
    viewport: DestinationDetailTimelineViewport;
  } | null>(null);
  const timelineViewport = timelineIdentity
    && timelineViewportState?.identity === timelineIdentity
    ? timelineViewportState.viewport
    : initialTimelineViewport;

  return (
    <QuietDialog
      open
      title={(
        <span className="destination-detail-title">
          <span className="destination-detail-title-icon" aria-hidden>
            {target.iconUrl ? (
              <img src={target.iconUrl} alt="" />
            ) : (
              target.displayName.trim()[0]?.toUpperCase() || "?"
            )}
          </span>
          <span>{target.displayName}</span>
        </span>
      )}
      headerAside={(
        <div className="destination-detail-header-actions">
          <button
            type="button"
            className="qp-dialog-close-button"
            aria-label={copy.close}
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}
      onClose={onClose}
      surfaceClassName="destination-detail-dialog"
    >
      <div
        className="destination-detail"
        style={{ "--destination-detail-color": target.color } as CSSProperties}
      >
        <section className="destination-detail-section">
          <div
            className="destination-detail-day-content"
            aria-busy={detail.day.status === "loading" || detail.day.status === "refreshing"}
            data-destination-detail-displayed-date={displayDay?.dateKey ?? ""}
            data-destination-detail-requested-date={detail.focusedDateKey}
          >
            {detail.day.status === "error" && !displayDay ? (
              <div className="destination-detail-error" role="status">
                <span>{copy.dayError}</span>
                <button type="button" className="qp-inline-action qp-inline-action-accent" onClick={detail.retryDay}>
                  {copy.retry}
                </button>
              </div>
            ) : displayDay && timelineViewport && timelineIdentity ? (
              <>
                {detail.day.status === "error" ? (
                  <div className="destination-detail-error" role="status">
                    <span>{copy.dayError}</span>
                    <button
                      type="button"
                      className="qp-inline-action qp-inline-action-accent"
                      onClick={detail.retryDay}
                    >
                      {copy.retry}
                    </button>
                  </div>
                ) : null}
                <DestinationDetailTimeline
                  key={timelineIdentity}
                  objectName={target.displayName}
                  color={target.color}
                  day={displayDay}
                  viewport={timelineViewport}
                  minimumDurationMs={minSessionMinutes * 60_000}
                  onViewportChange={(viewport) => {
                    setTimelineViewportState({
                      identity: timelineIdentity,
                      viewport,
                    });
                  }}
                  onZoomHoursChange={(zoomHours) => {
                    setTimelineZoomHours(zoomHours);
                    rememberDestinationDetailTimelineZoomHours(zoomHours);
                  }}
                  toolbarAside={(
                    <QuietDatePicker
                      value={detail.focusedDateKey}
                      onChange={detail.setFocusedDateKey}
                      ariaLabel={UI_TEXT.date.pickDate}
                      className="destination-detail-date-trigger"
                      displayLabel={formatDateControlLabel(displayDay.dateKey, UI_TEXT, locale)}
                      showCalendarIcon={false}
                      maxDate={detail.todayDateKey}
                      dayNavigation={{
                        ariaLabel: UI_TEXT.date.pickDate,
                        previousAriaLabel: copy.previousDay,
                        nextAriaLabel: copy.nextDay,
                        previousDisabled: !previousDateKey,
                        nextDisabled: !nextDateKey,
                        className: "destination-detail-day-actions",
                        onPrevious: () => {
                          if (previousDateKey) detail.setFocusedDateKey(previousDateKey);
                        },
                        onNext: () => {
                          if (nextDateKey) detail.setFocusedDateKey(nextDateKey);
                        },
                      }}
                    />
                  )}
                />
              </>
            ) : (
              <div className="destination-detail-timeline-placeholder" role="status">
                {copy.loading}
              </div>
            )}
          </div>
        </section>

        <section className="destination-detail-section destination-detail-record-section">
          <div className="destination-detail-section-header destination-detail-record-header">
            <h4>{copy.details(target.mode)}</h4>
            <div
              className="destination-detail-duration-controls"
              role="group"
              aria-label={copy.minimumDuration}
            >
              <button
                type="button"
                className="qp-button-secondary destination-detail-duration-button"
                disabled={!canDecreaseMinSession}
                aria-label={UI_TEXT.accessibility.history.decreaseMinDuration}
                onClick={() => updateMinSessionMinutes(minSessionMinutes - 1)}
              >
                <Minus size={11} aria-hidden />
              </button>
              <span className="destination-detail-duration-value">
                {UI_TEXT.settings.minuteValue(minSessionMinutes)}
              </span>
              <button
                type="button"
                className="qp-button-secondary destination-detail-duration-button"
                disabled={!canIncreaseMinSession}
                aria-label={UI_TEXT.accessibility.history.increaseMinDuration}
                onClick={() => updateMinSessionMinutes(minSessionMinutes + 1)}
              >
                <Plus size={11} aria-hidden />
              </button>
            </div>
          </div>
          {displayDay && timelineViewport ? (
            <DestinationDetailRecords
              day={displayDay}
              minimumDurationMs={minSessionMinutes * 60_000}
              mode={target.mode}
              objectName={target.displayName}
              viewport={timelineViewport}
            />
          ) : (
            <div className="destination-detail-records-placeholder" aria-hidden />
          )}
        </section>
      </div>
    </QuietDialog>
  );
}
