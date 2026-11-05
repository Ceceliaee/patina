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
    await runTest("mini defaults to activity after retiring today", async () => {
      await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: 1, mobile: false }, sessionId);
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`document.querySelector('[data-mini-page="activity"]')?.textContent.includes('3h 26m')`);
      assert.equal(await read(`Boolean(document.querySelector('[data-mini-page="today"]'))`), false);
      assert.equal(await read(`Boolean(document.querySelector('.mini-tools,.mini-navigation'))`), false);
    });
    await runTest("mini retains activity mode and suspends reads when collapsed", async () => {
      assert.equal(await read(`document.querySelectorAll('.mini-header button').length`), 3);
      assert.equal(await read(`document.querySelectorAll('.mini-leader').length`), 3);
      await patch({ history_timeline_mode: "category" });
      await wait(`document.querySelector('[data-mini-page="activity"][data-display-mode="category"]')?.textContent.includes('开发')`);
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
      assert.equal(await read(`document.querySelector('.mini-daily-total .mini-duration').textContent`), "3h 26m", "website mode does not replace the daily application total");
      await read(`document.querySelector('.mini-leader').click()`);
      assert.equal(await read(`Boolean(document.querySelector('.mini-detail'))`), false);
      await patch({ web_activity_enabled: "0" });
      await wait(`document.querySelector('[data-mini-page="activity"][data-display-mode="app"]')?.textContent.includes('3h 26m')`);
    });
    await runTest("mini separates today's summary from the last hour and shows only its top three", async () => {
      assert.equal(await read(`document.querySelector('.mini-daily-range').textContent`), "08:34–12:00");
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>snapshot.kind==='today'?snapshot:({...snapshot,sessions:Array.from({length:8},(_,index)=>({
        ...snapshot.sessions[0],id:index+1,app_name:'Activity '+String(index+1).padStart(2,'0'),exe_name:'activity-'+index+'.exe',
        start_time:snapshot.start_ms+index*420000,end_time:snapshot.start_ms+index*420000+360000,duration:360000,
        continuity_group_start_time:snapshot.start_ms+index*420000
      }))});globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
      await wait(`document.querySelector('.mini-leader-name')?.textContent==='Activity 01'`);
      assert.deepEqual(await read(`Array.from(document.querySelectorAll('.mini-leader-name'),row=>row.textContent)`), ["Activity 01", "Activity 02", "Activity 03"]);
      assert.equal(await read(`document.querySelectorAll('.mini-timeline-segment').length`), 8, "ranking truncation does not remove timeline segments");
      for (const scale of [1, 1.25, 1.5, 2]) {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
        assert.equal(await read(`(() => {
          const list=document.querySelector('.mini-leaders'),box=list.getBoundingClientRect();
          const content=document.querySelector('.mini-content').getBoundingClientRect();
          const summary=document.querySelector('.mini-summary'),total=summary.firstElementChild.getBoundingClientRect();
          const period=document.querySelector('.mini-daily-range').getBoundingClientRect();
          const axis=document.querySelector('.mini-timeline .qp-timeline-axis').getBoundingClientRect();
          return summary.firstElementChild.textContent==='3h 26m'&&total.left===box.left
            &&period.right===box.right&&total.right+8<=period.left&&summary.getBoundingClientRect().height===36
            &&box.top-axis.bottom===4&&list.scrollHeight===list.clientHeight&&list.scrollWidth===list.clientWidth
            &&!list.hasAttribute('tabindex')&&!list.classList.contains('qp-scroll-region')
            &&Array.from(list.children).every(row=>{const r=row.getBoundingClientRect();return r.height===32&&r.bottom<=content.bottom-10});
        })()`), true, `daily summary and top three fit at ${scale} DPI`);
      }
      await read(`delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
      await wait(`document.querySelector('.mini-leader-name')?.textContent==='Editor'`);
    });
    await runTest("mini daily summary survives an empty recent hour and does not substitute it on daily read failure", async () => {
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>snapshot.kind==='today'?snapshot:({...snapshot,sessions:[]});globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
      await wait(`document.querySelectorAll('.mini-leader').length===0`);
      assert.equal(await read(`document.querySelector('.mini-daily-total .mini-duration').textContent`), "3h 26m");
      assert.equal(await read(`document.querySelector('.mini-daily-range').textContent`), "08:34–12:00");
      assert.deepEqual(await read(`Array.from(document.querySelectorAll('.mini-timeline .qp-timeline-axis span'),tick=>tick.textContent)`), ["11:00", "12:00"]);
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>{if(snapshot.kind==='today')throw Error('daily read unavailable');return snapshot};globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
      await wait(`document.querySelector('.mini-content[role="alert"] button')`);
      assert.equal(await read(`Boolean(document.querySelector('.mini-daily-summary'))`), false);
      await read(`delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;document.querySelector('.mini-content button').click()`);
      await wait(`document.querySelector('.mini-daily-total .mini-duration')?.textContent==='3h 26m'`);
    });
    await runTest("mini discards a delayed collapsed read and presents read failures with retry", async () => {
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>snapshot.kind==='today'?new Promise(resolve=>{globalThis.__miniRelease=()=>resolve(snapshot)}):snapshot;globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
      await wait(`Boolean(globalThis.__miniRelease)`);
      await escape();
      await wait(`!document.querySelector('.mini-content')`);
      await read(`globalThis.__miniRelease();delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;delete globalThis.__miniRelease;new Promise(resolve=>setTimeout(resolve,100))`);
      assert.equal(await read(`Boolean(document.querySelector('[data-mini-page]'))`), false);
      await read(`globalThis.__PATINA_COMPACT_FAILURES=['cmd_get_mini_activity_snapshot']`);
      await read(`document.querySelector('.mini-handle').click()`);
      await wait(`Boolean(document.querySelector('.mini-content[role="alert"] button'))`);
      assert.equal(await read(`Boolean(document.querySelector('.mini-category-bar'))`), false);
      await read(`globalThis.__PATINA_COMPACT_FAILURES=[];document.querySelector('.mini-content button').click()`);
      await wait(`Boolean(document.querySelector('[data-mini-page="activity"]'))`);
      await read(`globalThis.__PATINA_MINI_ACTIVITY_HOOK=snapshot=>snapshot.kind==='today'?({...snapshot,aggregate:{...snapshot.aggregate,records:[]}}):({...snapshot,sessions:[],web:null});globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
      await wait(`document.querySelector('.mini-daily-total .mini-duration').textContent==='0m'`);
      assert.equal(await read(`document.querySelectorAll('.mini-leader').length`), 0);
      assert.equal(await read(`document.querySelector('.mini-daily-range').textContent`), '—');
      await read(`delete globalThis.__PATINA_MINI_ACTIVITY_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
    });
    await runTest("mini status buttons share visibility, fixed order, navigation and compact geometry", async () => {
      const timer = { id: 17, label: "Reading", counting_up: false, kind: "pomodoro", state: "paused", value_ms: 300_000, visible_until_ms: null, total_ms: 300_000, phase: "short_break" };
      const reminder = { id: 8, label: "喝水", scheduled_at: Date.now() + 600_000 };
      const setStatus = async (tools: unknown[], next: unknown) => read(`globalThis.__PATINA_MINI_TRACKING_OVERRIDE={miniStatus:${JSON.stringify({ tools, reminder: next, sampled_at_ms: Date.now() })}};globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed',{reason:'tracking-status-changed',changed_at_ms:Date.now()})`);
      await setStatus([], {...reminder,scheduled_at:Date.now()+24*60*60*1000+2000});
      await wait(`!document.querySelector('[data-titlebar-tools-status]')`);
      await wait(`document.querySelectorAll('[data-titlebar-tools-status] button').length===1`);
      await setStatus([timer], reminder);
      await wait(`document.querySelectorAll('[data-titlebar-tools-status] button').length===1`);
      assert.equal(await read(`Boolean(document.querySelector('[data-titlebar-tools-status] .lucide-bell-ring'))`), true);
      await setStatus([{...timer,state:'running'}], reminder);
      await wait(`document.querySelectorAll('[data-titlebar-tools-status] button').length===2`);
      assert.equal(await read(`Boolean(document.querySelector('[data-titlebar-tools-status] button:first-child .lucide-alarm-clock'))`), true);
      for (const [scale, locale] of [[1, "zh-CN"], [1.25, "en-US"], [1.5, "ru-RU"], [2, "es"]] as const) {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
        await patch({ language: locale });
        await wait(`document.documentElement.lang==='${locale}'&&document.querySelectorAll('[data-titlebar-tools-status] button').length===2&&document.querySelector('.mini-shell').dataset.transitioning==='false'`);
        assert.deepEqual(await read(`(() => {const panel=document.querySelector('.mini-panel').getBoundingClientRect(),drag=document.querySelector('.mini-drag-region').getBoundingClientRect();return {height:panel.height,card:Boolean(document.querySelector('.mini-tools')),drag:drag.width>=24,buttons:Array.from(document.querySelectorAll('.mini-header button')).every(b=>{const r=b.getBoundingClientRect();return r.width===24&&r.height===24&&r.right<=320;})}})()`), { height:240,card:false,drag:true,buttons:true });
        assert.equal(await read(`(() => {
          const pin=document.querySelector('.mini-window-actions button'),p=pin.getBoundingClientRect();
          return Array.from(document.querySelectorAll('[data-titlebar-tools-status] button')).every(button=>{
            const r=button.getBoundingClientRect();return Math.abs(r.top+r.height/2-p.top-p.height/2)<0.5
              &&getComputedStyle(button).borderRadius===getComputedStyle(pin).borderRadius;
          });
        })()`),true,"status buttons must match the window controls' vertical center and rounded corners");
        const screenshot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
        writeFileSync(join(evidence, `${locale}-tools.png`), Buffer.from(screenshot.data, "base64"));
      }
      await read(`globalThis.__PATINA_MINI_OPEN_TOOLS_HOOK=()=>{throw new Error('main unavailable')};document.querySelector('[data-titlebar-tools-status] button').click()`);
      await wait(`Boolean(document.querySelector('.mini-error'))`);
      await read(`delete globalThis.__PATINA_MINI_OPEN_TOOLS_HOOK;document.querySelector('[data-titlebar-tools-status] button').click()`);
      await wait(`!document.querySelector('.mini-error')`);
      await read(`Array.from(document.querySelectorAll('[data-titlebar-tools-status] button')).at(-1).click()`);
      await wait(`globalThis.__PATINA_INVOKED_COMMANDS.some(x=>x.payload?.action?.kind==='open_tools'&&x.payload.action.section==='reminders')`);
      assert.equal(await read(`globalThis.__PATINA_INVOKED_COMMANDS.some(x=>x.payload?.action?.kind==='open_tools'&&x.payload.action.section==='pomodoro')`),true);
      await setStatus([{...timer,state:'completed'}], {...reminder,id:9,label:'下一条提醒'});
      await wait(`document.querySelectorAll('[data-titlebar-tools-status] button').length===1&&document.querySelector('[data-titlebar-tools-status] button').getAttribute('aria-label').includes('下一条提醒')`);
      await setStatus([], null);
      await wait(`!document.querySelector('[data-titlebar-tools-status]')&&document.querySelector('.mini-panel').getBoundingClientRect().height===240`);
      await read(`delete globalThis.__PATINA_MINI_TRACKING_OVERRIDE`);
    });

    for (const [scale, locale] of [[1, "zh-CN"], [1.25, "en-US"], [1.5, "ru-RU"], [2, "es"]] as const) {
      await runTest(`mini activity fits 320 by 240 at ${scale} scale in ${locale}`, async () => {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
        await patch({ language: locale });
        await wait(`document.documentElement.lang === '${locale}'`);
        for (let page = 0; page < 1; page++) {
          await wait(`Boolean(document.querySelector('[data-mini-page],.mini-tools'))`);
          assert.equal(await read(`(() => {
            const header=document.querySelector('.mini-header').getBoundingClientRect();
            const actions=document.querySelector('.mini-window-actions').getBoundingClientRect();
            const drag=document.querySelector('.mini-drag-region').getBoundingClientRect();
            const buttons=Array.from(document.querySelectorAll('.mini-window-actions > button'));
            return header.height===32&&Math.abs(header.right-actions.right-8)<1&&drag.right<=actions.left
              &&!document.querySelector('.mini-navigation')&&buttons.length===3
              &&buttons.every((button,index)=>{
                const rect=button.getBoundingClientRect();
                return rect.width===24&&rect.height===24&&rect.left===actions.left+index*28
                  &&rect.right<=320&&button.querySelector('svg').getAttribute('width')==='14';
              })&&document.querySelector('.mini-content').scrollWidth<=document.querySelector('.mini-content').clientWidth;
          })()`), true);
          if (page === 0) {
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
