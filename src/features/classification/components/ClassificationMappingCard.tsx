import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Captions, CaptionsOff, ListPlus, ListX, PencilLine, Trash2 } from "lucide-react";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting";
import QuietSelect from "../../../shared/components/QuietSelect";
import QuietColorField from "../../../shared/components/QuietColorField";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import QuietTooltip from "../../../shared/components/QuietTooltip";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietBadge from "../../../shared/components/QuietBadge";


interface ClassificationMappingCardProps {
  identityContent?: ReactNode;
  identity: string;
  kind: "app" | "web";
  fallbackIcon?: ReactNode;
  editNameLabel: string;
  deleteRecordsLabel: string;
  icon?: string;
  displayName: string;
  displayColor: string;
  assignedCategory: UserAssignableAppCategory;
  trackingEnabled: boolean;
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
  onToggleTitleCapture: () => void;
  onToggleTracking: () => void;
  onDeleteAllSessions: () => void;
}

function IdentityText({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setTruncated(node.scrollWidth > node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);
  return (
    <QuietTooltip label={text} disabled={!truncated} className="qp-app-identity-tooltip">
      <span ref={ref} className={className} tabIndex={truncated ? 0 : undefined}>{text}</span>
    </QuietTooltip>
  );
}

export default function ClassificationMappingCard({
  identity,
  kind,
  fallbackIcon,
  editNameLabel,
  deleteRecordsLabel,
  icon,
  displayName,
  displayColor,
  assignedCategory,
  trackingEnabled,
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
  onToggleTitleCapture,
  onToggleTracking,
  onDeleteAllSessions,
  identityContent,
}: ClassificationMappingCardProps) {
  const UI_TEXT = useLocaleText();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocus = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!isBusy && restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false;
      if (document.activeElement === document.body) deleteButtonRef.current?.focus();
    }
  }, [isBusy]);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const page = row?.closest('[data-classification-content-state]');
    return () => {
      if (!row?.contains(document.activeElement)) return;
      const fallback = row.nextElementSibling?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?? row.previousElementSibling?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      const search = page?.querySelector<HTMLInputElement>('input');
      window.requestAnimationFrame(() => {
        const target = fallback?.isConnected ? fallback : search;
        if (document.activeElement === document.body && target?.isConnected) target.focus();
      });
    };
  }, []);
  return (
    <div ref={rowRef} data-classification-app={kind === "app" ? identity : undefined} data-classification-web={kind === "web" ? identity : undefined} className="qp-app-mapping-row" role="group" aria-label={displayName}>
      <div className="qp-app-mapping-identity">
        <div className="qp-app-mapping-icon" style={{ boxShadow: `0 0 0 2px ${displayColor}22` }}>
          {icon ? <img src={icon} alt="" /> : fallbackIcon ?? <span>{(displayName || identity).slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="qp-app-mapping-details">
          <div className="qp-app-mapping-name-line">
            {isEditingName ? (
              <input
                id={`${kind === "app" ? "app-name" : "web-domain-name"}-${identity}`}
                aria-label={editNameLabel}
                value={inputValue}
                autoFocus
                disabled={isBusy}
                onChange={(event) => onNameDraftChange(event.target.value)}
                onBlur={onNameBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                    editButtonRef.current?.focus();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onNameEditCancel();
                    editButtonRef.current?.focus();
                  }
                }}
                className="qp-input qp-app-mapping-name-input"
              />
            ) : <IdentityText text={displayName} className="qp-app-mapping-name" />}
            <QuietIconAction
              buttonRef={editButtonRef}
              icon={<PencilLine size={14} />}
              className="qp-icon-action-dimmed"
              title={editNameLabel}
              disabled={isBusy}
              onClick={onStartNameEdit}
            />
            {!trackingEnabled && <QuietBadge tone="warning">{UI_TEXT.mapping.noStats}</QuietBadge>}
          </div>
          <div className="qp-app-mapping-exe-line">
            {identityContent ?? <IdentityText text={identity} className="qp-app-mapping-exe" />}
          </div>
        </div>
      </div>
      <div className="qp-app-mapping-controls">
        <QuietSelect
          value={assignedCategory}
          ariaLabel={UI_TEXT.mapping.categorySelectLabel(displayName)}
          disabled={isBusy}
          className="qp-app-mapping-category"
          onChange={(value) => onCategoryAssign(String(value))}
          options={categoryOptions}
        />
        <div className="qp-app-mapping-actions">
        <QuietColorField
          color={displayColor}
          format={colorFormat}
          presentation="swatch"
          disabled={isBusy}
          onChange={onColorAssign}
          onFormatChange={onColorFormatChange}
          title={UI_TEXT.mapping.color}
          resetAction={{ label: UI_TEXT.mapping.restoreDefaultColor, onReset: () => onColorAssign(null) }}
        />
          <QuietIconAction
            icon={titleCaptureEnabled ? <Captions size={16} /> : <CaptionsOff size={16} />}
            ariaLabel={UI_TEXT.mapping.titleRecorded}
            title={!globalTitleEnabled ? UI_TEXT.mapping.globalTitleDisabled : titleCaptureEnabled ? UI_TEXT.mapping.titleCaptureOnHint : UI_TEXT.mapping.titleCaptureOffHint}
            describedBy={!globalTitleEnabled ? "classification-global-title-disabled" : undefined}
            pressed={titleCaptureEnabled}
            showPressedStyle={false}
            disabled={isBusy || !globalTitleEnabled}
            onClick={onToggleTitleCapture}
          />
          <QuietIconAction
            icon={trackingEnabled ? <ListX size={16} /> : <ListPlus size={16} />}
            ariaLabel={UI_TEXT.mapping.excludeStats}
            title={trackingEnabled ? UI_TEXT.mapping.trackingOnHint : UI_TEXT.mapping.trackingOffHint}
            pressed={!trackingEnabled}
            showPressedStyle={false}
            disabled={isBusy}
            onClick={onToggleTracking}
          />
          <QuietIconAction
            icon={<Trash2 size={16} />}
            title={deleteRecordsLabel}
            tone="danger"
            className="qp-app-mapping-delete"
            buttonRef={deleteButtonRef}
            disabled={isBusy}
            onClick={() => {
              restoreDeleteFocus.current = true;
              onDeleteAllSessions();
            }}
          />
        </div>
      </div>
    </div>
  );
}
