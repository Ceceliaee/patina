import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Globe2 } from "lucide-react";
import type { ObservedWebDomainCandidate } from "../../../shared/types/webActivity.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting.ts";
import ClassificationMappingCard from "./ClassificationMappingCard";
import LinkedWebMenu, { type LinkedWebMenuProps } from "./LinkedWebMenu.tsx";
import { webLinkParent } from "../../../shared/classification/webLinks.ts";

interface WebDomainMappingCardProps {
  grouping: Omit<LinkedWebMenuProps, "candidate" | "disabled" | "globalTitleEnabled">;
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

export default function WebDomainMappingCard({ candidate, grouping, recordingEnabled, onToggleRecording, onDeleteHistory, ...props }: WebDomainMappingCardProps) {
  const UI_TEXT = useLocaleText();
  const parent = webLinkParent(candidate.normalizedDomain);
  const original = parent ? grouping.candidates.find(value => value.normalizedDomain === candidate.domain)
    ?? candidate.memberCandidates?.find(value => grouping.candidates.some(raw => raw.normalizedDomain === value.normalizedDomain)) : candidate;
  const primary = original ?? candidate;
  const rawOverride = grouping.overrides[primary.normalizedDomain] ?? {};
  return (
    <ClassificationMappingCard
      {...props}
      identity={candidate.normalizedDomain}
      kind="web"
      titleCaptureEnabled={rawOverride.captureTitle !== false}
      onToggleTitleCapture={() => grouping.onChange(primary.normalizedDomain, { ...rawOverride, captureTitle: rawOverride.captureTitle === false })}
      identityContent={<LinkedWebMenu {...grouping} candidate={candidate} disabled={props.isBusy} globalTitleEnabled={props.globalTitleEnabled} />}
      icon={candidate.faviconUrl ?? undefined}
      fallbackIcon={<Globe2 size={17} aria-hidden="true" />}
      editNameLabel={UI_TEXT.mapping.editWebDomainName}
      deleteRecordsLabel={UI_TEXT.mapping.deleteWebRecords}
      trackingEnabled={parent ? rawOverride.enabled !== false : recordingEnabled}
      onToggleTracking={parent ? () => grouping.onChange(primary.normalizedDomain, { ...rawOverride, enabled: rawOverride.enabled === false }) : onToggleRecording}
      onDeleteAllSessions={parent ? () => grouping.onDelete(primary) : onDeleteHistory}
    />
  );
}
