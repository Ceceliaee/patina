import { Dices, EthernetPort, Eye, EyeOff, KeyRound, Link2, Server } from "lucide-react";
import type { ReactNode, SyntheticEvent } from "react";
import { useEffect, useState } from "react";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietSubpanel from "../../../shared/components/QuietSubpanel";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import { buildLocalApiEnabledChange, createLocalApiToken } from "../services/localApiTokenService.ts";

type SettingsInterfacePanelProps = {
  localApiEnabled: boolean;
  webActivityEnabled: boolean;
  port: number;
  localApiToken: string;
  webActivityToken: string;
  remoteStatusBridgeEnabled: boolean;
  remoteStatusBridgeUrl: string;
  remoteStatusBridgeToken: string;
  remoteStatusBridgeMachineId: string;
  onLocalApiEnabledChange: (nextChecked: boolean) => void;
  onWebActivityEnabledChange: (nextChecked: boolean) => void;
  onPortChange: (nextPort: number) => void;
  onLocalApiTokenChange: (nextToken: string) => void;
  onWebActivityTokenChange: (nextToken: string) => void;
  onRemoteStatusBridgeEnabledChange: (nextChecked: boolean) => void;
  onRemoteStatusBridgeUrlChange: (nextUrl: string) => void;
  onRemoteStatusBridgeTokenChange: (nextToken: string) => void;
};

type TokenFieldProps = {
  id: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  onChange: (nextToken: string) => void;
  onGenerate: () => void;
  onToggleVisible: () => void;
  showLabel: string;
  hideLabel: string;
};

type EndpointFieldProps = {
  id: string;
  prefix: string;
  value: string;
  disabled: boolean;
  onChange: (nextValue: string) => void;
  onCommit: () => void;
};

type PortFieldProps = {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (nextValue: string) => void;
  onCommit: () => void;
};

type TextFieldProps = {
  id: string;
  value: string;
  disabled: boolean;
  readOnly?: boolean;
  spellCheck?: boolean;
  onChange?: (nextValue: string) => void;
  onCommit?: () => void;
};

type InterfaceInlineFieldProps = {
  htmlFor: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
};

const LOCAL_API_PORT_MIN = 1024;
const LOCAL_API_PORT_MAX = 65535;
const LOCAL_API_ENDPOINT_PREFIX = "ws://127.0.0.1:";
const PORT_DRAFT_PATTERN = /^\d{0,5}$/;
const INTERFACE_FIELD_GRID_CLASS = "mt-4 grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]";

function normalizePort(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return "";
  if (parsed < LOCAL_API_PORT_MIN || parsed > LOCAL_API_PORT_MAX) return "";
  return String(parsed);
}

function TokenField({
  id,
  value,
  visible,
  disabled,
  onChange,
  onGenerate,
  onToggleVisible,
  showLabel,
  hideLabel,
}: TokenFieldProps) {
  return (
    <div className="relative w-full">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="qp-input h-[34px] w-full pr-18"
        disabled={disabled}
        autoComplete="off"
      />
      <button
        type="button"
        className="settings-token-action-button settings-token-random-button"
        disabled={disabled}
        aria-label={UI_TEXT.accessibility.settings.generateLocalApiToken}
        onClick={onGenerate}
      >
        <Dices size={14} />
      </button>
      <button
        type="button"
        className="settings-token-action-button settings-token-visibility-button"
        disabled={disabled}
        aria-label={visible ? hideLabel : showLabel}
        onClick={onToggleVisible}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function EndpointField({
  id,
  prefix,
  value,
  disabled,
  onChange,
  onCommit,
}: EndpointFieldProps) {
  return (
    <div className="relative w-full">
      <input
        id={id}
        type="text"
        value={value}
        onBeforeInput={(event) => keepEndpointPrefixLocked(event, prefix)}
        onKeyDown={(event) => {
          const input = event.currentTarget;
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          const editsPrefix = start < prefix.length
            || (event.key === "Backspace" && start <= prefix.length && start === end);
          if (editsPrefix) {
            event.preventDefault();
            input.setSelectionRange(prefix.length, input.value.length);
          }
        }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        className="qp-input h-[34px] w-full"
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

function PortField({
  id,
  value,
  disabled,
  onChange,
  onCommit,
}: PortFieldProps) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      className="qp-input h-[34px] w-full"
      disabled={disabled}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

function TextField({
  id,
  value,
  disabled,
  readOnly = false,
  spellCheck = false,
  onChange,
  onCommit,
}: TextFieldProps) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      onBlur={onCommit}
      className="qp-input h-[34px] w-full"
      disabled={disabled}
      readOnly={readOnly}
      autoComplete="off"
      spellCheck={spellCheck}
    />
  );
}

function InterfaceInlineField({
  htmlFor,
  icon,
  title,
  children,
}: InterfaceInlineFieldProps) {
  return (
    <QuietActionRow className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2">
      <label
        htmlFor={htmlFor}
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-[var(--qp-text-primary)]"
      >
        {icon}
        <span>{title}</span>
      </label>
      {children}
    </QuietActionRow>
  );
}

export default function SettingsInterfacePanel({
  localApiEnabled,
  webActivityEnabled,
  port,
  localApiToken,
  webActivityToken,
  remoteStatusBridgeEnabled,
  remoteStatusBridgeUrl,
  remoteStatusBridgeToken,
  remoteStatusBridgeMachineId,
  onLocalApiEnabledChange,
  onWebActivityEnabledChange,
  onPortChange,
  onLocalApiTokenChange,
  onWebActivityTokenChange,
  onRemoteStatusBridgeEnabledChange,
  onRemoteStatusBridgeUrlChange,
  onRemoteStatusBridgeTokenChange,
}: SettingsInterfacePanelProps) {
  const [localApiPortDraft, setLocalApiPortDraft] = useState(String(port));
  const [webActivityPortDraft, setWebActivityPortDraft] = useState(String(port));
  const [localApiTokenVisible, setLocalApiTokenVisible] = useState(false);
  const [webActivityTokenVisible, setWebActivityTokenVisible] = useState(false);
  const [remoteStatusBridgeTokenVisible, setRemoteStatusBridgeTokenVisible] = useState(false);
  const localApiEndpointDraft = `${LOCAL_API_ENDPOINT_PREFIX}${localApiPortDraft}`;

  useEffect(() => {
    setLocalApiPortDraft(String(port));
    setWebActivityPortDraft(String(port));
  }, [port]);

  const handleLocalApiEnabledChange = (nextChecked: boolean) => {
    const change = buildLocalApiEnabledChange(nextChecked, localApiToken);
    if (change.token !== null && change.token !== localApiToken) {
      onLocalApiTokenChange(change.token);
    }
    onLocalApiEnabledChange(change.enabled);
  };
  const handleWebActivityEnabledChange = (nextChecked: boolean) => {
    if (nextChecked && webActivityToken.trim().length === 0) {
      onWebActivityTokenChange(createLocalApiToken());
    }
    onWebActivityEnabledChange(nextChecked);
  };
  const handleRemoteStatusBridgeEnabledChange = (nextChecked: boolean) => {
    if (nextChecked && remoteStatusBridgeToken.trim().length === 0) {
      onRemoteStatusBridgeTokenChange(createLocalApiToken());
    }
    onRemoteStatusBridgeEnabledChange(nextChecked);
  };
  const handleEndpointChange = (nextValue: string, prefix: string) => {
    if (!nextValue.startsWith(prefix)) return;
    const nextDraft = nextValue.slice(prefix.length);
    if (!PORT_DRAFT_PATTERN.test(nextDraft)) return;
    return nextDraft;
  };
  const commitPortDraft = (draft: string, setDraft: (nextDraft: string) => void) => {
    const normalized = normalizePort(draft);
    if (normalized) {
      setDraft(normalized);
      const nextPort = Number(normalized);
      if (nextPort !== port) onPortChange(nextPort);
    } else {
      setDraft(String(port));
    }
  };
  return (
    <section className="qp-panel p-5 md:p-6">
      <div className="mb-5 flex items-center gap-2.5 border-b border-[var(--qp-border-subtle)] pb-2">
        <Server size={16} className="text-[var(--qp-accent-default)]" />
        <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.localApiTitle}</h2>
      </div>

      <div className="space-y-5">
        <QuietSubpanel>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                {UI_TEXT.settings.remoteStatusBridgeTitle}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
                {UI_TEXT.settings.remoteStatusBridgeEnabledHint}
              </p>
            </div>
            <QuietSwitch
              checked={remoteStatusBridgeEnabled}
              onChange={handleRemoteStatusBridgeEnabledChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleRemoteStatusBridge}
            />
          </div>

          <div className={INTERFACE_FIELD_GRID_CLASS}>
            <InterfaceInlineField
              htmlFor="settings-remote-status-bridge-url"
              icon={<Link2 size={14} className="text-[var(--qp-text-tertiary)]" />}
              title={UI_TEXT.settings.remoteStatusBridgeUrlLabel}
            >
              <TextField
                id="settings-remote-status-bridge-url"
                value={remoteStatusBridgeUrl}
                disabled={!remoteStatusBridgeEnabled}
                spellCheck={false}
                onChange={onRemoteStatusBridgeUrlChange}
              />
            </InterfaceInlineField>

            <InterfaceInlineField
              htmlFor="settings-remote-status-bridge-token"
              icon={<KeyRound size={14} className="text-[var(--qp-text-tertiary)]" />}
              title={UI_TEXT.settings.remoteStatusBridgeTokenLabel}
            >
              <TokenField
                id="settings-remote-status-bridge-token"
                value={remoteStatusBridgeToken}
                visible={remoteStatusBridgeTokenVisible}
                disabled={!remoteStatusBridgeEnabled}
                onChange={onRemoteStatusBridgeTokenChange}
                onGenerate={() => {
                  onRemoteStatusBridgeTokenChange(createLocalApiToken());
                  setRemoteStatusBridgeTokenVisible(true);
                }}
                onToggleVisible={() => setRemoteStatusBridgeTokenVisible((current) => !current)}
                showLabel={UI_TEXT.accessibility.settings.showLocalApiToken}
                hideLabel={UI_TEXT.accessibility.settings.hideLocalApiToken}
              />
            </InterfaceInlineField>

            <InterfaceInlineField
              htmlFor="settings-remote-status-bridge-machine-id"
              icon={<Server size={14} className="text-[var(--qp-text-tertiary)]" />}
              title={UI_TEXT.settings.remoteStatusBridgeMachineIdLabel}
            >
              <TextField
                id="settings-remote-status-bridge-machine-id"
                value={remoteStatusBridgeMachineId}
                disabled={false}
                readOnly
              />
            </InterfaceInlineField>
          </div>
        </QuietSubpanel>

        <QuietSubpanel>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                {UI_TEXT.settings.webActivityTitle}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
                {UI_TEXT.settings.webActivityEnabledHint}
              </p>
            </div>
            <QuietSwitch
              checked={webActivityEnabled}
              onChange={handleWebActivityEnabledChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleWebActivity}
            />
          </div>

          <div className={INTERFACE_FIELD_GRID_CLASS}>
            <InterfaceInlineField
              htmlFor="settings-web-activity-address"
              icon={<EthernetPort size={14} className="text-[var(--qp-text-tertiary)]" />}
              title={UI_TEXT.settings.webActivityAddressLabel}
            >
              <PortField
                id="settings-web-activity-address"
                value={webActivityPortDraft}
                disabled={!webActivityEnabled}
                onChange={(nextValue) => {
                  if (PORT_DRAFT_PATTERN.test(nextValue)) setWebActivityPortDraft(nextValue);
                }}
                onCommit={() => commitPortDraft(webActivityPortDraft, setWebActivityPortDraft)}
              />
            </InterfaceInlineField>

            <InterfaceInlineField
              htmlFor="settings-web-activity-token"
              icon={<KeyRound size={14} className="text-[var(--qp-text-tertiary)]" />}
              title={UI_TEXT.settings.webActivityTokenLabel}
            >
              <TokenField
                id="settings-web-activity-token"
                value={webActivityToken}
                visible={webActivityTokenVisible}
                disabled={!webActivityEnabled}
                onChange={onWebActivityTokenChange}
                onGenerate={() => {
                  onWebActivityTokenChange(createLocalApiToken());
                  setWebActivityTokenVisible(true);
                }}
                onToggleVisible={() => setWebActivityTokenVisible((current) => !current)}
                showLabel={UI_TEXT.accessibility.settings.showLocalApiToken}
                hideLabel={UI_TEXT.accessibility.settings.hideLocalApiToken}
              />
            </InterfaceInlineField>
          </div>
        </QuietSubpanel>

        <QuietSubpanel>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                {UI_TEXT.settings.localApiGeneralTitle}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
                {UI_TEXT.settings.localApiEnabledHint}
              </p>
            </div>
            <QuietSwitch
              checked={localApiEnabled}
              onChange={handleLocalApiEnabledChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleLocalApi}
            />
          </div>

          <div className={INTERFACE_FIELD_GRID_CLASS}>
            <InterfaceInlineField
              htmlFor="settings-local-api-address"
              icon={<Link2 size={14} className="text-[var(--qp-text-tertiary)]" />}
              title={UI_TEXT.settings.localApiPortLabel}
            >
              <EndpointField
                id="settings-local-api-address"
                prefix={LOCAL_API_ENDPOINT_PREFIX}
                value={localApiEndpointDraft}
                disabled={!localApiEnabled}
                onChange={(nextValue) => {
                  const nextDraft = handleEndpointChange(nextValue, LOCAL_API_ENDPOINT_PREFIX);
                  if (nextDraft !== undefined) setLocalApiPortDraft(nextDraft);
                }}
                onCommit={() => commitPortDraft(localApiPortDraft, setLocalApiPortDraft)}
              />
            </InterfaceInlineField>

            <InterfaceInlineField
              htmlFor="settings-local-api-token"
              icon={<KeyRound size={14} className="text-[var(--qp-text-tertiary)]" />}
              title={UI_TEXT.settings.localApiTokenLabel}
            >
              <TokenField
                id="settings-local-api-token"
                value={localApiToken}
                visible={localApiTokenVisible}
                disabled={!localApiEnabled}
                onChange={onLocalApiTokenChange}
                onGenerate={() => {
                  onLocalApiTokenChange(createLocalApiToken());
                  setLocalApiTokenVisible(true);
                }}
                onToggleVisible={() => setLocalApiTokenVisible((current) => !current)}
                showLabel={UI_TEXT.accessibility.settings.showLocalApiToken}
                hideLabel={UI_TEXT.accessibility.settings.hideLocalApiToken}
              />
            </InterfaceInlineField>
          </div>
        </QuietSubpanel>
      </div>
    </section>
  );
}

function keepEndpointPrefixLocked(event: SyntheticEvent<HTMLInputElement>, prefix: string) {
  const input = event.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  if (start >= prefix.length && end >= prefix.length) return;
  event.preventDefault();
  input.setSelectionRange(prefix.length, input.value.length);
}
