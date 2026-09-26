import { useState } from "react";

// Keep a complete range presentation while its replacement loads, never across
// destination identities, failed reads, or a local-day rollover.
export function useDataPresentation<T>(
  value: T,
  ready: boolean,
  pending: boolean,
  scope = "",
): T {
  const key = `${scope}/${new Date().toDateString()}`;
  const [committed, setCommitted] = useState(ready ? { value, key } : null);
  if (ready && committed?.value !== value) setCommitted({ value, key });
  return !ready && pending && committed?.key === key ? committed.value : value;
}
