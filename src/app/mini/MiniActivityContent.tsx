import { useState, type SyntheticEvent } from "react";
import HourlyActivityChart from "../../shared/charts/HourlyActivityChart.tsx";
import { ANONYMOUS_ACTIVITY_BACKGROUND } from "../../shared/charts/AnonymousActivityPattern.tsx";
import QuietChartTooltip, { type QuietChartTooltipItem } from "../../shared/components/QuietChartTooltip.tsx";
import { QuietTimelineTrack } from "../../shared/components/QuietTimelineTrack.tsx";
import { useLocaleText } from "../../shared/i18n/index.ts";
import type { TrackerHealthSnapshot } from "../../shared/types/tracking.ts";
import type { MiniActivityPage } from "../../platform/desktop/miniActivityRuntimeGateway.ts";
import { formatMiniActivityDuration } from "./miniActivityViewModel.ts";
import { useMiniActivity } from "./useMiniActivity.ts";

function clockLabel(value: number) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function rangeLabel(start: number, end: number, sampledAt: number) {
  const showDate = new Date(start).toDateString() !== new Date(end).toDateString()
    || new Date(start).toDateString() !== new Date(sampledAt).toDateString();
  const label = (value: number) => {
    const date = new Date(value);
    return `${showDate ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ` : ""}${clockLabel(value)}`;
  };
  return `${label(start)}–${label(end)}`;
}

export default function MiniActivityContent({ page, health }: { page: MiniActivityPage; health: TrackerHealthSnapshot }) {
  const text = useLocaleText();
  const { view, failed, retry } = useMiniActivity(page, health);
  const [tip, setTip] = useState<{ scope: string; kind: "category" | "categories" | "segment"; key: string; anchor: HTMLButtonElement } | null>(null);
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
  if (!view) return <div className="mini-content mini-empty" role={failed ? "alert" : "status"}>
    {failed ? <><span>{text.miniWindow.failed}</span><button className="qp-button qp-button-secondary" onClick={retry}>{text.common.retry}</button></> : text.common.loading}
  </div>;
  const scope = `${view.kind}:${view.mode}:${new Date(view.sampledAtMs).toDateString()}`;
  const categoryItems = view.kind === "today" ? view.categories.map(category => ({
    key: category.key, name: category.name, color: category.color,
    value: `${formatMiniActivityDuration(category.duration)} · ${Math.round(category.duration / view.total * 100)}%`,
  })) : [];
  const details: Record<string, { label?: string; items: QuietChartTooltipItem[] }> = {};
  const detailProps = (kind: "category" | "segment", key: string, label: string | undefined, items: QuietChartTooltipItem[]) => {
    details[`${kind}:${key}`] = { label, items };
    const open = (event: SyntheticEvent<HTMLButtonElement>) => setTip({ scope, kind, key, anchor: event.currentTarget });
    return {
    "aria-label": [label, ...items.map(item => `${item.name} ${item.value}`)].filter(Boolean).join(" · "),
    onMouseEnter: open,
    onFocus: open,
    onBlur: () => setTip(null),
    onClick: open,
    };
  };
  // Resolve from this snapshot, so a refresh keeps the open detail without stale names.
  const currentDetail = () => tip?.scope !== scope ? null : tip.kind === "categories"
    ? { label: text.dashboard.focusShare, items: categoryItems } : details[`${tip.kind}:${tip.key}`];
  return <div className="mini-content mini-activity-content" data-mini-page={view.kind}
    data-display-mode={view.mode} onKeyDown={event => {
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.target instanceof Element
        && event.target.matches('.mini-category-segment')) {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.mini-category-segment'));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        event.preventDefault(); event.stopPropagation();
      }
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
    <div className="mini-summary"><span className="mini-duration">{formatMiniActivityDuration(view.total)}</span></div>
    {view.kind === "today" ? <>
      <div className="mini-hourly-chart" onFocus={() => setTip(null)}>
        <HourlyActivityChart mode={view.mode} hourlyActivity={view.hourly.points} hourlyCategoryActivity={view.hourly}
          margin={{ top: 5, left: 0, right: 0, bottom: 0 }} padding={{ left: 10, right: 10 }} compactTooltip showXAxis={false} />
      </div>
      <div className="mini-category-bar" aria-label={text.dashboard.focusShare}>
        <div className="mini-category-track" aria-hidden="true">
          {view.categories.slice().reverse().map(item => <span key={item.key}
            style={{ width: `${item.duration / view.total * 100}%`, backgroundColor: item.color,
              backgroundImage: item.key === "anonymous" ? ANONYMOUS_ACTIVITY_BACKGROUND : undefined }} />)}
        </div>
        {view.categories.slice().reverse().map(item => <button key={item.key} type="button" className="mini-category-segment"
          style={{ width: `${item.duration / view.total * 100}%` }}
          {...detailProps("category", item.key, undefined, [{ key: item.key, name: item.name,
            value: `${formatMiniActivityDuration(item.duration)} · ${Math.round(item.duration / view.total * 100)}%`, color: item.color }])}
          onClick={event => setTip({ scope, kind: "categories", key: "all", anchor: event.currentTarget })} />)}
      </div>
      {view.total === 0 && <p className="mini-empty-inline">{text.dashboard.emptyState}</p>}
    </> : <>
      <QuietTimelineTrack className="mini-timeline"
        axisTicks={[0, 1].map(ratio => ({ ratio, label: clockLabel(view.timeline.viewportStartMs + ratio * view.timeline.viewportDurationMs) }))}>
        <div className="mini-timeline-paint" aria-hidden="true">
          {view.timeline.segments.map(item => <span key={item.id}
            style={{ left: `${item.startRatio * 100}%`, width: `${Math.max(0, item.widthRatio) * 100}%`,
              backgroundColor: item.color, backgroundImage: item.category === "anonymous" ? ANONYMOUS_ACTIVITY_BACKGROUND : undefined }} />)}
        </div>
        {view.timeline.segments.map(item => <button key={item.id} type="button" className="mini-timeline-segment"
          style={{ left: `${item.startRatio * 100}%`, width: `${Math.max(0, item.widthRatio) * 100}%` }}
          {...detailProps("segment", item.id, item.label, [{ key: item.id, name: rangeLabel(item.startTime, item.endTime, view.sampledAtMs),
            value: formatMiniActivityDuration(item.duration), color: item.color }])} />)}
      </QuietTimelineTrack>
      <ul className="mini-leaders qp-scroll-region" tabIndex={0} aria-label={text.miniWindow.activity} onFocus={() => setTip(null)}>
        {view.leaders.map(item => <li key={item.key} className="mini-leader">
          <span className="mini-category-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <span className="mini-leader-name">{item.label}</span><span className="mini-duration">{formatMiniActivityDuration(item.duration)}</span>
        </li>)}
      </ul>
    </>}
    {currentDetail() && <div ref={positionDetail} className="mini-detail qp-scroll-region"><QuietChartTooltip {...currentDetail()!} /></div>}
  </div>;
}
