import { Captions, CaptionsOff, Globe2, ListPlus, ListX, PencilLine, RotateCcw, Trash2 } from "lucide-react";
import type { ObservedWebDomainCandidate } from "../../../shared/types/webActivity.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting.ts";
import QuietBadge from "../../../shared/components/QuietBadge";
import QuietColorField from "../../../shared/components/QuietColorField";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietInlineAction from "../../../shared/components/QuietInlineAction";
import QuietSelect from "../../../shared/components/QuietSelect";
import { UI_TEXT } from "../../../shared/copy/index.ts";

interface WebDomainMappingCardProps {
  candidate: ObservedWebDomainCandidate;
  displayName: string;
  displayColor: string;
  assignedCategory: UserAssignableAppCategory;
  recordingEnabled: boolean;
  titleCaptureEnabled: boolean;
  globalTitleEnabled: boolean;
  isBusy: boolean;
  isEditingName: boolean;
  inputValue: string;
  colorFormat: ColorDisplayFormat;
  categoryOptions: Array<{ value: string; label: string }>;
  onNameDraftChange: (nextValue: string) => void;
  onNameBlur: () => void;
  onNameEditCancel: () => void;
  onStartNameEdit: () => void;
  onColorAssign: (nextColor?: string | null) => void;
  onColorFormatChange: (nextFormat: ColorDisplayFormat) => void;
  onCategoryAssign: (value: string) => void;
  onToggleRecording: () => void;
  onToggleTitleCapture: () => void;
  onDeleteHistory: () => void;
}

export default function WebDomainMappingCard({
  candidate,
  displayName,
  displayColor,
  assignedCategory,
  recordingEnabled,
  titleCaptureEnabled,
  globalTitleEnabled,
  isBusy,
  isEditingName,
  inputValue,
  colorFormat,
  categoryOptions,
  onNameDraftChange,
  onNameBlur,
  onNameEditCancel,
  onStartNameEdit,
  onColorAssign,
  onColorFormatChange,
  onCategoryAssign,
  onToggleRecording,
  onToggleTitleCapture,
  onDeleteHistory,
}: WebDomainMappingCardProps) {
  return (
    <div className="relative rounded-[12px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-[8px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] p-1.5"
            style={{ boxShadow: `0 0 0 2px ${displayColor}22` }}
          >
            {candidate.faviconUrl ? (
              <img src={candidate.faviconUrl} className="h-full w-full object-contain" alt="" />
            ) : (
              <Globe2 size={17} className="text-[var(--qp-text-tertiary)]" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="inline-flex max-w-full items-center gap-1">
              {isEditingName ? (
                <input
                  id={`web-domain-name-${candidate.normalizedDomain}`}
                  value={inputValue}
                  autoFocus
                  disabled={isBusy}
                  onChange={(event) => {
                    onNameDraftChange(event.target.value);
                  }}
                  onBlur={onNameBlur}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                      return;
                    }
                    if (event.key === "Escape") {
                      onNameEditCancel();
                    }
                  }}
                  className="qp-input max-w-[240px] truncate px-2 py-1 text-[15px]"
                />
              ) : (
                <span className="truncate rounded-[8px] px-2 py-1 text-[15px] font-semibold text-[var(--qp-text-primary)]">
                  {displayName}
                </span>
              )}
              <QuietIconAction
                icon={<PencilLine size={13} />}
                title={UI_TEXT.mapping.editWebDomainName}
                disabled={isBusy}
                onClick={onStartNameEdit}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 px-2">
              <QuietBadge>{candidate.normalizedDomain}</QuietBadge>
              {!recordingEnabled && (
                <QuietBadge tone="warning">{UI_TEXT.mapping.noStats}</QuietBadge>
              )}
              {!titleCaptureEnabled && (
                <QuietBadge tone="subtle">{UI_TEXT.mapping.titleNotRecorded}</QuietBadge>
              )}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-2">
          <div className="flex flex-nowrap items-center gap-2">
            <div className="order-2 flex max-w-full flex-wrap items-center gap-2 rounded-[8px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-2 py-1.5">
              <QuietColorField
                color={displayColor}
                format={colorFormat}
                fixedValueSlot
                disabled={isBusy}
                onChange={(nextColor) => onColorAssign(nextColor)}
                onFormatChange={onColorFormatChange}
                title={UI_TEXT.mapping.color}
              />
              <QuietIconAction
                icon={<RotateCcw size={13} />}
                disabled={isBusy}
                className="qp-icon-action-dimmed"
                onClick={() => onColorAssign(null)}
                title={UI_TEXT.mapping.restoreDefaultColor}
              />
            </div>
            <QuietSelect
              value={assignedCategory}
              ariaLabel={UI_TEXT.mapping.categorySelectLabel(displayName)}
              disabled={isBusy}
              className="order-1 min-w-[132px]"
              onChange={(value) => onCategoryAssign(String(value))}
              options={categoryOptions}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <QuietInlineAction
              disabled={isBusy || !globalTitleEnabled}
              onClick={onToggleTitleCapture}
              tone={titleCaptureEnabled ? "neutral" : "accent"}
              title={!globalTitleEnabled
                ? UI_TEXT.mapping.globalTitleDisabled
                : titleCaptureEnabled
                  ? UI_TEXT.mapping.disableTitleCapture
                  : UI_TEXT.mapping.enableTitleCapture}
              leadingIcon={titleCaptureEnabled ? <CaptionsOff size={12} /> : <Captions size={12} />}
            >
              {titleCaptureEnabled ? UI_TEXT.mapping.titleNotRecorded : UI_TEXT.mapping.titleRecorded}
            </QuietInlineAction>
            <QuietInlineAction
              disabled={isBusy}
              onClick={onToggleRecording}
              tone={recordingEnabled ? "warning" : "accent"}
              title={recordingEnabled ? UI_TEXT.mapping.disableWebTracking : UI_TEXT.mapping.enableWebTracking}
              leadingIcon={recordingEnabled ? <ListX size={12} /> : <ListPlus size={12} />}
            >
              {recordingEnabled ? UI_TEXT.mapping.excludeStats : UI_TEXT.mapping.restoreStats}
            </QuietInlineAction>
            <QuietInlineAction
              disabled={isBusy}
              onClick={onDeleteHistory}
              tone="danger"
              title={UI_TEXT.mapping.deleteWebRecords}
              leadingIcon={<Trash2 size={12} />}
            >
              {UI_TEXT.mapping.deleteWebRecords}
            </QuietInlineAction>
          </div>
        </div>
      </div>
    </div>
  );
}
