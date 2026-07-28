export type DataWebHeatmapRequestStatus =
  | "idle"
  | "loading-cold"
  | "ready"
  | "refreshing"
  | "refresh-failed-with-retained-data"
  | "cold-failed";

export interface DataWebHeatmapRequestState<Snapshot> {
  presentationKey: string | null;
  requestKey: string | null;
  snapshot: Snapshot | null;
  status: DataWebHeatmapRequestStatus;
}

export type DataWebHeatmapRequestAction<Snapshot> =
  | {
    type: "begin";
    presentationKey: string;
    requestKey: string;
  }
  | {
    type: "succeeded";
    presentationKey: string;
    requestKey: string;
    snapshot: Snapshot;
  }
  | {
    type: "failed";
    presentationKey: string;
    requestKey: string;
  }
  | {
    type: "reset";
  };

export function createInitialDataWebHeatmapRequestState<Snapshot>(): DataWebHeatmapRequestState<Snapshot> {
  return {
    presentationKey: null,
    requestKey: null,
    snapshot: null,
    status: "idle",
  };
}

export function reduceDataWebHeatmapRequestState<Snapshot>(
  state: DataWebHeatmapRequestState<Snapshot>,
  action: DataWebHeatmapRequestAction<Snapshot>,
): DataWebHeatmapRequestState<Snapshot> {
  if (action.type === "reset") {
    return createInitialDataWebHeatmapRequestState();
  }

  if (action.type === "begin") {
    const retainedSnapshot = state.presentationKey === action.presentationKey
      ? state.snapshot
      : null;
    return {
      presentationKey: action.presentationKey,
      requestKey: action.requestKey,
      snapshot: retainedSnapshot,
      status: retainedSnapshot ? "refreshing" : "loading-cold",
    };
  }

  if (
    state.requestKey !== action.requestKey
    || state.presentationKey !== action.presentationKey
  ) {
    return state;
  }

  if (action.type === "succeeded") {
    return {
      presentationKey: action.presentationKey,
      requestKey: action.requestKey,
      snapshot: action.snapshot,
      status: "ready",
    };
  }

  return {
    ...state,
    status: state.snapshot ? "refresh-failed-with-retained-data" : "cold-failed",
  };
}

export function resolveDataWebHeatmapRequestState<Snapshot>(
  state: DataWebHeatmapRequestState<Snapshot>,
  presentationKey: string,
  requestKey: string,
): DataWebHeatmapRequestState<Snapshot> {
  if (state.presentationKey === presentationKey && state.requestKey === requestKey) {
    return state;
  }

  const retainedSnapshot = state.presentationKey === presentationKey
    ? state.snapshot
    : null;
  return {
    presentationKey,
    requestKey,
    snapshot: retainedSnapshot,
    status: retainedSnapshot ? "refreshing" : "loading-cold",
  };
}
