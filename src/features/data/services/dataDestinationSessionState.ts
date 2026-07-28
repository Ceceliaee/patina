import type { DataDestinationTrendOption } from "./dataDestinationState.ts";

export interface DataDestinationSessionSelectionState {
  appKeys: string[];
  webKeys: string[];
}

type DataDestinationSessionMode = "app" | "web";

const sessionSelectionState: DataDestinationSessionSelectionState = {
  appKeys: [],
  webKeys: [],
};
const sessionSelectionRevisions: Record<DataDestinationSessionMode, number | null> = {
  app: null,
  web: null,
};
const sessionOptionRegistry: Record<
  DataDestinationSessionMode,
  Map<string, DataDestinationTrendOption>
> = {
  app: new Map(),
  web: new Map(),
};

export function getDataDestinationSessionSelectionState(): DataDestinationSessionSelectionState {
  return {
    appKeys: [...sessionSelectionState.appKeys],
    webKeys: [...sessionSelectionState.webKeys],
  };
}

export function rememberDataDestinationSessionSelectionState(
  nextState: DataDestinationSessionSelectionState,
): void {
  sessionSelectionState.appKeys = [...nextState.appKeys];
  sessionSelectionState.webKeys = [...nextState.webKeys];
}

export function getDataDestinationSessionSelectionRevision(
  mode: DataDestinationSessionMode,
): number | null {
  return sessionSelectionRevisions[mode];
}

export function rememberDataDestinationSessionSelectionRevision(
  mode: DataDestinationSessionMode,
  revision: number,
): void {
  sessionSelectionRevisions[mode] = revision;
}

export function rememberDataDestinationSessionOptions(
  mode: DataDestinationSessionMode,
  options: readonly DataDestinationTrendOption[],
): void {
  for (const option of options) {
    sessionOptionRegistry[mode].set(option.key, { ...option });
  }
}

export function getDataDestinationSessionOptions(
  mode: DataDestinationSessionMode,
  keys: readonly string[],
): DataDestinationTrendOption[] {
  return keys
    .map((key) => sessionOptionRegistry[mode].get(key))
    .filter((option): option is DataDestinationTrendOption => Boolean(option))
    .map((option) => ({ ...option }));
}

export function resolveDataDestinationSessionOptions(
  mode: DataDestinationSessionMode,
  currentOptions: readonly DataDestinationTrendOption[],
  availableOptions: readonly DataDestinationTrendOption[],
): DataDestinationTrendOption[] {
  const availableByKey = new Map(availableOptions.map((option) => [option.key, option]));
  return currentOptions.map((current) => ({
    ...(availableByKey.get(current.key) ?? sessionOptionRegistry[mode].get(current.key) ?? current),
    totalDuration: current.totalDuration,
    percentage: current.percentage,
    averageDuration: current.averageDuration,
    activeDayCount: current.activeDayCount,
  }));
}

export function resetDataDestinationSessionSelectionStateForTests(): void {
  sessionSelectionState.appKeys = [];
  sessionSelectionState.webKeys = [];
  sessionSelectionRevisions.app = null;
  sessionSelectionRevisions.web = null;
  sessionOptionRegistry.app.clear();
  sessionOptionRegistry.web.clear();
}
