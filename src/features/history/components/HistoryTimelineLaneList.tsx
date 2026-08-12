import { formatDuration } from "../services/historyFormatting.ts";
import type {
  HistoryTimelineDisplayMode,
  HistoryTimelineLane,
  HistoryTimelineViewModel,
} from "../services/historyTimelineViewModel.ts";
import HistoryHorizontalTimeline from "./HistoryHorizontalTimeline.tsx";

interface Props {
  title: string;
  emptyMessage: string;
  viewModel: HistoryTimelineViewModel;
  mode: HistoryTimelineDisplayMode;
  sourceIcons: Record<string, string>;
  interactionActive: boolean;
}

function resolveLaneIcon(
  lane: HistoryTimelineLane,
  sourceIcons: Record<string, string>,
) {
  for (const key of lane.iconKeys) {
    const iconSrc = sourceIcons[key];
    if (iconSrc) return iconSrc;
  }
  return undefined;
}

export default function HistoryTimelineLaneList({
  title,
  emptyMessage,
  viewModel,
  mode,
  sourceIcons,
  interactionActive,
}: Props) {
  return (
    <section className="history-timeline-lanes" aria-label={title}>
      <h3 className="history-timeline-lanes-title">{title}</h3>
      <div
        className="history-timeline-lanes-scroll qp-scroll-region"
        data-history-timeline-lane-count={viewModel.lanes.length}
      >
        {viewModel.lanes.length === 0 ? (
          <p className="history-timeline-lanes-empty">{emptyMessage}</p>
        ) : (
          <div className="history-timeline-lanes-list" role="list">
            {viewModel.lanes.map((lane) => {
              const iconSrc = resolveLaneIcon(lane, sourceIcons);
              const laneViewModel: HistoryTimelineViewModel = {
                ...viewModel,
                segments: lane.segments,
                lanes: [lane],
                legendItems: [],
              };

              return (
                <div
                  key={lane.key}
                  className="history-timeline-lane-row"
                  role="listitem"
                  aria-label={`${lane.label} ${formatDuration(lane.duration)}`}
                >
                  <div className="history-timeline-lane-identity">
                    {iconSrc ? (
                      <img src={iconSrc} className="history-timeline-lane-icon" alt="" />
                    ) : (
                      <span
                        className="history-timeline-lane-dot"
                        style={{ backgroundColor: lane.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="history-timeline-lane-label">{lane.label}</span>
                  </div>
                  <div className="history-timeline-lane-track">
                    <HistoryHorizontalTimeline
                      viewModel={laneViewModel}
                      mode={mode}
                      title={null}
                      variant="lane"
                      showHeader={false}
                      showAxis={false}
                      showEmptyMessage={false}
                      interactionActive={interactionActive}
                    />
                  </div>
                  <span className="history-timeline-lane-duration">
                    {formatDuration(lane.duration)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
