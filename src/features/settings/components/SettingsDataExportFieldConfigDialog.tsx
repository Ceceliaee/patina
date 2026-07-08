import { CheckSquare, ChevronDown, ChevronUp, GripVertical, RotateCcw, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";
import type { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  DEFAULT_SETTINGS_DATA_EXPORT_FIELDS,
  SETTINGS_DATA_EXPORT_FIELD_GROUPS,
  SETTINGS_DATA_EXPORT_FIELD_KEYS,
} from "../services/settingsDataExportFields.ts";

type SettingsDataExportFieldKey = (typeof SETTINGS_DATA_EXPORT_FIELD_KEYS)[number];
type SettingsDataExportFieldGroupId = (typeof SETTINGS_DATA_EXPORT_FIELD_GROUPS)[number]["id"];
type DropMarker = { field: SettingsDataExportFieldKey; placement: "before" | "after" } | null;

interface Props {
  open: boolean;
  selectedFields: string[];
  uiText: typeof UI_TEXT;
  onClose: () => void;
  onConfirm: (fields: string[]) => void;
}

const GROUP_COPY_KEYS: Record<SettingsDataExportFieldGroupId, {
  title: "groupDefault" | "groupAnalysis" | "groupAdvanced";
  hint: "groupDefaultHint" | "groupAnalysisHint" | "groupAdvancedHint";
}> = {
  default: { title: "groupDefault", hint: "groupDefaultHint" },
  analysis: { title: "groupAnalysis", hint: "groupAnalysisHint" },
  advanced: { title: "groupAdvanced", hint: "groupAdvancedHint" },
};

const DEFAULT_COLLAPSED_GROUPS: SettingsDataExportFieldGroupId[] = ["analysis", "advanced"];

function isSettingsDataExportFieldKey(value: string): value is SettingsDataExportFieldKey {
  return (SETTINGS_DATA_EXPORT_FIELD_KEYS as readonly string[]).includes(value);
}

function normalizeSelectedFields(fields: readonly string[]): SettingsDataExportFieldKey[] {
  const seen = new Set<string>();
  const selected = fields
    .filter(isSettingsDataExportFieldKey)
    .filter((field) => {
      if (seen.has(field)) return false;
      seen.add(field);
      return true;
    });
  return selected.length > 0 ? selected : [...DEFAULT_SETTINGS_DATA_EXPORT_FIELDS];
}

function buildOrder(selectedFields: readonly string[]): SettingsDataExportFieldKey[] {
  const selected = normalizeSelectedFields(selectedFields);
  const remaining = SETTINGS_DATA_EXPORT_FIELD_KEYS.filter((field) => !selected.includes(field));
  return [...selected, ...remaining];
}

function reorderFieldWithinGroup(
  order: SettingsDataExportFieldKey[],
  field: SettingsDataExportFieldKey,
  targetIndex: number,
  groupFields: readonly SettingsDataExportFieldKey[],
): SettingsDataExportFieldKey[] {
  const groupSet = new Set<SettingsDataExportFieldKey>(groupFields);
  if (!groupSet.has(field)) return order;

  const groupOrder = order.filter((candidate) => groupSet.has(candidate));
  const fromIndex = groupOrder.indexOf(field);
  if (fromIndex < 0) return order;

  const nextGroupOrder = groupOrder.filter((candidate) => candidate !== field);
  const boundedTargetIndex = Math.min(Math.max(0, targetIndex), nextGroupOrder.length);
  nextGroupOrder.splice(boundedTargetIndex, 0, field);

  let cursor = 0;
  return order.map((candidate) => (
    groupSet.has(candidate) ? nextGroupOrder[cursor++] : candidate
  ));
}

function restoreDefaultOrderWithinGroup(
  order: SettingsDataExportFieldKey[],
  groupFields: readonly SettingsDataExportFieldKey[],
): SettingsDataExportFieldKey[] {
  const groupSet = new Set<SettingsDataExportFieldKey>(groupFields);
  let cursor = 0;
  return order.map((candidate) => (
    groupSet.has(candidate) ? groupFields[cursor++] : candidate
  ));
}

export default function SettingsDataExportFieldConfigDialog({ open, selectedFields, uiText, onClose, onConfirm }: Props) {
  const t = uiText.export;
  const [order, setOrder] = useState<SettingsDataExportFieldKey[]>(() => buildOrder(selectedFields));
  const [selected, setSelected] = useState<Set<SettingsDataExportFieldKey>>(() => new Set(normalizeSelectedFields(selectedFields)));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<SettingsDataExportFieldGroupId>>(() => new Set(DEFAULT_COLLAPSED_GROUPS));
  const [draggingField, setDraggingField] = useState<SettingsDataExportFieldKey | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker>(null);
  const [dragPreview, setDragPreview] = useState<{
    field: SettingsDataExportFieldKey;
    x: number;
    y: number;
    width: number;
    height: number;
    selected: boolean;
  } | null>(null);
  const rowRefs = useRef<Map<SettingsDataExportFieldKey, HTMLDivElement>>(new Map());
  const orderRef = useRef<SettingsDataExportFieldKey[]>(order);
  const dragStateRef = useRef<{
    field: SettingsDataExportFieldKey;
    groupFields: SettingsDataExportFieldKey[];
    pointerId: number;
    targetIndex: number;
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null>(null);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeSelectedFields(selectedFields);
    setOrder(buildOrder(normalized));
    setSelected(new Set(normalized));
    setCollapsedGroups(new Set(DEFAULT_COLLAPSED_GROUPS));
    setDraggingField(null);
    setDropMarker(null);
    setDragPreview(null);
    dragStateRef.current = null;
  }, [open, selectedFields]);

  const selectedCount = selected.size;

  const toggleField = (field: SettingsDataExportFieldKey) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const toggleGroupFields = (groupFields: readonly SettingsDataExportFieldKey[]) => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = groupFields.every((field) => next.has(field));
      if (allSelected) {
        groupFields.forEach((field) => next.delete(field));
      } else {
        groupFields.forEach((field) => next.add(field));
      }
      return next;
    });
  };

  const restoreGroupOrder = (groupFields: readonly SettingsDataExportFieldKey[]) => {
    setOrder((current) => {
      const next = restoreDefaultOrderWithinGroup(current, groupFields);
      orderRef.current = next;
      return next;
    });
  };

  const toggleGroupCollapsed = (groupId: SettingsDataExportFieldGroupId) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const confirm = () => {
    const nextFields = order.filter((field) => selected.has(field));
    if (nextFields.length === 0) return;
    onConfirm(nextFields);
  };

  const getCurrentGroupFields = useCallback((
    sourceOrder: readonly SettingsDataExportFieldKey[],
    groupFields: readonly SettingsDataExportFieldKey[],
  ) => {
    const groupSet = new Set(groupFields);
    return sourceOrder.filter((field) => groupSet.has(field));
  }, []);

  const getDropPosition = useCallback((clientY: number, groupFields: readonly SettingsDataExportFieldKey[]) => {
    if (groupFields.length === 0) {
      return { targetIndex: 0, marker: null as DropMarker };
    }
    for (let index = 0; index < groupFields.length; index += 1) {
      const row = rowRefs.current.get(groupFields[index]);
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return {
          targetIndex: index,
          marker: { field: groupFields[index], placement: "before" as const },
        };
      }
    }
    return {
      targetIndex: groupFields.length,
      marker: { field: groupFields[groupFields.length - 1], placement: "after" as const },
    };
  }, []);

  const setRowRef = useCallback((field: SettingsDataExportFieldKey) => (node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(field, node);
    } else {
      rowRefs.current.delete(field);
    }
  }, []);

  const clearDrag = useCallback(() => {
    dragStateRef.current = null;
    setDraggingField(null);
    setDropMarker(null);
    setDragPreview(null);
  }, []);

  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    field: SettingsDataExportFieldKey,
    groupFields: readonly SettingsDataExportFieldKey[],
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const row = rowRefs.current.get(field);
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const targetFields = groupFields.filter((candidate) => candidate !== field);
    const dropPosition = getDropPosition(event.clientY, targetFields);
    dragStateRef.current = {
      field,
      groupFields: [...groupFields],
      pointerId: event.pointerId,
      targetIndex: dropPosition.targetIndex,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
    };
    setDraggingField(field);
    setDropMarker(dropPosition.marker);
    setDragPreview({
      field,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      selected: selected.has(field),
    });
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      event.preventDefault();
      setDragPreview((current) => current ? {
        ...current,
        x: event.clientX - dragState.pointerOffsetX,
        y: event.clientY - dragState.pointerOffsetY,
      } : current);
      const currentGroupFields = getCurrentGroupFields(orderRef.current, dragState.groupFields)
        .filter((field) => field !== dragState.field);
      const dropPosition = getDropPosition(event.clientY, currentGroupFields);
      dragState.targetIndex = dropPosition.targetIndex;
      setDropMarker(dropPosition.marker);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      event.preventDefault();
      setOrder((current) => {
        const next = reorderFieldWithinGroup(
          current,
          dragState.field,
          dragState.targetIndex,
          dragState.groupFields,
        );
        orderRef.current = next;
        return next;
      });
      clearDrag();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      clearDrag();
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [clearDrag, getCurrentGroupFields, getDropPosition]);

  const dragPreviewCopy = dragPreview
    ? (t.fields as Record<string, { label: string; desc: string }>)[dragPreview.field]
    : null;

  return (
    <>
      <QuietDialog
        open={open}
        title={t.configFieldsTitle}
        description={t.configFieldsHint}
        onClose={onClose}
        surfaceClassName="settings-data-export-field-dialog"
        actions={(
          <>
            <div className="settings-data-export-field-dialog-actions-spacer" />
            <button
              type="button"
              onClick={onClose}
              className="qp-button-secondary h-8 min-h-0 px-3 text-xs font-semibold leading-none"
            >
              {uiText.dialog.cancel}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={selectedCount === 0}
              className="qp-button-primary h-8 min-h-0 px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {uiText.dialog.confirm}
            </button>
          </>
        )}
      >
        <div className="settings-data-export-field-dialog-body">
          <div className={`settings-data-export-field-summary ${selectedCount === 0 ? "settings-data-export-field-summary-danger" : ""}`}>
            <span>{t.configFieldsCount(selectedCount, SETTINGS_DATA_EXPORT_FIELD_KEYS.length)}</span>
            {selectedCount === 0 ? <strong>{t.configFieldsEmpty}</strong> : null}
          </div>

          {SETTINGS_DATA_EXPORT_FIELD_GROUPS.map((group) => {
            const copyKeys = GROUP_COPY_KEYS[group.id];
            const groupFields = order.filter((field) => (group.fields as readonly string[]).includes(field));
            const defaultGroupFields = group.fields as readonly SettingsDataExportFieldKey[];
            const selectedGroupCount = defaultGroupFields.filter((field) => selected.has(field)).length;
            const isCollapsed = collapsedGroups.has(group.id);
            const allGroupFieldsSelected = selectedGroupCount === defaultGroupFields.length;
            const groupSelectionLabel = allGroupFieldsSelected ? t.deselectGroupFields : t.selectGroupFields;
            return (
              <section key={group.id} className={`settings-data-export-field-group ${isCollapsed ? "settings-data-export-field-group-collapsed" : ""}`}>
                <header className="settings-data-export-field-group-header">
                  <div className="min-w-0">
                    <p>{t[copyKeys.title]}</p>
                    <span>{t[copyKeys.hint]}</span>
                  </div>
                  <div className="settings-data-export-field-group-actions">
                    <QuietTooltip
                      label={groupSelectionLabel}
                      placement="top"
                      disabled={Boolean(draggingField)}
                    >
                      <button
                        type="button"
                        className="settings-data-export-field-group-action"
                        aria-label={groupSelectionLabel}
                        onClick={() => toggleGroupFields(defaultGroupFields)}
                        disabled={Boolean(draggingField)}
                      >
                        {allGroupFieldsSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    </QuietTooltip>
                    <QuietTooltip
                      label={t.restoreGroupDefaultOrder}
                      placement="top"
                      disabled={Boolean(draggingField)}
                    >
                      <button
                        type="button"
                        className="settings-data-export-field-group-action"
                        aria-label={t.restoreGroupDefaultOrder}
                        onClick={() => restoreGroupOrder(defaultGroupFields)}
                        disabled={Boolean(draggingField)}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </QuietTooltip>
                    <QuietTooltip
                      label={isCollapsed ? t.expandFieldGroup : t.collapseFieldGroup}
                      placement="top"
                      disabled={Boolean(draggingField)}
                    >
                      <button
                        type="button"
                        className="settings-data-export-field-group-action"
                        aria-label={isCollapsed ? t.expandFieldGroup : t.collapseFieldGroup}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleGroupCollapsed(group.id)}
                        disabled={Boolean(draggingField)}
                      >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      </button>
                    </QuietTooltip>
                  </div>
                </header>

                {!isCollapsed ? (
                  <div className="settings-data-export-field-list">
                    {groupFields.map((field) => {
                      const fieldCopy = (t.fields as Record<string, { label: string; desc: string }>)[field];
                      const isSelected = selected.has(field);
                      const markerPlacement = dropMarker?.field === field ? dropMarker.placement : null;
                      return (
                        <div
                          key={field}
                          ref={setRowRef(field)}
                          className={[
                            "settings-data-export-field-row",
                            isSelected ? "settings-data-export-field-row-selected" : "",
                            draggingField === field ? "settings-data-export-field-row-dragging" : "",
                            markerPlacement === "before" ? "settings-data-export-field-row-drop-before" : "",
                            markerPlacement === "after" ? "settings-data-export-field-row-drop-after" : "",
                          ].filter(Boolean).join(" ")}
                        >
                          <button
                            type="button"
                            className="settings-data-export-field-drag-handle"
                            aria-label={t.dragField}
                            onPointerDown={(event) => startDrag(event, field, groupFields)}
                          >
                            <GripVertical size={16} />
                          </button>
                          <button
                            type="button"
                            className="settings-data-export-field-copy"
                            onClick={() => toggleField(field)}
                          >
                            <span className="settings-data-export-field-line">
                              <strong>{fieldCopy.label}</strong>
                              <span>{fieldCopy.desc}</span>
                            </span>
                          </button>
                          <input
                            type="checkbox"
                            className="settings-data-export-field-check-input"
                            aria-label={t.toggleField}
                            checked={isSelected}
                            onChange={() => toggleField(field)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </QuietDialog>

      {dragPreview && dragPreviewCopy && typeof document !== "undefined"
        ? createPortal(
          <div
            className={[
              "settings-data-export-field-row",
              dragPreview.selected ? "settings-data-export-field-row-selected" : "",
              "settings-data-export-field-drag-preview",
            ].filter(Boolean).join(" ")}
            style={{
              left: dragPreview.x,
              top: dragPreview.y,
              width: dragPreview.width,
              height: dragPreview.height,
            }}
          >
            <span className="settings-data-export-field-drag-handle settings-data-export-field-drag-handle-preview">
              <GripVertical size={16} />
            </span>
            <span className="settings-data-export-field-copy settings-data-export-field-copy-preview">
              <span className="settings-data-export-field-line">
                <strong>{dragPreviewCopy.label}</strong>
                <span>{dragPreviewCopy.desc}</span>
              </span>
            </span>
            <input
              type="checkbox"
              className="settings-data-export-field-check-input"
              checked={dragPreview.selected}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
