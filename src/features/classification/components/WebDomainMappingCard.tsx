import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Globe2 } from "lucide-react";
import type { ObservedWebDomainCandidate } from "../../../shared/types/webActivity.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting.ts";
import ClassificationMappingCard from "./ClassificationMappingCard";

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

export default function WebDomainMappingCard({ candidate, recordingEnabled, onToggleRecording, onDeleteHistory, ...props }: WebDomainMappingCardProps) {
  const UI_TEXT = useLocaleText();
  return (
    <ClassificationMappingCard
      {...props}
      identity={candidate.normalizedDomain}
      kind="web"
      icon={candidate.faviconUrl ?? undefined}
      fallbackIcon={<Globe2 size={17} aria-hidden="true" />}
      editNameLabel={UI_TEXT.mapping.editWebDomainName}
      deleteRecordsLabel={UI_TEXT.mapping.deleteWebRecords}
      trackingEnabled={recordingEnabled}
      onToggleTracking={onToggleRecording}
      onDeleteAllSessions={onDeleteHistory}
    />
  );
}
