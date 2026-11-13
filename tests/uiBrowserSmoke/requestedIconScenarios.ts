import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForAnimationFrames, waitForExpression } from "./browserHarness.ts";

export async function runRequestedIconScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("requested icon snapshots evict old batches and ignore superseded and unmounted requests", async () => {
    await evaluate(client, sessionId, `import('/tests/uiBrowserSmoke/requestedIconsFixture.ts').then(module => {
      globalThis.__patinaRequestedIconsProbe = module.createRequestedIconsProbe();
    })`);
    const probe = "globalThis.__patinaRequestedIconsProbe";
    try {
      for (const [index, name] of ["first.exe", "second.exe"].entries()) {
        await evaluate(client, sessionId, `${probe}.render([${jsonString(name)}])`);
        await waitForExpression(client, sessionId, `${probe}.read().requests.length === ${index + 1}`);
        await evaluate(client, sessionId, `${probe}.resolve(${index}, { [${jsonString(name)}]: 'icon' })`);
        await waitForExpression(client, sessionId, `${probe}.read().icons[${jsonString(name)}] === 'icon'`);
        assert.deepEqual(await evaluate(client, sessionId, `Object.keys(${probe}.read().icons).sort()`), ["base.exe", name].sort());
      }
      await evaluate(client, sessionId, `${probe}.render(['slow.exe'])`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 3`);
      await evaluate(client, sessionId, `${probe}.render(['current.exe'])`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 4`);
      await evaluate(client, sessionId, `${probe}.resolve(3, { 'current.exe': 'current' })`);
      await waitForExpression(client, sessionId, `${probe}.read().icons['current.exe'] === 'current'`);
      await evaluate(client, sessionId, `${probe}.resolve(2, { 'slow.exe': 'obsolete' })`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.deepEqual(await evaluate(client, sessionId, `Object.keys(${probe}.read().icons).sort()`), ["base.exe", "current.exe"]);
      await evaluate(client, sessionId, `${probe}.change('unrelated.exe')`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, `${probe}.read().requests.length`), 4);
      await evaluate(client, sessionId, `${probe}.change('CURRENT.EXE')`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 5`);
      assert.equal(await evaluate(client, sessionId, `${probe}.read().icons['current.exe']`), 'current');
      await evaluate(client, sessionId, `${probe}.resolve(4, { 'current.exe': 'refreshed' })`);
      await waitForExpression(client, sessionId, `${probe}.read().icons['current.exe'] === 'refreshed'`);
      await evaluate(client, sessionId, `${probe}.render(['unmounted.exe'])`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 6`);
      const commits = await evaluate(client, sessionId, `${probe}.read().commits`);
      await evaluate(client, sessionId, `${probe}.dispose(); ${probe}.reject(5)`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, `${probe}.read().commits`), commits);
      assert.deepEqual(await evaluate(client, sessionId, `${probe}.read().errors`), []);
    } finally {
      await evaluate(client, sessionId, `${probe}?.dispose(); delete globalThis.__patinaRequestedIconsProbe`);
    }
  });
}
