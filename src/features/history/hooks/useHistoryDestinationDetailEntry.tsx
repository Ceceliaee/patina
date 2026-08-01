import { useCallback, useEffect, type ReactNode } from "react";
import DestinationDetailDialogEntry from "../../destination/components/DestinationDetailDialogEntry.tsx";
import { useDestinationDetailLauncher } from "../../destination/hooks/useDestinationDetailLauncher.ts";
import {
  createDestinationDetailTarget,
  type DestinationDetailRuntimeContext,
  type DestinationDetailTarget,
} from "../../destination/types.ts";

export function createHistoryAppDetailTarget(
  key: string,
  displayName: string,
  iconUrl: string | null,
  color: string,
) {
  return createDestinationDetailTarget({
    mode: "app",
    key,
    identityKeys: [key],
    displayName,
    secondaryText: key,
    iconUrl,
    color,
  });
}

export function createHistoryWebDetailTarget(
  key: string,
  displayName: string,
  domain: string,
  iconUrl: string | null,
  color: string,
) {
  return createDestinationDetailTarget({
    mode: "web",
    key,
    identityKeys: [key],
    displayName,
    secondaryText: domain,
    iconUrl,
    color,
  });
}

interface UseHistoryDestinationDetailEntryOptions {
  initialDateKey: string;
  runtime: DestinationDetailRuntimeContext;
  webActivityEnabled: boolean;
}

interface HistoryDestinationDetailEntry {
  dialog: ReactNode;
  open: (target: DestinationDetailTarget, trigger: HTMLButtonElement) => void;
  prepare: (target: DestinationDetailTarget, trigger: HTMLButtonElement) => void;
}

export function useHistoryDestinationDetailEntry({
  initialDateKey,
  runtime,
  webActivityEnabled,
}: UseHistoryDestinationDetailEntryOptions): HistoryDestinationDetailEntry {
  const launcher = useDestinationDetailLauncher();
  const { close, open, openPrepared, prepare, request } = launcher;

  useEffect(() => {
    if (webActivityEnabled || request?.target.mode !== "web") return;
    close();
  }, [close, request, webActivityEnabled]);

  const prepareEntry = useCallback((
    target: DestinationDetailTarget,
    trigger: HTMLButtonElement,
  ) => {
    prepare({ target, initialDateKey }, { returnFocusTo: trigger });
  }, [initialDateKey, prepare]);

  const openEntry = useCallback((
    target: DestinationDetailTarget,
    trigger: HTMLButtonElement,
  ) => {
    if (openPrepared()) return;
    open({ target, initialDateKey }, { returnFocusTo: trigger });
  }, [initialDateKey, open, openPrepared]);

  return {
    prepare: prepareEntry,
    open: openEntry,
    dialog: request ? (
      <DestinationDetailDialogEntry
        key={`${request.target.mode}:${request.target.key}`}
        target={request.target}
        initialDateKey={request.initialDateKey}
        runtime={runtime}
        onClose={close}
      />
    ) : null,
  };
}
