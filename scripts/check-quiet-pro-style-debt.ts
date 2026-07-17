import { readFileSync } from "node:fs";

const ARBITRARY_RADIUS_BASELINE: Record<string, number> = {
  "src/app/components/AppSidebar.tsx": 3,
  "src/features/update/components/UpdateStatusPanel.tsx": 0,
  "src/shared/components/QuietStepperSlider.tsx": 0,
  "src/features/dashboard/components/Dashboard.tsx": 2,
  "src/features/classification/components/WebDomainMappingCard.tsx": 4,
  "src/features/classification/components/AppMappingCandidateCard.tsx": 4,
  "src/features/classification/components/AppMapping.tsx": 4,
  "src/features/classification/components/CategoryColorControls.tsx": 1,
  "src/features/settings/components/Settings.tsx": 3,
  "src/features/history/components/History.tsx": 2,
  "src/features/settings/components/SettingsDataSafetyPanel.tsx": 8,
  "src/features/settings/components/SettingsRemoteBackupPanel.tsx": 9,
  "src/features/history/components/HistoryTimelineDialogDateControls.tsx": 2,
  "src/features/history/components/HistoryTimelineLists.tsx": 8,
};

const failures: string[] = [];
for (const [path, budget] of Object.entries(ARBITRARY_RADIUS_BASELINE)) {
  const count = readFileSync(path, "utf8").match(/rounded-\[/g)?.length ?? 0;
  if (count > budget) failures.push(`${path}: ${count} arbitrary radii exceeds debt baseline ${budget}`);
  if (count < budget) failures.push(`${path}: debt shrank to ${count}; tighten baseline ${budget}`);
}

if (failures.length > 0) {
  console.error("Quiet Pro arbitrary-radius debt guard failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  const totalBaseline = Object.values(ARBITRARY_RADIUS_BASELINE)
    .reduce((total, count) => total + count, 0);
  console.log(`Quiet Pro arbitrary-radius debt guard passed (${totalBaseline} exact historical occurrences; no growth allowed)`);
}
