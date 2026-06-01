import { Cable } from "lucide-react";
import { useEffect, useState } from "react";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import { buildLocalApiEnabledChange } from "../services/localApiTokenService.ts";

type SettingsLocalApiPanelProps = {
  enabled: boolean;
  port: number;
  token: string;
  onEnabledChange: (nextChecked: boolean) => void;
  onPortChange: (nextPort: number) => void;
  onTokenChange: (nextToken: string) => void;
};

const LOCAL_API_PORT_MIN = 1024;
const LOCAL_API_PORT_MAX = 65535;

function normalizePort(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return "";
  if (parsed < LOCAL_API_PORT_MIN || parsed > LOCAL_API_PORT_MAX) return "";
  return String(parsed);
}

export default function SettingsLocalApiPanel({
  enabled,
  port,
  token,
  onEnabledChange,
  onPortChange,
  onTokenChange,
}: SettingsLocalApiPanelProps) {
  const [portDraft, setPortDraft] = useState(String(port));

  useEffect(() => {
    setPortDraft(String(port));
  }, [port]);

  const handleEnabledChange = (nextChecked: boolean) => {
    const change = buildLocalApiEnabledChange(nextChecked, token);
    if (change.token !== null && change.token !== token) {
      onTokenChange(change.token);
    }
    onEnabledChange(change.enabled);
  };

  return (
    <section className="qp-panel p-5 md:p-6">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)]">
        <Cable size={16} className="text-[var(--qp-accent-default)]" />
        <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.localApiTitle}</h2>
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">
            {UI_TEXT.settings.localApiEnabledLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
              {UI_TEXT.settings.localApiEnabledHint}
            </p>
            <QuietSwitch
              checked={enabled}
              onChange={handleEnabledChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleLocalApi}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-local-api-port"
            className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]"
          >
            {UI_TEXT.settings.localApiPortLabel}
          </label>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
            <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
              {UI_TEXT.settings.localApiPortHint}
            </p>
            <input
              id="settings-local-api-port"
              type="number"
              min={LOCAL_API_PORT_MIN}
              max={LOCAL_API_PORT_MAX}
              step={1}
              value={portDraft}
              onChange={(event) => {
                const nextDraft = event.target.value;
                setPortDraft(nextDraft);
                const normalized = normalizePort(nextDraft);
                if (normalized) {
                  onPortChange(Number(normalized));
                }
              }}
              onBlur={() => {
                const normalized = normalizePort(portDraft);
                if (normalized) {
                  setPortDraft(normalized);
                  onPortChange(Number(normalized));
                } else {
                  setPortDraft(String(port));
                }
              }}
              className="h-9 w-full rounded-[8px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-3 text-sm font-medium tabular-nums text-[var(--qp-text-primary)] outline-none focus:border-[var(--qp-accent-default)] disabled:cursor-not-allowed disabled:opacity-50 md:w-[180px]"
              disabled={!enabled}
              inputMode="numeric"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-local-api-token"
            className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]"
          >
            {UI_TEXT.settings.localApiTokenLabel}
          </label>
          <p className="mt-2 text-sm text-[var(--qp-text-secondary)] leading-relaxed">
            {UI_TEXT.settings.localApiTokenHint}
          </p>
          <input
            id="settings-local-api-token"
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            className="mt-3 h-9 w-full rounded-[8px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-3 text-sm font-medium text-[var(--qp-text-primary)] outline-none focus:border-[var(--qp-accent-default)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!enabled}
            autoComplete="off"
          />
        </div>
      </div>
    </section>
  );
}
