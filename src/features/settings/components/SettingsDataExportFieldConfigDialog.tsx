import { CheckSquare, ChevronDown, ChevronUp, RotateCcw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";
import type { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  DEFAULT_SETTINGS_DATA_EXPORT_FIELDS,
  SETTINGS_DATA_EXPORT_FIELD_GROUPS,
  SETTINGS_DATA_EXPORT_FIELD_KEYS,
} from "../services/settingsDataExportFields.ts";

type SettingsDataExportFieldKey = (typeof SETTINGS_DATA_EXPORT_FIELD_KEYS)[number];
type SettingsDataExportFieldGroupId = (typeof SETTINGS_DATA_EXPORT_FIELD_GROUPS)[number]["id"];

interface Props {
  open: boolean;
  selectedFields: string[];
  defaultFields: readonly SettingsDataExportFieldKey[];
  uiText: typeof UI_TEXT;
  onClose: () => void;
  onConfirm: (fields: string[]) => void;
}

const GROUP_COPY_KEYS: Record<SettingsDataExportFieldGroupId, {
  title: "groupActivity" | "groupApps" | "groupWeb" | "groupClassification" | "groupAnalysis" | "groupAudit";
  hint: "groupActivityHint" | "groupAppsHint" | "groupWebHint" | "groupClassificationHint" | "groupAnalysisHint" | "groupAuditHint";
}> = {
  activity: { title: "groupActivity", hint: "groupActivityHint" },
  apps: { title: "groupApps", hint: "groupAppsHint" },
  web: { title: "groupWeb", hint: "groupWebHint" },
  classification: { title: "groupClassification", hint: "groupClassificationHint" },
  analysis: { title: "groupAnalysis", hint: "groupAnalysisHint" },
  audit: { title: "groupAudit", hint: "groupAuditHint" },
};

const DEFAULT_COLLAPSED_GROUPS: SettingsDataExportFieldGroupId[] = SETTINGS_DATA_EXPORT_FIELD_GROUPS.map((group) => group.id);

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

export default function SettingsDataExportFieldConfigDialog({ open, selectedFields, defaultFields, uiText, onClose, onConfirm }: Props) {
  const t = uiText.export;
  const [selected, setSelected] = useState<Set<SettingsDataExportFieldKey>>(() => new Set(normalizeSelectedFields(selectedFields)));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<SettingsDataExportFieldGroupId>>(() => new Set(DEFAULT_COLLAPSED_GROUPS));

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeSelectedFields(selectedFields);
    setSelected(new Set(normalized));
    setCollapsedGroups(new Set(DEFAULT_COLLAPSED_GROUPS));
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
    const nextFields = SETTINGS_DATA_EXPORT_FIELD_KEYS.filter((field) => selected.has(field));
    if (nextFields.length === 0) return;
    onConfirm(nextFields);
  };

  const restoreFormatDefaults = () => {
    const defaults = normalizeSelectedFields(defaultFields);
    setSelected(new Set(defaults));
  };

  return (
    <QuietDialog
        open={open}
        title={t.configFieldsTitle}
        description={t.configFieldsHint}
        headerAside={(
          <>
            <QuietTooltip label={t.restoreFormatDefaults} placement="top">
              <button
                type="button"
                className="settings-data-export-field-header-action"
                aria-label={t.restoreFormatDefaults}
                onClick={restoreFormatDefaults}
              >
                <RotateCcw size={14} />
              </button>
            </QuietTooltip>
          </>
        )}
        onClose={onClose}
        surfaceClassName="settings-data-export-field-dialog"
        initialFocus="surface"
        actions={(
          <>
            <div className="settings-data-export-field-dialog-actions-spacer" />
            <QuietButton
              onClick={onClose}
              className="h-8 min-h-0 px-3 text-xs font-semibold leading-none"
            >
              {uiText.dialog.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              onClick={confirm}
              disabled={selectedCount === 0}
              className="h-8 min-h-0 px-3 text-xs font-semibold leading-none"
            >
              {uiText.dialog.confirm}
            </QuietButton>
          </>
        )}
      >
        <div className="settings-data-export-field-dialog-body">
          {selectedCount === 0 ? <div className="settings-data-export-field-empty-warning">{t.configFieldsEmpty}</div> : null}
          {SETTINGS_DATA_EXPORT_FIELD_GROUPS.map((group) => {
            const copyKeys = GROUP_COPY_KEYS[group.id];
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
                    <span className="settings-data-export-field-group-count">
                      {selectedGroupCount}/{defaultGroupFields.length}
                    </span>
                    <QuietTooltip
                      label={groupSelectionLabel}
                      placement="top"
                    >
                      <button
                        type="button"
                        className="settings-data-export-field-group-action"
                        aria-label={groupSelectionLabel}
                        onClick={() => toggleGroupFields(defaultGroupFields)}
                      >
                        {allGroupFieldsSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    </QuietTooltip>
                    <QuietTooltip
                      label={isCollapsed ? t.expandFieldGroup : t.collapseFieldGroup}
                      placement="top"
                    >
                      <button
                        type="button"
                        className="settings-data-export-field-group-action"
                        aria-label={isCollapsed ? t.expandFieldGroup : t.collapseFieldGroup}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleGroupCollapsed(group.id)}
                      >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      </button>
                    </QuietTooltip>
                  </div>
                </header>

                {!isCollapsed ? (
                  <div className="settings-data-export-field-list">
                    {defaultGroupFields.map((field) => {
                      const fieldCopy = (t.fields as Record<string, { label: string; desc: string }>)[field];
                      const isSelected = selected.has(field);
                      return (
                        <div
                          key={field}
                          className={[
                            "settings-data-export-field-row",
                            isSelected ? "settings-data-export-field-row-selected" : "",
                          ].filter(Boolean).join(" ")}
                        >
                          <button
                            type="button"
                            className="settings-data-export-field-copy"
                            onClick={() => toggleField(field)}
                          >
                            <span className="settings-data-export-field-line">
                              <strong>
                                {fieldCopy.label}
                              </strong>
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
  );
}
