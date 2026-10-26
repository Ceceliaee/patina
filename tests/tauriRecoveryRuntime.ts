import { verifyWebviewRecovery, verifyWebviewRecoveryLimit } from "./tauriWebviewRecovery.ts";

import { RuntimeSession } from "./tauriRuntimeHarness.ts";

export async function run(session: RuntimeSession) {
  const { logs, devtoolsPort } = session;
  let client = session.client!;
  try {
    await session.show();
    client = await verifyWebviewRecovery(client, devtoolsPort);
    await verifyWebviewRecoveryLimit(client, devtoolsPort, () => logs.join(""));

  } finally { session.client = client; }
}
