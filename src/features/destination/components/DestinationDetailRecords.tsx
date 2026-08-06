import { useLocale, useLocaleText, type Locale } from "../../../shared/i18n/index.ts";
import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import {
  getDestinationDetailTitleRecords,
  type DestinationDetailTitleRecord,
  type DestinationDetailActivity,
  type DestinationDetailDayViewModel,
} from "../services/destinationDetailReadModel.ts";
import {
  clipDestinationDetailActivitiesToViewport,
  type DestinationDetailTimelineViewport,
} from "../services/destinationDetailTimelineViewport.ts";

interface Props {
  day: DestinationDetailDayViewModel;
  minimumDurationMs: number;
  mode: "app" | "web";
  objectName: string;
  viewport: DestinationDetailTimelineViewport;
}

interface OpenActivityDetails {
  activity: DestinationDetailActivity;
  anchor: HTMLButtonElement;
}

function formatTime(timestamp: number, dayEndMs: number, locale: Locale) {
  if (timestamp === dayEndMs) return "24:00";
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function DestinationDetailRecords({
  day,
  minimumDurationMs,
  mode,
  objectName,
  viewport,
}: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = UI_TEXT.destinationDetail;
  const popoverId = useId();
  const [openDetails, setOpenDetails] = useState<OpenActivityDetails | null>(
    null,
  );
  const activitiesInViewport = clipDestinationDetailActivitiesToViewport(
    day.activities,
    viewport,
  );
  const visibleActivities = activitiesInViewport.filter(
    (activity) => activity.duration >= minimumDurationMs,
  );

  useEffect(() => {
    setOpenDetails(null);
  }, [
    day.dateKey,
    minimumDurationMs,
    viewport.endMs,
    viewport.startMs,
  ]);

  if (visibleActivities.length === 0) {
    return (
      <div className="destination-detail-empty" role="status">
        {activitiesInViewport.length === 0
          ? day.activities.length === 0
            ? copy.noActivity
            : copy.noActivityInWindow
          : copy.noActivityAtMinimum(Math.round(minimumDurationMs / 60_000))}
      </div>
    );
  }

  const toggleDetails = (
    activity: DestinationDetailActivity,
    anchor: HTMLButtonElement,
  ) => {
    setOpenDetails((current) => (
      current?.activity.id === activity.id
        ? null
        : { activity, anchor }
    ));
  };

  return (
    <>
      <ol className="destination-detail-records">
        {visibleActivities.map((activity) => {
          const start = formatTime(activity.startTime, day.dayEndMs, locale);
          const end = formatTime(activity.endTime, day.dayEndMs, locale);
          const duration = formatDuration(activity.duration);
          const titleCount = getDestinationDetailTitleRecords(activity).length;
          const expanded = openDetails?.activity.id === activity.id;
          return (
            <li
              key={activity.id}
              className="qp-workbench-list-card destination-detail-activity"
            >
              <div
                className="destination-detail-activity-summary"
                aria-label={copy.activityAria(start, end, objectName, duration, titleCount)}
              >
                <span className="destination-detail-record-copy">
                  <strong>{objectName}</strong>
                  {mode === "app" ? (
                    <span className="qp-workbench-list-meta destination-detail-record-meta">
                      <span>{UI_TEXT.history.activitySegmentCount(
                        activity.activityCount ?? activity.records.length,
                      )}</span>
                      <span aria-hidden="true">·</span>
                      <span>{UI_TEXT.history.titleRowCount(titleCount)}</span>
                    </span>
                  ) : titleCount > 0 ? (
                    <span className="qp-workbench-list-meta destination-detail-record-meta">
                      {UI_TEXT.history.titleRowCount(titleCount)}
                    </span>
                  ) : null}
                  {activity.current ? (
                    <span className="destination-detail-current">{copy.current}</span>
                  ) : null}
                  {titleCount > 0 ? (
                    <button
                      type="button"
                      className="qp-button-secondary qp-compact-disclosure destination-detail-activity-disclosure"
                      aria-expanded={expanded}
                      aria-controls={expanded ? popoverId : undefined}
                      aria-label={copy.toggleTitleDetails(expanded, objectName)}
                      onClick={(event) => toggleDetails(activity, event.currentTarget)}
                    >
                      {expanded
                        ? <ChevronDown size={11} aria-hidden="true" />
                        : <ChevronRight size={11} aria-hidden="true" />}
                    </button>
                  ) : null}
                </span>
                <span className="destination-detail-record-timing">
                  <span className="destination-detail-record-duration">{duration}</span>
                  <time>{start} - {end}</time>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <QuietAnchoredPopover
        open={Boolean(openDetails)}
        anchor={openDetails?.anchor ?? null}
        id={popoverId}
        ariaLabel={copy.titleDetails}
        onClose={() => setOpenDetails(null)}
        className="destination-detail-record-popover"
        horizontalAnchorRatio={0.25}
      >
        <div className="destination-detail-popover-title">
          {copy.titleDetails}
        </div>
        <ol className="destination-detail-popover-list">
          {(openDetails
            ? getDestinationDetailTitleRecords(openDetails.activity)
            : []).map((record: DestinationDetailTitleRecord) => {
            const start = formatTime(record.startTime, day.dayEndMs, locale);
            const end = formatTime(record.endTime, day.dayEndMs, locale);
            const duration = formatDuration(record.duration);
            return (
              <li
                key={record.id}
                className="destination-detail-popover-item"
                aria-label={copy.recordAria(start, end, record.title, duration)}
              >
                <span className="destination-detail-popover-copy">
                  <strong className="qp-record-detail-title">{record.title}</strong>
                  {record.secondaryText ? <span>{record.secondaryText}</span> : null}
                </span>
                <span className="destination-detail-popover-time">
                  <span className="destination-detail-popover-duration">{duration}</span>
                  <time>{start}–{end}</time>
                </span>
              </li>
            );
          })}
        </ol>
      </QuietAnchoredPopover>
    </>
  );
}
