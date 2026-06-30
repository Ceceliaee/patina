import { Dices, EthernetPort, Eye, EyeOff, Fingerprint, KeyRound, Link2, Server, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietSubpanel from "../../../shared/components/QuietSubpanel";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { SettingsRuntimeAdapterService } from "../services/settingsRuntimeAdapterService.ts";
import { createSettingsToken } from "../services/settingsTokenService.ts";

type SettingsInterfacePanelProps = {
  webActivityEnabled: boolean;
  showWebActivityHelp: boolean;
  port: number;
  webActivityToken: string;
  remoteStatusBridgeEnabled: boolean;
  remoteStatusBridgeUrl: string;
  remoteStatusBridgeToken: string;
  remoteStatusBridgeMachineId: string;
  onWebActivityEnabledChange: (nextChecked: boolean) => void;
  onPortChange: (nextPort: number) => void;
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

type RevealableTextFieldProps = {
  id: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  readOnly?: boolean;
  showLabel: string;
  hideLabel: string;
  onToggleVisible: () => void;
};

type InterfaceInlineFieldProps = {
  htmlFor: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
};

type WebActivityHelpDetail = (typeof UI_TEXT.settings.webActivityHelpSteps)[number]["details"][number];
type WebActivityHelpCopiedField = "port" | "token";

const WEB_ACTIVITY_PORT_MIN = 1024;
const WEB_ACTIVITY_PORT_MAX = 65535;
const PORT_DRAFT_PATTERN = /^\d{0,5}$/;
const INTERFACE_FIELD_GRID_CLASS = "mt-4 grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]";

function normalizePort(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return "";
  if (parsed < WEB_ACTIVITY_PORT_MIN || parsed > WEB_ACTIVITY_PORT_MAX) return "";
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
        aria-label={UI_TEXT.accessibility.settings.generateServiceToken}
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

function RevealableTextField({
  id,
  value,
  visible,
  disabled,
  readOnly = false,
  showLabel,
  hideLabel,
  onToggleVisible,
}: RevealableTextFieldProps) {
  return (
    <div className="relative w-full">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        className="qp-input h-[34px] w-full pr-10"
        disabled={disabled}
        readOnly={readOnly}
        autoComplete="off"
        spellCheck={false}
      />
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

function InterfaceInlineField({
  htmlFor,
  icon,
  title,
  children,
  className,
}: InterfaceInlineFieldProps) {
  const rowClassName = [
    "settings-interface-field grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2",
    className,
  ].filter(Boolean).join(" ");

  return (
    <QuietActionRow className={rowClassName}>
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

function WebActivityHelpDetailItem({ detail }: { detail: WebActivityHelpDetail }) {
  if (typeof detail === "string") {
    return <>{detail}</>;
  }

  const children = "children" in detail ? detail.children : undefined;
  if (Array.isArray(children)) {
    return (
      <>
        <span>{detail.text}</span>
        <ul className="settings-web-activity-help-subdetail-list">
          {children.map((child) => (
            <li key={child}>{child}</li>
          ))}
        </ul>
      </>
    );
  }

  const links = "links" in detail ? (detail.links ?? []) : [];
  return (
    <>
      <span>{detail.text}</span>
      <span className="settings-web-activity-help-link-row">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={(event) => {
              event.preventDefault();
              void SettingsRuntimeAdapterService.openWebActivityHelpLink(link.href);
            }}
          >
            {link.label}
          </a>
        ))}
      </span>
    </>
  );
}

export default function SettingsInterfacePanel({
  webActivityEnabled,
  showWebActivityHelp,
  port,
  webActivityToken,
  remoteStatusBridgeEnabled,
  remoteStatusBridgeUrl,
  remoteStatusBridgeToken,
  remoteStatusBridgeMachineId,
  onWebActivityEnabledChange,
  onPortChange,
  onWebActivityTokenChange,
  onRemoteStatusBridgeEnabledChange,
  onRemoteStatusBridgeUrlChange,
  onRemoteStatusBridgeTokenChange,
}: SettingsInterfacePanelProps) {
  const [webActivityPortDraft, setWebActivityPortDraft] = useState(String(port));
  const [webActivityTokenVisible, setWebActivityTokenVisible] = useState(false);
  const [webActivityHelpOpen, setWebActivityHelpOpen] = useState(false);
  const [copiedWebActivityHelpField, setCopiedWebActivityHelpField] = useState<WebActivityHelpCopiedField | null>(null);
  const webActivityHelpCopyResetTimer = useRef<number | null>(null);
  const [remoteStatusBridgeTokenVisible, setRemoteStatusBridgeTokenVisible] = useState(false);
  const [remoteStatusBridgeMachineIdVisible, setRemoteStatusBridgeMachineIdVisible] = useState(false);

  useEffect(() => {
    setWebActivityPortDraft(String(port));
  }, [port]);

  useEffect(() => () => {
    if (webActivityHelpCopyResetTimer.current !== null) {
      window.clearTimeout(webActivityHelpCopyResetTimer.current);
    }
  }, []);

  const handleWebActivityEnabledChange = (nextChecked: boolean) => {
    if (nextChecked && webActivityToken.trim().length === 0) {
      onWebActivityTokenChange(createSettingsToken());
    }
    onWebActivityEnabledChange(nextChecked);
  };
  const handleRemoteStatusBridgeEnabledChange = (nextChecked: boolean) => {
    if (nextChecked && remoteStatusBridgeToken.trim().length === 0) {
      onRemoteStatusBridgeTokenChange(createSettingsToken());
    }
    onRemoteStatusBridgeEnabledChange(nextChecked);
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

  const copyWebActivityHelpValue = (field: WebActivityHelpCopiedField, value: string) => {
    const copyValue = value.trim();
    if (!copyValue) return;

    void SettingsRuntimeAdapterService.copyWebActivityHelpValue(copyValue).then(() => {
      setCopiedWebActivityHelpField(field);
      if (webActivityHelpCopyResetTimer.current !== null) {
        window.clearTimeout(webActivityHelpCopyResetTimer.current);
      }
      webActivityHelpCopyResetTimer.current = window.setTimeout(() => {
        setCopiedWebActivityHelpField((currentField) => (currentField === field ? null : currentField));
        webActivityHelpCopyResetTimer.current = null;
      }, 1400);
    }).catch(() => {});
  };

  return (
    <>
      <section className="qp-panel p-5 md:p-6">
        <div className="mb-5 flex items-center gap-2.5 border-b border-[var(--qp-border-subtle)] pb-2">
          <Server size={16} className="text-[var(--qp-accent-default)]" />
          <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.servicesTitle}</h2>
        </div>

        <div className="space-y-5">
          <QuietSubpanel className="settings-web-activity-subpanel">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="settings-web-activity-title-row flex min-w-0 flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                    {UI_TEXT.settings.webActivityTitle}
                  </p>
                  {showWebActivityHelp && (
                    <button
                      type="button"
                      className="settings-inline-help-button"
                      aria-label={UI_TEXT.accessibility.settings.openWebActivityHelp}
                      onClick={() => setWebActivityHelpOpen(true)}
                    >
                      <span>{UI_TEXT.settings.webActivityHelpAction}</span>
                    </button>
                  )}
                </div>
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

            {webActivityEnabled ? (
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
                      onWebActivityTokenChange(createSettingsToken());
                      setWebActivityTokenVisible(true);
                    }}
                    onToggleVisible={() => setWebActivityTokenVisible((current) => !current)}
                    showLabel={UI_TEXT.accessibility.settings.showServiceToken}
                    hideLabel={UI_TEXT.accessibility.settings.hideServiceToken}
                  />
                </InterfaceInlineField>
              </div>
            ) : null}
          </QuietSubpanel>

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

            {remoteStatusBridgeEnabled ? (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
                <InterfaceInlineField
                  htmlFor="settings-remote-status-bridge-url"
                  icon={<Link2 size={14} className="text-[var(--qp-text-tertiary)]" />}
                  title={UI_TEXT.settings.remoteStatusBridgeUrlLabel}
                  className="lg:col-span-2"
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
                  htmlFor="settings-remote-status-bridge-machine-id"
                  icon={<Fingerprint size={14} className="text-[var(--qp-text-tertiary)]" />}
                  title={UI_TEXT.settings.remoteStatusBridgeMachineIdLabel}
                >
                  <RevealableTextField
                    id="settings-remote-status-bridge-machine-id"
                    value={remoteStatusBridgeMachineId}
                    visible={remoteStatusBridgeMachineIdVisible}
                    disabled={!remoteStatusBridgeEnabled}
                    readOnly
                    onToggleVisible={() => setRemoteStatusBridgeMachineIdVisible((current) => !current)}
                    showLabel={UI_TEXT.accessibility.settings.showRemoteMachineId}
                    hideLabel={UI_TEXT.accessibility.settings.hideRemoteMachineId}
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
                      onRemoteStatusBridgeTokenChange(createSettingsToken());
                      setRemoteStatusBridgeTokenVisible(true);
                    }}
                    onToggleVisible={() => setRemoteStatusBridgeTokenVisible((current) => !current)}
                    showLabel={UI_TEXT.accessibility.settings.showServiceToken}
                    hideLabel={UI_TEXT.accessibility.settings.hideServiceToken}
                  />
                </InterfaceInlineField>
              </div>
            ) : null}
          </QuietSubpanel>
        </div>
      </section>

      <QuietDialog
        open={webActivityHelpOpen}
        title={UI_TEXT.settings.webActivityHelpTitle}
        description={UI_TEXT.settings.webActivityHelpDescription}
        onClose={() => setWebActivityHelpOpen(false)}
        surfaceClassName="settings-web-activity-help-dialog"
      >
        <button
          type="button"
          className="qp-dialog-close-button settings-web-activity-help-close"
          aria-label={UI_TEXT.common.close}
          onClick={() => setWebActivityHelpOpen(false)}
        >
          <X size={16} aria-hidden />
        </button>
        <ol className="settings-web-activity-help-list">
          {UI_TEXT.settings.webActivityHelpSteps.map((step, index) => (
            <li key={step.title}>
              <div className="settings-web-activity-help-step-copy">
                <div className="settings-web-activity-help-step-heading">
                  <span className="settings-web-activity-help-step-index">{index + 1}</span>
                  <strong>{step.title}</strong>
                </div>
                <p className="settings-web-activity-help-step-description">{step.description}</p>
                <ul className="settings-web-activity-help-detail-list">
                  {step.details.map((detail, detailIndex) => (
                    <li key={typeof detail === "string" ? detail : detail.text}>
                      <WebActivityHelpDetailItem detail={detail} />
                      {index === 0 && detailIndex === step.details.length - 1 ? (
                        <span className="settings-web-activity-help-copy-row">
                          <button
                            type="button"
                            aria-label={UI_TEXT.accessibility.settings.copyWebActivityPort}
                            onClick={() => copyWebActivityHelpValue("port", String(port))}
                          >
                            {copiedWebActivityHelpField === "port"
                              ? UI_TEXT.settings.webActivityHelpCopiedAction
                              : UI_TEXT.settings.webActivityHelpCopyPortAction}
                          </button>
                          <button
                            type="button"
                            disabled={webActivityToken.trim().length === 0}
                            aria-label={UI_TEXT.accessibility.settings.copyWebActivityToken}
                            onClick={() => copyWebActivityHelpValue("token", webActivityToken)}
                          >
                            {copiedWebActivityHelpField === "token"
                              ? UI_TEXT.settings.webActivityHelpCopiedAction
                              : UI_TEXT.settings.webActivityHelpCopyTokenAction}
                          </button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        <p className="settings-web-activity-help-note">{UI_TEXT.settings.webActivityHelpNote}</p>
      </QuietDialog>
    </>
  );
}
