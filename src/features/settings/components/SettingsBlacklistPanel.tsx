import { Plus, X } from "lucide-react";
import { useState } from "react";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietSubpanel from "../../../shared/components/QuietSubpanel";
import { UI_TEXT } from "../../../shared/copy";

interface Props {
  blacklistedApps: string;
  blacklistedDomains: string;
  onBlacklistedAppsChange: (val: string) => void;
  onBlacklistedDomainsChange: (val: string) => void;
}

function parseJsonList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function SettingsBlacklistPanel({
  blacklistedApps,
  blacklistedDomains,
  onBlacklistedAppsChange,
  onBlacklistedDomainsChange,
}: Props) {
  const t = UI_TEXT.settings;
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addMode, setAddMode] = useState<"app" | "domain">("app");
  const [addInput, setAddInput] = useState("");

  const apps = parseJsonList(blacklistedApps);
  const domains = parseJsonList(blacklistedDomains);

  const openAddDialog = (mode: "app" | "domain") => {
    setAddMode(mode);
    setAddInput("");
    setAddDialogOpen(true);
  };

  const handleAdd = () => {
    const val = addInput.trim().toLowerCase();
    if (!val) return;
    if (addMode === "app") {
      const next = [...apps, val];
      onBlacklistedAppsChange(JSON.stringify(next));
    } else {
      const next = [...domains, val];
      onBlacklistedDomainsChange(JSON.stringify(next));
    }
    setAddDialogOpen(false);
  };

  const removeApp = (idx: number) => {
    const next = apps.filter((_, i) => i !== idx);
    onBlacklistedAppsChange(JSON.stringify(next));
  };

  const removeDomain = (idx: number) => {
    const next = domains.filter((_, i) => i !== idx);
    onBlacklistedDomainsChange(JSON.stringify(next));
  };

  const renderList = (
    items: string[],
    onRemove: (idx: number) => void,
    removeLabel: string,
    emptyLabel: string,
  ) => {
    if (items.length === 0) {
      return <p className="text-xs italic text-[var(--qp-text-tertiary)]">{emptyLabel}</p>;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, idx) => (
          <div
            key={item}
            className="flex items-center gap-1 rounded-[6px] bg-[var(--qp-bg-elevated)] border border-[var(--qp-border-subtle)] pl-2 pr-1 py-0.5"
          >
            <span className="text-xs text-[var(--qp-text-primary)]">{item}</span>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              aria-label={removeLabel}
              className="rounded-[4px] p-0.5 text-[var(--qp-text-tertiary)] hover:text-[var(--qp-danger)] hover:bg-[var(--qp-danger)]/10"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <QuietSubpanel>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{t.blacklistTitle}</p>
          </div>
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-[var(--qp-text-secondary)]">{t.blacklistAppsLabel}</p>
              <button
                type="button"
                onClick={() => openAddDialog("app")}
                className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-xs font-semibold text-[var(--qp-accent-default)] hover:bg-[var(--qp-accent-subtle)]"
              >
                <Plus size={12} />
                {t.blacklistAddApp}
              </button>
            </div>
            <p className="text-xs text-[var(--qp-text-tertiary)] mb-2">{t.blacklistAppsHint}</p>
            {renderList(apps, removeApp, t.blacklistRemoveApp, t.blacklistEmpty)}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-[var(--qp-text-secondary)]">{t.blacklistDomainsLabel}</p>
              <button
                type="button"
                onClick={() => openAddDialog("domain")}
                className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-xs font-semibold text-[var(--qp-accent-default)] hover:bg-[var(--qp-accent-subtle)]"
              >
                <Plus size={12} />
                {t.blacklistAddDomain}
              </button>
            </div>
            <p className="text-xs text-[var(--qp-text-tertiary)] mb-2">{t.blacklistDomainsHint}</p>
            {renderList(domains, removeDomain, t.blacklistRemoveDomain, t.blacklistEmpty)}
          </div>
        </div>
      </QuietSubpanel>

      <QuietDialog
        open={addDialogOpen}
        title={t.blacklistAddTitle}
        onClose={() => setAddDialogOpen(false)}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setAddDialogOpen(false)}
              className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold"
            >
              {UI_TEXT.dialog.cancel}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!addInput.trim()}
              className="qp-button-primary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold disabled:opacity-50"
            >
              {addMode === "app" ? t.blacklistAddAppConfirm : t.blacklistAddDomainConfirm}
            </button>
          </>
        )}
      >
        <input
          autoFocus
          type="text"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder={addMode === "app" ? t.blacklistAddAppPlaceholder : t.blacklistAddDomainPlaceholder}
          className="qp-input h-[34px] w-full mt-2"
        />
      </QuietDialog>
    </>
  );
}
