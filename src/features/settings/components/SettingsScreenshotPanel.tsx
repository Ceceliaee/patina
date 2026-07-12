import { useState, useRef, useEffect } from "react";
import { Camera } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietSegmentedFilter, {
  type QuietSegmentedFilterOption,
} from "../../../shared/components/QuietSegmentedFilter";
import type { ScreenshotSettings } from "../services/screenshotSettingsService.ts";

type IntervalPreset = "1m" | "5m" | "10m" | "custom";
type RetentionPreset = "1d" | "7d" | "custom";

const INTERVAL_PRESET_SECS: Record<Exclude<IntervalPreset, "custom">, number> = {
  "1m": 60,
  "5m": 300,
  "10m": 600,
};

const RETENTION_PRESET_DAYS: Record<Exclude<RetentionPreset, "custom">, number> = {
  "1d": 1,
  "7d": 7,
};

const MIN_INTERVAL_HOURS = 1 / 60;
const MAX_INTERVAL_HOURS = 24;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 90;

const ESTIMATED_BYTES_PER_SHOT = 300 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function secsToHours(totalSecs: number): number {
  return totalSecs / 3600;
}

function hoursToSecs(hours: number): number {
  return Math.round(hours * 3600);
}

const INTERVAL_QUICK_OPTIONS = [1, 2, 3, 6, 12, 24];
const RETENTION_QUICK_OPTIONS = [7, 14, 30, 60, 90];

interface SettingsScreenshotPanelProps {
  settings: ScreenshotSettings;
  onChange: (next: Partial<ScreenshotSettings>) => void;
}

export default function SettingsScreenshotPanel({
  settings,
  onChange,
}: SettingsScreenshotPanelProps) {
  const copy = UI_TEXT.settings;

  const [intervalPreset, setIntervalPreset] = useState<IntervalPreset>(() => {
    const secs = settings.intervalSecs;
    if (secs === INTERVAL_PRESET_SECS["1m"]) return "1m";
    if (secs === INTERVAL_PRESET_SECS["5m"]) return "5m";
    if (secs === INTERVAL_PRESET_SECS["10m"]) return "10m";
    return "custom";
  });

  const [retentionPreset, setRetentionPreset] = useState<RetentionPreset>(() => {
    const days = settings.retentionDays;
    if (days === RETENTION_PRESET_DAYS["1d"]) return "1d";
    if (days === RETENTION_PRESET_DAYS["7d"]) return "7d";
    return "custom";
  });

  const [customHours, setCustomHours] = useState(secsToHours(settings.intervalSecs));
  const [customHoursInput, setCustomHoursInput] = useState(String(secsToHours(settings.intervalSecs)));
  const [customDays, setCustomDays] = useState(settings.retentionDays);
  const [customDaysInput, setCustomDaysInput] = useState(String(settings.retentionDays));

  const hoursInputRef = useRef<HTMLInputElement>(null);
  const daysInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const secs = settings.intervalSecs;
    let preset: IntervalPreset = "custom";
    if (secs === INTERVAL_PRESET_SECS["1m"]) preset = "1m";
    else if (secs === INTERVAL_PRESET_SECS["5m"]) preset = "5m";
    else if (secs === INTERVAL_PRESET_SECS["10m"]) preset = "10m";
    setIntervalPreset(preset);
    const hours = secsToHours(secs);
    setCustomHours(hours);
    setCustomHoursInput(String(hours));
  }, [settings.intervalSecs]);

  useEffect(() => {
    const days = settings.retentionDays;
    let preset: RetentionPreset = "custom";
    if (days === RETENTION_PRESET_DAYS["1d"]) preset = "1d";
    else if (days === RETENTION_PRESET_DAYS["7d"]) preset = "7d";
    setRetentionPreset(preset);
    setCustomDays(days);
    setCustomDaysInput(String(days));
  }, [settings.retentionDays]);

  const estimatedDailyCount = Math.max(1, Math.floor((24 * 60 * 60) / settings.intervalSecs));
  const estimatedDailyBytes = estimatedDailyCount * ESTIMATED_BYTES_PER_SHOT;
  const estimatedSizeLabel = formatBytes(estimatedDailyBytes);

  const intervalOptions: QuietSegmentedFilterOption<IntervalPreset>[] = [
    { value: "1m", label: copy.screenshotIntervalPreset1m },
    { value: "5m", label: copy.screenshotIntervalPreset5m },
    { value: "10m", label: copy.screenshotIntervalPreset10m },
    { value: "custom", label: copy.screenshotIntervalCustom },
  ];

  const retentionOptions: QuietSegmentedFilterOption<RetentionPreset>[] = [
    { value: "1d", label: copy.screenshotRetentionPreset1d },
    { value: "7d", label: copy.screenshotRetentionPreset7d },
    { value: "custom", label: copy.screenshotRetentionCustom },
  ];

  const handleIntervalPresetChange = (preset: IntervalPreset) => {
    setIntervalPreset(preset);
    if (preset !== "custom") {
      onChange({ intervalSecs: INTERVAL_PRESET_SECS[preset] });
    } else {
      const currentHours = secsToHours(settings.intervalSecs);
      const isPresetValue = Object.values(INTERVAL_PRESET_SECS).includes(settings.intervalSecs);
      const targetHours = isPresetValue ? 1 : currentHours;
      setCustomHours(targetHours);
      setCustomHoursInput(String(targetHours));
      onChange({ intervalSecs: hoursToSecs(targetHours) });
    }
  };

  const handleCustomHoursCommit = (raw: string) => {
    let val = parseFloat(raw);
    if (isNaN(val)) val = 1;
    val = Math.max(MIN_INTERVAL_HOURS, Math.min(MAX_INTERVAL_HOURS, val));
    const secs = hoursToSecs(val);
    setCustomHours(val);
    setCustomHoursInput(String(val));
    onChange({ intervalSecs: secs });
  };

  const handleHoursInputBlur = () => {
    handleCustomHoursCommit(customHoursInput);
  };

  const handleHoursInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      hoursInputRef.current?.blur();
    }
  };

  const handleHoursQuickSelect = (hours: number) => {
    setCustomHours(hours);
    setCustomHoursInput(String(hours));
    onChange({ intervalSecs: hoursToSecs(hours) });
  };

  const handleRetentionPresetChange = (preset: RetentionPreset) => {
    setRetentionPreset(preset);
    if (preset !== "custom") {
      onChange({ retentionDays: RETENTION_PRESET_DAYS[preset] });
    } else {
      const currentDays = settings.retentionDays;
      const isPresetValue = Object.values(RETENTION_PRESET_DAYS).includes(currentDays);
      const targetDays = isPresetValue ? 30 : currentDays;
      setCustomDays(targetDays);
      setCustomDaysInput(String(targetDays));
      onChange({ retentionDays: targetDays });
    }
  };

  const handleCustomDaysCommit = (raw: string) => {
    let val = parseInt(raw, 10);
    if (isNaN(val)) val = 1;
    val = Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, val));
    setCustomDays(val);
    setCustomDaysInput(String(val));
    onChange({ retentionDays: val });
  };

  const handleDaysInputBlur = () => {
    handleCustomDaysCommit(customDaysInput);
  };

  const handleDaysInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      daysInputRef.current?.blur();
    }
  };

  const handleDaysQuickSelect = (days: number) => {
    setCustomDays(days);
    setCustomDaysInput(String(days));
    onChange({ retentionDays: days });
  };

  return (
    <section className="qp-panel min-h-[240px] p-5 md:p-6 settings-screenshot-panel">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)]">
        <Camera size={16} className="text-[var(--qp-accent-default)]" />
        <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">
          {copy.screenshotsEnabledLabel}
        </h2>
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">
            {copy.screenshotIntervalLabel}
          </label>
          <p className="mt-2 text-sm text-[var(--qp-text-secondary)] leading-relaxed mb-3">
            {copy.screenshotIntervalHint}
          </p>

          <div className="settings-screenshot-warning mb-3">
            {copy.screenshotStorageWarning(estimatedDailyCount, estimatedSizeLabel)}
          </div>

          <div className="flex items-start gap-4 flex-wrap">
            <QuietSegmentedFilter
              value={intervalPreset}
              options={intervalOptions}
              onChange={handleIntervalPresetChange}
              className="settings-screenshot-segmented"
            />

            {intervalPreset === "custom" && (
              <div className="settings-screenshot-custom-interval">
                <div className="settings-screenshot-custom-row">
                  <span className="settings-screenshot-custom-label">小时</span>
                  <div className="settings-screenshot-input-wrap">
                    <input
                      ref={hoursInputRef}
                      type="number"
                      min={MIN_INTERVAL_HOURS}
                      max={MAX_INTERVAL_HOURS}
                      step="0.5"
                      value={customHoursInput}
                      onChange={(e) => setCustomHoursInput(e.target.value)}
                      onBlur={handleHoursInputBlur}
                      onKeyDown={handleHoursInputKeyDown}
                      className="qp-input h-8 w-20 text-sm settings-screenshot-custom-input"
                    />
                    <span className="settings-screenshot-custom-unit">H</span>
                  </div>
                </div>
                <div className="settings-screenshot-quick-options">
                  <span className="settings-screenshot-quick-label">快速选择:</span>
                  <div className="settings-screenshot-quick-buttons">
                    {INTERVAL_QUICK_OPTIONS.map((h) => (
                      <button
                        key={h}
                        type="button"
                        className={`qp-chip h-6 px-2 text-[10px] ${
                          Math.abs(customHours - h) < 0.01 ? "is-active" : ""
                        }`}
                        onClick={() => handleHoursQuickSelect(h)}
                      >
                        {h}h
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">
            {copy.screenshotRetentionLabel}
          </label>
          <p className="mt-2 text-sm text-[var(--qp-text-secondary)] leading-relaxed mb-3">
            {copy.screenshotRetentionHint}
          </p>

          <div className="flex items-start gap-4 flex-wrap">
            <QuietSegmentedFilter
              value={retentionPreset}
              options={retentionOptions}
              onChange={handleRetentionPresetChange}
              className="settings-screenshot-segmented"
            />

            {retentionPreset === "custom" && (
              <div className="settings-screenshot-custom-retention">
                <div className="settings-screenshot-custom-row">
                  <span className="settings-screenshot-custom-label">天数</span>
                  <div className="settings-screenshot-input-wrap">
                    <input
                      ref={daysInputRef}
                      type="number"
                      min={MIN_RETENTION_DAYS}
                      max={MAX_RETENTION_DAYS}
                      step="1"
                      value={customDaysInput}
                      onChange={(e) => setCustomDaysInput(e.target.value)}
                      onBlur={handleDaysInputBlur}
                      onKeyDown={handleDaysInputKeyDown}
                      className="qp-input h-8 w-20 text-sm settings-screenshot-custom-input"
                    />
                    <span className="settings-screenshot-custom-unit">天</span>
                  </div>
                </div>
                <div className="settings-screenshot-quick-options">
                  <span className="settings-screenshot-quick-label">快速选择:</span>
                  <div className="settings-screenshot-quick-buttons">
                    {RETENTION_QUICK_OPTIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`qp-chip h-6 px-2 text-[10px] ${
                          customDays === d ? "is-active" : ""
                        }`}
                        onClick={() => handleDaysQuickSelect(d)}
                      >
                        {d}天
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
