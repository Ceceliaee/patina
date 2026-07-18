export type TimeRecordOrigin = "native" | "import_exact" | "import_bucket";

export interface OwnedTimeRange<T = unknown> {
  key: string;
  origin: TimeRecordOrigin;
  startTime: number;
  endTime: number;
  capacityEndTime?: number;
  value?: T;
}

interface IndexedRange<T> {
  index: number;
  record: OwnedTimeRange<T>;
}

interface TimeInterval {
  startTime: number;
  endTime: number;
}

interface SweepEvent<T> {
  time: number;
  boundary: "start" | "end";
  candidate: IndexedRange<T>;
}

const ORIGIN_ORDER: Record<TimeRecordOrigin, number> = {
  native: 0,
  import_exact: 1,
  import_bucket: 2,
};

export function resolveNativeSessionPrecedence<T>(
  records: OwnedTimeRange<T>[],
): OwnedTimeRange<T>[] {
  const indexed = records
    .map((record, index) => ({ index, record }))
    .filter(({ record }) => (
      Number.isFinite(record.startTime)
      && Number.isFinite(record.endTime)
      && record.endTime > record.startTime
    ));
  const native = indexed.filter(({ record }) => record.origin === "native");
  const exact = indexed
    .filter(({ record }) => record.origin === "import_exact")
    .sort(compareIndexedRanges);
  const buckets = indexed.filter(({ record }) => record.origin === "import_bucket");
  const resolvedExact = resolveExactRangesBySweep(native, exact);
  const resolved: IndexedRange<T>[] = [
    ...native.map(cloneIndexedRange),
    ...resolvedExact,
  ];
  const occupied = mergeIntervals([
    ...native.map(({ record }) => record),
    ...resolvedExact.map(({ record }) => record),
  ]);

  const bucketsByWindow = new Map<string, IndexedRange<T>[]>();
  for (const candidate of buckets) {
    const capacityEndTime = candidate.record.capacityEndTime ?? candidate.record.endTime;
    if (!Number.isFinite(capacityEndTime) || capacityEndTime <= candidate.record.startTime) {
      continue;
    }
    const groupKey = `${candidate.record.startTime}:${capacityEndTime}`;
    const group = bucketsByWindow.get(groupKey) ?? [];
    group.push(candidate);
    bucketsByWindow.set(groupKey, group);
  }

  for (const group of bucketsByWindow.values()) {
    group.sort((left, right) => left.index - right.index);
    const windowStart = group[0].record.startTime;
    const windowEnd = group[0].record.capacityEndTime ?? group[0].record.endTime;
    const occupiedDuration = intersectedDuration(occupied, windowStart, windowEnd);
    let availableDuration = Math.max(0, windowEnd - windowStart - occupiedDuration);
    let remainingRequested = group.reduce(
      (total, { record }) => total + (record.endTime - record.startTime),
      0,
    );

    for (const candidate of group) {
      const requested = candidate.record.endTime - candidate.record.startTime;
      const allocated = remainingRequested <= availableDuration
        ? requested
        : remainingRequested > 0
          ? Math.floor((requested * availableDuration) / remainingRequested)
          : 0;
      if (allocated > 0) {
        resolved.push({
          index: candidate.index,
          record: {
            ...candidate.record,
            endTime: candidate.record.startTime + allocated,
          },
        });
      }
      remainingRequested -= requested;
      availableDuration -= allocated;
    }
  }

  return resolved
    .sort(compareIndexedRanges)
    .map(({ record }) => record);
}

function cloneIndexedRange<T>(candidate: IndexedRange<T>): IndexedRange<T> {
  return { index: candidate.index, record: { ...candidate.record } };
}

function compareIndexedRanges<T>(left: IndexedRange<T>, right: IndexedRange<T>): number {
  return left.record.startTime - right.record.startTime
    || ORIGIN_ORDER[left.record.origin] - ORIGIN_ORDER[right.record.origin]
    || left.index - right.index
    || left.record.endTime - right.record.endTime;
}

function resolveExactRangesBySweep<T>(
  native: IndexedRange<T>[],
  exact: IndexedRange<T>[],
): IndexedRange<T>[] {
  const events: SweepEvent<T>[] = [];
  for (const candidate of [...native, ...exact]) {
    events.push(
      { time: candidate.record.startTime, boundary: "start", candidate },
      { time: candidate.record.endTime, boundary: "end", candidate },
    );
  }
  events.sort((left, right) => left.time - right.time);

  const activeExact = new Set<number>();
  const exactHeap: IndexedRange<T>[] = [];
  const resolved: IndexedRange<T>[] = [];
  let activeNativeCount = 0;
  let cursor = 0;
  while (cursor < events.length) {
    const time = events[cursor].time;
    while (cursor < events.length && events[cursor].time === time) {
      const event = events[cursor];
      if (event.candidate.record.origin === "native") {
        activeNativeCount += event.boundary === "start" ? 1 : -1;
      } else if (event.boundary === "start") {
        activeExact.add(event.candidate.index);
        heapPush(exactHeap, event.candidate);
      } else {
        activeExact.delete(event.candidate.index);
      }
      cursor += 1;
    }

    const nextTime = events[cursor]?.time;
    if (nextTime === undefined || nextTime <= time || activeNativeCount > 0) continue;
    while (exactHeap[0] && !activeExact.has(exactHeap[0].index)) {
      heapPop(exactHeap);
    }
    const winner = exactHeap[0];
    if (!winner) continue;

    const previous = resolved[resolved.length - 1];
    if (previous?.index === winner.index && previous.record.endTime === time) {
      previous.record.endTime = nextTime;
    } else {
      resolved.push({
        index: winner.index,
        record: { ...winner.record, startTime: time, endTime: nextTime },
      });
    }
  }
  return resolved;
}

function heapPush<T>(heap: IndexedRange<T>[], candidate: IndexedRange<T>): void {
  heap.push(candidate);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareIndexedRanges(heap[parent], heap[index]) <= 0) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function heapPop<T>(heap: IndexedRange<T>[]): IndexedRange<T> | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && compareIndexedRanges(heap[left], heap[smallest]) < 0) {
      smallest = left;
    }
    if (right < heap.length && compareIndexedRanges(heap[right], heap[smallest]) < 0) {
      smallest = right;
    }
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
  return first;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const ordered = intervals
    .filter((interval) => interval.endTime > interval.startTime)
    .map((interval) => ({ ...interval }))
    .sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
  const merged: TimeInterval[] = [];
  for (const interval of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.startTime > previous.endTime) {
      merged.push(interval);
      continue;
    }
    previous.endTime = Math.max(previous.endTime, interval.endTime);
  }
  return merged;
}

function intersectedDuration(
  intervals: TimeInterval[],
  startTime: number,
  endTime: number,
): number {
  return intervals.reduce((total, interval) => (
    total + Math.max(
      0,
      Math.min(endTime, interval.endTime) - Math.max(startTime, interval.startTime),
    )
  ), 0);
}
