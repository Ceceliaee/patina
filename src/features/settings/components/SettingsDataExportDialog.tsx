import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import { CalendarClock, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QuietDateRangePicker, {
  type QuietDateRangePickerSelection, } from "../../../shared/components/QuietDateRangePicker.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietRangeControl from "../../../shared/components/QuietRangeControl.tsx";
import type { QuietToastTone } from "../../../shared/types/toast.ts";

import { formatLocalDateKey, startOfLocalDay } from "../../../shared/lib/localDate.ts";
import {
  SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT,
  SETTINGS_DATA_EXPORT_FIELD_KEYS,
  isSettingsDataExportField,
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
import type { ScheduledExportSnapshot } from "../services/scheduledExportService.ts";
import {
  readExportFormat,
  readExportFields,
  readExportRangeMode,
  rememberExportFormat,
  rememberExportFields,
  rememberExportRangeMode,
} from "../services/settingsDataExportPreferences.ts";
import SettingsDataExportFieldConfigDialog from "./SettingsDataExportFieldConfigDialog.tsx";

type ScheduledExportDialogComponent = typeof import("./SettingsScheduledExportDialog.tsx")["default"];

interface Props {
  open: boolean;
  onClose: () => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
}

function getFormatOptions(text: UiText): Array<{ value: ExportFormat; label: string; hint: string }> {
  return [
    { value: "csv", label: text.export.formatCSV, hint: text.export.formatCSVHint },
    { value: "markdown", label: text.export.formatMarkdown, hint: text.export.formatMarkdownHint },
    { value: "parquet", label: text.export.formatParquet, hint: text.export.formatParquetHint },
    { value: "sqlite", label: text.export.formatSQLite, hint: text.export.formatSQLiteHint },
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

function getPickerLabels(text: UiText) {
  return {
    title: text.data.rangePickerTitle,
    modeLabels: {
      custom: text.data.pickerModes.custom,
      day: text.export.timeRangeModeDay,
      week: text.data.pickerModes.week,
      month: text.data.pickerModes.month,
      year: text.data.pickerModes.year,
    },
    pickStartDate: text.data.pickStartDate,
    pickEndDate: text.data.pickEndDate,
    pickDate: text.data.pickDate,
    shortRangeHint: text.data.shortRangeHint,
    cancel: text.common.cancel,
    apply: text.data.applyRange,
    previousMonth: text.accessibility.data.previousPickerMonth,
    nextMonth: text.accessibility.data.nextPickerMonth,
    yearMonthLabel: text.date.yearMonthLabel,
    weekdaysShort: text.date.weekdaysShort,
  };
}

function getDataStyleRangeLabel(resolved: ResolvedExportTimeRange, text: UiText): string {
  if (resolved.selection.kind === "custom") {
    return resolved.dayCount > 0 ? text.data.customDayCount(resolved.dayCount) : text.data.pickerModes.custom;
  }
  if (resolved.selection.kind === "week") {
    const weekMatch = /W(\d{2})$/.exec(resolved.label);
    const weekNumber = weekMatch ? Number(weekMatch[1]) : null;
    return weekNumber ? text.data.weekLabel(weekNumber) : resolved.label;
  }
  if (resolved.selection.kind === "month") {
    const month = Number(resolved.startDateKey.slice(5, 7));
    return month ? text.date.monthLabel(month) : resolved.label;
  }
  if (resolved.selection.kind === "year") {
    const year = Number(resolved.startDateKey.slice(0, 4));
    return year ? text.data.yearLabel(year) : resolved.label;
  }
  return resolved.startDateKey || resolved.label;
}

function getClosedRangeLabel(
  resolved: ResolvedExportTimeRange,
  presetLabels: Record<ExportRangeMode, string>,
  text: UiText,
): string {
  const todayKey = formatLocalDateKey(startOfLocalDay(new Date()));
  if (resolved.selection.kind !== "custom" && resolved.endDateKey === todayKey) {
    return presetLabels[resolved.selection.kind];
  }
  return getDataStyleRangeLabel(resolved, text);
}

function resolveExportPickerSelection(
  selection: QuietDateRangePickerSelection,
  text: UiText,
  nowMs?: number,
): ResolvedExportTimeRange {
  const resolved = resolveExportRangeSelection(selection, nowMs);
  return {
    ...resolved,
    label: getDataStyleRangeLabel(resolved, text),
  };
}

export default function SettingsDataExportDialog({ open, onClose, onToast }: Props) {
  const UI_TEXT = useLocaleText();
  const initialRangeMode = readExportRangeMode();
  const initialFormat = readExportFormat();
  const [rangeMode, setRangeMode] = useState<ExportRangeMode>(initialRangeMode);
  const [rangeSelection, setRangeSelection] = useState<ExportRangeSelection>(() => buildExportRangeSelection(initialRangeMode));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<ExportRangePickerMode>("custom");
  const [pickerLabel, setPickerLabel] = useState(() => getPickerLabels(UI_TEXT).modeLabels.custom);
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [exporting, setExporting] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>(() => readExportFields(
    initialFormat,
    SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT[initialFormat],
  ));
  const [showFieldConfig, setShowFieldConfig] = useState(false);
  const [scheduledExportOpen, setScheduledExportOpen] = useState(false);
  const [scheduledExportOpening, setScheduledExportOpening] = useState(false);
  const [scheduledExportSnapshot, setScheduledExportSnapshot] = useState<ScheduledExportSnapshot | null>(null);
  const [ScheduledExportDialog, setScheduledExportDialog] = useState<ScheduledExportDialogComponent | null>(null);
  const rangeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const scheduledExportAnchorRef = useRef<HTMLSpanElement | null>(null);
  const scheduledExportFields = useMemo(
    () => selectedFields.filter(isSettingsDataExportField),
    [selectedFields],
  );

  useEffect(() => {
    if (!open) {
      setScheduledExportOpen(false);
      setScheduledExportSnapshot(null);
      setScheduledExportDialog(null);
    }
  }, [open]);

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
  const rangeLabel = getClosedRangeLabel(resolvedTimeRange, rangeLabels, UI_TEXT);
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
        setPickerLabel(getPickerLabels(UI_TEXT).modeLabels[nextMode]);
      }
      return;
    }
    const nextMode = EXPORT_RANGE_MODES[rangeModeIndex + delta];
    if (nextMode) {
      setRangeMode(nextMode);
      rememberExportRangeMode(nextMode);
      setRangeSelection(buildExportRangeSelection(nextMode));
    }
  }, [pickerMode, pickerOpen, rangeModeIndex, UI_TEXT]);

  const openPicker = useCallback(() => {
    setPickerMode("custom");
    setPickerLabel(getPickerLabels(UI_TEXT).modeLabels.custom);
    setPickerOpen((current) => !current);
  }, [UI_TEXT]);

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
      onToast?.(msg, "error");
    } finally {
      setExporting(false);
    }
  }, [
    format,
    onToast,
    resolvedTimeRange.endDateKey,
    resolvedTimeRange.endTime,
    resolvedTimeRange.startDateKey,
    resolvedTimeRange.startTime,
    selectedFields,
    timeRangeErrorMessage,
    UI_TEXT,
  ]);

  const openScheduledExport = useCallback(async () => {
    if (selectedFields.length === 0) {
      onToast?.(UI_TEXT.export.configFieldsEmpty, "warning");
      return;
    }
    setScheduledExportOpening(true);
    try {
      const dialogModule = await import("./SettingsScheduledExportDialog.tsx");
      const next = await dialogModule.loadScheduledExportSnapshot();
      setScheduledExportDialog(() => dialogModule.default);
      setScheduledExportSnapshot(next);
      setScheduledExportOpen(true);
    } catch (error) {
      console.error("scheduled export snapshot load failed", error);
      onToast?.(UI_TEXT.settings.loadFailed, "error");
    } finally {
      setScheduledExportOpening(false);
    }
  }, [onToast, selectedFields.length, UI_TEXT.export.configFieldsEmpty, UI_TEXT.settings.loadFailed]);

  const closeScheduledExport = useCallback(() => {
    setScheduledExportOpen(false);
    window.requestAnimationFrame(() => {
      scheduledExportAnchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
  }, []);

  return (
    <>
      <QuietDialog
        open={open}
        title={UI_TEXT.export.title}
        description={UI_TEXT.export.dialogDescription}
        onClose={showFieldConfig || scheduledExportOpen ? () => undefined : onClose}
        closeOnBackdrop={!exporting}
        surfaceClassName="settings-data-export-dialog-surface"
        headerAside={(
          <span ref={scheduledExportAnchorRef} className="inline-flex">
            <QuietIconAction
              icon={<CalendarClock size={16} aria-hidden="true" />}
              title={UI_TEXT.export.scheduledTitle}
              ariaLabel={UI_TEXT.export.scheduledTitle}
              disabled={exporting || scheduledExportOpening || selectedFields.length === 0}
              onClick={() => void openScheduledExport()}
            />
          </span>
        )}
        actions={(
          <>
            <QuietButton
              size="large"
              onClick={onClose}
              disabled={exporting}
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void handleExport()}
              disabled={exporting || selectedFields.length === 0 || Boolean(timeRangeErrorMessage)}
              busy={exporting}
            >
              {exporting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {UI_TEXT.export.exporting}
                </>
              ) : (
                UI_TEXT.export.exportAction
              )}
            </QuietButton>
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
              {getFormatOptions(UI_TEXT).map((option) => (
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
              <QuietButton
                size="large"
                onClick={() => setShowFieldConfig(true)}
                disabled={exporting}
              >
                {UI_TEXT.export.configFields}
              </QuietButton>
            </div>
            {selectedFields.length === 0 ? <p className="settings-data-export-result settings-data-export-result-danger">{UI_TEXT.export.configFieldsEmpty}</p> : null}
          </section>

        </div>
      </QuietDialog>

      {pickerOpen && rangeAnchorRef.current ? (
        <QuietDateRangePicker
          anchor={rangeAnchorRef.current}
          mode={pickerMode}
          labels={getPickerLabels(UI_TEXT)}
          resolveSelection={(selection, nowMs) => resolveExportPickerSelection(selection, UI_TEXT, nowMs)}
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

      {scheduledExportSnapshot && ScheduledExportDialog ? (
        <ScheduledExportDialog
          open={open && scheduledExportOpen}
          initialSnapshot={scheduledExportSnapshot}
          currentFormat={format}
          currentFields={scheduledExportFields}
          onClose={closeScheduledExport}
        />
      ) : null}
    </>
  );
}
