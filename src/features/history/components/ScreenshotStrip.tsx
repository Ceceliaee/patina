import { Camera, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  queryScreenshots,
  getScreenshotData,
} from "../services/historyScreenshots.ts";
import type { ScreenshotEntry } from "../services/historyScreenshots.ts";

interface Props {
  date: Date;
}

export default function ScreenshotStrip({ date }: Props) {
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [viewerData, setViewerData] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    queryScreenshots(start.getTime(), end.getTime())
      .then(setScreenshots)
      .catch(() => setScreenshots([]))
      .finally(() => setLoading(false));
  }, [date, expanded]);

  const handleView = useCallback(async (id: number) => {
    setViewerId(id);
    setViewerData(null);
    try {
      const data = await getScreenshotData(id);
      setViewerData(data);
    } catch {
      setViewerId(null);
    }
  }, []);

  const currentIndex = viewerId != null
    ? screenshots.findIndex((s) => s.id === viewerId)
    : -1;

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      handleView(screenshots[currentIndex - 1].id);
    }
  }, [currentIndex, screenshots, handleView]);

  const handleNext = useCallback(() => {
    if (currentIndex < screenshots.length - 1) {
      handleView(screenshots[currentIndex + 1].id);
    }
  }, [currentIndex, screenshots, handleView]);

  if (!expanded) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)] transition-colors"
        onClick={() => setExpanded(true)}
        title="View screenshots for this day"
      >
        <Camera size={13} />
        Screenshots
      </button>
    );
  }

  return (
    <div className="border-t border-[var(--qp-border)] mt-2 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-wider flex items-center gap-1.5">
          <Camera size={12} />
          Screenshots
          {screenshots.length > 0 && (
            <span className="font-normal">({screenshots.length})</span>
          )}
        </span>
        <button
          type="button"
          className="text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)]"
          onClick={() => { setExpanded(false); setViewerId(null); setViewerData(null); }}
        >
          <X size={13} />
        </button>
      </div>

      {loading && (
        <div className="text-[10px] text-[var(--qp-text-tertiary)] py-2">Loading...</div>
      )}

      {!loading && screenshots.length === 0 && (
        <div className="text-[10px] text-[var(--qp-text-tertiary)] py-2 italic">
          No screenshots for this day. Enable in Settings → Tracking.
        </div>
      )}

      {!loading && screenshots.length > 0 && (
        <>
          {/* Thumbnails strip */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {screenshots.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`shrink-0 rounded overflow-hidden border-2 transition-colors ${
                  viewerId === s.id
                    ? "border-[var(--qp-accent)]"
                    : "border-transparent hover:border-[var(--qp-border)]"
                }`}
                onClick={() => handleView(s.id)}
                title={new Date(s.capturedAt).toLocaleTimeString()}
              >
                <img
                  src={`data:image/webp;base64,${s.thumbnailBase64}`}
                  alt={`Screenshot at ${new Date(s.capturedAt).toLocaleTimeString()}`}
                  className="block"
                  style={{ width: "120px", height: "auto", aspectRatio: `${s.width}/${s.height}` }}
                />
              </button>
            ))}
          </div>

          {/* Full image viewer */}
          {viewerData && (
            <div className="relative mt-2 rounded overflow-hidden border border-[var(--qp-border)] bg-black/5">
              <img
                src={`data:image/webp;base64,${viewerData}`}
                alt="Screenshot full view"
                className="w-full h-auto max-h-[50vh] object-contain"
              />
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2">
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-black/50 text-white text-[10px] hover:bg-black/70 disabled:opacity-30"
                  disabled={currentIndex <= 0}
                  onClick={handlePrev}
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[10px] text-white bg-black/50 px-2 py-0.5 rounded">
                  {currentIndex + 1} / {screenshots.length}
                  {" · "}
                  {screenshots[currentIndex] && new Date(screenshots[currentIndex].capturedAt).toLocaleTimeString()}
                </span>
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-black/50 text-white text-[10px] hover:bg-black/70 disabled:opacity-30"
                  disabled={currentIndex >= screenshots.length - 1}
                  onClick={handleNext}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
