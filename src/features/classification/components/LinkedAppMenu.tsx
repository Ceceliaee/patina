import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus, Check, X, ArrowLeft, House, Captions, CaptionsOff, ListX, ListPlus } from "lucide-react";
import QuietAnchoredPopover, { type QuietPopoverCloseReason } from "../../../shared/components/QuietAnchoredPopover.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietSearchField from "../../../shared/components/QuietSearchField.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { AppLinks } from "../../../shared/classification/appLinks.ts";
import type { ObservedAppCandidate } from "../types.ts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean, reason?: QuietPopoverCloseReason) => void;
  parent: ObservedAppCandidate;
  candidates: readonly ObservedAppCandidate[];
  links: AppLinks;
  icons: Record<string, string>;
  disabled: boolean;
  globalTitleEnabled: boolean;
  name: (candidate: ObservedAppCandidate) => string;
  tracking: (candidate: ObservedAppCandidate) => boolean;
  titleCapture: (candidate: ObservedAppCandidate) => boolean;
  onLink: (member: string, parent: ObservedAppCandidate | null) => void;
  onTracking: (candidate: ObservedAppCandidate, enabled: boolean) => void;
  onTitle: (candidate: ObservedAppCandidate, enabled: boolean) => void;
}

function LinkedAppList({ children }: { children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (list.current) list.current.style.height = `${list.current.getBoundingClientRect().height}px`;
  }, []);
  return <div ref={list} className="qp-app-link-list qp-scroll-region">{children}</div>;
}

export default function LinkedAppMenu(props: Props) {
  const text = useLocaleText();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const { open } = props;
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const members = Object.keys(props.links).filter((key) => props.links[key] === props.parent.exeName);
  const candidates = open && !props.disabled ? props.candidates : [];
  // Closed menus retain their indicator without scanning the complete app catalog.
  const byKey = new Map(candidates.map((candidate) => [candidate.exeName, candidate]));
  const memberRows = members.map((exeName) => byKey.get(exeName)
    ?? { exeName, appName: exeName, totalDuration: 0, lastSeenMs: 0 });
  const roots = new Set(Object.values(props.links));
  const available = (adding ? candidates : []).filter((candidate) => candidate.exeName !== props.parent.exeName
    && !roots.has(candidate.exeName)
    && (!props.links[candidate.exeName] || props.links[candidate.exeName] === props.parent.exeName)
    && `${props.name(candidate)} ${candidate.exeName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const close = (reason: QuietPopoverCloseReason) => {
    props.onOpenChange(false, reason);
    if (reason === "escape") trigger.current?.focus({ preventScroll: true });
  };
  return <>
    <button ref={trigger} type="button" className="qp-app-link-trigger qp-app-mapping-exe"
      aria-label={`${text.mapping.linkedApps}: ${props.parent.exeName}`} aria-expanded={open}
      aria-controls={open ? id : undefined} disabled={props.disabled}
      onClick={() => { setAdding(false); setQuery(""); props.onOpenChange(!open); }}>
      <span>{props.parent.exeName}</span>{members.length > 0 && <ChevronDown size={12} aria-hidden />}
    </button>
    <QuietAnchoredPopover open={open && !props.disabled} anchor={trigger.current} id={id}
      ariaLabel={text.mapping.linkedApps} onClose={close} className="qp-app-link-popover"
      horizontalAlign="start"
      initialFocusRef={adding ? search : add}>
      {adding ? <>
        <button type="button" className="qp-app-link-action" aria-label={text.mapping.backToLinkedApps}
          onClick={() => setAdding(false)}><ArrowLeft size={14} aria-hidden />{text.mapping.addLinkedApp}</button>
        <QuietSearchField ref={search} value={query} aria-label={text.mapping.addLinkedApp}
          onChange={(event) => setQuery(event.target.value)} />
        <LinkedAppList key="adding">
          {available.length === 0 && <p>{text.mapping.searchNoResults}</p>}
          {available.map((candidate) => <button type="button" className="qp-app-link-option" key={candidate.exeName}
            disabled={Boolean(props.links[candidate.exeName])} onClick={() => {
              props.onLink(candidate.exeName, props.parent);
              search.current?.focus({ preventScroll: true });
            }}>
            {props.icons[candidate.exeName] && <img src={props.icons[candidate.exeName]} alt="" />}
            <span>{candidate.exeName}</span>
            {props.links[candidate.exeName] ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
          </button>)}
        </LinkedAppList>
      </> : <>
        <strong>{text.mapping.linkedApps}</strong>
        <LinkedAppList key="members">
          <div className="qp-app-link-option"><span>{props.parent.exeName}</span><div className="qp-app-link-main-icon"><House size={12} role="img" aria-label={text.mapping.mainApp} /></div></div>
          {memberRows.map((candidate) => <div key={candidate.exeName} className="qp-app-link-option qp-app-link-member">
            <span>{candidate.exeName}</span>
            <div className="qp-app-link-controls">
              <QuietIconAction icon={props.titleCapture(candidate) ? <Captions size={12} /> : <CaptionsOff size={12} />}
                title={text.mapping.titleRecorded} showTooltip={false} pressed={props.titleCapture(candidate)} showPressedStyle={false}
                disabled={props.disabled || !props.globalTitleEnabled}
                onClick={() => props.onTitle(candidate, !props.titleCapture(candidate))} />
              <QuietIconAction icon={props.tracking(candidate) ? <ListX size={12} /> : <ListPlus size={12} />}
                title={text.mapping.excludeStats} showTooltip={false} pressed={!props.tracking(candidate)} showPressedStyle={false}
                disabled={props.disabled}
                onClick={() => props.onTracking(candidate, !props.tracking(candidate))} />
              <QuietIconAction icon={<X size={12} />} title={`${text.mapping.unlinkApp}: ${candidate.exeName}`}
                showTooltip={false} disabled={props.disabled}
                onClick={() => { props.onLink(candidate.exeName, null); add.current?.focus({ preventScroll: true }); }} />
            </div>
          </div>)}
        </LinkedAppList>
        <button ref={add} type="button" className="qp-app-link-action" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden />{text.mapping.addLinkedApp}
        </button>
      </>}
    </QuietAnchoredPopover>
  </>;
}
