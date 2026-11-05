export type ReadModelRefreshState = {
  mappingVersion: number;
  dataRefreshTick: number;
};

export const INITIAL_READ_MODEL_REFRESH_STATE: ReadModelRefreshState = {
  mappingVersion: 0,
  dataRefreshTick: 0,
};

export function resolveReadModelRefreshSignal(
  syncTick: number,
  state: ReadModelRefreshState,
): number {
  return syncTick + state.dataRefreshTick;
}

export function applyMappingOverridesReadModelRefresh(
  state: ReadModelRefreshState,
): ReadModelRefreshState {
  return {
    mappingVersion: state.mappingVersion + 1,
    dataRefreshTick: state.dataRefreshTick + 1,
  };
}
