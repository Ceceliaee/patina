/** One owner per independently committed snapshot, shared by all its event sources. */
export function createLatestSnapshotRefresh<T>(deps: {
  load: () => Promise<T>;
  accept: (snapshot: T) => void;
  failed: (error: unknown) => void;
}) {
  let sequence = 0;
  let disposed = false;
  return {
    async refresh(load: () => Promise<T> = deps.load): Promise<void> {
      if (disposed) return;
      const request = ++sequence;
      try {
        const snapshot = await load();
        if (!disposed && request === sequence) deps.accept(snapshot);
      } catch (error) {
        if (!disposed && request === sequence) deps.failed(error);
      }
    },
    dispose() { disposed = true; sequence += 1; },
  };
}
