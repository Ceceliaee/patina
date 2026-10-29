import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

export async function runMiniPagedScenarios({ client, sessionId, appUrl, runTest }: BrowserSmokeContext) {
  const read = (value: string) => evaluate(client, sessionId, value);
  const wait = (value: string) => waitForExpression(client, sessionId, `Boolean(${value})`, 15_000, "mini pages");
  const settingsKey = "__time_tracker_smoke_settings";
  const previous = await read(`localStorage.getItem('${settingsKey}')`);
  const evidence = join(tmpdir(), "patina-mini-pages-review");
  mkdirSync(evidence, { recursive: true });
  const patch = async (value: Record<string, string>) => read(`{const s=JSON.parse(localStorage.getItem('${settingsKey}')||'{}');Object.assign(s,${JSON.stringify(value)});localStorage.setItem('${settingsKey}',JSON.stringify(s));globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{});}`);
  const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
  const next = async () => {
    const title = await read(`document.querySelector('.mini-page-title').textContent`);
    await read(`document.querySelector('.mini-navigation').click()`);
    await wait(`document.querySelector('.mini-page-title').textContent !== ${JSON.stringify(title)}`);
  };
  const escape = async () => {
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }, sessionId);
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape" }, sessionId);
  };
  try {
    await patch({ language: "zh-CN", dynamic_effects: "0", hourly_activity_chart_mode: "category", history_timeline_mode: "app",
      refresh_interval_secs: "1", timeline_merge_gap_secs: "0",
      "__app_override::editor.exe": JSON.stringify({ category: "development" }),
      "__app_override::browser.exe": JSON.stringify({ category: "utility" }),
      "__app_override::chat.exe": JSON.stringify({ category: "communication" }) });
    await runTest("mini defaults to today with precise proportions and bounded keyboard details", async () => {
      await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: 1, mobile: false }, sessionId);
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`document.querySelector('[data-mini-page="today"]')?.textContent.includes('3h 26m')`);
      assert.equal(await read(`document.querySelectorAll('.mini-category-segment').length`), 4);
      assert.deepEqual(await read(`Array.from(document.querySelectorAll('.mini-category-segment'),button=>
        Math.round(button.getBoundingClientRect().width/document.querySelector('.mini-category-bar').getBoundingClientRect().width*206))`),
      [14, 28, 46, 118], "category proportions run from smaller left segments to larger right segments");
      assert.equal(await read(`document.querySelector('.mini-content').textContent.includes('1h 58m')`), false);
      await read(`document.querySelector('.mini-category-segment:last-child').focus()`);
      await wait(`document.querySelector('[role="tooltip"]')?.textContent.includes('1h 58m')`);
      assert.equal(await read(`(() => {const r=document.querySelector('.mini-detail').getBoundingClientRect();return r.width<=220&&r.height<=40})()`), true,
        "a single category uses a compact content-sized tooltip");
      assert.equal(await read(`(() => {const r=document.querySelector('[role="tooltip"]').getBoundingClientRect();return r.left>=0&&r.top>=32&&r.right<=320&&r.bottom<=240})()`), true);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft" }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft" }, sessionId);
      await wait(`document.querySelector('[role="tooltip"]')?.textContent.includes('46m')`);
      await read(`document.querySelector('.mini-category-segment').click()`);
      assert.equal(await read(`document.querySelectorAll('.mini-detail .qp-chart-tooltip-item').length`), 4);
      await escape();
      assert.equal(await read(`Boolean(document.querySelector('[role="tooltip"]'))`), false);
      assert.equal(await read(`document.querySelector('.mini-shell').dataset.expanded`), "true");
      await escape();
      await wait(`document.querySelector('.mini-shell').dataset.expanded==='false' && !document.querySelector('.mini-content')`);
      await read(`document.querySelector('.mini-handle').click()`);
      await wait(`Boolean(document.querySelector('[data-mini-page="today"]'))`);
      await patch({ hourly_activity_chart_mode: "total" });
      await wait(`document.querySelector('[data-hourly-activity-chart-mode="total"]')`);
    });
    await runTest("mini category details stay compact and follow both edges across DPI scales", async () => {
      await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
      for (const scale of [1, 1.25, 1.5, 2]) {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
        assert.equal(await read(`(() => {
          const content=document.querySelector('.mini-content').getBoundingClientRect();
          const chart=document.querySelector('.mini-hourly-chart').getBoundingClientRect();
          const hit=document.querySelector('.qp-hourly-chart-hit').getBoundingClientRect();
          const track=document.querySelector('.mini-category-bar').getBoundingClientRect();
          const paint=document.querySelector('.mini-category-track');
          const bounds=paint.getBoundingClientRect();
          return document.querySelectorAll('.mini-hourly-chart svg text').length===0
            &&Math.abs(chart.bottom-hit.bottom)<=1&&Math.abs(track.top-chart.bottom-8)<=1
            &&Math.abs(content.bottom-track.bottom-10)<=1&&hit.height>100
            &&bounds.height===10&&bounds.width===track.width&&getComputedStyle(paint).overflow==='hidden'
            &&Array.from(document.querySelectorAll('.mini-category-segment')).every(button=>button.getBoundingClientRect().height===24);
        })()`), true, `the chart uses the released axis space and leaves only the bottom inset at ${scale} DPI`);
        assert.equal(await read(`(() => {
          const paint=document.querySelector('.mini-category-track');
          const track=document.querySelector('.mini-category-bar');
          return Math.abs(paint.lastElementChild.getBoundingClientRect().right-paint.getBoundingClientRect().right)<0.001
            &&Math.abs(document.querySelector('.mini-category-segment:last-child').getBoundingClientRect().right-track.getBoundingClientRect().right)<0.001;
        })()`), true, `percentage rounding leaves no unpainted or unclickable gap at the right cap at ${scale} DPI`);
        let firstLeft = 0;
        for (const edge of ["first", "last"]) {
          await read(`document.querySelector('.mini-category-segment:${edge}-of-type').focus()`);
          await wait(`document.activeElement?.getAttribute('aria-label') === [document.querySelector('.mini-detail .qp-chart-tooltip-name')?.textContent, document.querySelector('.mini-detail .qp-chart-tooltip-value')?.textContent].join(' ')`);
          const bounds = await read(`(() => {
            const r=document.querySelector('.mini-detail').getBoundingClientRect();
            const anchor=document.activeElement.getBoundingClientRect();
            return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,anchorTop:anchor.top};
          })()`) as { left: number; right: number; top: number; bottom: number; width: number; height: number; anchorTop: number };
          assert.ok(bounds.width <= 220 && bounds.height <= 40, `compact ${edge} detail at ${scale} DPI`);
          assert.ok(bounds.left >= 12 && bounds.right <= 308 && bounds.top >= 32, `bounded ${edge} detail at ${scale} DPI: ${JSON.stringify(bounds)}`);
          assert.ok(bounds.bottom <= bounds.anchorTop && bounds.anchorTop - bounds.bottom <= 8, "detail sits just above its category");
          if (edge === "first") firstLeft = bounds.left;
          else assert.ok(bounds.left > firstLeft, "the detail follows its trigger instead of using a fixed full-width panel");
          if (scale === 1.25 && edge === "last") {
            await read(`document.activeElement.blur()`);
            const point = await read(`(() => {const r=document.querySelector('.mini-category-segment:last-child').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`) as { x: number; y: number };
            await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
            await wait(`document.querySelector('.mini-detail .qp-chart-tooltip-name')?.textContent === '开发'`);
            const shot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
            writeFileSync(join(evidence, "today-compact-category.png"), Buffer.from(shot.data, "base64"));
          }
        }
      }
      await escape();
      await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: 1, mobile: false }, sessionId);
    });
    await runTest("mini category hover follows every adjacent segment in both directions", async () => {
      await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
      await read(`document.activeElement.blur()`);
      for (const scale of [1, 1.25, 1.5, 2]) {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 300, y: 235 }, sessionId);
        const segments = await read(`Array.from(document.querySelectorAll('.mini-category-segment'),button=>{
          const r=button.getBoundingClientRect();return {left:r.left,right:r.right,y:r.top+r.height/2,label:button.getAttribute('aria-label')};
        })`) as { left: number; right: number; y: number; label: string }[];
        for (const direction of [1, -1]) {
          for (const segment of direction === 1 ? segments : segments.slice().reverse()) {
            const positions = [segment.left + 1, (segment.left + segment.right) / 2, segment.right - 1];
            for (const x of direction === 1 ? positions : positions.reverse()) {
              await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: segment.y }, sessionId);
              await read(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
              assert.equal(await read(`[
                document.querySelector('.mini-detail .qp-chart-tooltip-name')?.textContent,
                document.querySelector('.mini-detail .qp-chart-tooltip-value')?.textContent,
              ].join(' ')`), segment.label, `hover follows each segment at ${scale} DPI, direction ${direction}, x=${x}`);
              assert.equal(await read(`document.querySelectorAll('[role="tooltip"]').length`), 1);
            }
          }
        }
      }
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 300, y: 235 }, sessionId);
      await wait(`!document.querySelector('[role="tooltip"]')`);
      await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: 1, mobile: false }, sessionId);
    });
    await runTest("mini pointer details dismiss when moving to another chart or empty space", async () => {
      await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
      await read(`document.activeElement.blur()`);
      const move = (point: { x: number; y: number }) => client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
      const category = await read(`(() => {const r=document.querySelector('.mini-category-segment:last-child').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`) as { x: number; y: number };
      await move(category);
      await wait(`document.querySelector('.mini-detail')`);
      const chart = await read(`(() => {const r=document.querySelector('.mini-hourly-chart .qp-hourly-chart-hit[tabindex="0"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+2}})()`) as { x: number; y: number };
      await move(chart);
      await wait(`document.querySelector('.mini-hourly-chart [role="tooltip"]')`);
      assert.equal(await read(`document.querySelectorAll('[role="tooltip"]').length`), 1, "moving to a bar dismisses the old category detail");
      await move(category);
      await wait(`document.querySelector('.mini-detail')`);
      assert.equal(await read(`document.querySelectorAll('[role="tooltip"]').length`), 1);
      const bridge = await read(`(() => {
        const a=document.querySelector('.mini-category-segment:last-child').getBoundingClientRect();
        const d=document.querySelector('.mini-detail').getBoundingClientRect();
        return {x:Math.min(a.right,d.right)-2,y:(d.bottom+a.top)/2,insideY:d.bottom-4};
      })()`) as { x: number; y: number; insideY: number };
      await move({ x: bridge.x, y: bridge.y });
      assert.equal(await read(`Boolean(document.querySelector('.mini-detail'))`), true, "the short gap to the detail remains traversable");
      await move({ x: bridge.x, y: bridge.insideY });
      assert.equal(await read(`Boolean(document.querySelector('.mini-detail'))`), true);
      await move({ x: 300, y: 235 });
      await wait(`!document.querySelector('[role="tooltip"]')`);
      await read(`document.querySelector('.mini-category-segment:last-child').focus()`);
      await wait(`document.querySelector('.mini-detail')`);
      await move(chart);
      await wait(`document.querySelector('.mini-hourly-chart [role="tooltip"]')`);
      assert.equal(await read(`document.querySelectorAll('[role="tooltip"]').length`), 1, "an old focus does not pin a tooltip after pointer movement");
      await move({ x: 300, y: 235 });
      await read(`document.activeElement.blur();document.querySelector('.mini-category-segment').focus()`);
      await wait(`document.querySelector('.mini-detail')`);
      await move({ x: 160, y: 15 });
      await wait(`!document.querySelector('[role="tooltip"]')`);
      await read(`document.activeElement.blur();document.querySelector('.mini-category-segment').focus()`);
      await wait(`document.querySelector('.mini-detail')`);
      await escape();
      assert.equal(await read(`Boolean(document.querySelector('[role="tooltip"]'))`), false);
    });
    await runTest("mini hourly details expand downward with full rows and shared scrollbars", async () => {
      await patch({ hourly_activity_chart_mode: "category", "__app_override::game.exe": JSON.stringify({ category: "game" }) });
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>({...snapshot,aggregate:{...snapshot.aggregate,
        records:[...snapshot.aggregate.records,{appName:'Game',exeName:'game.exe'}].map((record,index)=>({...record,
          startTime:snapshot.sampled_at_ms-(50-index*10)*60000,endTime:snapshot.sampled_at_ms-(40-index*10)*60000}))}});
        globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{})`);
      await wait(`document.querySelector('.mini-summary .mini-duration')?.textContent === '50m'`);
      await read(`document.querySelector('.mini-hourly-chart .qp-hourly-chart-hit[tabindex="0"]').focus()`);
      await wait(`document.querySelectorAll('.mini-hourly-chart .qp-chart-tooltip-item').length === 5`);
      assert.equal(await read(`(() => {
        const chart=document.querySelector('.mini-hourly-chart');const tip=chart.querySelector('[role="tooltip"]');
        const r=tip.getBoundingClientRect(),c=chart.getBoundingClientRect();
        const hit=document.activeElement.getBoundingClientRect(),x=hit.left+hit.width/2;
        return r.width<=220&&r.left>=12&&r.right<=308&&Math.abs(r.top-c.top)<=1&&r.bottom<=232
          &&tip.scrollHeight===tip.clientHeight&&(r.left>=x+8||r.right<=x-8);
      })()`), true, "five category rows grow below the chart without an unnecessary scrollbar");
      const shot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
      writeFileSync(join(evidence, "today-hourly-downward.png"), Buffer.from(shot.data, "base64"));
      await patch({ "__category_label_override::development": "Long category name ".repeat(35) });
      await wait(`document.querySelector('.mini-hourly-chart [role="tooltip"]')?.textContent.includes('Long category name')`);
      assert.equal(await read(`(() => {
        const tip=document.querySelector('.mini-hourly-chart [role="tooltip"]');
        return tip.scrollHeight>tip.clientHeight&&getComputedStyle(tip,'::-webkit-scrollbar').width==='6px'
          &&tip.getBoundingClientRect().bottom<=232;
      })()`), true, "genuine overflow uses the Quiet Pro scrollbar inside the window");
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown" }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown" }, sessionId);
      await wait(`document.querySelector('.mini-hourly-chart [role="tooltip"]').scrollTop>0`);
      await escape();
      assert.equal(await read(`Boolean(document.querySelector('.mini-hourly-chart [role="tooltip"]'))`), false);
      await patch({ "__category_label_override::development": "", "__app_override::game.exe": "" });
      await read(`delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{})`);
      await wait(`document.querySelector('.mini-summary .mini-duration')?.textContent === '3h 26m'`);
    });
    await runTest("mini details keep long category names readable inside the window", async () => {
      const name = "Long category name ".repeat(35);
      await patch({ "__category_label_override::development": name });
      await wait(`document.querySelector('.mini-category-segment:last-child')?.getAttribute('aria-label')?.includes(${JSON.stringify(name.trim())})`);
      await read(`document.querySelector('.mini-category-segment:last-child').focus()`);
      assert.equal(await read(`document.querySelector('.mini-detail').scrollHeight > document.querySelector('.mini-detail').clientHeight`), true);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown" }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown" }, sessionId);
      await wait(`document.querySelector('.mini-detail').scrollTop > 0`);
      const before = await read(`globalThis.__PATINA_INVOKED_COMMANDS.filter(x=>x.command==='cmd_get_mini_activity_snapshot').length`);
      await wait(`globalThis.__PATINA_INVOKED_COMMANDS.filter(x=>x.command==='cmd_get_mini_activity_snapshot').length > ${before}`);
      await read(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      assert.equal(await read(`document.querySelector('.mini-detail')?.scrollTop > 0`), true, "refresh retains the open detail and scroll position");
      assert.equal(await read(`document.querySelector('.mini-detail').getBoundingClientRect().top >= 32`), true);
      await escape();
      await patch({ "__category_label_override::development": "" });
    });
    await runTest("mini touch opens all categories and releases protection after dismissal", async () => {
      await wait(`document.querySelector('.mini-category-segment:last-child')?.getAttribute('aria-label')?.startsWith('开发')`);
      await read(`document.activeElement.blur()`);
      await escape();
      await read(`document.querySelector('.mini-handle').click()`);
      await wait(`Boolean(document.querySelector('[data-mini-page="today"]')) && document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
      await client.command("Emulation.setTouchEmulationEnabled", { enabled: true }, sessionId);
      const point = await read(`(() => {const r=document.querySelector('.mini-category-segment').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`) as { x: number; y: number };
      assert.equal(await read(`document.elementFromPoint(${point.x},${point.y})?.matches('.mini-category-segment')`), true);
      await client.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] }, sessionId);
      await client.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId);
      await wait(`document.querySelectorAll('.mini-detail .qp-chart-tooltip-item').length === 4`);
      await escape();
      await read(`document.activeElement.blur()`);
      await wait(`(()=>{const action=globalThis.__PATINA_INVOKED_COMMANDS.filter(x=>x.command==='cmd_mini_window_action'&&x.payload?.action?.kind==='protect').at(-1)?.payload.action;return action?.keyboard===false&&action?.touch===false})()`);
      await client.command("Emulation.setTouchEmulationEnabled", { enabled: false }, sessionId);
    });
    await runTest("mini preserves page, mode and focus through rapid manual navigation", async () => {
      assert.equal(await read(`document.querySelectorAll('.mini-header button').length`), 4);
      assert.equal(await read(`document.querySelector('.mini-navigation').getAttribute('aria-label')`), "今日 · 下一页");
      const button = await read(`(() => {const r=document.querySelector('button.mini-navigation').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`) as { x: number; y: number };
      await client.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...button }, sessionId);
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...button }, sessionId);
      await wait(`document.querySelector('[data-mini-page="activity"]')?.textContent.includes('56m')`);
      assert.equal(await read(`document.querySelectorAll('.mini-leader').length`), 3);
      await patch({ history_timeline_mode: "category" });
      await wait(`document.querySelector('[data-mini-page="activity"][data-display-mode="category"]')?.textContent.includes('开发')`);
      assert.equal(await read(`document.activeElement === document.querySelector('.mini-navigation')`), true);
      for (const [key, code, virtualKeyCode, input, page] of [["Enter", "Enter", 13, "\r", "工具"], [" ", "Space", 32, " ", "今日"]] as const) {
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: input, unmodifiedText: input, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode }, sessionId);
        await client.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode }, sessionId);
        await wait(`document.querySelector('.mini-page-title').textContent === '${page}'`);
        assert.equal(await read(`document.activeElement === document.querySelector('.mini-navigation')`), true);
      }
      await next();
      await read(`for(let i=0;i<3;i++) document.querySelector('.mini-navigation').click()`);
      await wait(`document.querySelector('[data-mini-page="activity"][data-display-mode="category"]')`);
      assert.equal(await read(`document.activeElement === document.querySelector('.mini-navigation')`), true);
      await escape();
      await wait(`document.querySelector('.mini-shell').dataset.expanded==='false' && !document.querySelector('.mini-content')`);
      const before = await read(`globalThis.__PATINA_INVOKED_COMMANDS.filter(x=>x.command==='cmd_get_mini_activity_snapshot').length`);
      await read(`new Promise(resolve=>setTimeout(resolve,1150))`);
      assert.equal(await read(`globalThis.__PATINA_INVOKED_COMMANDS.filter(x=>x.command==='cmd_get_mini_activity_snapshot').length`), before);
      await read(`document.querySelector('.mini-handle').click()`);
      await wait(`document.querySelector('[data-mini-page="activity"]')`);
    });
    await runTest("mini thin activity strip keeps colors and ranking rows do not open details", async () => {
      await patch({ history_timeline_mode: "app" });
      await wait(`document.querySelector('[data-mini-page="activity"][data-display-mode="app"]')`);
      assert.deepEqual(await read(`Array.from(document.querySelectorAll('.mini-timeline .qp-timeline-axis span'),tick=>tick.textContent)`), ["11:00", "12:00"]);
      await read(`document.activeElement.blur()`);
      const colors = `Array.from(document.querySelectorAll('.mini-timeline-paint > span,.mini-leader'),item=>{
        const style=getComputedStyle(item);return [style.backgroundColor,style.backgroundImage,style.opacity];
      })`;
      const initialColors = await read(colors);
      const segments = await read(`Array.from(document.querySelectorAll('.mini-timeline-segment'),button=>{
        const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+2,label:button.getAttribute('aria-label')};
      })`) as { x: number; y: number; label: string }[];
      for (const segment of segments) {
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: segment.x, y: segment.y }, sessionId);
        await wait(`document.querySelector('.mini-detail')`);
        assert.equal(await read(`document.querySelector('.mini-detail .qp-chart-tooltip-label').textContent`), segment.label.split(" · ")[0]);
        assert.deepEqual(await read(colors), initialColors, "inspecting a segment does not fade colors or highlight ranking rows");
      }
      const shot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(evidence, "activity-segment-detail.png"), Buffer.from(shot.data as string, "base64"));
      const gap = await read(`(() => {const r=document.querySelector('.mini-timeline .qp-timeline-track').getBoundingClientRect();return {x:r.x+r.width*47/60,y:r.y+12}})()`) as { x: number; y: number };
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...gap }, sessionId);
      await wait(`!document.querySelector('.mini-detail')`);
      for (const mode of ["app", "category"]) {
        await patch({ history_timeline_mode: mode });
        await wait(`document.querySelector('[data-display-mode="${mode}"]')`);
        const before = await read(colors);
        await read(`document.querySelector('.mini-timeline-segment').focus()`);
        await wait(`document.querySelector('.mini-detail')`);
        const rows = await read(`Array.from(document.querySelectorAll('.mini-leader'),row=>{
          const r=row.getBoundingClientRect();return {x:r.right-4,y:r.y+r.height/2};
        })`) as { x: number; y: number }[];
        for (const point of rows) {
          await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
          await wait(`!document.querySelector('.mini-detail')`);
          await client.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point }, sessionId);
          await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point }, sessionId);
          assert.equal(await read(`Boolean(document.querySelector('.mini-detail'))`), false);
          assert.deepEqual(await read(colors), before);
        }
        assert.equal(await read(`document.querySelectorAll('.mini-leaders button,.mini-leaders [tabindex],.mini-leaders [title]').length`), 0,
          "ranking rows are static list content without focus stops or native tooltips");
      }
    });
    await runTest("mini website mode follows grouping and falls back when collection is disabled", async () => {
      await patch({ history_timeline_mode: "web", web_activity_enabled: "1", web_activity_token: "fixture-token" });
      await wait(`document.querySelector('[data-mini-page="activity"][data-display-mode="web"]')?.textContent.includes('20m')`);
      assert.equal(await read(`document.querySelectorAll('.mini-leader').length`), 1);
      assert.equal(await read(`document.querySelector('.mini-leader-name').textContent`), "Grouped site");
      await read(`document.querySelector('.mini-leader').click()`);
      assert.equal(await read(`Boolean(document.querySelector('.mini-detail'))`), false);
      await patch({ web_activity_enabled: "0" });
      await wait(`document.querySelector('[data-mini-page="activity"][data-display-mode="app"]')?.textContent.includes('56m')`);
    });
    await runTest("mini complete ranking uses remaining height and native scrolling below a left aligned total", async () => {
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>({...snapshot,sessions:Array.from({length:8},(_,index)=>({
        ...snapshot.sessions[0],id:index+1,app_name:'Activity '+String(index+1).padStart(2,'0'),exe_name:'activity-'+index+'.exe',
        start_time:snapshot.start_ms+index*420000,end_time:snapshot.start_ms+index*420000+360000,duration:360000,
        continuity_group_start_time:snapshot.start_ms+index*420000
      }))});globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{})`);
      await wait(`document.querySelectorAll('.mini-leader').length===8`);
      for (const scale of [1, 1.25, 1.5, 2]) {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
        await read(`document.querySelector('.mini-leaders').scrollTop=0`);
        await wait(`document.querySelector('.mini-leaders').scrollTop===0`);
        assert.equal(await read(`(() => {
          const list=document.querySelector('.mini-leaders'),box=list.getBoundingClientRect();
          const content=document.querySelector('.mini-content').getBoundingClientRect();
          const summary=document.querySelector('.mini-summary'),total=summary.firstElementChild.getBoundingClientRect();
          const axis=document.querySelector('.mini-timeline .qp-timeline-axis').getBoundingClientRect();
          const scrollbar=getComputedStyle(list,'::-webkit-scrollbar'),thumb=getComputedStyle(list,'::-webkit-scrollbar-thumb');
          const duration=list.firstElementChild.lastElementChild.getBoundingClientRect();
          return summary.textContent==='48m'&&total.left===box.left&&Math.abs(box.bottom-content.bottom+10)<1
            &&box.top-axis.bottom===8&&list.scrollHeight>list.clientHeight&&list.scrollWidth===list.clientWidth
            &&list.classList.contains('qp-scroll-region')&&getComputedStyle(list).overflowY==='auto'
            &&scrollbar.width===getComputedStyle(list).getPropertyValue('--qp-scrollbar-size').trim()
            &&parseFloat(scrollbar.width)-parseFloat(thumb.borderLeftWidth)-parseFloat(thumb.borderRightWidth)===4
            &&Math.abs(box.right-(list.offsetWidth-list.clientWidth)-duration.right-8)<1
            &&Array.from(list.children).every(row=>row.getBoundingClientRect().height===32);
        })()`), true, `complete ranking fits the remaining viewport at ${scale} DPI`);
        const anchor = await read(`(() => {const r=document.querySelector('.mini-timeline').getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()`);
        const point = await read(`(() => {const r=document.querySelector('.mini-leaders').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`) as { x: number; y: number };
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
        await client.command("Input.dispatchMouseEvent", { type: "mouseWheel", deltaX: 0, deltaY: 400, ...point }, sessionId);
        await wait(`(() => {const list=document.querySelector('.mini-leaders');return list.scrollTop+list.clientHeight>=list.scrollHeight-1})()`);
        assert.equal(await read(`(() => {const list=document.querySelector('.mini-leaders'),row=list.lastElementChild.getBoundingClientRect(),box=list.getBoundingClientRect();return row.top>=box.top&&row.bottom<=box.bottom+1})()`), true);
        assert.deepEqual(await read(`(() => {const r=document.querySelector('.mini-timeline').getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()`), anchor,
          "scrolling the ranking keeps the summary and timeline fixed");
        await read(`document.querySelector('.mini-timeline-segment').focus()`);
        await wait(`document.querySelector('.mini-detail')`);
        await read(`document.querySelector('.mini-leaders').focus()`);
        await wait(`!document.querySelector('.mini-detail')`);
        for (const [key, code, edge] of [["Home", 36, "list.scrollTop===0"], ["End", 35, "list.scrollTop+list.clientHeight>=list.scrollHeight-1"]] as const) {
          await client.command("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }, sessionId);
          await client.command("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }, sessionId);
          await wait(`(() => {const list=document.querySelector('.mini-leaders');return ${edge}})()`);
        }
        if (scale === 1) {
          const shot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId);
          writeFileSync(join(evidence, "activity-ranking-scrolled.png"), Buffer.from(shot.data as string, "base64"));
        }
      }
      await read(`delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{})`);
      await wait(`document.querySelector('.mini-summary').textContent==='56m'&&document.querySelectorAll('.mini-leader').length===3`);
      assert.equal(await read(`(() => {const list=document.querySelector('.mini-leaders');return list.scrollTop===0&&list.scrollHeight===list.clientHeight})()`), true);
    });
    await runTest("mini discards a delayed former page and presents read failures with retry", async () => {
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>new Promise(resolve=>{globalThis.__miniRelease=()=>resolve(snapshot)});globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{})`);
      await wait(`Boolean(globalThis.__miniRelease)`);
      await next();
      await wait(`Boolean(document.querySelector('.mini-tools'))`);
      await read(`globalThis.__miniRelease();delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;delete globalThis.__miniRelease;new Promise(resolve=>setTimeout(resolve,100))`);
      assert.equal(await read(`Boolean(document.querySelector('[data-mini-page]'))`), false);
      await read(`globalThis.__PATINA_COMPACT_FAILURES=['cmd_get_mini_activity_snapshot']`);
      await next();
      await wait(`Boolean(document.querySelector('.mini-content[role="alert"] button'))`);
      assert.equal(await read(`Boolean(document.querySelector('.mini-category-bar'))`), false);
      await read(`globalThis.__PATINA_COMPACT_FAILURES=[];document.querySelector('.mini-content button').click()`);
      await wait(`Boolean(document.querySelector('[data-mini-page="today"]'))`);
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>({...snapshot,aggregate:{...snapshot.aggregate,records:[]}});globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{})`);
      await wait(`document.querySelector('.mini-empty-inline')`);
      assert.equal(await read(`document.querySelectorAll('.mini-category-segment').length`), 0);
      await read(`delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{})`);
    });
    for (const [scale, locale] of [[1, "zh-CN"], [1.25, "en-US"], [1.5, "ru-RU"], [2, "es"]] as const) {
      await runTest(`mini three pages fit 320 by 240 at ${scale} scale in ${locale}`, async () => {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
        await patch({ language: locale });
        await wait(`document.documentElement.lang === '${locale}'`);
        for (let page = 0; page < 3; page++) {
          await wait(`Boolean(document.querySelector('[data-mini-page],.mini-tools'))`);
          assert.equal(await read(`(() => {
            const header=document.querySelector('.mini-header').getBoundingClientRect();
            const actions=document.querySelector('.mini-window-actions').getBoundingClientRect();
            const drag=document.querySelector('.mini-drag-region').getBoundingClientRect();
            const buttons=Array.from(document.querySelectorAll('.mini-window-actions > button'));
            return header.height===32&&Math.abs(header.right-actions.right-8)<1&&drag.right<=actions.left
              &&document.querySelector('.mini-page-title').getBoundingClientRect().height<=1&&buttons.length===4
              &&buttons.every((button,index)=>{
                const rect=button.getBoundingClientRect();
                return rect.width===24&&rect.height===24&&rect.left===actions.left+index*28
                  &&rect.right<=320&&button.querySelector('svg').getAttribute('width')==='14';
              })&&document.querySelector('.mini-content').scrollWidth<=document.querySelector('.mini-content').clientWidth;
          })()`), true);
          if (page === 1) {
            assert.equal(await read(`(() => {
              const content=document.querySelector('.mini-content').getBoundingClientRect();
              const track=document.querySelector('.mini-timeline .qp-timeline-track').getBoundingClientRect();
              const paint=document.querySelector('.mini-timeline-paint').getBoundingClientRect();
              return track.height===24&&paint.height===12&&paint.top-track.top===6
                &&document.querySelector('.mini-timeline .qp-timeline-axis').getBoundingClientRect().height===18
                &&Array.from(document.querySelectorAll('.mini-timeline-segment')).every(button=>button.getBoundingClientRect().height===24)
                &&Array.from(document.querySelectorAll('.mini-leader')).every(button=>{const r=button.getBoundingClientRect();return r.height===32&&r.bottom<=content.bottom-10});
            })()`), true);
          }
          if (scale === 1 || scale === 2) {
            const screenshot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
            writeFileSync(join(evidence, `${locale}-${page}.png`), Buffer.from(screenshot.data, "base64"));
          }
          await next();
        }
      });
    }
    console.log(`Mini visual evidence: ${evidence}`);
  } catch (error) {
    console.error("Mini page diagnostics", await read(`({text:document.body.innerText,commands:globalThis.__PATINA_INVOKED_COMMANDS.slice(-8)})`));
    throw error;
  } finally {
    await read(`delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;delete globalThis.__miniRelease;globalThis.__PATINA_COMPACT_FAILURES=[];${previous === null ? `localStorage.removeItem('${settingsKey}')` : `localStorage.setItem('${settingsKey}',${JSON.stringify(previous)})`}`);
    await client.command("Emulation.setTouchEmulationEnabled", { enabled: false }, sessionId);
    await client.command("Emulation.clearDeviceMetricsOverride", {}, sessionId);
    await client.command("Page.navigate", { url: appUrl }, sessionId);
    await wait(`Boolean(document.querySelector('[data-titlebar-mini-entry]'))`);
  }
}
