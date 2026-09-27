import { createElement, type ComponentType } from "react";

export type PreloadableView = "history" | "settings" | "mapping" | "data" | "tools" | "about";

type ViewChunkLoader = () => Promise<unknown>;
type ViewChunkLoaders = Record<PreloadableView, ViewChunkLoader>;
type ViewChunkStatus = "idle" | "pending" | "resolved" | "rejected";
const DEFAULT_VIEW_CHUNK_LOADERS: ViewChunkLoaders = {
  history: () => import("../../features/history/components/History"),
  settings: () => import("../../features/settings/components/Settings"),
  mapping: () => import("../../features/classification/components/AppMapping"),
  data: () => import("../../features/data/components/Data"),
  tools: () => import("../../features/tools/components/Tools"),
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

export function preloadLazyViewChunk(
  view: PreloadableView,
  deps: { loaders?: Partial<ViewChunkLoaders> } = {},
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

export function readPreloadedViewComponent<Props extends object = Record<string, unknown>>(
  view: PreloadableView,
): ComponentType<Props> {
  const record = getViewChunkRecord(view);

  if (record.status === "resolved") {
    return (record.module as { default: ComponentType<Props> }).default;
  }

  if (record.status === "rejected") {
    throw record.error;
  }

  throw preloadLazyViewChunk(view);
}

export function getPreloadableViewChunkStatus(view: PreloadableView): ViewChunkStatus {
  return getViewChunkRecord(view).status;
}

export function createPreloadableViewComponent<Props extends object = Record<string, unknown>>(
  view: PreloadableView,
): ComponentType<Props> {
  const displayName = `PreloadableView(${view})`;
  const PreloadableViewComponent: ComponentType<Props> = (props) => {
    const Component = readPreloadedViewComponent<Props>(view);
    return createElement(Component, props);
  };
  PreloadableViewComponent.displayName = displayName;
  return PreloadableViewComponent;
}

export function resetPreloadableViewChunksForTests(): void {
  viewChunkRecords.clear();
}
