import { FolderOpen, Plus, Scan, X } from "lucide-react";
import { useState } from "react";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietSubpanel from "../../../shared/components/QuietSubpanel";
import { UI_TEXT } from "../../../shared/copy";
import { scanDirectoryForExes } from "../../../platform/persistence/classificationSettingsGateway";
import { pickStorageDirectory } from "../../../platform/storage/storageRuntimeGateway";

interface Props {
  customScanDirs: string;
  onCustomScanDirsChange: (val: string) => void;
}

function parseJsonList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

interface ScanResult {
  dir: string;
  exes: Array<{ exeName: string; filePath: string }>;
}

export default function SettingsScanDirsPanel({
  customScanDirs,
  onCustomScanDirsChange,
}: Props) {
  const t = UI_TEXT.settings;
  const dirs = parseJsonList(customScanDirs);
  const [scanningDir, setScanningDir] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);

  const addDir = async () => {
    const dir = await pickStorageDirectory();
    if (!dir) return;
    if (dirs.includes(dir)) return;
    onCustomScanDirsChange(JSON.stringify([...dirs, dir]));
  };

  const removeDir = (idx: number) => {
    onCustomScanDirsChange(JSON.stringify(dirs.filter((_, i) => i !== idx)));
  };

  const scanDir = async (dir: string) => {
    setScanningDir(dir);
    try {
      const exes = await scanDirectoryForExes(dir);
      setScanResults((prev) => {
        const next = prev.filter((r) => r.dir !== dir);
        return [...next, { dir, exes }];
      });
    } catch (err) {
      console.error("scan failed", err);
    } finally {
      setScanningDir(null);
    }
  };

  const scanAll = async () => {
    setScanResults([]);
    for (const dir of dirs) {
      await scanDir(dir);
    }
    setScanDialogOpen(true);
  };

  return (
    <>
      <QuietSubpanel>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{t.scanDirsTitle}</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">{t.scanDirsHint}</p>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {dirs.length === 0 && (
            <p className="text-xs italic text-[var(--qp-text-tertiary)]">{t.scanDirsEmpty}</p>
          )}
          {dirs.map((dir, idx) => (
            <div
              key={dir}
              className="flex items-center gap-2 rounded-[8px] bg-[var(--qp-bg-elevated)] border border-[var(--qp-border-subtle)] px-3 py-2"
            >
              <FolderOpen size={14} className="shrink-0 text-[var(--qp-text-tertiary)]" />
              <span className="flex-1 min-w-0 text-xs text-[var(--qp-text-primary)] truncate">{dir}</span>
              <button
                type="button"
                onClick={() => scanDir(dir)}
                disabled={scanningDir !== null}
                aria-label={t.scanDirsScan}
                className="rounded-[6px] p-1 text-[var(--qp-text-tertiary)] hover:text-[var(--qp-accent-default)] hover:bg-[var(--qp-accent-subtle)] disabled:opacity-50"
              >
                <Scan size={14} />
              </button>
              <button
                type="button"
                onClick={() => removeDir(idx)}
                aria-label={t.scanDirsRemove}
                className="rounded-[6px] p-1 text-[var(--qp-text-tertiary)] hover:text-[var(--qp-danger)] hover:bg-[var(--qp-danger)]/10"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={addDir}
            className="flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-xs font-semibold text-[var(--qp-accent-default)] hover:bg-[var(--qp-accent-subtle)] border border-dashed border-[var(--qp-border-subtle)]"
          >
            <Plus size={12} />
            {t.scanDirsAdd}
          </button>
          {dirs.length > 0 && (
            <button
              type="button"
              onClick={scanAll}
              disabled={scanningDir !== null}
              className="flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-xs font-semibold text-[var(--qp-text-secondary)] hover:bg-[var(--qp-bg-elevated)] border border-[var(--qp-border-subtle)] disabled:opacity-50"
            >
              {scanningDir !== null ? (
                <span className="animate-spin">⟳</span>
              ) : (
                <Scan size={12} />
              )}
              {scanningDir !== null ? t.scanDirsScanning : t.scanDirsScan}
            </button>
          )}
        </div>
      </QuietSubpanel>

      <QuietDialog
        open={scanDialogOpen}
        title={t.scanDirsScanResultTitle}
        onClose={() => setScanDialogOpen(false)}
        actions={(
          <button
            type="button"
            onClick={() => setScanDialogOpen(false)}
            className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold"
          >
            {UI_TEXT.common.close}
          </button>
        )}
      >
        <div className="mt-2 space-y-3 max-h-60 overflow-y-auto">
          {scanResults.length === 0 && (
            <p className="text-xs text-[var(--qp-text-tertiary)]">{t.scanDirsScanResultEmpty}</p>
          )}
          {scanResults.map((result) => (
            <div key={result.dir}>
              <p className="text-xs font-medium text-[var(--qp-text-secondary)] mb-1">{result.dir}</p>
              <p className="text-xs text-[var(--qp-text-tertiary)] mb-1">
                {t.scanDirsScanResultCount.replace("{count}", String(result.exes.length))}
              </p>
              {result.exes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {result.exes.map((exe) => (
                    <div
                      key={exe.exeName}
                      className="rounded-[4px] bg-[var(--qp-bg-elevated)] border border-[var(--qp-border-subtle)] px-1.5 py-0.5"
                    >
                      <span className="text-[11px] text-[var(--qp-text-primary)]">{exe.exeName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </QuietDialog>
    </>
  );
}
