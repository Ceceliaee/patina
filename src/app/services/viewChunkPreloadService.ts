import { createElement, type ComponentType } from "react";

export type PreloadableView = "history" | "settings" | "mapping" | "data" | "about";

export interface LazyViewChunkPreloadOptions {
  views?: PreloadableView[];
  initialDelayMs?: number;
  staggerMs?: number;
  idleTimeoutMs?: number;
}

type ViewChunkLoader = () => Promise<unknown>;
type ViewChunkLoaders = Record<PreloadableView, ViewChunkLoader>;
type ViewChunkStatus = "idle" | "pending" | "resolved" | "rejected";
type SchedulePreloadTask = (
  callback: () => void,
  delayMs: number,
  idleTimeoutMs: number,
) => () => void;

interface LazyViewChunkPreloadDeps {
  loaders?: Partial<ViewChunkLoaders>;
  schedule?: SchedulePreloadTask;
  warn?: (message: string, error: unknown) => void;
}

type IdleWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const DEFAULT_PRELOADABLE_VIEWS: PreloadableView[] = ["history", "data", "mapping", "settings", "about"];
const DEFAULT_INITIAL_DELAY_MS = 1200;
const DEFAULT_STAGGER_MS = 200;
const DEFAULT_IDLE_TIMEOUT_MS = 1500;

const DEFAULT_VIEW_CHUNK_LOADERS: ViewChunkLoaders = {
  history: () => import("../../features/history/components/History"),
  settings: () => import("../../features/settings/components/Settings"),
  mapping: () => import("../../features/classification/components/AppMapping"),
  data: () => import("../../features/data/components/Data"),
  about: () => import("../../features/about/components/About"),
};

interface ViewChunkRecord {
  error?: unknown;
  module?: unknown;
  promise?: Promise<unknown>;
  status: ViewChunkStatus;
}

const viewChunkRecords = new Map<PreloadableView, ViewChunkRecord>();

function getViewChunkRecord(view: PreloadableView): ViewChunkRecord {
  const existing = viewChunkRecords.get(view);
  if (existing) {
    return existing;
  }

  const record: ViewChunkRecord = { status: "idle" };
  viewChunkRecords.set(view, record);
  return record;
}

function resolveViewChunkLoaders(loaders?: Partial<ViewChunkLoaders>): ViewChunkLoaders {
  return {
    ...DEFAULT_VIEW_CHUNK_LOADERS,
    ...loaders,
  };
}

function schedulePreloadTask(
  callback: () => void,
  delayMs: number,
  idleTimeoutMs: number,
): () => void {
  if (typeof window === "undefined") {
    const timer = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(timer);
  }

  let cancelIdle: (() => void) | null = null;
  const timer = window.setTimeout(() => {
    const idleWindow = window as IdleWindow;

    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const handle = idleWindow.requestIdleCallback(callback, { timeout: idleTimeoutMs });
      cancelIdle = () => idleWindow.cancelIdleCallback?.(handle);
      return;
    }

    const handle = window.setTimeout(callback, 0);
    cancelIdle = () => window.clearTimeout(handle);
  }, delayMs);

  return () => {
    window.clearTimeout(timer);
    cancelIdle?.();
  };
}

export function scheduleLazyViewChunkPreload(
  options: LazyViewChunkPreloadOptions = {},
  deps: LazyViewChunkPreloadDeps = {},
): () => void {
  const views = options.views ?? DEFAULT_PRELOADABLE_VIEWS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const loaders = resolveViewChunkLoaders(deps.loaders);
  const schedule = deps.schedule ?? schedulePreloadTask;
  const warn = deps.warn ?? console.warn;
  let cancelled = false;
  let cancelCurrentTask: (() => void) | null = null;

  const scheduleView = (index: number, delayMs: number) => {
    if (cancelled || index >= views.length) {
      return;
    }

    cancelCurrentTask = schedule(() => {
      cancelCurrentTask = null;
      void preloadView(index);
    }, delayMs, idleTimeoutMs);
  };

  const preloadView = async (index: number) => {
    if (cancelled) {
      return;
    }

    const view = views[index];

    try {
      await preloadLazyViewChunk(view, { loaders });
    } catch (error) {
      warn(`Failed to preload ${view} view chunk`, error);
    }

    if (!cancelled) {
      scheduleView(index + 1, staggerMs);
    }
  };

  scheduleView(0, initialDelayMs);

  return () => {
    cancelled = true;
    cancelCurrentTask?.();
    cancelCurrentTask = null;
  };
}

export function preloadLazyViewChunk(
  view: PreloadableView,
  deps: Pick<LazyViewChunkPreloadDeps, "loaders"> = {},
): Promise<unknown> {
  const record = getViewChunkRecord(view);

  if (record.status === "resolved") {
    return Promise.resolve(record.module);
  }

  if (record.status === "pending" && record.promise) {
    return record.promise;
  }

  const loaders = resolveViewChunkLoaders(deps.loaders);
  const promise = loaders[view]()
    .then((loadedModule) => {
      record.status = "resolved";
      record.module = loadedModule;
      record.promise = undefined;
      record.error = undefined;
      return loadedModule;
    })
    .catch((error) => {
      record.status = "rejected";
      record.promise = undefined;
      record.error = error;
      throw error;
    });

  record.status = "pending";
  record.promise = promise;
  record.module = undefined;
  record.error = undefined;
  return promise;
}

export function readPreloadedViewComponent(view: PreloadableView): ComponentType<Record<string, unknown>> {
  const record = getViewChunkRecord(view);

  if (record.status === "resolved") {
    return (record.module as { default: ComponentType<Record<string, unknown>> }).default;
  }

  if (record.status === "rejected") {
    throw record.error;
  }

  throw preloadLazyViewChunk(view);
}

export function getPreloadableViewChunkStatus(view: PreloadableView): ViewChunkStatus {
  return getViewChunkRecord(view).status;
}

export function createPreloadableViewComponent(
  view: PreloadableView,
): ComponentType<Record<string, unknown>> {
  const displayName = `PreloadableView(${view})`;
  const PreloadableViewComponent: ComponentType<Record<string, unknown>> = (props) => {
    const Component = readPreloadedViewComponent(view);
    return createElement(Component, props);
  };
  PreloadableViewComponent.displayName = displayName;
  return PreloadableViewComponent;
}

export function resetPreloadableViewChunksForTests(): void {
  viewChunkRecords.clear();
}
