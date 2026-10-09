import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import LinkedAppMenu from '../../src/features/classification/components/LinkedAppMenu.tsx';
import type { AppLinks } from '../../src/shared/classification/appLinks.ts';
import { LocaleProvider } from '../../src/shared/i18n/index.ts';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let currentCounts = { names: 0, candidates: 0 };
export function mount(links: AppLinks = {}, suffix = '', disabled = false) {
  if (!host) {
    host = document.createElement('div');
    host.id = 'linked-menu-probe';
    host.style.cssText = 'position:fixed;top:100px;left:100px;z-index:9999';
    document.body.append(host);
    root = createRoot(host);
  }
  const counts = { names: 0, candidates: 0 };
  currentCounts = counts;
  const candidates = Array.from({ length: 50 }, (_, index) => ({
    get exeName() { if (index > 0) counts.candidates++; return `probe-${index}.exe`; },
    appName: `Probe ${index}${suffix}`, totalDuration: 0, lastSeenMs: 0,
  }));
  root!.render(createElement(LocaleProvider, { locale: 'zh-CN', children: createElement(LinkedAppMenu, {
    parent: candidates[0], candidates, links, icons: {}, disabled, globalTitleEnabled: true,
    name: candidate => { counts.names++; return candidate.appName; }, tracking: () => true, titleCapture: () => true,
    onLink: () => undefined, onTracking: () => undefined, onTitle: () => undefined,
  }) }));
}
export function nameCalls() { return currentCounts.names; }
export function candidateReads() { return currentCounts.candidates; }
export function cleanup() { root?.unmount(); host?.remove(); root = undefined; host = undefined; }
