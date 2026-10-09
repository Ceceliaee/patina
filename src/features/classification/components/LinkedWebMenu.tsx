import { useId, useRef } from "react";
import { Captions, CaptionsOff, ChevronDown, House, ListPlus, ListX, X } from "lucide-react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import { IdentityText } from "./ClassificationMappingCard.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import { setWebDomainIndependent, webDisplayDomain, webLinkParent } from "../../../shared/classification/webLinks.ts";
import type { ObservedWebDomainCandidate, WebDomainOverride } from "../../../shared/types/webActivity.ts";

export interface LinkedWebMenuProps {
  openIdentity: string | null;
  onOpenIdentity: (identity: string | null) => void;
  candidate: ObservedWebDomainCandidate;
  overrides: Record<string, WebDomainOverride>;
  disabled: boolean;
  globalTitleEnabled: boolean;
  onChange: (identity: string, override: WebDomainOverride | null) => void;
}
export function focusWebCard(identity: string) {
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll<HTMLElement>('[data-classification-web]')]
      .find(node => node.dataset.classificationWeb === identity);
    (card?.querySelector<HTMLButtonElement>('.qp-app-link-trigger') ?? card?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
  });
}
export default function LinkedWebMenu({ openIdentity, onOpenIdentity, candidate, overrides, disabled, globalTitleEnabled, onChange }: LinkedWebMenuProps) {
  const text = useLocaleText(), id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const identity = candidate.normalizedDomain, parent = webDisplayDomain(identity);
  if (!webLinkParent(identity)) return <IdentityText text={parent} className="qp-app-mapping-exe" />;
  const open = openIdentity === identity;
  const close = () => { onOpenIdentity(null); trigger.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={trigger} type="button" className="qp-app-link-trigger qp-app-mapping-exe"
      aria-label={`${text.mapping.webLinks}: ${parent}`} aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={disabled} onClick={() => onOpenIdentity(open ? null : identity)}>
      <span>{parent}</span><ChevronDown size={12} aria-hidden />
    </button>
    <QuietAnchoredPopover open={open && !disabled} anchor={trigger.current} id={id} ariaLabel={text.mapping.webLinks}
      onClose={close} className="qp-app-link-popover qp-web-grouping-popover" horizontalAlign="start">
      <strong>{text.mapping.webLinks}</strong>
      <div className="qp-app-link-list qp-scroll-region">
        <div className="qp-app-link-option"><IdentityText text={parent} className="qp-app-mapping-exe" />
          <div className="qp-app-link-main-icon"><House size={12} role="img" aria-label={text.mapping.mainWebDomain} /></div></div>
        {open && candidate.memberCandidates?.map(member => {
          const domain = member.normalizedDomain, override = overrides[domain] ?? {};
          return <div key={domain} className="qp-app-link-option qp-app-link-member">
            <IdentityText text={domain} className="qp-app-mapping-exe" />
            <div className="qp-app-link-controls">
              <QuietIconAction icon={override.captureTitle === false ? <CaptionsOff size={12} /> : <Captions size={12} />}
                title={`${text.mapping.titleRecorded}: ${domain}`} showTooltip={false} pressed={override.captureTitle !== false} showPressedStyle={false}
                disabled={disabled || !globalTitleEnabled} onClick={() => onChange(domain, { ...override, captureTitle: override.captureTitle === false })} />
              <QuietIconAction icon={override.enabled === false ? <ListPlus size={12} /> : <ListX size={12} />}
                title={`${text.mapping.excludeStats}: ${domain}`} showTooltip={false} pressed={override.enabled === false} showPressedStyle={false}
                disabled={disabled} onClick={() => onChange(domain, { ...override, enabled: override.enabled === false })} />
              <QuietIconAction icon={<X size={12} />} title={`${text.mapping.webIndependent}: ${domain}`} disabled={disabled}
                onClick={() => { const change = setWebDomainIndependent(domain, true, overrides); if (change) { onChange(change.key, change.override); onOpenIdentity(null); focusWebCard(domain); } }} />
            </div>
          </div>;
        })}
      </div>
    </QuietAnchoredPopover>
  </>;
}
