import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Globe2, Plus } from "lucide-react";
import type { ObservedWebDomainCandidate } from "../../../shared/types/webActivity.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting.ts";
import ClassificationMappingCard from "./ClassificationMappingCard";
import LinkedWebMenu, { focusWebCard, type LinkedWebMenuProps } from "./LinkedWebMenu.tsx";
import { setWebDomainIndependent, webLinkParent } from "../../../shared/classification/webLinks.ts";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";

interface WebDomainMappingCardProps {
  grouping: Omit<LinkedWebMenuProps, "candidate" | "disabled" | "globalTitleEnabled">;
  candidate: ObservedWebDomainCandidate;
  onSetMembers: (domains: string[], field: "captureTitle" | "enabled", value: boolean) => void;
  displayName: string;
  displayColor: string;
  assignedCategory: UserAssignableAppCategory;
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
  onDeleteHistory: () => void;
}

export default function WebDomainMappingCard({ candidate, grouping, onSetMembers, onDeleteHistory, ...props }: WebDomainMappingCardProps) {
  const UI_TEXT = useLocaleText();
  const parent = webLinkParent(candidate.normalizedDomain);
  const members = candidate.memberCandidates ?? [candidate];
  const countEnabled = (field: "captureTitle" | "enabled") => members.filter(member => grouping.overrides[member.normalizedDomain]?.[field] !== false).length;
  const titles = countEnabled("captureTitle"), recordings = countEnabled("enabled");
  const titleEnabled = titles === members.length;
  const allRecording = recordings === members.length;
  const root = grouping.overrides[candidate.normalizedDomain]?.groupingRoot;
  const setMembers = (field: "captureTitle" | "enabled", value: boolean) => {
    onSetMembers(members.map(member => member.normalizedDomain), field, value);
  };
  return (
    <ClassificationMappingCard
      {...props}
      identity={candidate.normalizedDomain}
      kind="web"
      titleMixed={!titleEnabled && titles > 0}
      trackingMixed={!allRecording && recordings > 0}
      titleCaptureEnabled={titleEnabled}
      onToggleTitleCapture={() => setMembers("captureTitle", !titleEnabled)}
      identityContent={<LinkedWebMenu {...grouping} candidate={candidate} disabled={props.isBusy} globalTitleEnabled={props.globalTitleEnabled} />}
      icon={candidate.faviconUrl ?? undefined}
      fallbackIcon={<Globe2 size={17} aria-hidden="true" />}
      editNameLabel={UI_TEXT.mapping.editWebDomainName}
      deleteRecordsLabel={UI_TEXT.mapping.deleteWebRecords}
      trackingEnabled={allRecording}
      onToggleTracking={() => setMembers("enabled", recordings === 0)}
      onDeleteAllSessions={onDeleteHistory}
      additionalAction={!parent && root ? <QuietIconAction icon={<Plus size={16} />} title={UI_TEXT.mapping.mergeWebDomain(root)} disabled={props.isBusy}
        onClick={() => { const change = setWebDomainIndependent(candidate.normalizedDomain, false, grouping.overrides); if (change) { grouping.onChange(change.key, change.override); grouping.onOpenIdentity(null); focusWebCard(change.key); } }} /> : undefined}
    />
  );
}
