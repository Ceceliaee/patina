import { useId, useRef, useState } from "react";
import { ArrowLeft, Captions, CaptionsOff, Check, ChevronDown, House, ListPlus, ListX, Plus, X } from "lucide-react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import QuietSearchField from "../../../shared/components/QuietSearchField.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import { IdentityText } from "./ClassificationMappingCard.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import { resolveWebOwner, webDisplayDomain } from "../../../shared/classification/webLinks.ts";
import type { ObservedWebDomainCandidate, WebDomainOverride } from "../../../shared/types/webActivity.ts";

export interface LinkedWebMenuProps {
  openIdentity: string | null;
  onOpenIdentity: (identity: string | null) => void;
  candidate: ObservedWebDomainCandidate;
  overrides: Record<string, WebDomainOverride>;
  candidates: ObservedWebDomainCandidate[];
  disabled: boolean;
  globalTitleEnabled: boolean;
  onChange: (identity: string, override: WebDomainOverride | null) => void;
  onDelete: (candidate: ObservedWebDomainCandidate) => void;
}

export default function LinkedWebMenu({ openIdentity, onOpenIdentity, candidate, overrides, candidates, disabled, globalTitleEnabled, onChange }: LinkedWebMenuProps) {
  const text = useLocaleText();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const identity = candidate.normalizedDomain;
  const open = openIdentity === identity;
  const parent = webDisplayDomain(identity);
  const key = `site:${parent}`;
  const members = (candidate.memberCandidates ?? []).filter(member => member.normalizedDomain !== parent);
  const available = open && adding ? candidates.filter(value => value.normalizedDomain !== parent
    && [value.normalizedDomain, identity].includes(resolveWebOwner(value.normalizedDomain, overrides))
    && value.normalizedDomain.includes(query.trim().toLowerCase())) : [];
  const write = (linked: string[]) => {
    const source = overrides[identity] ?? overrides[parent] ?? {};
    if (!linked.length) {
      onChange(parent, { ...overrides[parent], displayName: source.displayName, category: source.category, color: source.color });
      onChange(identity, null);
      onOpenIdentity(parent);
      return;
    }
    onChange(key, { displayName: source.displayName, category: source.category, color: source.color,
      siteRule: { members: [...new Set(linked)].filter(domain => domain !== parent).sort() } });
    onOpenIdentity(key);
  };
  const close = () => { onOpenIdentity(null); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" className="qp-app-link-trigger qp-app-mapping-exe"
      aria-label={`${text.mapping.webLinks}: ${parent}`} aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={disabled} onClick={() => { setAdding(false); setQuery(""); onOpenIdentity(open ? null : identity); }}>
      <span>{parent}</span>{members.length > 0 && <ChevronDown size={12} aria-hidden />}
    </button>
    <QuietAnchoredPopover open={open && !disabled} anchor={trigger.current} id={id} ariaLabel={text.mapping.webLinks}
      onClose={close} className="qp-app-link-popover qp-web-grouping-popover" horizontalAlign="start" initialFocusRef={adding ? search : add}>
      {adding ? <>
        <button type="button" className="qp-app-link-action" aria-label={text.mapping.backToLinkedWebDomains}
          onClick={() => setAdding(false)}><ArrowLeft size={14} aria-hidden />{text.mapping.addLinkedWebDomain}</button>
        <QuietSearchField ref={search} value={query} aria-label={text.mapping.addLinkedWebDomain} onChange={event => setQuery(event.target.value)} />
        <div className="qp-app-link-list qp-scroll-region">
          {available.map(value => <button type="button" className="qp-app-link-option" key={value.normalizedDomain} disabled={resolveWebOwner(value.normalizedDomain, overrides) === identity} onClick={() => {
            write([...members.map(member => member.normalizedDomain), value.normalizedDomain]);
            search.current?.focus();
          }}>{value.faviconUrl && <img src={value.faviconUrl} alt="" />}<IdentityText text={value.normalizedDomain} className="qp-app-mapping-exe" />{resolveWebOwner(value.normalizedDomain, overrides) === identity ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}</button>)}
          {available.length === 0 && <p>{text.mapping.searchNoResults}</p>}
        </div>
      </> : <>
        <strong>{text.mapping.webLinks}</strong>
        <div className="qp-app-link-list qp-scroll-region">
          <div className="qp-app-link-option"><IdentityText text={parent} className="qp-app-mapping-exe" />
            <div className="qp-app-link-main-icon"><House size={12} role="img" aria-label={text.mapping.mainWebDomain} /></div></div>
          {members.map(member => {
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
                <QuietIconAction icon={<X size={12} />} title={`${text.mapping.unlinkApp}: ${domain}`} showTooltip={false} disabled={disabled}
                  onClick={() => { write(members.filter(value => value.normalizedDomain !== domain).map(value => value.normalizedDomain)); add.current?.focus(); }} />
              </div>
            </div>;
          })}
        </div>
        <button ref={add} type="button" className="qp-app-link-action" onClick={() => { setQuery(""); setAdding(true); }}>
          <Plus size={14} aria-hidden />{text.mapping.addLinkedWebDomain}
        </button>
      </>}
    </QuietAnchoredPopover>
  </>;
}
