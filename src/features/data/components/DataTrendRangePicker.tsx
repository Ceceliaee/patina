import QuietDateRangePicker, {
  type QuietDateRangePickerSelection,
  type QuietResolvedDateRange,
} from "../../../shared/components/QuietDateRangePicker.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  resolveDataTrendRange,
  type DataTrendPickerMode,
  type DataTrendRangeSelection,
} from "../services/dataTrendRange.ts";

interface Props {
  anchor: HTMLElement;
  mode: DataTrendPickerMode;
  onApply: (selection: DataTrendRangeSelection) => void;
  onClose: () => void;
  onDraftLabelChange: (label: string) => void;
}

function resolveDataPickerSelection(
  selection: QuietDateRangePickerSelection,
  nowMs?: number,
): QuietResolvedDateRange {
  const dataSelection: DataTrendRangeSelection = selection.kind === "day"
    ? {
      kind: "custom",
      startDateKey: selection.anchorDateKey,
      endDateKey: selection.anchorDateKey,
    }
    : selection as DataTrendRangeSelection;
  const resolved = resolveDataTrendRange(dataSelection, nowMs);
  return {
    ...resolved,
    selection,
  };
}

function toDataSelection(selection: QuietDateRangePickerSelection): DataTrendRangeSelection {
  if (selection.kind === "day") {
    return {
      kind: "custom",
      startDateKey: selection.anchorDateKey,
      endDateKey: selection.anchorDateKey,
    };
  }
  return selection as DataTrendRangeSelection;
}

export default function DataTrendRangePicker({ anchor, mode, onApply, onClose, onDraftLabelChange }: Props) {
  return (
    <QuietDateRangePicker
      anchor={anchor}
      mode={mode}
      labels={{
        title: UI_TEXT.data.rangePickerTitle,
        modeLabels: {
          custom: UI_TEXT.data.pickerModes.custom,
          day: UI_TEXT.data.pickerModes.custom,
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
      }}
      resolveSelection={resolveDataPickerSelection}
      onDraftLabelChange={onDraftLabelChange}
      onClose={onClose}
      onApply={(selection) => onApply(toDataSelection(selection))}
    />
  );
}
