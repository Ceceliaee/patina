const LOCAL_DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function parseLocalDateKey(dateKey: string): Date | null {
  const match = LOCAL_DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addLocalDays(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

export function addLocalMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function minLocalDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

export function maxLocalDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

export function countInclusiveLocalDays(startDateKey: string, endDateKey: string): number {
  const start = parseLocalDateKey(startDateKey);
  const end = parseLocalDateKey(endDateKey);
  if (!start || !end || start > end) return 0;

  let count = 0;
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) count += 1;
  return count;
}

export function getIsoWeek(date: Date): { week: number; year: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return {
    week: Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7),
    year: utc.getUTCFullYear(),
  };
}

export function moveLocalDateByCalendarKey(date: Date, key: string): Date | null {
  const mondayFirstDay = (date.getDay() + 6) % 7;
  const dayOffset = key === "ArrowRight"
    ? 1
    : key === "ArrowLeft"
      ? -1
      : key === "ArrowDown"
        ? 7
        : key === "ArrowUp"
          ? -7
          : key === "Home"
            ? -mondayFirstDay
            : key === "End"
              ? 6 - mondayFirstDay
              : null;
  return dayOffset === null ? null : startOfLocalDay(addLocalDays(date, dayOffset));
}

export function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function buildMondayFirstCalendarGrid(month: Date): Date[] {
  const monthStart = startOfLocalMonth(month);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = addLocalDays(monthStart, -mondayOffset);

  return Array.from({ length: 42 }, (_, index) => addLocalDays(gridStart, index));
}
