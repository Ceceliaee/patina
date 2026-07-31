import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getUiLocale, UI_TEXT } from "../../../shared/copy/index.ts";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import { getDataDestinationDetailCopy } from "../copy/dataDestinationDetailCopy.ts";
import type {
  DataDestinationDetailActivity,
  DataDestinationDetailDayViewModel,
  DataDestinationDetailRecord,
} from "../services/dataDestinationDetailReadModel.ts";
import {
  clipDataDestinationDetailActivitiesToViewport,
  type DataDestinationDetailTimelineViewport,
} from "../services/dataDestinationDetailTimelineViewport.ts";

interface Props {
  day: DataDestinationDetailDayViewModel;
  minimumDurationMs: number;
  mode: "app" | "web";
  objectName: string;
  viewport: DataDestinationDetailTimelineViewport;
}

interface OpenActivityDetails {
  activity: DataDestinationDetailActivity;
  anchor: HTMLButtonElement;
}

function formatTime(timestamp: number, dayEndMs: number) {
  if (timestamp === dayEndMs) return "24:00";
  return new Date(timestamp).toLocaleTimeString(getUiLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ActivityDetailItem({
  dayEndMs,
  record,
}: {
  dayEndMs: number;
  record: DataDestinationDetailRecord;
}) {
  const copy = getDataDestinationDetailCopy();
  const start = formatTime(record.startTime, dayEndMs);
  const end = formatTime(record.endTime, dayEndMs);
  const title = record.title ?? copy.untitled;

  return (
    <li
      className="data-destination-detail-popover-item"
      aria-label={copy.recordAria(start, end, title, formatDuration(record.duration))}
    >
      <span className="data-destination-detail-popover-copy">
        <strong>{title}</strong>
        {record.secondaryText ? (
          <span>{record.secondaryText}</span>
        ) : null}
      </span>
      <span className="data-destination-detail-popover-time">
        <span className="data-destination-detail-popover-duration">
          {formatDuration(record.duration)}
        </span>
        <time>{start}–{end}</time>
      </span>
    </li>
  );
}

function ActivitySummary({
  activity,
  dayEndMs,
  mode,
  objectName,
  disclosure,
  expanded = false,
  popoverId,
  onToggleDetails,
}: {
  activity: DataDestinationDetailActivity;
  dayEndMs: number;
  mode: "app" | "web";
  objectName: string;
  disclosure: boolean;
  expanded?: boolean;
  popoverId?: string;
  onToggleDetails?: (anchor: HTMLButtonElement) => void;
}) {
  const copy = getDataDestinationDetailCopy();
  const start = formatTime(activity.startTime, dayEndMs);
  const end = formatTime(activity.endTime, dayEndMs);
  const activityCount = activity.activityCount ?? activity.records.length;
  const titleCount = activity.records.filter((record) => Boolean(record.title)).length;

  return (
    <div
      className="data-destination-detail-activity-summary"
      aria-label={copy.activityAria(
        start,
        end,
        objectName,
        formatDuration(activity.duration),
        activity.records.length,
      )}
    >
      <time>{start}–{end}</time>
      <span className="data-destination-detail-record-copy">
        <strong>{objectName}</strong>
        {mode === "app" ? (
          <span className="data-destination-detail-record-meta">
            <span>
              {UI_TEXT.history.activitySegmentCount(activityCount)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {UI_TEXT.history.titleRowCount(titleCount)}
            </span>
          </span>
        ) : titleCount > 0 ? (
          <span className="data-destination-detail-record-meta">
            {UI_TEXT.history.titleRowCount(titleCount)}
          </span>
        ) : null}
        {disclosure && onToggleDetails ? (
          <button
            type="button"
            className="qp-button-secondary qp-compact-disclosure data-destination-detail-activity-disclosure"
            aria-expanded={expanded}
            aria-controls={expanded ? popoverId : undefined}
            aria-label={copy.toggleTitleDetails(expanded, objectName)}
            onClick={(event) => onToggleDetails(event.currentTarget)}
          >
            {expanded ? (
              <ChevronDown size={11} aria-hidden="true" />
            ) : (
              <ChevronRight size={11} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </span>
      {activity.current ? (
        <span className="data-destination-detail-current">
          {copy.current}
        </span>
      ) : null}
      <span className="data-destination-detail-record-duration">
        {formatDuration(activity.duration)}
      </span>
    </div>
  );
}

function ActivityRecord({
  activity,
  dayEndMs,
  mode,
  objectName,
  expanded,
  popoverId,
  onToggleDetails,
}: {
  activity: DataDestinationDetailActivity;
  dayEndMs: number;
  mode: "app" | "web";
  objectName: string;
  expanded: boolean;
  popoverId: string;
  onToggleDetails: (
    activity: DataDestinationDetailActivity,
    anchor: HTMLButtonElement,
  ) => void;
}) {
  const hasDetails = activity.records.length > 1
    || activity.records.some((record) => Boolean(
      record.title || record.secondaryText,
    ));

  return (
    <li className="qp-workbench-list-card data-destination-detail-activity">
      <ActivitySummary
        activity={activity}
        dayEndMs={dayEndMs}
        mode={mode}
        objectName={objectName}
        disclosure={hasDetails}
        expanded={expanded}
        popoverId={popoverId}
        onToggleDetails={(anchor) => onToggleDetails(activity, anchor)}
      />
    </li>
  );
}

export default function DataDestinationDetailRecords({
  day,
  minimumDurationMs,
  mode,
  objectName,
  viewport,
}: Props) {
  const copy = getDataDestinationDetailCopy();
  const popoverId = useId();
  const [openDetails, setOpenDetails] = useState<OpenActivityDetails | null>(
    null,
  );
  const activitiesInViewport = clipDataDestinationDetailActivitiesToViewport(
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
      <div className="data-destination-detail-empty" role="status">
        {activitiesInViewport.length === 0
          ? day.activities.length === 0
            ? copy.noActivity
            : copy.noActivityInWindow
          : copy.noActivityAtMinimum(Math.round(minimumDurationMs / 60_000))}
      </div>
    );
  }

  const toggleDetails = (
    activity: DataDestinationDetailActivity,
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
      <ol className="data-destination-detail-records">
        {visibleActivities.map((activity) => (
          <ActivityRecord
            key={activity.id}
            activity={activity}
            dayEndMs={day.dayEndMs}
            mode={mode}
            objectName={objectName}
            expanded={openDetails?.activity.id === activity.id}
            popoverId={popoverId}
            onToggleDetails={toggleDetails}
          />
        ))}
      </ol>
      <QuietAnchoredPopover
        open={Boolean(openDetails)}
        anchor={openDetails?.anchor ?? null}
        id={popoverId}
        ariaLabel={copy.titleDetails}
        onClose={() => setOpenDetails(null)}
        className="data-destination-detail-record-popover"
      >
        <div className="data-destination-detail-popover-title">
          {copy.titleDetails}
        </div>
        <ol className="data-destination-detail-popover-list">
          {openDetails?.activity.records.map((record) => (
            <ActivityDetailItem
              key={record.id}
              dayEndMs={day.dayEndMs}
              record={record}
            />
          ))}
        </ol>
      </QuietAnchoredPopover>
    </>
  );
}
