import { useLocaleText } from "../../../shared/i18n/index.ts";
import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import QuietRangeControl from "../../../shared/components/QuietRangeControl.tsx";

import {
  DATA_TREND_PICKER_MODES,
  DEFAULT_DATA_TREND_RANGE_SELECTION,
  getAdjacentDataTrendRangeSelection,
  resolveDataTrendRange,
  type DataTrendPickerMode,
  type DataTrendRangeSelection,
} from "../services/dataTrendRange.ts";
import DataTrendRangePicker from "./DataTrendRangePicker.tsx";

interface Props {
  allTimeEndDateKey: string;
  allTimeStartDateKey: string;
  ariaLabel: string;
  selection: DataTrendRangeSelection;
  displayLabel?: string;
  displaySelection?: DataTrendRangeSelection;
  onChange: (selection: DataTrendRangeSelection) => void;
}

export default function DataTrendRangeControl({
  allTimeEndDateKey,
  allTimeStartDateKey,
  ariaLabel,
  selection,
  displayLabel,
  displaySelection = selection,
  onChange,
}: Props) {
  const UI_TEXT = useLocaleText();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<DataTrendPickerMode>("custom");
  const [pickerLabel, setPickerLabel] = useState(UI_TEXT.data.pickerModes.custom);
  const isSpecial = selection.kind !== "all" && selection.kind !== "rolling";
  const nowMs = Date.now();
  const label = displayLabel ?? resolveDataTrendRange(displaySelection, nowMs, UI_TEXT).label;
  const pickerModeIndex = DATA_TREND_PICKER_MODES.indexOf(pickerMode);

  const adjacent = (delta: -1 | 1) => getAdjacentDataTrendRangeSelection(
    selection, delta, nowMs, UI_TEXT, allTimeStartDateKey, allTimeEndDateKey,
  );
  const previousSelection = open ? null : adjacent(-1);
  const nextSelection = open ? null : adjacent(1);
  const selectAdjacent = (delta: number) => {
    if (open) {
      const mode = DATA_TREND_PICKER_MODES[pickerModeIndex + delta];
      if (mode) setPickerMode(mode);
    } else {
      const next = delta < 0 ? previousSelection : nextSelection;
      if (next) onChange(next);
    }
  };

  return (
    <>
      <div className="data-trend-period-control">
        {isSpecial ? (
          <button
            type="button"
            className="qp-control data-trend-range-reset"
            aria-label={UI_TEXT.accessibility.data.resetTrendRange}
            onClick={() => {
              setOpen(false);
              onChange(DEFAULT_DATA_TREND_RANGE_SELECTION);
              requestAnimationFrame(() => anchorRef.current?.focus());
            }}
          >
            <RotateCcw size={14} aria-hidden />
          </button>
        ) : null}
        <QuietRangeControl
          ref={anchorRef}
          className="data-trend-range-control"
          labelClassName="data-trend-range-label data-trend-range-trigger"
          ariaLabel={ariaLabel}
          label={open ? pickerLabel : label}
          labelAriaLabel={UI_TEXT.accessibility.data.openTrendRangePicker}
          previousAriaLabel={open
            ? UI_TEXT.accessibility.data.previousPickerMode
            : isSpecial ? UI_TEXT.accessibility.data.earlierRange : UI_TEXT.accessibility.data.shorterTrendRange}
          nextAriaLabel={open
            ? UI_TEXT.accessibility.data.nextPickerMode
            : isSpecial ? UI_TEXT.accessibility.data.newerRange : UI_TEXT.accessibility.data.longerTrendRange}
          previousDisabled={open ? pickerModeIndex === 0 : !previousSelection}
          nextDisabled={open ? pickerModeIndex === DATA_TREND_PICKER_MODES.length - 1 : !nextSelection}
          expanded={open}
          onPrevious={() => selectAdjacent(-1)}
          onNext={() => selectAdjacent(1)}
          onLabelClick={() => {
            setPickerMode("custom");
            setPickerLabel(UI_TEXT.data.pickerModes.custom);
            setOpen((current) => !current);
          }}
        />
      </div>
      {open && anchorRef.current ? (
        <DataTrendRangePicker
          anchor={anchorRef.current}
          mode={pickerMode}
          onDraftLabelChange={setPickerLabel}
          onClose={() => setOpen(false)}
          onApply={(nextSelection) => {
            onChange(nextSelection);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
