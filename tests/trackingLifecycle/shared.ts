import assert from "node:assert/strict";
import {
  isTrackableWindow,
  planWindowTransition,
  resolveStartupSealTime,
} from "../helpers/trackingWindowLifecycle.ts";
import {
  buildDailySummaries,
  buildNormalizedAppStats,
  buildTimelineSessions,
  compileSessions,
  getDayRange,
  getRollingDayRanges,
} from "../../src/shared/lib/sessionReadCompiler.ts";
import {
  buildReadModelDiagnostics,
  materializeLiveSessions,
  resolveLiveCutoffMs,
} from "../../src/shared/lib/readModelCore.ts";
import { buildDashboardReadModel } from "../../src/features/dashboard/services/dashboardReadModel.ts";
import { buildHistoryReadModel } from "../../src/features/history/services/historyReadModel.ts";
import type { HistorySession } from "../../src/shared/types/sessions.ts";
import {
  resolveTrackerHealth,
  type TrackedWindow,
} from "../../src/shared/types/tracking.ts";
import {
  isRawCurrentTrackingSnapshot,
  isRawTrackingDataChangedPayload,
  isRawTrackingWindowSnapshot,
} from "../../src/platform/runtime/trackingRawDtos.ts";
import { AppClassification } from "../../src/shared/classification/appClassification.ts";
import { ProcessMapper } from "../../src/shared/classification/processMapper.ts";
import {
  applyMappingOverridesReadModelRefresh,
  applySessionDeletionReadModelRefresh,
  INITIAL_READ_MODEL_REFRESH_STATE,
  resolveReadModelRefreshSignal,
} from "../../src/app/services/readModelRefreshState.ts";
import {
  loadDashboardRuntimeSnapshotWithDeps,
  loadHistoryRuntimeSnapshotWithDeps,
} from "../../src/app/services/readModelRuntimeService.ts";
import { resolveTrackingDataChangedEffects } from "../../src/app/hooks/trackingDataChangedPolicy.ts";
import { applyTrackingDataChangedPayload } from "../../src/app/hooks/trackingDataChangedRuntime.ts";
import {
  clearSessionsByRangeWithDeps,
  resolveSessionStartCleanupCutoffTime,
  buildSessionCleanupPlan,
  shouldDeleteSessionByStartTime,
} from "../../src/features/settings/services/sessionCleanupPolicy.ts";
import {
  createTestHarness,
  makeSession,
  makeWindow,
} from "../helpers/trackingTestHarness.ts";

export {
  assert,
  buildDailySummaries,
  buildNormalizedAppStats,
  buildReadModelDiagnostics,
  buildSessionCleanupPlan,
  clearSessionsByRangeWithDeps,
  buildTimelineSessions,
  compileSessions,
  buildDashboardReadModel,
  buildHistoryReadModel,
  INITIAL_READ_MODEL_REFRESH_STATE,
  isTrackableWindow,
  isRawCurrentTrackingSnapshot,
  isRawTrackingDataChangedPayload,
  isRawTrackingWindowSnapshot,
  materializeLiveSessions,
  makeSession,
  makeWindow,
  applyMappingOverridesReadModelRefresh,
  applySessionDeletionReadModelRefresh,
  loadDashboardRuntimeSnapshotWithDeps,
  loadHistoryRuntimeSnapshotWithDeps,
  planWindowTransition,
  ProcessMapper,
  resolveLiveCutoffMs,
  resolveReadModelRefreshSignal,
  resolveSessionStartCleanupCutoffTime,
  resolveStartupSealTime,
  resolveTrackerHealth,
  resolveTrackingDataChangedEffects,
  applyTrackingDataChangedPayload,
  shouldDeleteSessionByStartTime,
  getDayRange,
  getRollingDayRanges,
};

export type {
  HistorySession,
  TrackedWindow,
};

export const shouldTrack = (exeName: string) => !["patina.exe", "time_tracker.exe"].includes(exeName.toLowerCase());
export const resolveCanonicalDisplayName = AppClassification.resolveCanonicalDisplayName;
export const resolveCanonicalExecutable = AppClassification.resolveCanonicalExecutable;
export const shouldTrackProcess = AppClassification.shouldTrackProcess;

const harness = createTestHarness();

export const runTest = harness.run;

export async function finishTrackingLifecycleTests() {
  await harness.finish("tracking lifecycle");
}
