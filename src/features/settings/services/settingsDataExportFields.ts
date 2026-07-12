import {
  ADVANCED_DATA_EXPORT_PROTOCOL_FIELDS,
  ANALYSIS_DATA_EXPORT_PROTOCOL_FIELDS,
  DATA_EXPORT_PROTOCOL_FIELDS,
  DATA_EXPORT_PROTOCOL_FIELD_GROUPS,
  DATA_EXPORT_PROTOCOL_DEFAULT_FIELDS_BY_FORMAT,
  DEFAULT_DATA_EXPORT_PROTOCOL_FIELDS,
  type DataExportProtocolField,
} from "../../../platform/persistence/dataExportGateway.ts";

export const DEFAULT_SETTINGS_DATA_EXPORT_FIELDS = DEFAULT_DATA_EXPORT_PROTOCOL_FIELDS;
export const ANALYSIS_SETTINGS_DATA_EXPORT_FIELDS = ANALYSIS_DATA_EXPORT_PROTOCOL_FIELDS;
export const ADVANCED_SETTINGS_DATA_EXPORT_FIELDS = ADVANCED_DATA_EXPORT_PROTOCOL_FIELDS;
export const SETTINGS_DATA_EXPORT_FIELD_KEYS = DATA_EXPORT_PROTOCOL_FIELDS;

export type SettingsDataExportFieldKey = DataExportProtocolField;

export type SettingsDataExportFieldGroupId = "activity" | "apps" | "web" | "classification" | "analysis" | "audit";

export interface SettingsDataExportFieldGroup {
  id: SettingsDataExportFieldGroupId;
  fields: readonly SettingsDataExportFieldKey[];
}

export const SETTINGS_DATA_EXPORT_FIELD_GROUPS: SettingsDataExportFieldGroup[] = [
  {
    id: "activity",
    fields: DATA_EXPORT_PROTOCOL_FIELD_GROUPS.activity,
  },
  {
    id: "apps",
    fields: DATA_EXPORT_PROTOCOL_FIELD_GROUPS.apps,
  },
  {
    id: "web",
    fields: DATA_EXPORT_PROTOCOL_FIELD_GROUPS.web,
  },
  {
    id: "classification",
    fields: DATA_EXPORT_PROTOCOL_FIELD_GROUPS.classification,
  },
  {
    id: "analysis",
    fields: DATA_EXPORT_PROTOCOL_FIELD_GROUPS.analysis,
  },
  {
    id: "audit",
    fields: DATA_EXPORT_PROTOCOL_FIELD_GROUPS.audit,
  },
];

export const SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT = DATA_EXPORT_PROTOCOL_DEFAULT_FIELDS_BY_FORMAT;

export function createDefaultSettingsDataExportFields(): SettingsDataExportFieldKey[] {
  return [...DEFAULT_SETTINGS_DATA_EXPORT_FIELDS];
}
