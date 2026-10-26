import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

// Module entry points must not inherit classifications created by an earlier
// page's interaction tests. Preserve every setting outside this fixture.
export async function withClassifiedApps(context: BrowserSmokeContext, scenario: () => Promise<void>) {
  const { client, sessionId } = context;
  const before = await evaluate(client, sessionId, "localStorage.getItem('__time_tracker_smoke_settings')");
  const reload = async () => {
    const origin = await evaluate(client, sessionId, "performance.timeOrigin");
    await client.command("Page.reload", {}, sessionId);
    await waitForExpression(client, sessionId, `performance.timeOrigin !== ${origin} && Boolean(globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE)`);
  };
  const failures: unknown[] = [];
  try {
    await evaluate(client, sessionId, `(() => {
      const settings = JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') ?? '{}');
      for (const [exe, category] of [['cursor.exe', 'development'], ['deep-research-workbench.exe', 'office']]) {
        settings['__app_override::' + exe] = JSON.stringify({ category, enabled: true });
      }
      localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify(settings));
    })()`);
    await reload();
    await scenario();
  } catch (error) { failures.push(error); }
  finally {
    try {
      await evaluate(client, sessionId, `(() => {
        const before = ${JSON.stringify(before)};
        if (before === null) localStorage.removeItem('__time_tracker_smoke_settings');
        else localStorage.setItem('__time_tracker_smoke_settings', before);
      })()`);
      await reload();
    } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Classified app fixture failed");
}
