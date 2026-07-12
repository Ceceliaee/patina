import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import QuietDateRangePicker, {
  type QuietDateRangePickerSelection,
} from "../../../shared/components/QuietDateRangePicker.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietRangeControl from "../../../shared/components/QuietRangeControl.tsx";
import type { QuietToastTone } from "../../../shared/components/QuietToast.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { formatLocalDateKey, startOfLocalDay } from "../../../shared/lib/localDate.ts";
import {
  SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT,
  SETTINGS_DATA_EXPORT_FIELD_KEYS,
} from "../services/settingsDataExportFields.ts";
import {
  buildExportRangeSelection,
  EXPORT_RANGE_MODES,
  EXPORT_RANGE_PICKER_MODES,
  resolveExportRangeSelection,
  type ExportFormat,
  type ExportRangeMode,
  type ExportRangePickerMode,
  type ExportRangeSelection,
  type ResolvedExportTimeRange,
} from "../services/settingsDataExportRange.ts";
import {
  exportData,
  pickExportSaveFile,
} from "../services/settingsDataExportService.ts";
import {
  readExportFormat,
  readExportFields,
  readExportRangeMode,
  rememberExportFormat,
  rememberExportFields,
  rememberExportRangeMode,
} from "../services/settingsDataExportPreferences.ts";
import SettingsDataExportFieldConfigDialog from "./SettingsDataExportFieldConfigDialog.tsx";

interface Props {
  open: boolean;
  onClose: () => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
}

function getFormatOptions(): Array<{ value: ExportFormat; label: string; hint: string }> {
  return [
    { value: "csv", label: UI_TEXT.export.formatCSV, hint: UI_TEXT.export.formatCSVHint },
    { value: "markdown", label: UI_TEXT.export.formatMarkdown, hint: UI_TEXT.export.formatMarkdownHint },
    { value: "parquet", label: UI_TEXT.export.formatParquet, hint: UI_TEXT.export.formatParquetHint },
    { value: "sqlite", label: UI_TEXT.export.formatSQLite, hint: UI_TEXT.export.formatSQLiteHint },
  ];
}

const FORMAT_EXTENSION: Record<ExportFormat, string> = {
  csv: "csv",
  sqlite: "sqlite",
  parquet: "parquet",
  markdown: "md",
};

function replacePathExtension(path: string, format: ExportFormat): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  const extension = FORMAT_EXTENSION[format];
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const directory = slashIndex >= 0 ? trimmed.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
  if (!fileName) return trimmed;
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return `${directory}${stem}.${extension}`;
}

function isExportRangeMode(value: string): value is ExportRangeMode {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

function getPickerLabels() {
  return {
    title: UI_TEXT.data.rangePickerTitle,
    modeLabels: {
      custom: UI_TEXT.data.pickerModes.custom,
      day: UI_TEXT.export.timeRangeModeDay,
      week: UI_TEXT.data.pickerModes.week,
      month: UI_TEXT.data.pickerModes.month,
      year: UI_TEXT.data.pickerModes.year,
    },
    pickStartDate: UI_TEXT.data.pickStartDate,
    pickEndDate: UI_TEXT.data.pickEndDate,
    pickDate: UI_TEXT.data.pickDate,
    shortRangeHint: UI_TEXT.data.shortRangeHint,
    cancel: UI_TEXT.common.cancel,
    apply: UI_TEXT.data.applyRange,
    previousMonth: UI_TEXT.accessibility.data.previousPickerMonth,
    nextMonth: UI_TEXT.accessibility.data.nextPickerMonth,
    yearMonthLabel: UI_TEXT.date.yearMonthLabel,
    weekdaysShort: UI_TEXT.date.weekdaysShort,
  };
}

function getDataStyleRangeLabel(resolved: ResolvedExportTimeRange): string {
  if (resolved.selection.kind === "custom") {
    return resolved.dayCount > 0 ? UI_TEXT.data.customDayCount(resolved.dayCount) : UI_TEXT.data.pickerModes.custom;
  }
  if (resolved.selection.kind === "week") {
    const weekMatch = /W(\d{2})$/.exec(resolved.label);
    const weekNumber = weekMatch ? Number(weekMatch[1]) : null;
    return weekNumber ? UI_TEXT.data.weekLabel(weekNumber) : resolved.label;
  }
  if (resolved.selection.kind === "month") {
    const month = Number(resolved.startDateKey.slice(5, 7));
    return month ? UI_TEXT.date.monthLabel(month) : resolved.label;
  }
  if (resolved.selection.kind === "year") {
    const year = Number(resolved.startDateKey.slice(0, 4));
    return year ? UI_TEXT.data.yearLabel(year) : resolved.label;
  }
  return resolved.startDateKey || resolved.label;
}

function getClosedRangeLabel(
  resolved: ResolvedExportTimeRange,
  presetLabels: Record<ExportRangeMode, string>,
): string {
  const todayKey = formatLocalDateKey(startOfLocalDay(new Date()));
  if (resolved.selection.kind !== "custom" && resolved.endDateKey === todayKey) {
    return presetLabels[resolved.selection.kind];
  }
  return getDataStyleRangeLabel(resolved);
}

function resolveExportPickerSelection(
  selection: QuietDateRangePickerSelection,
  nowMs?: number,
): ResolvedExportTimeRange {
  const resolved = resolveExportRangeSelection(selection, nowMs);
  return {
    ...resolved,
    label: getDataStyleRangeLabel(resolved),
  };
}

export default function SettingsDataExportDialog({ open, onClose, onToast }: Props) {
  const initialRangeMode = readExportRangeMode();
  const initialFormat = readExportFormat();
  const [rangeMode, setRangeMode] = useState<ExportRangeMode>(initialRangeMode);
  const [rangeSelection, setRangeSelection] = useState<ExportRangeSelection>(() => buildExportRangeSelection(initialRangeMode));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<ExportRangePickerMode>("custom");
  const [pickerLabel, setPickerLabel] = useState(getPickerLabels().modeLabels.custom);
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [exporting, setExporting] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>(() => readExportFields(
    initialFormat,
    SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT[initialFormat],
  ));
  const [showFieldConfig, setShowFieldConfig] = useState(false);
  const rangeAnchorRef = useRef<HTMLButtonElement | null>(null);

  const resolvedTimeRange = useMemo(
    () => resolveExportRangeSelection(rangeSelection),
    [rangeSelection],
  );
  const rangeLabels = {
    day: UI_TEXT.export.timeRangeModeDay,
    week: UI_TEXT.export.timeRangeModeWeek,
    month: UI_TEXT.export.timeRangeModeMonth,
    year: UI_TEXT.export.timeRangeModeYear,
  };
  const rangeLabel = getClosedRangeLabel(resolvedTimeRange, rangeLabels);
  const rangeModeIndex = EXPORT_RANGE_MODES.indexOf(rangeMode);
  const timeRangeErrorMessage = resolvedTimeRange.error === "missingCustomRange"
    ? UI_TEXT.export.timeRangeMissing
    : resolvedTimeRange.error === "invalidCustomRange"
      ? UI_TEXT.export.timeRangeInvalid
      : null;
  const changeFormat = useCallback((nextFormat: ExportFormat) => {
    setFormat(nextFormat);
    rememberExportFormat(nextFormat);
    setSelectedFields(readExportFields(
      nextFormat,
      SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT[nextFormat],
    ));
  }, []);

  const applyRangeSelection = useCallback((selection: QuietDateRangePickerSelection) => {
    setRangeSelection(selection);
    if (isExportRangeMode(selection.kind)) {
      setRangeMode(selection.kind);
      rememberExportRangeMode(selection.kind);
    }
    setPickerOpen(false);
  }, []);

  const shiftRange = useCallback((delta: -1 | 1) => {
    if (pickerOpen) {
      const pickerModeIndex = EXPORT_RANGE_PICKER_MODES.indexOf(pickerMode);
      const nextMode = EXPORT_RANGE_PICKER_MODES[pickerModeIndex + delta];
      if (nextMode) {
        setPickerMode(nextMode);
        setPickerLabel(getPickerLabels().modeLabels[nextMode]);
      }
      return;
    }
    const nextMode = EXPORT_RANGE_MODES[rangeModeIndex + delta];
    if (nextMode) {
      setRangeMode(nextMode);
      rememberExportRangeMode(nextMode);
      setRangeSelection(buildExportRangeSelection(nextMode));
    }
  }, [pickerMode, pickerOpen, rangeModeIndex]);

  const openPicker = useCallback(() => {
    setPickerMode("custom");
    setPickerLabel(getPickerLabels().modeLabels.custom);
    setPickerOpen((current) => !current);
  }, []);

  const handleExport = useCallback(async () => {
    if (selectedFields.length === 0) {
      onToast?.(UI_TEXT.export.configFieldsEmpty, "warning");
      return;
    }
    if (timeRangeErrorMessage) {
      onToast?.(timeRangeErrorMessage, "warning");
      return;
    }
    setExporting(true);
    try {
      const pickedPath = await pickExportSaveFile(
        format,
        resolvedTimeRange.startDateKey,
        resolvedTimeRange.endDateKey,
      );
      if (!pickedPath) return;
      const result = await exportData({
        format,
        outputPath: replacePathExtension(pickedPath, format),
        startTime: resolvedTimeRange.startTime,
        endTime: resolvedTimeRange.endTime,
        selectedFields,
      });
      const message = UI_TEXT.export.exportDone(result.rowCount);
      onToast?.(message, "success");
    } catch (error) {
      const msg = `${UI_TEXT.export.exportFailed}: ${error}`;
      onToast?.(msg, "warning");
    } finally {
      setExporting(false);
    }
  }, [format, onToast, resolvedTimeRange.endTime, resolvedTimeRange.startTime, selectedFields, timeRangeErrorMessage]);

  return (
    <>
      <QuietDialog
        open={open}
        title={UI_TEXT.export.title}
        description={UI_TEXT.export.dialogDescription}
        onClose={showFieldConfig ? () => undefined : onClose}
        closeOnBackdrop={!exporting}
        surfaceClassName="settings-data-export-dialog-surface"
        actions={(
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={exporting}
              className="qp-button-secondary h-8 min-h-0 px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {UI_TEXT.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || selectedFields.length === 0 || Boolean(timeRangeErrorMessage)}
              className="qp-button-primary h-8 min-h-0 px-3 text-xs font-semibold leading-none disabled:opacity-50 inline-flex items-center gap-1.5"
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
          </>
        )}
      >
        <div className="settings-data-export-dialog-body">
          <section className="settings-data-export-section settings-data-export-range-section">
            <div className="settings-data-export-section-header">
              <div className="min-w-0">
                <p className="settings-data-export-section-title">{UI_TEXT.export.timeRangeLabel}</p>
                <p className="settings-data-export-section-hint">{resolvedTimeRange.startDateKey} - {resolvedTimeRange.endDateKey}</p>
              </div>
              <QuietRangeControl
                ref={rangeAnchorRef}
                className="settings-data-export-range-control"
                labelClassName="settings-data-export-range-label"
                ariaLabel={UI_TEXT.export.timeRangeLabel}
                label={pickerOpen ? pickerLabel : rangeLabel}
                labelAriaLabel={UI_TEXT.export.openRangePicker}
                previousAriaLabel={pickerOpen ? UI_TEXT.export.previousPickerMode : UI_TEXT.export.previousRange}
                nextAriaLabel={pickerOpen ? UI_TEXT.export.nextPickerMode : UI_TEXT.export.nextRange}
                previousDisabled={pickerOpen
                  ? EXPORT_RANGE_PICKER_MODES.indexOf(pickerMode) === 0
                  : rangeModeIndex === 0}
                nextDisabled={pickerOpen
                  ? EXPORT_RANGE_PICKER_MODES.indexOf(pickerMode) === EXPORT_RANGE_PICKER_MODES.length - 1
                  : rangeModeIndex === EXPORT_RANGE_MODES.length - 1}
                expanded={pickerOpen}
                onPrevious={() => shiftRange(-1)}
                onNext={() => shiftRange(1)}
                onLabelClick={openPicker}
              />
            </div>
            {timeRangeErrorMessage ? <p className="settings-data-export-result settings-data-export-result-danger">{timeRangeErrorMessage}</p> : null}
          </section>

          <section className="settings-data-export-section settings-data-export-format-section">
            <div className="settings-data-export-section-header">
              <div className="min-w-0">
                <p className="settings-data-export-section-title">{UI_TEXT.export.formatLabel}</p>
              </div>
            </div>
            <div className="settings-data-export-format-grid" role="radiogroup" aria-label={UI_TEXT.export.formatLabel}>
              {getFormatOptions().map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={format === option.value}
                  disabled={exporting}
                  className={`settings-data-export-format-option ${format === option.value ? "settings-data-export-format-option-selected" : ""}`}
                  onClick={() => changeFormat(option.value)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-data-export-section">
            <div className="settings-data-export-section-header">
              <div className="min-w-0">
                <p className="settings-data-export-section-title">{UI_TEXT.export.configFields}</p>
                <p className={`settings-data-export-section-hint ${selectedFields.length === 0 ? "text-[var(--qp-danger)]" : ""}`}>
                  {UI_TEXT.export.configFieldsCount(selectedFields.length, SETTINGS_DATA_EXPORT_FIELD_KEYS.length)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFieldConfig(true)}
                disabled={exporting}
                className="qp-button-secondary h-8 min-h-0 px-3 text-xs font-semibold leading-none inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {UI_TEXT.export.configFields}
              </button>
            </div>
            {selectedFields.length === 0 ? <p className="settings-data-export-result settings-data-export-result-danger">{UI_TEXT.export.configFieldsEmpty}</p> : null}
          </section>

        </div>
      </QuietDialog>

      {pickerOpen && rangeAnchorRef.current ? (
        <QuietDateRangePicker
          anchor={rangeAnchorRef.current}
          mode={pickerMode}
          labels={getPickerLabels()}
          resolveSelection={resolveExportPickerSelection}
          onDraftLabelChange={setPickerLabel}
          onClose={() => setPickerOpen(false)}
          onApply={applyRangeSelection}
        />
      ) : null}

      <SettingsDataExportFieldConfigDialog
        open={showFieldConfig}
        selectedFields={selectedFields}
        defaultFields={SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT[format]}
        uiText={UI_TEXT}
        onClose={() => setShowFieldConfig(false)}
        onConfirm={(fields) => {
          setSelectedFields(fields);
          rememberExportFields(format, fields);
          setShowFieldConfig(false);
        }}
      />
    </>
  );
}
