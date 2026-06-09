import assert from "node:assert/strict";
import {
  buildUpdateConfirmDialogModel,
  buildUpdateStatusPanelModel,
  shouldOpenUpdateDialogForSnapshot,
  shouldShowSidebarUpdateEntry,
} from "../src/features/update/services/updateViewModel.ts";
import {
  clearPendingUpdateRelaunchViewRestore,
  consumePendingUpdateRelaunchView,
  markPendingUpdateRelaunchViewRestore,
  rememberLastActiveView,
} from "../src/app/services/updateRelaunchViewStorage.ts";
import { setUiTextLanguage } from "../src/shared/copy/uiText.ts";
import type { UpdateSnapshot } from "../src/shared/types/update.ts";

function makeSnapshot(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    currentVersion: "0.1.0",
    status: "idle",
    latestVersion: null,
    releaseNotes: null,
    releaseDate: null,
    errorMessage: null,
    errorStage: null,
    downloadedBytes: null,
    totalBytes: null,
    releasePageUrl: "https://github.com/Ceceliaee/patina/releases",
    assetDownloadUrl: null,
    ...overrides,
  };
}

let passed = 0;

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function withWindowStorage(storage: MemoryStorage, fn: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
}

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

runTest("available uses download action and shows sidebar entry", () => {
  const snapshot = makeSnapshot({
    status: "available",
    latestVersion: "0.1.1",
    assetDownloadUrl: "https://example.com/update.exe",
  });
  const panel = buildUpdateStatusPanelModel(snapshot, false, false);

  assert.equal(panel.primaryAction.label, "立即下载");
  assert.equal(panel.primaryAction.action, "open_confirm");
  assert.equal(panel.secondaryAction, null);
  assert.equal(shouldShowSidebarUpdateEntry(snapshot), true);
  assert.equal(panel.progress, null);
});

runTest("up-to-date uses check action without sidebar entry", () => {
  const snapshot = makeSnapshot({ status: "up_to_date" });
  const panel = buildUpdateStatusPanelModel(snapshot, false, false);

  assert.equal(panel.primaryAction.label, "检查更新");
  assert.equal(panel.primaryAction.action, "check");
  assert.equal(panel.secondaryAction, null);
  assert.equal(shouldShowSidebarUpdateEntry(snapshot), false);
});

runTest("download error prefers direct package download and keeps retry secondary action", () => {
  const panel = buildUpdateStatusPanelModel(makeSnapshot({
    status: "error",
    errorStage: "download",
    errorMessage: "failed to download update: timeout",
    latestVersion: "0.2.3",
    assetDownloadUrl: "https://example.com/update.exe",
  }), false, false);

  assert.equal(panel.statusTitle, "无法下载安装包");
  assert.equal(panel.primaryAction.action, "open_download_url");
  assert.equal(panel.secondaryAction?.action, "check");
});

runTest("check error falls back to release page", () => {
  const panel = buildUpdateStatusPanelModel(makeSnapshot({
    status: "error",
    errorStage: "check",
    errorMessage: "failed to check updates: error sending request for url (https://github.com/Ceceliaee/patina/releases/latest/download/latest.json)",
  }), false, false);

  assert.equal(panel.statusTitle, "无法检查更新");
  assert.equal(panel.statusDetail, "无法访问更新清单。当前网络可能无法连接 GitHub，你可以稍后重试，或手动下载。");
  assert.equal(panel.statusDetail?.includes("failed to check updates"), false);
  assert.equal(panel.statusDetail?.includes("github.com"), false);
  assert.equal(panel.primaryAction.action, "open_release_page");
  assert.equal(panel.secondaryAction?.action, "check");
  assert.equal(shouldShowSidebarUpdateEntry(makeSnapshot({
    status: "error",
    errorStage: "check",
    errorMessage: "failed to check updates: network offline",
  })), false);
});

runTest("checking uses disabled loading action", () => {
  const panel = buildUpdateStatusPanelModel(makeSnapshot({ status: "checking" }), true, false);
  assert.equal(panel.primaryAction.label, "检查中...");
  assert.equal(panel.primaryAction.disabled, true);
  assert.equal(panel.primaryAction.loading, true);
});

runTest("downloading builds determinate progress when total is known", () => {
  const panel = buildUpdateStatusPanelModel(makeSnapshot({
    status: "downloading",
    latestVersion: "0.2.0",
    downloadedBytes: 512,
    totalBytes: 1024,
  }), false, true);

  assert.equal(panel.progress?.valueText, "50%");
  assert.equal(panel.progress?.indeterminate, false);
  assert.equal(shouldShowSidebarUpdateEntry(makeSnapshot({ status: "downloading" })), true);
});

runTest("download preparation does not show a misleading partial progress bar", () => {
  const panel = buildUpdateStatusPanelModel(makeSnapshot({
    status: "downloading",
    latestVersion: "0.2.0",
  }), false, true);

  assert.equal(panel.progress, null);
});

runTest("downloading with bytes but unknown total stays indeterminate", () => {
  const panel = buildUpdateStatusPanelModel(makeSnapshot({
    status: "downloading",
    latestVersion: "0.2.0",
    downloadedBytes: 512,
  }), false, true);

  assert.notEqual(panel.progress, null);
  assert.equal(panel.progress?.percent, null);
  assert.equal(panel.progress?.valueText, null);
  assert.equal(panel.progress?.indeterminate, true);
});

runTest("confirm dialog opens for active update states and structured error states", () => {
  assert.equal(shouldOpenUpdateDialogForSnapshot(makeSnapshot({ status: "available" })), true);
  assert.equal(shouldOpenUpdateDialogForSnapshot(makeSnapshot({ status: "downloaded" })), true);
  assert.equal(shouldOpenUpdateDialogForSnapshot(makeSnapshot({ status: "downloading" })), true);
  assert.equal(shouldOpenUpdateDialogForSnapshot(makeSnapshot({ status: "installing" })), true);
  assert.equal(shouldOpenUpdateDialogForSnapshot(makeSnapshot({
    status: "error",
    errorStage: "download",
    latestVersion: "0.2.0",
  })), true);
  assert.equal(shouldOpenUpdateDialogForSnapshot(makeSnapshot({
    status: "error",
    errorStage: null,
    releasePageUrl: null,
    assetDownloadUrl: null,
    latestVersion: null,
  })), false);
});

runTest("confirm dialog model includes notes preview", () => {
  const model = buildUpdateConfirmDialogModel(makeSnapshot({
    status: "available",
    latestVersion: "0.2.0",
    releaseNotes: "A".repeat(260),
  }));
  assert.equal(model.title, "发现新版本");
  assert.equal(model.primaryAction?.label, "立即下载");
  assert.equal(model.versionCompareLabel, "v0.1.0 -> v0.2.0");
  assert.ok(model.notesPreview !== null);
  assert.ok(model.notesPreview!.length <= 223);
});

runTest("confirm dialog localizes structured release notes", () => {
  setUiTextLanguage("en-US");
  const model = buildUpdateConfirmDialogModel(makeSnapshot({
    status: "available",
    latestVersion: "0.2.0",
    releaseNotes: "zh-CN: 改进应用映射与备份恢复。\nen-US: Improved app mapping and backup restore.",
  }));

  assert.equal(model.notesPreview, "Improved app mapping and backup restore.");
  setUiTextLanguage("zh-CN");
});

runTest("confirm dialog shows progress while downloading", () => {
  const model = buildUpdateConfirmDialogModel(makeSnapshot({
    status: "downloading",
    latestVersion: "0.2.0",
    downloadedBytes: 768,
    totalBytes: 1024,
  }));

  assert.equal(model.title, "正在下载更新");
  assert.equal(model.progress?.valueText, "75%");
  assert.equal(model.progress?.indeterminate, false);
});

runTest("confirm dialog shows manual fallback actions for download errors", () => {
  const model = buildUpdateConfirmDialogModel(makeSnapshot({
    status: "error",
    errorStage: "download",
    errorMessage: "failed to download update",
    latestVersion: "0.2.3",
    assetDownloadUrl: "https://example.com/update.exe",
  }));

  assert.equal(model.title, "下载更新失败");
  assert.equal(model.confirmDescription.includes("failed to download update"), false);
  assert.equal(model.primaryAction?.action, "open_download_url");
  assert.equal(model.secondaryAction?.action, "check");
});

runTest("install error keeps retry install as primary action", () => {
  const snapshot = makeSnapshot({
    status: "error",
    errorStage: "install",
    errorMessage: "failed to install update",
    latestVersion: "0.2.3",
    assetDownloadUrl: "https://example.com/update.exe",
  });
  const panel = buildUpdateStatusPanelModel(snapshot, false, false);

  assert.equal(panel.primaryAction.action, "open_confirm");
  assert.equal(panel.primaryAction.label, "再次安装");
  assert.equal(panel.secondaryAction?.action, "open_download_url");
  assert.equal(shouldShowSidebarUpdateEntry(snapshot), false);
});

runTest("update relaunch view storage migrates legacy keys", () => {
  withWindowStorage(new MemoryStorage(), () => {
    window.localStorage.setItem("time-tracker:last-active-view", "data");
    window.localStorage.setItem("time-tracker:pending-update-relaunch-view", "1");

    assert.equal(consumePendingUpdateRelaunchView(), "data");
    assert.equal(window.localStorage.getItem("patina:last-active-view"), "data");
    assert.equal(window.localStorage.getItem("time-tracker:last-active-view"), null);
    assert.equal(window.localStorage.getItem("patina:pending-update-relaunch-view"), null);
    assert.equal(window.localStorage.getItem("time-tracker:pending-update-relaunch-view"), null);

    rememberLastActiveView("settings");
    markPendingUpdateRelaunchViewRestore();
    assert.equal(window.localStorage.getItem("patina:last-active-view"), "settings");
    assert.equal(window.localStorage.getItem("patina:pending-update-relaunch-view"), "1");

    clearPendingUpdateRelaunchViewRestore();
    assert.equal(window.localStorage.getItem("patina:pending-update-relaunch-view"), null);
  });
});

console.log(`Passed ${passed} update view model tests`);
