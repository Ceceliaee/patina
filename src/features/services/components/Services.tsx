import { Database, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import { UI_TEXT } from "../../../shared/copy";
import type { AppSettings } from "../../../shared/settings/appSettings";
import { saveAppSetting } from "../../../platform/persistence/appSettingsStore";
import { getSettingsBootstrapCache } from "../../settings/services/settingsBootstrapCache";
import { loadSettingsPageBootstrap } from "../../settings/services/settingsBootstrapService";
import SettingsInterfacePanel from "../../settings/components/SettingsInterfacePanel";
import StorageToolPanel from "./StorageToolPanel";
import { useStoragePageState } from "../hooks/useStoragePageState";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";

type ServicesTab = "extensions" | "storage";

export default function Services() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<ServicesTab>("extensions");
  const storageState = useStoragePageState();

  useEffect(() => {
    const cached = getSettingsBootstrapCache();
    if (cached) {
      setSettings(cached.settings);
      setLoading(false);
    }
    loadSettingsPageBootstrap()
      .then((bootstrap) => {
        setSettings(bootstrap.settings);
        setLoading(false);
      })
      .catch((err) => {
        console.error("load services settings failed", err);
        setLoading(false);
      });
  }, []);

  const handleChange = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      saveAppSetting(key, value).catch((err) => {
        console.error(`save ${key} failed`, err);
      });
      return next;
    });
  }, []);

  if (loading || !settings) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] gap-3">
        <RefreshCw className="animate-spin" size={20} />
        <span className="text-sm font-medium">{UI_TEXT.settings.loading}</span>
      </div>
    );
  }

  const tabOptions: Array<{ value: ServicesTab; label: string; icon: React.ReactNode }> = [
    { value: "extensions", label: UI_TEXT.services.tabExtensions, icon: <Server size={14} /> },
    { value: "storage", label: UI_TEXT.services.tabStorage, icon: <Database size={14} /> },
  ];

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-4 md:gap-5">
      <QuietPageHeader
        icon={<Server size={18} />}
        title={UI_TEXT.services.title}
        subtitle={UI_TEXT.services.subtitle}
        rightSlot={
          <QuietSegmentedFilter
            value={activeTab}
            options={tabOptions.map((t) => ({ value: t.value, label: t.label }))}
            onChange={(next) => setActiveTab(next as ServicesTab)}
          />
        }
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <div className="grid grid-cols-1 gap-4 md:gap-5">
          {activeTab === "extensions" && (
            <SettingsInterfacePanel
              webActivityEnabled={settings.webActivityEnabled}
              showWebActivityHelp={false}
              port={settings.webActivityPort}
              webActivityToken={settings.webActivityToken}
              privacyMode={settings.privacyMode}
              remoteStatusBridgeEnabled={settings.remoteStatusBridgeEnabled}
              remoteStatusBridgeUrl={settings.remoteStatusBridgeUrl}
              remoteStatusBridgeToken={settings.remoteStatusBridgeToken}
              remoteStatusBridgeMachineId={settings.remoteStatusBridgeMachineId}
              blacklistedApps={settings.blacklistedApps}
              blacklistedDomains={settings.blacklistedDomains}
              customScanDirs={settings.customScanDirs}
              onWebActivityEnabledChange={(nextChecked) => handleChange("webActivityEnabled", nextChecked)}
              onPortChange={(nextPort) => handleChange("webActivityPort", nextPort)}
              onWebActivityTokenChange={(nextToken) => handleChange("webActivityToken", nextToken)}
              onPrivacyModeChange={(nextChecked) => handleChange("privacyMode", nextChecked)}
              onRemoteStatusBridgeEnabledChange={(nextChecked) => handleChange("remoteStatusBridgeEnabled", nextChecked)}
              onRemoteStatusBridgeUrlChange={(nextUrl) => handleChange("remoteStatusBridgeUrl", nextUrl)}
              onRemoteStatusBridgeTokenChange={(nextToken) => handleChange("remoteStatusBridgeToken", nextToken)}
              onBlacklistedAppsChange={(val) => handleChange("blacklistedApps", val)}
              onBlacklistedDomainsChange={(val) => handleChange("blacklistedDomains", val)}
              onCustomScanDirsChange={(val) => handleChange("customScanDirs", val)}
            />
          )}
          {activeTab === "storage" && (
            <StorageToolPanel
              cleanupRange={storageState.cleanupRange}
              cleanupOptions={storageState.cleanupOptions}
              restoreStrategy={storageState.restoreStrategy}
              isCleaning={storageState.isCleaning}
              isExportingBackup={storageState.isExportingBackup}
              isRestoringBackup={storageState.isRestoringBackup}
              onCleanupRangeChange={storageState.setCleanupRange}
              onRestoreStrategyChange={storageState.setRestoreStrategy}
              onCleanup={storageState.handleCleanup}
              onExportBackup={storageState.handleExportBackup}
              onPrepareRestoreBackup={storageState.handlePrepareRestoreBackup}
              onRestoreBackup={storageState.handleRestoreBackup}
              onClearPendingRestoreBackup={storageState.handleClearPendingRestoreBackup}
              remoteBackup={storageState.remoteBackup}
              storageSnapshot={storageState.storageSnapshot}
              isStorageBusy={storageState.isStorageBusy}
              onRefreshStorageSnapshot={storageState.handleRefreshStorageSnapshot}
              onScheduleWebviewCacheClear={storageState.handleScheduleWebviewCacheClear}
              onChooseDataDirectory={storageState.handleChooseDataDirectory}
              onChooseCacheDirectory={storageState.handleChooseCacheDirectory}
              onRestoreDefaultDataDirectory={storageState.handleRestoreDefaultDataDirectory}
              onRestoreDefaultCacheDirectory={storageState.handleRestoreDefaultCacheDirectory}
              onCancelPendingStorageMigration={storageState.handleCancelPendingStorageMigration}
              onOpenStorageDirectory={storageState.handleOpenStorageDirectory}
            />
          )}
        </div>
      </div>
    </div>
  );
}
