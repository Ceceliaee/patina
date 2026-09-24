// Presentation identity only; anonymous facts contain no executable or domain.
export const ANONYMOUS_ACTIVITY_KEY = "activity:anonymous";

export function isAnonymousActivity(key: string): boolean {
  return key === ANONYMOUS_ACTIVITY_KEY;
}
