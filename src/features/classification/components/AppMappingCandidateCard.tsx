import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { ObservedAppCandidate } from "../types";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting";
import QuietSelect from "../../../shared/components/QuietSelect";
import QuietColorField from "../../../shared/components/QuietColorField";
import QuietInlineAction from "../../../shared/components/QuietInlineAction";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietBadge from "../../../shared/components/QuietBadge";
import { UI_TEXT } from "../../../shared/copy/index.ts";

interface AppMappingCandidateCardProps {
  candidate: ObservedAppCandidate;
  icon?: string;
  displayName: string;
  displayColor: string;
  assignedCategory: UserAssignableAppCategory;
  trackingEnabled: boolean;
  titleCaptureEnabled: boolean;
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
  onToggleTitleCapture: () => void;
  onToggleTracking: () => void;
  onDeleteAllSessions: () => void;
}

export default function AppMappingCandidateCard({
  candidate,
  icon,
  displayName,
  displayColor,
  assignedCategory,
  trackingEnabled,
  titleCaptureEnabled,
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
  onToggleTitleCapture,
  onToggleTracking,
  onDeleteAllSessions,
}: AppMappingCandidateCardProps) {
  return (
    <div
      className="relative rounded-[12px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] px-4 py-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="mt-0.5 h-10 w-10 rounded-[8px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] p-1.5"
            style={{ boxShadow: `0 0 0 2px ${displayColor}22` }}
          >
            {icon ? (
              <img src={icon} className="h-full w-full object-contain" alt="" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[var(--qp-text-tertiary)]">
                {(displayName || candidate.exeName).slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="inline-flex max-w-full items-center gap-1">
              {isEditingName ? (
                <input
                  id={`app-name-${candidate.exeName}`}
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
                icon={<Pencil size={13} />}
                title={UI_TEXT.mapping.editAppName}
                disabled={isBusy}
                onClick={onStartNameEdit}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 px-2">
              <QuietBadge>
                {candidate.exeName}
              </QuietBadge>
              {!titleCaptureEnabled && (
                <QuietBadge tone="subtle">
                  {UI_TEXT.mapping.titleNotRecorded}
                </QuietBadge>
              )}
              {!trackingEnabled && (
                <QuietBadge tone="warning">
                  {UI_TEXT.mapping.noStats}
                </QuietBadge>
              )}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 items-end">
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
              disabled={isBusy}
              className="order-1 min-w-[132px]"
              onChange={(value) => onCategoryAssign(String(value))}
              options={categoryOptions}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <QuietInlineAction
              disabled={isBusy}
              onClick={onToggleTitleCapture}
              tone={titleCaptureEnabled ? "neutral" : "accent"}
              title={titleCaptureEnabled ? UI_TEXT.mapping.disableTitleCapture : UI_TEXT.mapping.enableTitleCapture}
            >
              {titleCaptureEnabled ? UI_TEXT.mapping.titleRecorded : UI_TEXT.mapping.titleNotRecorded}
            </QuietInlineAction>
            <QuietInlineAction
              disabled={isBusy}
              onClick={onToggleTracking}
              tone={trackingEnabled ? "warning" : "accent"}
              title={trackingEnabled ? UI_TEXT.mapping.disableTracking : UI_TEXT.mapping.enableTracking}
            >
              {trackingEnabled ? UI_TEXT.mapping.statsEnabled : UI_TEXT.mapping.noStats}
            </QuietInlineAction>
            <QuietInlineAction
              disabled={isBusy}
              onClick={onDeleteAllSessions}
              tone="danger"
              title={UI_TEXT.mapping.deleteAppRecords}
              leadingIcon={<Trash2 size={12} />}
            >
              {UI_TEXT.mapping.deleteAppRecords}
            </QuietInlineAction>
          </div>
        </div>
      </div>
    </div>
  );
}
