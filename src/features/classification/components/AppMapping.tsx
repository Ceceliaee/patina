import { useEffect, useState, type ReactNode } from "react";
import { ListX, RefreshCw, Save, Sparkles, SlidersHorizontal } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietButton from "../../../shared/components/QuietButton";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import QuietSearchField from "../../../shared/components/QuietSearchField";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import CategoryColorControls from "./CategoryColorControls";
import AppMappingCandidateCard from "./AppMappingCandidateCard";
import WebDomainMappingCard from "./WebDomainMappingCard";
import { useAppMappingState } from "../hooks/useAppMappingState";
import type { CandidateFilter } from "../types";
import {
  readClassificationObjectMode,
  rememberClassificationObjectMode,
  type MappingObjectMode,
} from "../services/classificationLayoutPreferenceStorage.ts";

interface Props {
  icons: Record<string, string>;
  onDirtyChange?: (dirty: boolean) => void;
  onOverridesChanged?: () => void;
  onSessionsDeleted?: () => void;
  onRegisterSaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
  webActivityEnabled?: boolean;
  titleRecordingEnabled?: boolean;
}

export default function AppMapping(props: Props) {
  const { webActivityEnabled = false, titleRecordingEnabled = true } = props;
  const [objectMode, setObjectMode] = useState<MappingObjectMode>(readClassificationObjectMode);
  const filterOptions: Array<{ value: CandidateFilter; label: ReactNode; showCount?: boolean; ariaLabel?: string }> = [
    { value: "all", label: UI_TEXT.mapping.filters.all },
    { value: "classified", label: UI_TEXT.mapping.filters.classified },
    { value: "other", label: UI_TEXT.mapping.filters.other },
    {
      value: "excluded",
      label: <ListX size={13} aria-hidden />,
      showCount: false,
      ariaLabel: UI_TEXT.mapping.excludeStats,
    },
  ];
  const {
    dialogs,
    icons,
    loading,
    draftState,
    savedState,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    counts,
    webDomainCounts,
    saveStatus,
    saving,
    hasUnsavedChanges,
    handleCancel,
    handleSave,
    filteredCandidates,
    filteredWebDomainCandidates,
    showCategoryDialog,
    setShowCategoryDialog,
    colorFormat,
    setColorFormat,
    categoryControlCategories,
    candidateCategoryOptions,
    resolveCategoryColor,
    resolveCategoryLabel,
    handleCreateCategory,
    handleDeleteCategory,
    handleRenameCategory,
    resolveEffectiveDisplayName,
    resolveCandidateColor,
    resolveMappedCategory,
    resolveTrackingEnabled,
    resolveTitleCaptureEnabled,
    resolveWebDomainDisplayName,
    resolveWebDomainColor,
    resolveWebDomainCategory,
    resolveWebDomainEnabled,
    resolveWebDomainTitleCaptureEnabled,
    deletingSessionsExe,
    editingNameExe,
    nameDrafts,
    editingWebDomain,
    webNameDrafts,
    syncNameDraftToPageDraft,
    handleNameBlur,
    handleNameEditCancel,
    startNameEdit,
    syncWebNameDraftToPageDraft,
    handleWebNameBlur,
    handleWebNameEditCancel,
    startWebNameEdit,
    handleColorAssign,
    handleCategoryAssign,
    handleWebDomainColorAssign,
    handleWebDomainCategoryAssign,
    handleWebDomainTrackingToggle,
    handleWebDomainTitleCaptureToggle,
    handleTitleCaptureToggle,
    handleTrackingToggle,
    handleDeleteAllSessions,
    handleDeleteWebDomainHistory,
    applyCategoryColor,
  } = useAppMappingState(props);

  useEffect(() => {
    if (webActivityEnabled || objectMode !== "web") return;

    setObjectMode("app");
  }, [objectMode, webActivityEnabled]);

  const bootstrapReady = !loading && draftState !== null && savedState !== null;
  const effectiveObjectMode = webActivityEnabled ? objectMode : "app";
  const activeCounts = effectiveObjectMode === "web" ? webDomainCounts : counts;
  const objectModeOptions = [
    { value: "app" as const, label: UI_TEXT.mapping.objectModeApp, disabled: !bootstrapReady },
    { value: "web" as const, label: UI_TEXT.mapping.objectModeWeb, disabled: !bootstrapReady },
  ];
  const searchPlaceholder = effectiveObjectMode === "web"
    ? UI_TEXT.mapping.webSearchPlaceholder
    : UI_TEXT.mapping.appSearchPlaceholder;
  const handleObjectModeChange = (mode: MappingObjectMode) => {
    setObjectMode(mode);
    rememberClassificationObjectMode(mode);
  };
  const contentPaneKey = `${effectiveObjectMode}:${filter}`;

  return (
    <div
      className="flex h-full min-w-0 flex-col gap-4 md:gap-5 overflow-hidden"
      data-classification-content-state={bootstrapReady ? "ready" : "cold"}
    >
      <QuietPageHeader
        icon={<Sparkles size={18} />}
        title={UI_TEXT.mapping.title}
        subtitle={UI_TEXT.mapping.subtitle}
        rightSlot={(
          <div className="flex items-center gap-2.5">
            <div
              className={`qp-status ${
                saveStatus !== "saving" && hasUnsavedChanges ? "qp-status-danger" : ""
              } flex px-3 py-1.5 rounded-[8px] items-center text-xs font-semibold`}
            >
              {!bootstrapReady && (
                <span className="text-[var(--qp-text-tertiary)]" aria-hidden>—</span>
              )}
              {bootstrapReady && saveStatus === "saving" && (
                <span className="text-[var(--qp-accent-default)] flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin" />
                  {UI_TEXT.mapping.saving}
                </span>
              )}
              {bootstrapReady && saveStatus === "saved" && !hasUnsavedChanges && (
                <span className="text-[var(--qp-success)] flex items-center gap-1.5">
                  <Save size={14} />
                  {UI_TEXT.settings.saved}
                </span>
              )}
              {bootstrapReady && saveStatus !== "saving" && hasUnsavedChanges && <span>{UI_TEXT.mapping.unsaved}</span>}
              {bootstrapReady && saveStatus === "idle" && !hasUnsavedChanges && (
                <span className="text-[var(--qp-text-tertiary)]">{UI_TEXT.mapping.idle}</span>
              )}
            </div>
            <QuietButton
              size="large"
              onClick={handleCancel}
              disabled={!bootstrapReady || !hasUnsavedChanges || saving}
              className="rounded-[8px]"
            >
              {UI_TEXT.mapping.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void handleSave()}
              disabled={!bootstrapReady || !hasUnsavedChanges || saving}
              busy={saving}
              className="rounded-[8px]"
            >
              {saving ? UI_TEXT.mapping.saving : UI_TEXT.mapping.save}
            </QuietButton>
          </div>
        )}
      />

      <section className="qp-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <QuietSegmentedFilter<CandidateFilter>
              value={filter}
              onChange={setFilter}
              options={filterOptions.map((item) => {
                const count = item.value === "all"
                  ? activeCounts.all
                  : item.value === "other"
                    ? activeCounts.other
                    : activeCounts.classified;
                return {
                  value: item.value,
                  label: item.showCount === false
                    ? item.label
                    : `${item.label} (${bootstrapReady ? count : "—"})`,
                  ariaLabel: item.ariaLabel,
                  disabled: !bootstrapReady,
                };
              })}
            />
            <QuietSearchField
              className="w-[220px]"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              disabled={!bootstrapReady}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {webActivityEnabled && (
              <QuietSegmentedFilter
                value={effectiveObjectMode}
                onChange={handleObjectModeChange}
                options={objectModeOptions}
              />
            )}
            <QuietButton
              size="regular"
              onClick={() => setShowCategoryDialog(true)}
              disabled={!bootstrapReady}
              className="rounded-[8px]"
            >
              <SlidersHorizontal size={14} />
              {UI_TEXT.mapping.categoryControl}
            </QuietButton>
          </div>
        </div>
      </section>

      <div className="qp-panel flex-1 min-h-0 p-4">
        {!bootstrapReady ? (
          <div className="h-full" aria-hidden />
        ) : effectiveObjectMode === "web" ? (
          <div key={contentPaneKey} className="qp-classification-object-pane h-full">
            {filteredWebDomainCandidates.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--qp-text-tertiary)]">
                {UI_TEXT.mapping.webEmptyState}
              </div>
            ) : (
              <div className="h-full overflow-y-auto custom-scrollbar pr-1">
                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                  {filteredWebDomainCandidates.map((candidate) => {
                    const displayName = resolveWebDomainDisplayName(candidate);
                    const displayColor = resolveWebDomainColor(candidate);
                    const assignedCategory = resolveWebDomainCategory(candidate);
                    const recordingEnabled = resolveWebDomainEnabled(candidate);
                    const titleCaptureEnabled = resolveWebDomainTitleCaptureEnabled(candidate);
                    const isBusy = saving || deletingSessionsExe === candidate.normalizedDomain;
                    const isEditingName = editingWebDomain === candidate.normalizedDomain;
                    const inputValue = webNameDrafts[candidate.normalizedDomain] ?? displayName;

                    return (
                      <WebDomainMappingCard
                        key={candidate.normalizedDomain}
                        candidate={candidate}
                        displayName={displayName}
                        displayColor={displayColor}
                        assignedCategory={assignedCategory}
                        recordingEnabled={recordingEnabled}
                        titleCaptureEnabled={titleCaptureEnabled}
                        globalTitleEnabled={titleRecordingEnabled}
                        isBusy={isBusy}
                        isEditingName={isEditingName}
                        inputValue={inputValue}
                        colorFormat={colorFormat}
                        categoryOptions={candidateCategoryOptions}
                        onNameDraftChange={(nextValue) => syncWebNameDraftToPageDraft(candidate, nextValue)}
                        onNameBlur={() => {
                          handleWebNameBlur(candidate);
                        }}
                        onNameEditCancel={() => {
                          handleWebNameEditCancel(candidate);
                        }}
                        onStartNameEdit={() => {
                          startWebNameEdit(candidate);
                        }}
                        onColorAssign={(nextColor) => handleWebDomainColorAssign(candidate, nextColor)}
                        onColorFormatChange={setColorFormat}
                        onCategoryAssign={(value) => handleWebDomainCategoryAssign(candidate, value)}
                        onToggleRecording={() => handleWebDomainTrackingToggle(candidate, !recordingEnabled)}
                        onToggleTitleCapture={() => handleWebDomainTitleCaptureToggle(candidate, !titleCaptureEnabled)}
                        onDeleteHistory={() => {
                          void handleDeleteWebDomainHistory(candidate);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div key={contentPaneKey} className="qp-classification-object-pane h-full">
            <div className="h-full flex items-center justify-center text-sm text-[var(--qp-text-tertiary)]">
              {UI_TEXT.mapping.emptyState}
            </div>
          </div>
        ) : (
          <div key={contentPaneKey} className="qp-classification-object-pane h-full overflow-y-auto custom-scrollbar pr-1">
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              {filteredCandidates.map((candidate) => {
                const displayName = resolveEffectiveDisplayName(candidate);
                const displayColor = resolveCandidateColor(candidate);
                const assignedCategory = resolveMappedCategory(candidate);
                const trackingEnabled = resolveTrackingEnabled(candidate);
                const titleCaptureEnabled = resolveTitleCaptureEnabled(candidate);
                const isBusy = saving || deletingSessionsExe === candidate.exeName;
                const isEditingName = editingNameExe === candidate.exeName;
                const inputValue = nameDrafts[candidate.exeName] ?? displayName;

                return (
                  <AppMappingCandidateCard
                    key={candidate.exeName}
                    candidate={candidate}
                    icon={icons[candidate.exeName]}
                    displayName={displayName}
                    displayColor={displayColor}
                    assignedCategory={assignedCategory}
                    trackingEnabled={trackingEnabled}
                    titleCaptureEnabled={titleCaptureEnabled}
                    globalTitleEnabled={titleRecordingEnabled}
                    isBusy={isBusy}
                    isEditingName={isEditingName}
                    inputValue={inputValue}
                    colorFormat={colorFormat}
                    categoryOptions={candidateCategoryOptions}
                    onNameDraftChange={(nextValue) => syncNameDraftToPageDraft(candidate, nextValue)}
                    onNameBlur={() => {
                      handleNameBlur(candidate);
                    }}
                    onNameEditCancel={() => {
                      handleNameEditCancel(candidate);
                    }}
                    onStartNameEdit={() => {
                      startNameEdit(candidate);
                    }}
                    onColorAssign={(nextColor) => handleColorAssign(candidate, nextColor)}
                    onColorFormatChange={setColorFormat}
                    onCategoryAssign={(value) => handleCategoryAssign(candidate, value)}
                    onToggleTitleCapture={() => handleTitleCaptureToggle(candidate, !titleCaptureEnabled)}
                    onToggleTracking={() => handleTrackingToggle(candidate, !trackingEnabled)}
                    onDeleteAllSessions={() => {
                      void handleDeleteAllSessions(candidate);
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <QuietDialog
        open={showCategoryDialog}
        title={UI_TEXT.mapping.categoryDialogTitle}
        description={UI_TEXT.mapping.categoryDialogDescription}
        onClose={() => setShowCategoryDialog(false)}
        surfaceClassName="qp-category-dialog-surface"
        actions={(
          <>
            <QuietButton
              size="large"
              onClick={() => setShowCategoryDialog(false)}
              className="qp-dialog-action"
            >
              {UI_TEXT.common.close}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void handleCreateCategory()}
              className="qp-dialog-action"
            >
              {UI_TEXT.mapping.createCategoryAction}
            </QuietButton>
          </>
        )}
      >
        <div className="qp-category-dialog-body custom-scrollbar">
          <CategoryColorControls
            categories={categoryControlCategories}
            colorFormat={colorFormat}
            getCategoryLabel={resolveCategoryLabel}
            getCategoryColor={resolveCategoryColor}
            onColorFormatChange={setColorFormat}
            onApplyColor={applyCategoryColor}
            onRenameCategory={(category) => { void handleRenameCategory(category); }}
            onDeleteCategory={(category) => { void handleDeleteCategory(category); }}
          />
        </div>
      </QuietDialog>

      {dialogs}
    </div>
  );
}
