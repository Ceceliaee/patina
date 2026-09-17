import { useEffect, useReducer } from "react";
import { AppClassification } from "../classification/appClassification.ts";

type IconChangeListener = (exeName: string | null) => void;
const listeners = new Set<IconChangeListener>();

export function subscribeAppIconChanges(listener: IconChangeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function appIconChangeAffects(exeName: string | null, requested: readonly string[]): boolean {
  if (exeName === null) return true;
  const key = AppClassification.resolveCanonicalExecutable(exeName);
  return requested.some((name) => AppClassification.resolveCanonicalExecutable(name) === key
    || AppClassification.resolveStatisticalApp(name) === key);
}

export function publishAppIconChange(exeName: string | null): void {
  for (const listener of listeners) listener(exeName);
}

export function useAppIconRevision(exeNames: readonly string[]): number {
  const [revision, setRevision] = useReducer((value: number) => value + 1, 0);
  useEffect(() => subscribeAppIconChanges((exe) => {
    if (appIconChangeAffects(exe, exeNames)) setRevision();
  }), [exeNames]);
  return revision;
}
