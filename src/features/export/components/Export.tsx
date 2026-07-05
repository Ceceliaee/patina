import { ArrowDownToLine, FileDown, Loader2, ListOrdered } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import type { QuietToastTone } from "../../../shared/components/QuietToast";
import { UI_TEXT } from "../../../shared/copy/index";
import { exportData, pickExportSaveFile } from "../../../platform/persistence/dataExportGateway";
import ExportFieldConfigDialog from "./ExportFieldConfigDialog";

interface Props {
  onToast?: (message: string, tone?: QuietToastTone) => void;
}

type TimeRangePreset = "today" | "thisWeek" | "thisMonth" | "thisYear" | "custom";
type ExportFormat = "csv" | "sqlite" | "parquet";

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function endOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function getPresetTimeRange(preset: TimeRangePreset): { startTime: number; endTime: number } {
  const now = new Date();
  switch (preset) {
    case "today": {
      return { startTime: startOfDay(now), endTime: endOfDay(now) };
    }
    case "thisWeek": {
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
      return { startTime: startOfDay(monday), endTime: endOfDay(now) };
    }
    case "thisMonth": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startTime: startOfDay(first), endTime: endOfDay(now) };
    }
    case "thisYear": {
      const firstYear = new Date(now.getFullYear(), 0, 1);
      return { startTime: startOfDay(firstYear), endTime: endOfDay(now) };
    }
    default:
      return { startTime: startOfDay(now), endTime: endOfDay(now) };
  }
}

function daysBetween(startMs: number, endMs: number): number {
  return (endMs - startMs) / (1000 * 60 * 60 * 24);
}

function getRecommendation(
  preset: TimeRangePreset,
  customStart: string,
  customEnd: string,
): { format: ExportFormat; label: string } | null {
  if (preset === "today") {
    return { format: "csv", label: UI_TEXT.export.recommendationDaily };
  }
  if (preset === "thisWeek" || preset === "thisMonth") {
    return { format: "sqlite", label: UI_TEXT.export.recommendationMonthly };
  }
  if (preset === "thisYear") {
    return { format: "parquet", label: UI_TEXT.export.recommendationYearly };
  }
  if (preset === "custom" && customStart && customEnd) {
    const days = daysBetween(new Date(customStart).getTime(), new Date(customEnd).getTime());
    if (days < 3) {
      return { format: "csv", label: UI_TEXT.export.recommendationCustomShort };
    }
    if (days >= 365) {
      return { format: "parquet", label: UI_TEXT.export.recommendationCustomLong };
    }
    if (days >= 30) {
      return { format: "sqlite", label: UI_TEXT.export.recommendationCustomMedium };
    }
    return { format: "csv", label: UI_TEXT.export.recommendationCustomShort };
  }
  return null;
}

const FORMAT_INFO: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "csv", label: UI_TEXT.export.formatCSV, hint: UI_TEXT.export.formatCSVHint },
  { format: "sqlite", label: UI_TEXT.export.formatSQLite, hint: UI_TEXT.export.formatSQLiteHint },
  { format: "parquet", label: UI_TEXT.export.formatParquet, hint: UI_TEXT.export.formatParquetHint },
];

export default function Export({ onToast }: Props) {
  const [timePreset, setTimePreset] = useState<TimeRangePreset>("thisMonth");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exportPath, setExportPath] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([
    "record_type",
    "exe_name",
    "app_name",
    "window_title",
    "domain",
    "normalized_domain",
    "url",
    "page_title",
    "start_time",
    "end_time",
    "duration_ms",
  ]);
  const [showFieldConfig, setShowFieldConfig] = useState(false);

  const recommendation = useMemo(
    () => getRecommendation(timePreset, customStart, customEnd),
    [timePreset, customStart, customEnd],
  );

  const handlePresetChange = useCallback((preset: TimeRangePreset) => {
    setTimePreset(preset);
    setExportResult(null);
    if (preset !== "custom") {
      const { startTime, endTime } = getPresetTimeRange(preset);
      setCustomStart(new Date(startTime).toISOString().slice(0, 10));
      setCustomEnd(new Date(endTime).toISOString().slice(0, 10));
    }
  }, []);

  const handlePickPath = useCallback(async () => {
    const path = await pickExportSaveFile(format, exportPath || undefined);
    if (path) {
      setExportPath(path);
      setExportResult(null);
    }
  }, [format, exportPath]);

  const handleExport = useCallback(async () => {
    if (!exportPath) return;
    setExporting(true);
    setExportResult(null);
    try {
      const startDate = customStart ? new Date(customStart) : null;
      const endDate = customEnd ? new Date(customEnd) : null;
      const result = await exportData({
        format,
        outputPath: exportPath,
        startTime: startDate ? startDate.getTime() : null,
        endTime: endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999).getTime() : null,
        selectedFields,
      });
      const message = `${UI_TEXT.export.exportDone(result.rowCount)}`;
      setExportResult({ ok: true, message });
      onToast?.(message, "success");
    } catch (error) {
      const msg = `${UI_TEXT.export.exportFailed}: ${error}`;
      setExportResult({ ok: false, message: msg });
      onToast?.(msg, "warning");
    } finally {
      setExporting(false);
    }
  }, [exportPath, format, customStart, customEnd, onToast, selectedFields]);

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 md:gap-5">
      <QuietPageHeader
        icon={<ArrowDownToLine size={18} />}
        title={UI_TEXT.export.title}
        subtitle={UI_TEXT.export.subtitle}
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <div className="grid grid-cols-1 gap-4 md:gap-5">

          {/* Time Range */}
          <div className="qp-panel rounded-[12px] p-4 md:p-5">
            <p className="text-sm font-semibold text-[var(--qp-text-primary)] mb-3">
              {UI_TEXT.export.timeRangeLabel}
            </p>
            <div className="flex flex-wrap gap-2">
              {(["today", "thisWeek", "thisMonth", "thisYear", "custom"] as TimeRangePreset[]).map(
                (preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePresetChange(preset)}
                    disabled={exporting}
                    className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      timePreset === preset
                        ? "bg-[var(--qp-accent)] text-white"
                        : "bg-[var(--qp-bg-elevated)] text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)]"
                    }`}
                  >
                    {UI_TEXT.export[`timeRangePreset${preset.charAt(0).toUpperCase() + preset.slice(1)}` as keyof typeof UI_TEXT.export] as string}
                  </button>
                ),
              )}
            </div>
            {timePreset === "custom" && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--qp-text-tertiary)]">{UI_TEXT.export.timeRangeCustomStart}</span>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => { setCustomStart(e.target.value); setExportResult(null); }}
                    disabled={exporting}
                    className="qp-input rounded-[8px] px-2 py-1 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--qp-text-tertiary)]">{UI_TEXT.export.timeRangeCustomEnd}</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => { setCustomEnd(e.target.value); setExportResult(null); }}
                    disabled={exporting}
                    className="qp-input rounded-[8px] px-2 py-1 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Format Selection */}
          <div className="qp-panel rounded-[12px] p-4 md:p-5">
            <p className="text-sm font-semibold text-[var(--qp-text-primary)] mb-3">
              {UI_TEXT.export.formatLabel}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {FORMAT_INFO.map(({ format: fmt, label, hint }) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => { setFormat(fmt); setExportResult(null); }}
                  disabled={exporting}
                  className={`block w-full border rounded-[10px] p-3 text-left transition-colors disabled:opacity-50 ${
                    format === fmt
                      ? "border-[var(--qp-accent)] bg-[var(--qp-accent)]/5"
                      : "border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] hover:border-[var(--qp-border-strong)]"
                  }`}
                >
                  <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Recommendation */}
          {recommendation && (
            <div className="qp-panel rounded-[12px] p-4 md:p-5 border border-[var(--qp-accent)]/20 bg-[var(--qp-accent)]/5">
              <p className="text-xs font-semibold text-[var(--qp-accent)] uppercase tracking-[0.06em] mb-1">
                {UI_TEXT.export.recommendationTitle}
              </p>
              <p className="text-sm text-[var(--qp-text-secondary)]">{recommendation.label}</p>
            </div>
          )}

          {/* Fields config */}
          <div className="qp-panel rounded-[12px] p-4 md:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                  {UI_TEXT.export.configFields}
                </p>
                <p className="text-xs text-[var(--qp-text-tertiary)] mt-0.5">
                  {UI_TEXT.export.configFieldsCount(selectedFields.length, 11)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFieldConfig(true)}
                disabled={exporting}
                className="qp-button-secondary rounded-[8px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <ListOrdered size={14} />
                {UI_TEXT.export.configFields}
              </button>
            </div>
          </div>

          {/* Export Action */}
          <div className="qp-panel rounded-[12px] p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileDown size={14} className="text-[var(--qp-text-tertiary)] shrink-0" />
                  <input
                    value={exportPath}
                    onChange={(e) => { setExportPath(e.target.value); setExportResult(null); }}
                    placeholder={UI_TEXT.export.pathPlaceholder}
                    disabled={exporting}
                    className="qp-input flex-1 min-w-0 px-2 py-1.5 text-sm rounded-[8px]"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePickPath()}
                    disabled={exporting}
                    className="qp-button-secondary shrink-0 rounded-[8px] px-3 py-1.5 text-xs font-semibold"
                  >
                    {UI_TEXT.export.browse}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || !exportPath}
                className="qp-button-primary rounded-[8px] px-4 py-1.5 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {exporting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {UI_TEXT.export.exporting}
                  </>
                ) : (
                  UI_TEXT.export.exportAction
                )}
              </button>
            </div>
            {exportResult && (
              <p className={`mt-3 text-sm leading-relaxed ${exportResult.ok ? "text-[var(--qp-success)]" : "text-[var(--qp-danger)]"}`}>
                {exportResult.message}
              </p>
            )}
          </div>

        </div>
      </div>

      <ExportFieldConfigDialog
        open={showFieldConfig}
        selectedFields={selectedFields}
        uiText={UI_TEXT}
        onClose={() => setShowFieldConfig(false)}
        onConfirm={(fields) => {
          setSelectedFields(fields);
          setShowFieldConfig(false);
        }}
      />
    </div>
  );
}
