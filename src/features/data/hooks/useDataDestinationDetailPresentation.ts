import {
  useCallback,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  buildDataDestinationDetailTarget,
  createDataDestinationDetailSelectionSnapshot,
  selectDataDestinationDetailSnapshotTarget,
  type DataDestinationDetailSelectionSnapshot,
  type DataDestinationDetailTarget,
} from "../services/dataDestinationDetailState.ts";
import type {
  DataDestinationMode,
  DataDestinationTrendOption,
} from "../services/dataDestinationState.ts";
import type {
  DataTrendRangeSelection,
} from "../services/dataTrendRange.ts";

export interface DataDestinationDetailPresentation {
  target: DataDestinationDetailTarget;
  initialSelection: DataTrendRangeSelection;
  selectionSnapshot: DataDestinationDetailSelectionSnapshot;
}

interface UseDataDestinationDetailPresentationParams {
  appKeys: readonly string[];
  listRef: RefObject<HTMLDivElement | null>;
  mode: DataDestinationMode;
  rangeSelection: DataTrendRangeSelection;
  resolveOptionColor: (
    option: DataDestinationTrendOption,
    mode: DataDestinationMode,
  ) => string;
  restoreSelectionSnapshot: (
    snapshot: DataDestinationDetailSelectionSnapshot,
  ) => void;
  webKeys: readonly string[];
}

interface DetailIntent {
  key: string;
  mode: DataDestinationMode;
  snapshot: DataDestinationDetailSelectionSnapshot;
}

export function useDataDestinationDetailPresentation({
  appKeys,
  listRef,
  mode,
  rangeSelection,
  resolveOptionColor,
  restoreSelectionSnapshot,
  webKeys,
}: UseDataDestinationDetailPresentationParams) {
  const [presentation, setPresentation] =
    useState<DataDestinationDetailPresentation | null>(null);
  const intentRef = useRef<DetailIntent | null>(null);

  const createSelectionSnapshot = useCallback(() => (
    createDataDestinationDetailSelectionSnapshot({
      appKeys,
      webKeys,
      mode,
      listScrollTop: listRef.current?.scrollTop ?? 0,
    })
  ), [appKeys, listRef, mode, webKeys]);

  const captureIntent = useCallback((
    option: DataDestinationTrendOption,
    selectTarget = false,
  ) => {
    const snapshot = createSelectionSnapshot();
    intentRef.current = {
      key: option.key,
      mode,
      snapshot: selectTarget
        ? selectDataDestinationDetailSnapshotTarget(snapshot, mode, option.key)
        : snapshot,
    };
  }, [createSelectionSnapshot, mode]);

  const open = useCallback((option: DataDestinationTrendOption) => {
    const intent = intentRef.current;
    const selectionSnapshot = intent?.mode === mode && intent.key === option.key
      ? intent.snapshot
      : createSelectionSnapshot();

    restoreSelectionSnapshot(selectionSnapshot);
    setPresentation({
      target: buildDataDestinationDetailTarget(
        mode,
        option,
        resolveOptionColor(option, mode),
      ),
      initialSelection: { ...rangeSelection },
      selectionSnapshot,
    });
  }, [
    createSelectionSnapshot,
    mode,
    rangeSelection,
    resolveOptionColor,
    restoreSelectionSnapshot,
  ]);

  const close = useCallback(() => {
    if (!presentation) return;
    const { selectionSnapshot } = presentation;
    restoreSelectionSnapshot(selectionSnapshot);
    setPresentation(null);
    intentRef.current = null;
    window.requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: selectionSnapshot.listScrollTop });
    });
  }, [listRef, presentation, restoreSelectionSnapshot]);

  return {
    presentation,
    captureIntent,
    open,
    close,
  };
}
