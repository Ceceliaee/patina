import assert from "node:assert/strict";
import { evaluate, waitForAnimationFrames, waitForExpression, waitForStableExpression } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

export async function verifyDestinationDetailScroll({ client, sessionId, runTest }: Pick<BrowserSmokeContext, "client" | "sessionId" | "runTest">) {
  await runTest("detail scroll position stays stable when the pointer crosses cards at the bottom", async () => {
    // Extend the rendered cards to isolate scroll geometry from activity fixtures.
    await evaluate(client!, sessionId, `(() => {
      const list = document.querySelector('.destination-detail-records');
      for (let i = 0; i < 20; i++) list.append(list.lastElementChild.cloneNode(true));
    })()`);
    for (const size of [
      { width: 1280, height: 820, deviceScaleFactor: 1 },
      { width: 1100, height: 736, deviceScaleFactor: 1.25 },
      { width: 900, height: 600, deviceScaleFactor: 1.5 },
    ]) {
      await client!.command("Emulation.setDeviceMetricsOverride", { ...size, mobile: false }, sessionId);
      await waitForStableExpression(client!, sessionId,
        `innerWidth === ${size.width} && innerHeight === ${size.height} && devicePixelRatio === ${size.deviceScaleFactor}`,
        undefined, `detail viewport settled at ${JSON.stringify(size)}`);
      const scrollportHeight = await evaluate(client!, sessionId, `document.querySelector('.destination-detail-records').getBoundingClientRect().height`) as number;
      if (size.height >= 736) {
        const physicalHeight = scrollportHeight * size.deviceScaleFactor;
        assert.ok(Math.abs(physicalHeight - Math.round(physicalHeight)) < 0.01,
          `the capped scrollport must not end at half a physical pixel: ${physicalHeight}`);
      }
      const point = await evaluate(client!, sessionId, `(() => {
        const list = document.querySelector('.destination-detail-records');
        list.scrollTop = 0;
        const r = list.getBoundingClientRect();
        return {x:r.left+30,y:r.bottom-25};
      })()`) as { x: number; y: number };
      // Layout reads do not flush Chromium's compositor scroll/hit-test state.
      await waitForAnimationFrames(client!, sessionId);
      assert.equal(await evaluate(client!, sessionId,
        `document.querySelector('.destination-detail-records').contains(document.elementFromPoint(${point.x}, ${point.y}))`),
      true, `wheel target must hit the detail list at ${JSON.stringify(size)}`);
      await client!.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
      await client!.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: 10000 }, sessionId);
      try {
        await waitForExpression(client!, sessionId, `(() => {
          const list = document.querySelector('.destination-detail-records');
          return list.scrollHeight > list.clientHeight && Math.abs(list.scrollHeight-list.clientHeight-list.scrollTop)<1;
        })()`, undefined, `detail wheel reaches bottom at ${JSON.stringify(size)}`);
      } catch (cause) {
        const metrics = await evaluate(client!, sessionId, `(() => {
          const list = document.querySelector('.destination-detail-records');
          return {scrollTop:list?.scrollTop, scrollHeight:list?.scrollHeight, clientHeight:list?.clientHeight,
            bounds:list?.getBoundingClientRect().toJSON(), hit:document.elementFromPoint(${point.x},${point.y})?.className};
        })()`);
        throw new Error(`Detail scroll did not reach bottom: ${JSON.stringify({size, point, metrics})}`, { cause });
      }
      const snapshot = `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const list = document.querySelector('.destination-detail-records');
        resolve({scrollTop:list.scrollTop, bottom:list.lastElementChild.getBoundingClientRect().bottom});
      })))`;
      const before = await evaluate(client!, sessionId, snapshot);
      for (const offset of [85, 145, 25, -20]) {
        await client!.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y - offset }, sessionId);
        const after = await evaluate(client!, sessionId, snapshot);
        assert.deepEqual(after, before, `pointer movement must not shift cards at ${JSON.stringify(size)}`);
      }
    }
  });
}
