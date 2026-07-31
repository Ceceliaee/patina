import { useState, type CSSProperties } from "react";
import { Minus, Plus, X } from "lucide-react";
import QuietDatePicker from "../../../shared/components/QuietDatePicker.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { UI_TEXT, getUiLocale } from "../../../shared/copy/index.ts";
import {
  addLocalDays,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from "../../../shared/lib/localDate.ts";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import {
  getAdjacentDataDestinationFocusedDateKey,
  type DataDestinationDetailTarget,
} from "../services/dataDestinationDetailState.ts";
import {
  getInitialDataDestinationDetailTimelineViewport,
  type DataDestinationDetailTimelineViewport,
} from "../services/dataDestinationDetailTimelineViewport.ts";
import {
  clampDetailMinSecs,
  DETAIL_MIN_SECS_RANGE,
  readDetailMinSecs,
  readDataDestinationDetailTimelineZoomHours,
  rememberDataDestinationDetailTimelineZoomHours,
  saveDetailMinSecs,
} from "../services/dataDestinationDetailTimelinePreferenceStorage.ts";
import { useDataDestinationDetail } from "../hooks/useDataDestinationDetail.ts";
import { getDataDestinationDetailCopy } from "../copy/dataDestinationDetailCopy.ts";
import DataDestinationDetailTimeline from "./DataDestinationDetailTimeline.tsx";
import DataDestinationDetailRecords from "./DataDestinationDetailRecords.tsx";

interface Props {
  target: DataDestinationDetailTarget;
  initialSelection: DataTrendRangeSelection;
  refreshKey: number;
  mappingVersion: number;
  mergeThresholdSecs: number;
  onClose: () => void;
}

function getOptionInitial(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function formatDateControlLabel(dateKey: string) {
  const date = parseLocalDateKey(dateKey);
  if (!date) return dateKey;
  const today = startOfLocalDay(new Date());
  if (dateKey === formatLocalDateKey(today)) return UI_TEXT.date.today;
  if (dateKey === formatLocalDateKey(addLocalDays(today, -1))) {
    return UI_TEXT.date.yesterday;
  }
  return date.toLocaleDateString(getUiLocale(), {
    month: "short",
    day: "numeric",
  });
}

export default function DataDestinationDetailDialog({
  target,
  initialSelection,
  refreshKey,
  mappingVersion,
  mergeThresholdSecs,
  onClose,
}: Props) {
  const copy = getDataDestinationDetailCopy();
  const [timelineZoomHours, setTimelineZoomHours] = useState(
    readDataDestinationDetailTimelineZoomHours,
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
  const detail = useDataDestinationDetail({
    target,
    selection: initialSelection,
    refreshKey,
    mappingVersion,
    mergeThresholdSecs,
  });
  const dayBelongsToTarget = detail.day.requestKey.startsWith(
    `${target.mode}:${target.key}:`,
  );
  const retainedDay = dayBelongsToTarget ? detail.day.viewModel : null;
  const matchingDay = detail.focusedDateKey
    && retainedDay?.dateKey === detail.focusedDateKey
    ? retainedDay
    : null;
  const displayDay = matchingDay ?? retainedDay;
  const previousDateKey = detail.focusedDateKey
    ? getAdjacentDataDestinationFocusedDateKey(
      detail.focusedDateKey,
      -1,
    )
    : null;
  const nextDateKey = detail.focusedDateKey
    ? getAdjacentDataDestinationFocusedDateKey(
      detail.focusedDateKey,
      1,
    )
    : null;
  const timelineIdentity = displayDay
    ? `${target.mode}:${target.key}:${displayDay.dateKey}`
    : null;
  const initialTimelineViewport = displayDay
    ? getInitialDataDestinationDetailTimelineViewport(
      displayDay,
      detail.nowMs,
      timelineZoomHours,
    )
    : null;
  const [timelineViewportState, setTimelineViewportState] = useState<{
    identity: string;
    viewport: DataDestinationDetailTimelineViewport;
  } | null>(null);
  const timelineViewport = timelineIdentity
    && timelineViewportState?.identity === timelineIdentity
    ? timelineViewportState.viewport
    : initialTimelineViewport;

  return (
    <QuietDialog
      open
      title={(
        <span className="data-destination-detail-title">
          <span className="data-destination-detail-title-icon" aria-hidden>
            {target.iconUrl ? (
              <img src={target.iconUrl} alt="" draggable={false} />
            ) : (
              getOptionInitial(target.displayName)
            )}
          </span>
          <span>{target.displayName}</span>
        </span>
      )}
      headerAside={(
        <div className="data-destination-detail-header-actions">
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
      surfaceClassName="data-destination-detail-dialog"
    >
      <div
        className="data-destination-detail"
        style={{ "--data-detail-color": target.color } as CSSProperties}
      >
        <section className="data-destination-detail-section">
          <div
            className="data-destination-detail-day-content"
            aria-busy={detail.day.status === "loading" || detail.day.status === "refreshing"}
            data-data-detail-displayed-date={displayDay?.dateKey ?? ""}
            data-data-detail-requested-date={detail.focusedDateKey ?? ""}
          >
            {detail.day.status === "error" && !displayDay ? (
              <div className="data-destination-detail-error" role="status">
                <span>{copy.dayError}</span>
                <button type="button" className="qp-inline-action qp-inline-action-accent" onClick={detail.retryDay}>
                  {copy.retry}
                </button>
              </div>
            ) : displayDay && timelineViewport && timelineIdentity ? (
              <>
                {detail.day.status === "error" ? (
                  <div className="data-destination-detail-error" role="status">
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
                <DataDestinationDetailTimeline
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
                    rememberDataDestinationDetailTimelineZoomHours(zoomHours);
                  }}
                  toolbarAside={(
                    <QuietDatePicker
                      value={detail.focusedDateKey ?? detail.todayDateKey}
                      onChange={detail.setFocusedDateKey}
                      ariaLabel={UI_TEXT.date.pickDate}
                      className="data-destination-detail-date-trigger"
                      displayLabel={detail.focusedDateKey
                        ? formatDateControlLabel(detail.focusedDateKey)
                        : copy.focusedDate}
                      showCalendarIcon={false}
                      maxDate={detail.todayDateKey}
                      dayNavigation={{
                        ariaLabel: UI_TEXT.date.pickDate,
                        previousAriaLabel: copy.previousDay,
                        nextAriaLabel: copy.nextDay,
                        previousDisabled: !previousDateKey,
                        nextDisabled: !nextDateKey,
                        className: "data-destination-detail-day-actions",
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
              <div className="data-destination-detail-timeline-placeholder" role="status">
                {copy.loading}
              </div>
            )}
          </div>
        </section>

        <section className="data-destination-detail-section data-destination-detail-record-section">
          <div className="data-destination-detail-section-header data-destination-detail-record-header">
            <h4>{copy.details(target.mode)}</h4>
            <div
              className="data-destination-detail-duration-controls"
              role="group"
              aria-label={copy.minimumDuration}
            >
              <button
                type="button"
                className="qp-button-secondary data-destination-detail-duration-button"
                disabled={!canDecreaseMinSession}
                aria-label={UI_TEXT.accessibility.history.decreaseMinDuration}
                onClick={() => updateMinSessionMinutes(minSessionMinutes - 1)}
              >
                <Minus size={11} aria-hidden />
              </button>
              <span className="data-destination-detail-duration-value">
                {UI_TEXT.settings.minuteValue(minSessionMinutes)}
              </span>
              <button
                type="button"
                className="qp-button-secondary data-destination-detail-duration-button"
                disabled={!canIncreaseMinSession}
                aria-label={UI_TEXT.accessibility.history.increaseMinDuration}
                onClick={() => updateMinSessionMinutes(minSessionMinutes + 1)}
              >
                <Plus size={11} aria-hidden />
              </button>
            </div>
          </div>
          {displayDay && timelineViewport ? (
            <DataDestinationDetailRecords
              day={displayDay}
              minimumDurationMs={minSessionMinutes * 60_000}
              mode={target.mode}
              objectName={target.displayName}
              viewport={timelineViewport}
            />
          ) : (
            <div className="data-destination-detail-records-placeholder" aria-hidden />
          )}
        </section>
      </div>
    </QuietDialog>
  );
}
