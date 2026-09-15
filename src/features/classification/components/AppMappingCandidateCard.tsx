import type { ReactNode } from "react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ObservedAppCandidate } from "../types";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting";
import ClassificationMappingCard from "./ClassificationMappingCard";

interface AppMappingCandidateCardProps {
  identityContent?: ReactNode;
  candidate: ObservedAppCandidate;
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

export default function AppMappingCandidateCard({ candidate, ...props }: AppMappingCandidateCardProps) {
  const UI_TEXT = useLocaleText();
  return <ClassificationMappingCard {...props} identity={candidate.exeName} kind="app" editNameLabel={UI_TEXT.mapping.editAppName} deleteRecordsLabel={UI_TEXT.mapping.deleteAppRecords} />;
}
