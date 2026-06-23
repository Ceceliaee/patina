import type { CdpConnection } from "./browserHarness.ts";

export type RunBrowserSmokeTest = (
  name: string,
  fn: () => Promise<void> | void,
) => Promise<void>;

export type BrowserSmokeContext = {
  appUrl: string;
  client: CdpConnection;
  sessionId: string;
  runTest: RunBrowserSmokeTest;
};
