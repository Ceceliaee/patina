import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { QuietPopoverCloseReason } from "../../../shared/components/QuietAnchoredPopover.tsx";

interface Slot<T> { identity: string; height: number; preview?: T }
interface Session<T> { view: string; identity: string | null; slots: Slot<T>[]; width: number; height: number }
interface Reference { identity: string; top: number }

/** Retains presentation slots and readonly previews; the latest draft owns live cards. */
export function useMappingLinkLayout<T>(
  candidates: readonly T[],
  identityOf: (candidate: T) => string,
  root: RefObject<HTMLDivElement | null>,
  kind: "app" | "web",
  view: string,
  busy: boolean,
) {
  const [session, setSession] = useState<Session<T> | null>(null);
  const current = useRef(session);
  const restore = useRef<{ view: string; region: HTMLElement; width: number; height: number; references: Reference[]; focus?: string } | null>(null);
  const pendingClick = useRef<(() => void) | null>(null);
  const cards = () => [...(root.current?.querySelectorAll<HTMLElement>(`[data-classification-${kind}]`) ?? [])];
  const identity = (node: HTMLElement) => node.getAttribute(`data-classification-${kind}`)!;
  const cancelPendingClick = () => { pendingClick.current?.(); pendingClick.current = null; };
  const commit = (next: Session<T> | null) => { current.current = next; setSession(next); };
  const capture = (preferred?: string | null) => {
    const nodes = cards();
    const selected = nodes.find(node => identity(node) === preferred) ?? nodes[0];
    const region = selected?.closest<HTMLElement>(".qp-scroll-region");
    if (!region) return;
    const top = region.getBoundingClientRect().top;
    const preferredTop = selected.getBoundingClientRect().top;
    restore.current = { view, region, width: region.clientWidth, height: region.clientHeight,
      references: nodes.map(node => ({ identity: identity(node), top: node.getBoundingClientRect().top - top }))
        .sort((a, b) => Number(b.identity === preferred) - Number(a.identity === preferred)
          || Math.abs(a.top + top - preferredTop) - Math.abs(b.top + top - preferredTop)),
    };
  };
  const close = (reason?: QuietPopoverCloseReason) => {
    cancelPendingClick();
    if (reason === "scroll") restore.current = null;
    else if (!restore.current?.focus) capture(current.current?.identity);
    if (reason !== "outside") { commit(null); return; }
    // Pointerdown precedes the target's click. Keep slots until that click has
    // dispatched, otherwise a different card can move underneath the pointer.
    if (current.current) commit({ ...current.current, identity: null });
    let frame = 0;
    const finish = () => { cancelPendingClick(); commit(null); };
    const abandon = () => { restore.current = null; finish(); };
    const scroll = () => { restore.current = null; };
    const afterPointerUp = () => { frame = requestAnimationFrame(finish); };
    window.addEventListener("click", finish, { once: true });
    window.addEventListener("pointerup", afterPointerUp, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", abandon, { once: true });
    pendingClick.current = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("click", finish);
      window.removeEventListener("pointerup", afterPointerUp);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", abandon);
    };
  };
  const open = (key: string | null, reason?: QuietPopoverCloseReason) => {
    if (key === null) { close(reason); return; }
    cancelPendingClick();
    restore.current = null;
    commit({ view, identity: key, width: window.innerWidth, height: window.innerHeight,
      slots: current.current?.view === view ? current.current.slots
      : cards().map(node => ({ identity: identity(node), height: node.getBoundingClientRect().height, preview: byIdentity.get(identity(node)) })) });
  };
  const reset = () => { cancelPendingClick(); restore.current = null; commit(null); };
  const byIdentity = new Map(candidates.map(candidate => [identityOf(candidate), candidate]));
  const active = session?.view === view && (!session.identity || byIdentity.has(session.identity)) ? session : null;

  useLayoutEffect(() => {
    if (session && !active) {
      reset();
      if (document.activeElement === document.body) root.current?.querySelector<HTMLInputElement>(".qp-category-search input")?.focus({ preventScroll: true });
      return;
    }
    if (session && busy) { close(); return; }
    if (session) return;
    const reference = restore.current;
    restore.current = null;
    if (!reference || reference.view !== view || !reference.region.isConnected
      || reference.width !== reference.region.clientWidth || reference.height !== reference.region.clientHeight) return;
    const nodes = new Map(cards().map(node => [identity(node), node]));
    const anchor = reference.references.find(item => nodes.has(item.identity));
    if (!anchor) return;
    const delta = nodes.get(anchor.identity)!.getBoundingClientRect().top
      - reference.region.getBoundingClientRect().top - anchor.top;
    reference.region.scrollTop += delta;
    if (reference.focus) {
      const card = nodes.get(reference.focus);
      (card?.querySelector<HTMLButtonElement>(".qp-app-link-trigger") ?? card?.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
    }
  });
  useLayoutEffect(() => {
    const resize = () => {
      const opened = current.current;
      if (!opened || (opened.width === window.innerWidth && opened.height === window.innerHeight)) return;
      pendingClick.current?.(); pendingClick.current = null; restore.current = null;
      current.current = null; setSession(null);
    };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); pendingClick.current?.(); restore.current = null; };
  }, []);

  return {
    openIdentity: active?.identity ?? null,
    open, reset,
    beforeRegroup: (source: string, target: string) => {
      capture(source);
      const reference = restore.current;
      if (reference) {
        reference.references.unshift({ identity: target, top: reference.references[0].top });
        reference.focus = target;
      }
    },
    slots: active ? active.slots.map(slot => ({ ...slot, candidate: byIdentity.get(slot.identity) }))
      : candidates.map(candidate => ({ identity: identityOf(candidate), height: 0, candidate, preview: candidate })),
  };
}
