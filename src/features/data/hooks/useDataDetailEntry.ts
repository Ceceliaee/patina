import { useCallback, useRef, type RefObject } from "react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import { useDestinationDetailLauncher } from "../../destination/hooks/useDestinationDetailLauncher.ts";
import {
  createDestinationDetailTarget,
} from "../../destination/types.ts";
import {
  commitDataDestinationDetailSelection,
  type DataDestinationMode,
  type DataDestinationTrendOption,
} from "../services/dataDestinationState.ts";
import {
  resolveDataTrendRange,
  type DataTrendRangeSelection,
} from "../services/dataTrendRange.ts";

interface SelectionSnapshot {
  appKeys: string[];
  webKeys: string[];
  mode: DataDestinationMode;
  listScrollTop: number;
}

interface Params {
  appKeys: readonly string[];
  webKeys: readonly string[];
  mode: DataDestinationMode;
  rangeSelection: DataTrendRangeSelection;
  listRef: RefObject<HTMLDivElement | null>;
  resolveOptionColor: (option: DataDestinationTrendOption, mode: DataDestinationMode) => string;
  restoreSelectionSnapshot: (snapshot: SelectionSnapshot) => void;
}

interface DetailIntent {
  key: string;
  mode: DataDestinationMode;
  snapshot: SelectionSnapshot;
  returnFocusTo: HTMLElement | null;
}

export function useDataDetailEntry({
  appKeys,
  webKeys,
  mode,
  rangeSelection,
  listRef,
  resolveOptionColor,
  restoreSelectionSnapshot,
}: Params) {
  const UI_TEXT = useLocaleText();
  const launcher = useDestinationDetailLauncher();
  const intentRef = useRef<DetailIntent | null>(null);

  const createRequest = useCallback((option: DataDestinationTrendOption) => {
    const todayKey = formatLocalDateKey(new Date());
    const range = resolveDataTrendRange(rangeSelection, Date.now(), UI_TEXT);
    return {
      target: createDestinationDetailTarget({
        mode,
        key: option.key,
        identityKeys: option.identityKeys,
        displayName: option.displayName,
        secondaryText: option.secondaryText,
        iconUrl: option.iconUrl,
        color: resolveOptionColor(option, mode),
      }),
      initialDateKey: range.endDateKey <= todayKey ? range.endDateKey : todayKey,
    };
  }, [mode, rangeSelection, resolveOptionColor, UI_TEXT]);

  const createCloseHandler = useCallback((snapshot: SelectionSnapshot) => () => {
    restoreSelectionSnapshot(snapshot);
    window.requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: snapshot.listScrollTop });
    });
  }, [listRef, restoreSelectionSnapshot]);

  const createSnapshot = useCallback((): SelectionSnapshot => ({
    appKeys: [...appKeys],
    webKeys: [...webKeys],
    mode,
    listScrollTop: listRef.current?.scrollTop ?? 0,
  }), [appKeys, listRef, mode, webKeys]);

  const captureIntent = useCallback((
    option: DataDestinationTrendOption,
    returnFocusTo: HTMLElement | null = null,
  ) => {
    const snapshot = commitDataDestinationDetailSelection(
      createSnapshot(),
      mode,
      option.key,
    );
    intentRef.current = {
      key: option.key,
      mode,
      returnFocusTo,
      snapshot,
    };
    launcher.prepare(createRequest(option), {
      returnFocusTo,
      onClose: createCloseHandler(snapshot),
    });
  }, [createCloseHandler, createRequest, createSnapshot, launcher, mode]);

  const open = useCallback((option: DataDestinationTrendOption) => {
    const intent = intentRef.current;
    const snapshot = intent?.mode === mode && intent.key === option.key
      ? intent.snapshot
      : commitDataDestinationDetailSelection(createSnapshot(), mode, option.key);
    const returnFocusTo = intent?.mode === mode && intent.key === option.key
      ? intent.returnFocusTo
      : null;
    restoreSelectionSnapshot(snapshot);
    if (intent?.mode === mode && intent.key === option.key && launcher.openPrepared()) {
      return;
    }
    launcher.open(createRequest(option), {
      returnFocusTo,
      onClose: createCloseHandler(snapshot),
    });
  }, [createCloseHandler, createRequest, createSnapshot, launcher, mode, restoreSelectionSnapshot]);

  return {
    request: launcher.request,
    captureIntent,
    open,
    close: launcher.close,
  };
}
