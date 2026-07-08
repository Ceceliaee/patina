import {
  ADVANCED_DATA_EXPORT_PROTOCOL_FIELDS,
  ANALYSIS_DATA_EXPORT_PROTOCOL_FIELDS,
  DATA_EXPORT_PROTOCOL_FIELDS,
  DEFAULT_DATA_EXPORT_PROTOCOL_FIELDS,
  type DataExportProtocolField,
} from "../../../platform/persistence/dataExportGateway.ts";

export const DEFAULT_SETTINGS_DATA_EXPORT_FIELDS = DEFAULT_DATA_EXPORT_PROTOCOL_FIELDS;
export const ANALYSIS_SETTINGS_DATA_EXPORT_FIELDS = ANALYSIS_DATA_EXPORT_PROTOCOL_FIELDS;
export const ADVANCED_SETTINGS_DATA_EXPORT_FIELDS = ADVANCED_DATA_EXPORT_PROTOCOL_FIELDS;
export const SETTINGS_DATA_EXPORT_FIELD_KEYS = DATA_EXPORT_PROTOCOL_FIELDS;

export type SettingsDataExportFieldKey = DataExportProtocolField;

export type SettingsDataExportFieldGroupId = "default" | "analysis" | "advanced";

export interface SettingsDataExportFieldGroup {
  id: SettingsDataExportFieldGroupId;
  fields: readonly SettingsDataExportFieldKey[];
}

export const SETTINGS_DATA_EXPORT_FIELD_GROUPS: SettingsDataExportFieldGroup[] = [
  {
    id: "default",
    fields: DEFAULT_SETTINGS_DATA_EXPORT_FIELDS,
  },
  {
    id: "analysis",
    fields: ANALYSIS_SETTINGS_DATA_EXPORT_FIELDS,
  },
  {
    id: "advanced",
    fields: ADVANCED_SETTINGS_DATA_EXPORT_FIELDS,
  },
];

export function createDefaultSettingsDataExportFields(): SettingsDataExportFieldKey[] {
  return [...DEFAULT_SETTINGS_DATA_EXPORT_FIELDS];
}
