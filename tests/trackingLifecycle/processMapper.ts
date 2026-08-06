import {
  assert,
  buildNormalizedAppStats,
  buildDashboardReadModel,
  compileSessions,
  buildHistoryReadModel,
  makeSession,
  ProcessMapper,
  resolveCanonicalExecutable,
  resolveTrackerHealth,
  runTest,
  shouldTrackProcess,
} from "./shared.ts";
import { getLocaleText } from "../../src/shared/i18n/runtime.ts";

export function runProcessMapperTests() {
  runTest("system windows processes are excluded from tracking", () => {
    const blockedProcesses = [
      "System",
      "smss.exe",
      "csrss.exe",
      "wininit.exe",
      "logonui.exe",
      "lsass.exe",
      "services.exe",
      "winlogon.exe",
      "svchost.exe",
      "SearchHost.exe",
      "ShellExperienceHost.exe",
      "Consent.exe",
      "PickerHost.exe",
      "GameInputSvc.exe",
      "dwm.exe",
      "runtimebroker.exe",
      "ApplicationFrameHost.exe",
      "StartMenuExperienceHost.exe",
      "TextInputHost.exe",
      "fontdrvhost.exe",
      "taskhostw.exe",
      "LockApp.exe",
      "OpenWith.exe",
      "wuauclt.exe",
      "UsoClient.exe",
      "sihost.exe",
      "taskmgr.exe",
      "regedit.exe",
      "mmc.exe",
      "control.exe",
      "shellhost.exe",
    ];

    for (const exeName of blockedProcesses) {
      assert.equal(shouldTrackProcess(exeName), false);
      assert.equal(ProcessMapper.shouldTrack(exeName), false);
    }

    assert.equal(ProcessMapper.shouldTrack("Antigravity.exe"), true);
  });

  runTest("terminal apps stay trackable but unclassified until assigned", () => {
    for (
      const exeName of [
        "cmd.exe",
        "powershell.exe",
        "pwsh.exe",
        "windowsterminal.exe",
        "wt.exe",
        "conhost.exe",
        "openconsole.exe",
      ]
    ) {
      assert.equal(shouldTrackProcess(exeName), true);
      assert.equal(ProcessMapper.shouldTrack(exeName), true);
      assert.equal(ProcessMapper.map(exeName).category, "other");
    }
  });

  runTest("file explorer is treated as a normal unclassified app", () => {
    ProcessMapper.clearUserOverrides();
    assert.equal(shouldTrackProcess("explorer.exe"), true);
    assert.equal(ProcessMapper.shouldTrack("explorer.exe"), true);
    assert.equal(ProcessMapper.map("explorer.exe").category, "other");

    assert.equal(
      ProcessMapper.map("explorer.exe", { appName: "文件资源管理器" }).name,
      "文件资源管理器",
    );
    assert.equal(ProcessMapper.map("explorer.exe").name, "Explorer");

    ProcessMapper.setUserOverride("explorer.exe", {
      displayName: "Files",
      enabled: true,
      updatedAt: Date.now(),
    });
    assert.equal(ProcessMapper.map("explorer.exe", { appName: "文件资源管理器" }).name, "Files");

    ProcessMapper.clearUserOverrides();
  });

  runTest("wallpaper engine app windows remain trackable but unclassified", () => {
    for (const exeName of ["ui32.exe", "wallpaper32.exe", "wallpaper64.exe", "wallpaperengine.exe"]) {
      assert.equal(shouldTrackProcess(exeName), true);
      assert.equal(ProcessMapper.shouldTrack(exeName), true);
      assert.equal(ProcessMapper.map(exeName).category, "other");
    }
  });

  runTest("Patina itself remains trackable and uses the Patina display name", () => {
    ProcessMapper.clearUserOverrides();

    for (
      const exeName of [
        "patina.exe",
        "patina",
        "time_tracker.exe",
        "time_tracker",
        "time-tracker.exe",
        "time-tracker",
        "timetracker.exe",
        "timetracker",
        "time tracker.exe",
        "time tracker",
      ]
    ) {
      assert.equal(shouldTrackProcess(exeName), true);
      assert.equal(ProcessMapper.shouldTrack(exeName), true);
      assert.equal(ProcessMapper.map(exeName, { appName: "Patina" }).name, "Patina");
      assert.equal(ProcessMapper.map(exeName).category, "other");
    }
  });

  runTest("process mapper can exclude an app from tracking via override", () => {
    ProcessMapper.clearUserOverrides();
    assert.equal(ProcessMapper.shouldTrack("QQ.exe"), true);

    ProcessMapper.setUserOverride("QQ.exe", {
      track: false,
      enabled: true,
      updatedAt: Date.now(),
    });

    assert.equal(ProcessMapper.shouldTrack("QQ.exe"), false);
    ProcessMapper.clearUserOverrides();
  });

  runTest("process mapper can disable title capture per app without affecting tracking", () => {
    ProcessMapper.clearUserOverrides();
    assert.equal(ProcessMapper.shouldTrack("QQ.exe"), true);

    ProcessMapper.setUserOverride("QQ.exe", {
      captureTitle: false,
      enabled: true,
      updatedAt: Date.now(),
    });

    const override = ProcessMapper.getUserOverride("QQ.exe");
    assert.equal(override?.captureTitle, false);
    assert.equal(ProcessMapper.shouldTrack("QQ.exe"), true);

    const persisted = ProcessMapper.toOverrideStorageValue({
      captureTitle: false,
      enabled: true,
      updatedAt: Date.now(),
    });
    const parsed = ProcessMapper.fromOverrideStorageValue(persisted);
    assert.equal(parsed?.captureTitle, false);

    ProcessMapper.clearUserOverrides();
  });

  runTest("process mapper resolves known alias executables to canonical app identity", () => {
    const mapped = ProcessMapper.map("DouYin_Tray.exe");

    assert.equal(mapped.name, "Douyin");
    assert.equal(mapped.category, "other");
  });

  runTest("process mapper user override can reclassify an unknown app", () => {
    ProcessMapper.clearUserOverrides();
    const before = ProcessMapper.map("atlas.exe");
    assert.equal(before.category, "other");

    ProcessMapper.setUserOverride("atlas.exe", {
      category: "utility",
      enabled: true,
      updatedAt: Date.now(),
    });

    const after = ProcessMapper.map("atlas.exe");
    assert.equal(after.category, "utility");

    ProcessMapper.clearUserOverrides();
  });

  runTest("ordinary apps stay unclassified until the user explicitly assigns a category", () => {
    ProcessMapper.clearUserOverrides();

    for (const exeName of [
      "wps.exe",
      "chrome.exe",
      "sublime_text.exe",
      "atlas.exe",
      "mycodec.exe",
      "knowledge.exe",
      "openair.exe",
    ]) {
      assert.equal(ProcessMapper.map(exeName).category, "other");
    }

    ProcessMapper.setUserOverride("wps.exe", {
      category: "office",
      enabled: true,
      updatedAt: Date.now(),
    });
    assert.equal(ProcessMapper.map("wps.exe").category, "office");

    ProcessMapper.clearUserOverrides();
  });

  runTest("non-category overrides do not classify an app", () => {
    ProcessMapper.clearUserOverrides();
    ProcessMapper.setUserOverride("chrome.exe", {
      displayName: "Work Browser",
      color: "#112233",
      captureTitle: false,
      enabled: true,
      updatedAt: Date.now(),
    });

    assert.equal(ProcessMapper.map("chrome.exe").category, "other");
    assert.equal(ProcessMapper.map("chrome.exe").name, "Work Browser");

    ProcessMapper.clearUserOverrides();
  });

  runTest("process mapper allows assigning extended category ids", () => {
    ProcessMapper.clearUserOverrides();

    ProcessMapper.setUserOverride("atlas.exe", {
      category: "custom:\u4e13\u6ce8",
      enabled: true,
      updatedAt: Date.now(),
    });

    const mapped = ProcessMapper.map("atlas.exe");
    assert.equal(mapped.category, "custom:%E4%B8%93%E6%B3%A8");
    assert.equal(
      ProcessMapper.getCategoryLabel("custom:\u4e13\u6ce8", getLocaleText("zh-CN")),
      "\u4e13\u6ce8",
    );

    ProcessMapper.clearUserOverrides();
  });

  runTest("ordinary desktop apps remain unclassified without user overrides", () => {
    ProcessMapper.clearUserOverrides();
    const cases: Array<{ exeName: string; appName: string; expectedCategory: string }> = [
      { exeName: "vscodium.exe", appName: "VSCodium", expectedCategory: "other" },
      { exeName: "alma.exe", appName: "Alma", expectedCategory: "other" },
      { exeName: "zotero.exe", appName: "Zotero", expectedCategory: "other" },
      { exeName: "ToDesk.exe", appName: "ToDesk", expectedCategory: "other" },
      { exeName: "HoYoPlay.exe", appName: "HoYoPlay", expectedCategory: "other" },
      { exeName: "atlas.exe", appName: "Atlas", expectedCategory: "other" },
    ];

    for (const item of cases) {
      const mapped = ProcessMapper.map(item.exeName, { appName: item.appName });
      assert.equal(mapped.category, item.expectedCategory);
    }
  });

  runTest("runtime application names are not replaced by a static software catalog", () => {
    ProcessMapper.clearUserOverrides();
    const mapped = ProcessMapper.map("windowsterminal.exe", { appName: "WindowsTerminal" });

    assert.equal(mapped.name, "WindowsTerminal");
    assert.equal(mapped.category, "other");
  });

  runTest("display name overrides propagate into compiled app stats", () => {
    ProcessMapper.clearUserOverrides();
    ProcessMapper.setUserOverride("vscodium.exe", {
      displayName: "CodeLab",
      enabled: true,
      updatedAt: Date.now(),
    });

    const compiled = compileSessions([
      makeSession({
        id: 1,
        exeName: "vscodium.exe",
        appName: "VSCodium",
        startTime: 0,
        endTime: 60_000,
        duration: 60_000,
      }),
    ], {
      startMs: 0,
      endMs: 120_000,
      minSessionSecs: 0,
    });
    const stats = buildNormalizedAppStats(compiled);
    assert.equal(stats.length, 1);
    assert.equal(stats[0].appName, "CodeLab");
    ProcessMapper.clearUserOverrides();
  });

  runTest("history read model applies display name overrides globally", () => {
    ProcessMapper.clearUserOverrides();
    ProcessMapper.setUserOverride("vscodium.exe", {
      displayName: "CodeLab",
      enabled: true,
      updatedAt: Date.now(),
    });

    const trackerHealth = resolveTrackerHealth(120_000, 120_000, 8_000);
    const historyView = buildHistoryReadModel({
      daySessions: [
        makeSession({
          id: 1,
          exeName: "vscodium.exe",
          appName: "VSCodium",
          startTime: 0,
          endTime: 60_000,
          duration: 60_000,
        }),
      ],
      weeklySessions: [],
      selectedDate: new Date(0),
      trackerHealth,
      nowMs: 120_000,
      minSessionSecs: 0,
      mergeThresholdSecs: 180,
    });

    assert.equal(historyView.appSummary.length, 1);
    assert.equal(historyView.appSummary[0].appName, "CodeLab");
    assert.equal(historyView.timelineSessions.length, 1);
    assert.equal(historyView.timelineSessions[0].displayName, "CodeLab");
    ProcessMapper.clearUserOverrides();
  });

  runTest("history read model excludes apps marked as not tracked", () => {
    ProcessMapper.clearUserOverrides();
    ProcessMapper.setUserOverride("qq.exe", {
      track: false,
      enabled: true,
      updatedAt: Date.now(),
    });

    const trackerHealth = resolveTrackerHealth(120_000, 120_000, 8_000);
    const historyView = buildHistoryReadModel({
      daySessions: [
        makeSession({
          id: 1,
          exeName: "QQ.exe",
          appName: "QQ",
          startTime: 0,
          endTime: 60_000,
          duration: 60_000,
        }),
        makeSession({
          id: 2,
          exeName: "chrome.exe",
          appName: "Google Chrome",
          startTime: 65_000,
          endTime: 125_000,
          duration: 60_000,
        }),
      ],
      weeklySessions: [],
      selectedDate: new Date(0),
      trackerHealth,
      nowMs: 120_000,
      minSessionSecs: 0,
      mergeThresholdSecs: 180,
    });

    assert.equal(historyView.appSummary.length, 1);
    assert.equal(historyView.appSummary[0].exeName.toLowerCase(), "chrome.exe");
    assert.equal(historyView.timelineSessions.length, 1);
    assert.equal(historyView.timelineSessions[0].exeName.toLowerCase(), "chrome.exe");
    ProcessMapper.clearUserOverrides();
  });

  runTest("dashboard recomputes every derived metric after an app is excluded", () => {
    ProcessMapper.clearUserOverrides();
    ProcessMapper.setUserOverride("qq.exe", {
      track: false,
      enabled: true,
      updatedAt: Date.now(),
    });

    try {
      const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
      const todayStart = new Date(2026, 4, 8, 0, 0, 0).getTime();
      const yesterdayStart = new Date(2026, 4, 7, 0, 0, 0).getTime();
      const trackerHealth = resolveTrackerHealth(nowMs, nowMs, 8_000);
      const dashboard = buildDashboardReadModel(
        [
          makeSession({
            id: 1,
            exeName: "QQ.exe",
            appName: "QQ",
            startTime: todayStart + 9 * 60 * 60_000,
            endTime: todayStart + 10 * 60 * 60_000,
            duration: 60 * 60_000,
          }),
          makeSession({
            id: 2,
            exeName: "chrome.exe",
            appName: "Google Chrome",
            startTime: todayStart + 10 * 60 * 60_000,
            endTime: todayStart + 10.5 * 60 * 60_000,
            duration: 30 * 60_000,
          }),
        ],
        trackerHealth,
        nowMs,
        [
          makeSession({
            id: 3,
            exeName: "QQ.exe",
            appName: "QQ",
            startTime: yesterdayStart + 9 * 60 * 60_000,
            endTime: yesterdayStart + 10 * 60 * 60_000,
            duration: 60 * 60_000,
          }),
          makeSession({
            id: 4,
            exeName: "chrome.exe",
            appName: "Google Chrome",
            startTime: yesterdayStart + 10 * 60 * 60_000,
            endTime: yesterdayStart + 10.25 * 60 * 60_000,
            duration: 15 * 60_000,
          }),
        ],
      );

      assert.equal(dashboard.totalTrackedTime, 30 * 60_000);
      assert.equal(dashboard.yesterdayTrackedTime, 15 * 60_000);
      assert.deepEqual(dashboard.topApplications.map((item) => item.exeName), ["chrome.exe"]);
      assert.equal(dashboard.topApplications[0]?.percentage, 100);
      assert.equal(dashboard.categoryDist.length, 1);
      assert.equal(dashboard.categoryDist[0]?.value, 30 * 60_000);
      assert.equal(dashboard.hourlyActivity[9]?.minutes ?? 0, 0);
      assert.equal(dashboard.hourlyActivity[10]?.minutes, 30);
      assert.equal(
        Object.values(dashboard.hourlyCategoryActivity[9] ?? {})
          .reduce<number>((sum, minutes) => sum + Number(minutes), 0),
        0,
      );
    } finally {
      ProcessMapper.clearUserOverrides();
    }
  });

  runTest("process mapper color output stays stable for same app key", () => {
    ProcessMapper.clearUserOverrides();
    const first = ProcessMapper.map("vscodium.exe", { appName: "VSCodium" });
    const second = ProcessMapper.map("vscodium.exe", { appName: "VSCodium" });
    assert.equal(first.color, second.color);
  });

  runTest("canonical normalization resolves aliases and filters PickerHost", () => {
    assert.equal(resolveCanonicalExecutable("Douyin_tray.exe"), "douyin.exe");
    assert.equal(resolveCanonicalExecutable("Douyin_widget"), "douyin.exe");
    assert.equal(resolveCanonicalExecutable("steamwebhelper.exe"), "steam.exe");
    assert.equal(resolveCanonicalExecutable("alma-0.0.750-win-x64.exe"), "alma.exe");
    assert.equal(resolveCanonicalExecutable("cursor-updater.exe"), "cursor.exe");
    assert.equal(resolveCanonicalExecutable("setup-notion.exe"), "notion.exe");
    assert.equal(resolveCanonicalExecutable("setup-notion-beta.exe"), "notion.exe");
    assert.equal(resolveCanonicalExecutable("beta-setup-notion.exe"), "beta-setup-notion.exe");
    assert.equal(resolveCanonicalExecutable("obsidian-uninstall.exe"), "obsidian.exe");
    assert.equal(resolveCanonicalExecutable("unknownhelper.exe"), "unknownhelper.exe");
    assert.equal(resolveCanonicalExecutable("product-updater.exe"), "product-updater.exe");
    assert.equal(shouldTrackProcess("PickerHost.exe"), false);
    assert.equal(shouldTrackProcess("pickerhost"), false);
    assert.equal(shouldTrackProcess("uninstall.exe"), false);
    assert.equal(shouldTrackProcess("unins000.exe"), false);
    assert.equal(shouldTrackProcess("un_A.exe"), false);
    assert.equal(shouldTrackProcess("un_a"), false);
    assert.equal(shouldTrackProcess("msiexec.exe"), false);
    assert.equal(ProcessMapper.shouldTrack("msiexec.exe"), false);
    assert.equal(shouldTrackProcess("obsidian-setup.exe"), false);
    assert.equal(shouldTrackProcess("cursor-installer.exe"), false);
    assert.equal(shouldTrackProcess("cursor-updater.exe"), false);
    assert.equal(ProcessMapper.shouldTrack("cursor-updater.exe"), false);
    assert.equal(shouldTrackProcess("hrupdate.exe"), false);
    assert.equal(shouldTrackProcess("weixinupdate.exe", { appName: "WeChatUpdate" }), false);
    assert.equal(shouldTrackProcess("microsoftedgeupdate.exe", { appName: "Microsoft Edge Update" }), false);
    assert.equal(shouldTrackProcess("productupdate.exe", { appName: "Product Update" }), false);
    assert.equal(shouldTrackProcess("productupdater.exe", { appName: "Product Updater" }), false);
    assert.equal(shouldTrackProcess("productinstall.exe", { appName: "ProductInstall" }), false);
    assert.equal(shouldTrackProcess("productupdate.exe", { appName: "Productivity Update" }), true);
    assert.equal(shouldTrackProcess("productinstall.exe", { appName: "Product Install Studio" }), true);
    assert.equal(shouldTrackProcess("maintenancetool.exe"), false);
    assert.equal(shouldTrackProcess("bscccloud-3.33.0.tmp", {
      appName: "Setup/Uninstall",
    }), false);
    assert.equal(shouldTrackProcess("geek.exe", {
      appName: "Geek Uninstaller",
    }), true);
    assert.equal(shouldTrackProcess("geek-uninstaller.exe", {
      appName: "Geek Uninstaller",
    }), true);
    assert.equal(shouldTrackProcess("bcuninstaller.exe", {
      appName: "Bulk Crap Uninstaller",
    }), true);
    assert.equal(shouldTrackProcess("alma-0.0.750-win-x64.exe", {
      appName: "AI Provider Management Desktop App",
      windowTitle: "Alma \u5b89\u88c5",
    }), false);
    assert.equal(shouldTrackProcess("alma-0.0.750-win-x64.exe", {
      appName: "AI Provider Management Desktop App",
      windowTitle: "Alma",
    }), true);
    assert.equal(shouldTrackProcess("launcher.exe", {
      appName: "Wallpaper Engine Launcher",
    }), false);
    assert.equal(shouldTrackProcess("launcher.exe", {
      appName: "Game Launcher",
    }), true);
    assert.equal(shouldTrackProcess("Antigravity.exe"), true);
    assert.equal(shouldTrackProcess("patina.exe"), true);
    assert.equal(shouldTrackProcess("time_tracker.exe"), true);
    assert.equal(shouldTrackProcess("time-tracker.exe"), true);
  });
}
