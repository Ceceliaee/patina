import { useActivityDisplayColor } from "../../shared/hooks/useActivityDisplayColor.ts";
import { useState, type SyntheticEvent } from "react";
import { ANONYMOUS_ACTIVITY_BACKGROUND } from "../../shared/charts/AnonymousActivityPattern.tsx";
import QuietChartTooltip, { type QuietChartTooltipItem } from "../../shared/components/QuietChartTooltip.tsx";
import { QuietTimelineTrack } from "../../shared/components/QuietTimelineTrack.tsx";
import { useLocaleText } from "../../shared/i18n/index.ts";
import type { TrackerHealthSnapshot } from "../../shared/types/tracking.ts";
import { formatMiniActivityDuration } from "./miniActivityViewModel.ts";
import { useMiniActivity } from "./useMiniActivity.ts";
import { formatLocalDateKey } from "../../shared/lib/localDate.ts";

function clockLabel(value: number) {
  return new Date(value).toTimeString().slice(0, 5);
}

function rangeLabel(start: number, end: number, sampledAt: number) {
  const startDay = formatLocalDateKey(new Date(start));
  const endDay = formatLocalDateKey(new Date(end));
  const showDate = startDay !== endDay || startDay !== formatLocalDateKey(new Date(sampledAt));
  const label = (value: number, day: string) => (showDate ? day + " " : "") + clockLabel(value);
  return `${label(start, startDay)}–${label(end, endDay)}`;
}

export default function MiniActivityContent({ health }: { health: TrackerHealthSnapshot }) {
  const displayColor = useActivityDisplayColor();
  const text = useLocaleText();
  const { view, today, failed, retry } = useMiniActivity(health);
  const [tip, setTip] = useState<{ scope: string; key: string; anchor: HTMLButtonElement } | null>(null);
  const positionDetail = (detail: HTMLDivElement | null) => {
    if (!detail) return;
    const container = detail.parentElement!.getBoundingClientRect();
    const anchor = tip!.anchor.getBoundingClientRect();
    const { width, height } = detail.getBoundingClientRect();
    const left = anchor.left - container.left + (anchor.width - width) / 2;
    const above = anchor.top - container.top - height - 6;
    const top = above >= 8 ? above : anchor.bottom - container.top + 6;
    detail.style.left = `${Math.max(12, Math.min(left, container.width - width - 12))}px`;
    detail.style.top = `${Math.max(8, Math.min(top, container.height - height - 8))}px`;
  };
  if (!view || !today || view.kind !== "activity") return <div className="mini-content mini-empty" role={failed ? "alert" : "status"}>
    {failed ? <><span>{text.miniWindow.failed}</span><button className="qp-button qp-button-secondary" onClick={retry}>{text.common.retry}</button></> : text.common.loading}
  </div>;
  const scope = `${view.kind}:${view.mode}:${new Date(view.sampledAtMs).toDateString()}`;
  const details: Record<string, { label?: string; items: QuietChartTooltipItem[] }> = {};
  const detailProps = (key: string, label: string | undefined, items: QuietChartTooltipItem[]) => {
    details[key] = { label, items };
    const open = (event: SyntheticEvent<HTMLButtonElement>) => setTip({ scope, key, anchor: event.currentTarget });
    return {
    "aria-label": [label, ...items.map(item => `${item.name} ${item.value}`)].filter(Boolean).join(" · "),
    onMouseEnter: open,
    onFocus: open,
    onBlur: () => setTip(null),
    onClick: open,
    };
  };
  // Resolve from this snapshot, so a refresh keeps the open detail without stale names.
  const currentDetail = () => tip?.scope === scope ? details[tip.key] : null;
  const dailyDuration = formatMiniActivityDuration(today.total);
  const segmentBounds = (item: { startRatio: number; widthRatio: number }) => ({
    left: `${item.startRatio * 100}%`, width: `${Math.max(0, item.widthRatio) * 100}%`,
  });
  return <div className="mini-content mini-activity-content" data-mini-page={view.kind}
    data-display-mode={view.mode} onKeyDown={event => {
      if (event.key === "Escape" && currentDetail()) { event.preventDefault(); event.stopPropagation(); setTip(null); }
      if (currentDetail() && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.currentTarget.querySelector('.mini-detail')?.scrollBy({ top: event.key === "ArrowDown" ? 32 : -32 });
        event.preventDefault(); event.stopPropagation();
      }
    }} onPointerMove={event => {
      if (!tip || event.pointerType !== "mouse") return;
      // A new trigger opens its own detail; the previous anchor must not dismiss it.
      if (event.target instanceof Element && event.target.closest("button,.mini-detail")) return;
      const detail = event.currentTarget.querySelector(".mini-detail");
      const anchor = tip.anchor.getBoundingClientRect();
      const bounds = detail?.getBoundingClientRect();
      // Keep the short gap traversable when moving from the trigger into its detail.
      if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right
        && ((event.clientY >= bounds.bottom && event.clientY <= anchor.top)
          || (event.clientY >= anchor.bottom && event.clientY <= bounds.top))) return;
      setTip(null);
    }} onPointerLeave={event => {
      if (event.pointerType === "mouse") setTip(null);
    }} onPointerDown={event => {
      if (!(event.target instanceof Element) || !event.target.closest("button,.mini-detail")) setTip(null);
    }}>
    <div className="mini-summary mini-daily-summary">
      <div className="mini-daily-total"><span className="mini-duration" aria-label={`${text.date.today} ${text.dashboard.total} ${dailyDuration}`}>{dailyDuration}</span></div>
      <span className="mini-daily-range">{today.period ? `${clockLabel(today.period.startMs)}–${clockLabel(today.period.endMs)}` : "—"}</span>
    </div>
      <QuietTimelineTrack className="mini-timeline"
        axisTicks={[0, 1].map(ratio => ({ ratio, label: clockLabel(view.timeline.viewportStartMs + ratio * view.timeline.viewportDurationMs) }))}>
        <div className="mini-timeline-paint" aria-hidden="true">
          {view.timeline.segments.map(item => <span key={item.id}
            style={{ ...segmentBounds(item),
              backgroundColor: displayColor(item.color, "canvasTrack"), backgroundImage: item.category === "anonymous" ? ANONYMOUS_ACTIVITY_BACKGROUND : undefined }} />)}
        </div>
        {view.timeline.segments.map(item => <button key={item.id} type="button" className="mini-timeline-segment"
          style={segmentBounds(item)}
          {...detailProps(item.id, item.label, [{ key: item.id, name: rangeLabel(item.startTime, item.endTime, view.sampledAtMs),
            value: formatMiniActivityDuration(item.duration), color: item.color }])} />)}
      </QuietTimelineTrack>
      <ul className="mini-leaders" aria-label={text.miniWindow.recentHour}>
        {view.leaders.slice(0, 3).map(item => <li key={item.key} className="mini-leader">
          <span className="mini-category-dot" style={{ backgroundColor: displayColor(item.color, "canvas") }} aria-hidden="true" />
          <span className="mini-leader-name">{item.label}</span><span className="mini-duration">{formatMiniActivityDuration(item.duration)}</span>
        </li>)}
      </ul>
    {currentDetail() && <div ref={positionDetail} className="mini-detail qp-scroll-region"><QuietChartTooltip {...currentDetail()!} /></div>}
  </div>;
}
