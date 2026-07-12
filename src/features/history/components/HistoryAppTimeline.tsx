import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AppWindow, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight, FolderOpen, Lock, Unlock } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type {
  HistoryAppTimelineAppItem,
  HistoryAppTimelineSegment,
  HistoryAppTimelineViewModel,
} from "../services/historyAppTimelineViewModel";
import {
  findClosestScreenshotIndex as findClosestShotIndex,
  getScreenshotData,
  groupScreenshotsByApp,
  revealScreenshotInFolder,
  sliceContextScreenshots,
} from "../services/historyScreenshots.ts";
import type { ScreenshotEntry } from "../services/historyScreenshots.ts";
import HistoryAppTimelineRow from "./HistoryAppTimelineRow.tsx";

function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

interface Props {
  viewModel: HistoryAppTimelineViewModel;
  icons: Record<string, string>;
  screenshots: ScreenshotEntry[];
  onSegmentClick?: (segment: HistoryAppTimelineSegment, appItem: HistoryAppTimelineAppItem) => void;
  onZoomChange?: (zoomLevel: number, viewportStartRatio: number) => void;
}

export default function HistoryAppTimeline({
  viewModel,
  icons,
  screenshots,
  onSegmentClick,
  onZoomChange,
}: Props) {
  const copy = UI_TEXT.history;
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedAppKey, setExpandedAppKey] = useState<string | null>(null);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState<number>(-1);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [screenshotData, setScreenshotData] = useState<string | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<{
    appKey: string;
    time: number;
  } | null>(null);
  const [failedThumbnailIds, setFailedThumbnailIds] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const axisInnerRef = useRef<HTMLDivElement>(null);

  const zoomLevel = viewModel.zoomLevel;
  const dayDuration = viewModel.dayEndMs - viewModel.dayStartMs;
  const viewportDuration = viewModel.viewportEndMs - viewModel.viewportStartMs;
  const viewportStartRatio = (viewModel.viewportStartMs - viewModel.dayStartMs) / dayDuration;

  const sortedScreenshots = useMemo(() => {
    return [...screenshots].sort((a, b) => a.capturedAt - b.capturedAt);
  }, [screenshots]);

  const filteredAppItems = useMemo(() => {
    if (!searchQuery.trim()) return viewModel.appItems;
    const query = searchQuery.toLowerCase();
    return viewModel.appItems.filter(
      (app) =>
        app.appName.toLowerCase().includes(query) ||
        app.exeName.toLowerCase().includes(query) ||
        app.categoryLabel.toLowerCase().includes(query),
    );
  }, [searchQuery, viewModel.appItems]);

  const screenshotsByApp = useMemo(() => {
    return groupScreenshotsByApp(viewModel.appItems, sortedScreenshots);
  }, [viewModel.appItems, sortedScreenshots]);

  const loadScreenshot = useCallback(async (index: number) => {
    if (index < 0 || index >= sortedScreenshots.length) return;
    setViewerLoading(true);
    setScreenshotData(null);
    try {
      const data = await getScreenshotData(sortedScreenshots[index].id);
      setScreenshotData(data);
    } catch {
      setScreenshotData(null);
    } finally {
      setViewerLoading(false);
    }
  }, [sortedScreenshots]);

  const openScreenshotViewer = useCallback((index: number) => {
    if (index < 0 || index >= sortedScreenshots.length) return;
    setSelectedScreenshotIndex(index);
    loadScreenshot(index);
  }, [sortedScreenshots.length, loadScreenshot]);

  const closeScreenshotViewer = useCallback(() => {
    setSelectedScreenshotIndex(-1);
    setScreenshotData(null);
  }, []);

  const goToPrevScreenshot = useCallback(() => {
    if (selectedScreenshotIndex <= 0) return;
    const newIndex = selectedScreenshotIndex - 1;
    setSelectedScreenshotIndex(newIndex);
    loadScreenshot(newIndex);
  }, [selectedScreenshotIndex, loadScreenshot]);

  const goToNextScreenshot = useCallback(() => {
    if (selectedScreenshotIndex >= sortedScreenshots.length - 1) return;
    const newIndex = selectedScreenshotIndex + 1;
    setSelectedScreenshotIndex(newIndex);
    loadScreenshot(newIndex);
  }, [selectedScreenshotIndex, sortedScreenshots.length, loadScreenshot]);

  const handleRevealInFolder = useCallback(async () => {
    if (selectedScreenshotIndex < 0 || selectedScreenshotIndex >= sortedScreenshots.length) return;
    try {
      await revealScreenshotInFolder(sortedScreenshots[selectedScreenshotIndex].id);
    } catch (e) {
      console.error("Failed to reveal screenshot:", e);
    }
  }, [selectedScreenshotIndex, sortedScreenshots]);

  const handleSegmentClick = useCallback(
    async (segment: HistoryAppTimelineSegment, appItem: HistoryAppTimelineAppItem, e?: React.MouseEvent) => {
      onSegmentClick?.(segment, appItem);
      
      const isCtrlClick = e?.ctrlKey || e?.metaKey;
      const segmentMidTime = segment.startTime + segment.duration / 2;
      const closestIdx = findClosestShotIndex(sortedScreenshots, segmentMidTime);
      
      if (isCtrlClick && closestIdx >= 0) {
        openScreenshotViewer(closestIdx);
      } else if (!isCtrlClick) {
        setSelectedSegment({ appKey: appItem.exeName, time: segmentMidTime });
      }
    },
    [onSegmentClick, sortedScreenshots, openScreenshotViewer],
  );

  const handleSegmentDoubleClick = useCallback(
    (segment: HistoryAppTimelineSegment, appItem: HistoryAppTimelineAppItem) => {
      const segmentMidTime = segment.startTime + segment.duration / 2;
      const appScreenshots = screenshotsByApp[appItem.exeName] ?? [];
      if (appScreenshots.length === 0) return;

      setSelectedSegment({ appKey: appItem.exeName, time: segmentMidTime });
      
      const isSameAppAndExpanded = expandedAppKey === appItem.exeName;
      if (isSameAppAndExpanded) {
        setExpandedAppKey(null);
        setSelectedSegment(null);
      } else {
        setExpandedAppKey(appItem.exeName);
      }
    },
    [expandedAppKey, screenshotsByApp],
  );

  const toggleScrollLock = useCallback(() => {
    setScrollLocked((prev) => !prev);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();

      const listEl = listRef.current;
      if (!listEl) return;

      const rect = listEl.getBoundingClientRect();
      const pointerRatio = (e.clientX - rect.left) / rect.width;
      const pointerTimeRatio = viewportStartRatio + pointerRatio * (viewportDuration / dayDuration);

      const delta = e.deltaY > 0 ? -1 : 1;
      const newZoom = Math.min(6, Math.max(1, zoomLevel + delta));

      if (newZoom === zoomLevel) return;

      const newViewportDuration = dayDuration / Math.pow(2, newZoom - 1);
      const maxStartRatio = 1 - newViewportDuration / dayDuration;
      let newStartRatio = pointerTimeRatio - pointerRatio * (newViewportDuration / dayDuration);
      newStartRatio = Math.max(0, Math.min(maxStartRatio, newStartRatio));

      onZoomChange?.(newZoom, newStartRatio);
    },
    [zoomLevel, viewportStartRatio, viewportDuration, dayDuration, onZoomChange],
  );

  const handleListWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        handleWheel(e);
        return;
      }
      if (scrollLocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [scrollLocked, handleWheel],
  );

  const handleViewScreenshot = useCallback((screenshot: ScreenshotEntry) => {
    const idx = sortedScreenshots.findIndex((s) => s.id === screenshot.id);
    if (idx >= 0) {
      openScreenshotViewer(idx);
    }
  }, [sortedScreenshots, openScreenshotViewer]);

  const handleThumbnailError = useCallback((id: number) => {
    setFailedThumbnailIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((exeName: string, hasScreenshots: boolean) => {
    if (!hasScreenshots) return;
    setExpandedAppKey((current) => (current === exeName ? null : exeName));
  }, []);

  const handleHorizontalScroll = useCallback(
    (e: React.WheelEvent) => {
      if (e.altKey) return;
      if (zoomLevel <= 1) return;
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;

      e.preventDefault();
      const scrollAmount = e.deltaX;
      const viewportRatio = viewportDuration / dayDuration;
      const maxStartRatio = 1 - viewportRatio;
      let newStartRatio = viewportStartRatio + (scrollAmount / 800) * viewportRatio * 0.1;
      newStartRatio = Math.max(0, Math.min(maxStartRatio, newStartRatio));

      onZoomChange?.(zoomLevel, newStartRatio);
    },
    [zoomLevel, viewportStartRatio, viewportDuration, dayDuration, onZoomChange],
  );

  const handleViewerWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      
      const step = Math.max(1, Math.round(Math.abs(e.deltaY) / 50));
      if (e.deltaY > 0) {
        for (let i = 0; i < step; i++) {
          if (selectedScreenshotIndex < sortedScreenshots.length - 1) {
            const newIndex = selectedScreenshotIndex + 1 + i;
            if (newIndex < sortedScreenshots.length) {
              setSelectedScreenshotIndex(newIndex);
              loadScreenshot(newIndex);
            }
          }
        }
      } else {
        for (let i = 0; i < step; i++) {
          if (selectedScreenshotIndex > 0) {
            const newIndex = selectedScreenshotIndex - 1 - i;
            if (newIndex >= 0) {
              setSelectedScreenshotIndex(newIndex);
              loadScreenshot(newIndex);
            }
          }
        }
      }
    },
    [selectedScreenshotIndex, sortedScreenshots.length, loadScreenshot],
  );

  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(6, zoomLevel + 1);
    if (newZoom === zoomLevel) return;
    const centerRatio = viewportStartRatio + (viewportDuration / dayDuration) * 0.5;
    const newViewportDuration = dayDuration / Math.pow(2, newZoom - 1);
    const maxStartRatio = 1 - newViewportDuration / dayDuration;
    let newStartRatio = centerRatio - 0.5 * (newViewportDuration / dayDuration);
    newStartRatio = Math.max(0, Math.min(maxStartRatio, newStartRatio));
    onZoomChange?.(newZoom, newStartRatio);
  }, [zoomLevel, viewportStartRatio, viewportDuration, dayDuration, onZoomChange]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(1, zoomLevel - 1);
    if (newZoom === zoomLevel) return;
    const centerRatio = viewportStartRatio + (viewportDuration / dayDuration) * 0.5;
    const newViewportDuration = dayDuration / Math.pow(2, newZoom - 1);
    const maxStartRatio = 1 - newViewportDuration / dayDuration;
    let newStartRatio = centerRatio - 0.5 * (newViewportDuration / dayDuration);
    newStartRatio = Math.max(0, Math.min(maxStartRatio, newStartRatio));
    onZoomChange?.(newZoom, newStartRatio);
  }, [zoomLevel, viewportStartRatio, viewportDuration, dayDuration, onZoomChange]);

  const handleResetZoom = useCallback(() => {
    onZoomChange?.(1, 0);
  }, [onZoomChange]);

  useEffect(() => {
    if (selectedScreenshotIndex < 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrevScreenshot();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNextScreenshot();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeScreenshotViewer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedScreenshotIndex, goToPrevScreenshot, goToNextScreenshot, closeScreenshotViewer]);

  const currentScreenshot = selectedScreenshotIndex >= 0 ? sortedScreenshots[selectedScreenshotIndex] : null;
  const hasPrev = selectedScreenshotIndex > 0;
  const hasNext = selectedScreenshotIndex < sortedScreenshots.length - 1;

  return (
    <div className="history-app-timeline">
      <div className="history-app-timeline-header">
        <div className="history-app-timeline-header-title">
          <AppWindow size={14} className="history-app-timeline-header-title-icon" />
          <span className="history-app-timeline-header-title-text">
            {copy.appDistribution}
          </span>
          <span className="history-app-timeline-header-count">
            {filteredAppItems.length} apps
          </span>
        </div>
        <div className="history-app-timeline-header-right">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={UI_TEXT.data.appSearchPlaceholder}
            className="qp-input h-7 px-2 text-xs history-app-timeline-search"
          />
          <div className="history-app-timeline-zoom-controls">
            <button
              type="button"
              className="qp-icon-button h-7 w-7"
              onClick={handleZoomOut}
              disabled={zoomLevel <= 1}
              title="缩小"
            >
              <ZoomOut size={14} />
            </button>
            <span className="history-app-timeline-zoom-level">{zoomLevel}x</span>
            <button
              type="button"
              className="qp-icon-button h-7 w-7"
              onClick={handleZoomIn}
              disabled={zoomLevel >= 6}
              title="放大"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              className="qp-icon-button h-7 w-7"
              onClick={handleResetZoom}
              title="重置"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="history-app-timeline-hint">
        <span>按住 Alt 键并滚动鼠标滚轮可放大/缩小时间轴 · Ctrl+点击色块查看截图</span>
        <button
          type="button"
          className="history-app-timeline-scroll-lock-btn"
          onClick={toggleScrollLock}
          title={scrollLocked ? "解锁垂直滚动" : "锁定垂直滚动"}
        >
          {scrollLocked ? <Lock size={12} /> : <Unlock size={12} />}
          <span>{scrollLocked ? "已锁定" : "未锁定"}</span>
        </button>
      </div>

      <div
        className="history-app-timeline-viewport"
        onWheel={(e) => {
          if (e.altKey) {
            handleWheel(e);
          } else if (zoomLevel > 1 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            handleHorizontalScroll(e);
          }
        }}
      >
        <div
          ref={axisInnerRef}
          className="history-app-timeline-axis"
          aria-hidden="true"
        >
          <div className="history-app-timeline-axis-inner">
            {viewModel.axisTicks.map((tick) => (
              <div
                key={tick.label + tick.ratio}
                className="history-app-timeline-axis-tick"
                style={{ left: `${tick.ratio * 100}%` }}
              >
                <div className="history-app-timeline-axis-tick-line" />
                <span className="history-app-timeline-axis-tick-label">{tick.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          ref={listRef}
          className={`history-app-timeline-list ${scrollLocked ? "is-scroll-locked" : ""}`}
          onWheel={handleListWheel}
        >
          {filteredAppItems.length > 0 ? (
            filteredAppItems.map((appItem, index) => {
              const appScreenshots = screenshotsByApp[appItem.exeName] ?? [];
              const selectedTime = selectedSegment?.appKey === appItem.exeName ? selectedSegment.time : null;
              const contextShots = sliceContextScreenshots(appScreenshots, selectedTime);
              const isExpanded = expandedAppKey === appItem.exeName;
              const hasScreenshots = appScreenshots.length > 0;

              return (
                <div key={appItem.exeName}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpand(appItem.exeName, hasScreenshots)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && hasScreenshots) {
                        e.preventDefault();
                        toggleExpand(appItem.exeName, hasScreenshots);
                      }
                    }}
                    className={hasScreenshots ? "cursor-pointer" : ""}
                  >
                    <HistoryAppTimelineRow
                      appItem={appItem}
                      dayStartMs={viewModel.viewportStartMs}
                      dayEndMs={viewModel.viewportEndMs}
                      iconSrc={icons[appItem.exeName]}
                      index={index}
                      onSegmentClick={(seg, app, e) => handleSegmentClick(seg, app, e)}
                      onSegmentDoubleClick={(seg, app) => handleSegmentDoubleClick(seg, app)}
                      expandable={hasScreenshots}
                      isExpanded={isExpanded}
                    />
                  </div>
                  {isExpanded && hasScreenshots && (
                    <div className="history-app-timeline-screenshots">
                      <div className="history-app-timeline-screenshots-header">
                        <span className="history-app-timeline-screenshots-label">
                          {selectedSegment && selectedSegment.appKey === appItem.exeName
                            ? `当前选择: ${formatDateTime(selectedSegment.time)}`
                            : `共 ${appScreenshots.length} 张截图`}
                        </span>
                        {selectedSegment && selectedSegment.appKey === appItem.exeName && (
                          <button
                            type="button"
                            className="qp-button h-6 px-2 text-[10px]"
                            onClick={() => setSelectedSegment(null)}
                          >
                            显示全部
                          </button>
                        )}
                      </div>
                      <div className="history-app-timeline-screenshots-strip">
                        {contextShots.map((s) => {
                          const isCenter = selectedSegment && selectedSegment.appKey === appItem.exeName
                            ? Math.abs(s.capturedAt - selectedSegment.time) === Math.min(
                                ...contextShots.map(shot => Math.abs(shot.capturedAt - selectedSegment.time))
                              )
                            : false;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`history-app-timeline-screenshot-thumb ${isCenter ? "is-center" : ""} ${failedThumbnailIds.has(s.id) ? "is-error" : ""}`}
                              onClick={() => handleViewScreenshot(s)}
                              title={formatDateTime(s.capturedAt)}
                            >
                              <img
                                src={`data:image/webp;base64,${s.thumbnailBase64}`}
                                alt={`Screenshot at ${formatDateTime(s.capturedAt)}`}
                                style={{ aspectRatio: `${s.width}/${s.height}` }}
                                onError={() => handleThumbnailError(s.id)}
                              />
                              <div className="history-app-timeline-screenshot-thumb-time">
                                {new Date(s.capturedAt).toLocaleTimeString()}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="history-app-timeline-empty-state">
              <span>
                {searchQuery.trim() ? (copy.noData ?? "暂无数据") : (copy.emptyDay ?? "暂无数据")}
              </span>
            </div>
          )}
        </div>
      </div>

      {currentScreenshot && (
        <div
          className="history-app-timeline-screenshot-modal-overlay"
          onClick={closeScreenshotViewer}
          onWheel={handleViewerWheel}
        >
          <div
            className="history-app-timeline-screenshot-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="history-app-timeline-screenshot-modal-header">
              <div className="history-app-timeline-screenshot-modal-title">
                {formatDateTime(currentScreenshot.capturedAt)}
                <span className="history-app-timeline-screenshot-modal-counter">
                  {selectedScreenshotIndex + 1} / {sortedScreenshots.length}
                </span>
              </div>
              <div className="history-app-timeline-screenshot-modal-actions">
                <button
                  type="button"
                  className="qp-icon-button h-7 w-7"
                  onClick={handleRevealInFolder}
                  title="在文件夹中显示"
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  type="button"
                  className="qp-icon-button h-7 w-7"
                  onClick={closeScreenshotViewer}
                  title="关闭"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="history-app-timeline-screenshot-modal-body">
              <button
                type="button"
                className={`history-app-timeline-screenshot-nav history-app-timeline-screenshot-nav-left ${!hasPrev ? "is-disabled" : ""}`}
                onClick={goToPrevScreenshot}
                disabled={!hasPrev}
                title="上一张 (←)"
              >
                <ChevronLeft size={32} />
              </button>
              {viewerLoading && (
                <div className="text-[12px] text-[var(--qp-text-tertiary)] p-4">加载中...</div>
              )}
              {screenshotData && (
                <img
                  src={`data:image/webp;base64,${screenshotData}`}
                  alt="Screenshot full view"
                  className="history-app-timeline-screenshot-modal-image"
                />
              )}
              <button
                type="button"
                className={`history-app-timeline-screenshot-nav history-app-timeline-screenshot-nav-right ${!hasNext ? "is-disabled" : ""}`}
                onClick={goToNextScreenshot}
                disabled={!hasNext}
                title="下一张 (→)"
              >
                <ChevronRight size={32} />
              </button>
            </div>
            <div className="history-app-timeline-screenshot-modal-footer">
              <div className="history-app-timeline-screenshot-toolbar">
                <button
                  type="button"
                  className="qp-button h-7 px-3 text-xs history-app-timeline-screenshot-toolbar-btn"
                  onClick={goToPrevScreenshot}
                  disabled={!hasPrev}
                >
                  <ChevronLeft size={14} />
                  上一张
                </button>
                <button
                  type="button"
                  className="qp-button h-7 px-3 text-xs history-app-timeline-screenshot-toolbar-btn"
                  onClick={goToNextScreenshot}
                  disabled={!hasNext}
                >
                  下一张
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="qp-button h-7 px-3 text-xs history-app-timeline-screenshot-toolbar-btn"
                  onClick={handleRevealInFolder}
                >
                  <FolderOpen size={14} />
                  打开文件位置
                </button>
              </div>
              <div className="history-app-timeline-screenshot-footer-hint">
                ← / → 切换 · Ctrl+滚轮 快速浏览 · Esc 关闭
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
