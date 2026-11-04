import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

export async function runToolNotificationScenarios({ client, sessionId, runTest, appUrl }: BrowserSmokeContext) {
  await runTest("Notification shell preserves passive focus, natural sizes, errors and queued content", async () => {
    const storage = String(await evaluate(client, sessionId, "JSON.stringify({...localStorage})"));
    try {
      await evaluate(client, sessionId, `localStorage.setItem('__patina_notification_preferences',JSON.stringify({delivery:'notification',sound:'none'}));
        localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',theme_mode:'dark'}));
        location.href=${JSON.stringify(appUrl + "?__patinaWindow=tool-notification")}`);
      await waitForExpression(client, sessionId, `document.documentElement.dataset.windowLabel==='tool-notification' && typeof globalThis.__PATINA_EMIT_TAURI_EVENT==='function'`);
      await client.command("Emulation.setDeviceMetricsOverride", { width: 404, height: 240, deviceScaleFactor: 1.5, mobile: false }, sessionId);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE = {
        settings: {pomodoro_focus_minutes:25,pomodoro_short_break_minutes:5,pomodoro_long_break_minutes:15,pomodoro_long_break_every:4},
        reminders:[{id:1,label:'Notification',created_at:1,scheduled_at:1000,status:'pending_confirmation',fired_at:1000,cancelled_at:null}],
        activity_reminder_rules:[],free_focus_tasks:[],pomodoro_tasks:[],current_pomodoro:null,today_completed_pomodoros:0,next_reminder_at:null,sampled_at_ms:1000};
        globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert',{id:'reminder:1:1000',kind:'reminder',title:'',body:'Notification',occurred_at:1000});`);
      await waitForExpression(client, sessionId, `!!document.querySelector('.tools-timed-alert-surface') && globalThis.__PATINA_INVOKED_COMMANDS.some(c=>c.command==='cmd_tool_presentation_ready')`);
      assert.deepEqual(await evaluate(client, sessionId, `({width:document.querySelector('.tools-timed-alert-surface').getBoundingClientRect().width,
        passive:document.activeElement===document.body,role:document.querySelector('.tools-timed-alert-surface').getAttribute('role'),
        main:!!document.querySelector('main.qp-canvas'), background:getComputedStyle(document.querySelector('.qp-dialog-backdrop')).backgroundColor})`),
      { width: 400, passive: true, role: "region", main: false, background: "rgba(0, 0, 0, 0)" });
      const click = (text: string) => evaluate(client, sessionId, `[...document.querySelectorAll('.tools-usage-alert-surface button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
      await click("稍后提醒");
      await waitForExpression(client, sessionId, `document.activeElement?.value==='5'`);
      await evaluate(client, sessionId, `document.querySelector('input[value="15"]').click(); globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE={error:'failure'};
        globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert',{id:'usage-next',kind:'activity_reminder',title:'',body:'',occurred_at:2000,
          activity_reminder:{rule_id:2,date_key:'2026-11-04',target:{kind:'web',normalized_domain:'example.test'},target_label:'Example',usage_ms:120000,limit_ms:60000,message:''}});`);
      await click("确认");
      await waitForExpression(client, sessionId, `!!document.querySelector('.tools-usage-alert-error')`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('input[value="15"]').checked && !document.querySelector('.tools-usage-alert-name')`), true);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(c=>c.command==='cmd_tool_presentation_ready').at(-1)?.payload.height>240`);
      const height = await evaluate(client, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(c=>c.command==='cmd_tool_presentation_ready').at(-1).payload.height`) as number;
      assert.ok(height > 240, "expanded choices and errors must request additional native height");
      await client.command("Emulation.setDeviceMetricsOverride", { width: 404, height: height + 4, deviceScaleFactor: 1.5, mobile: false }, sessionId);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE={}`);
      await click("确认");
      await waitForExpression(client, sessionId, `document.querySelector('.tools-usage-alert-name')?.textContent==='Example'`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(c=>c.command==='cmd_tool_presentation_ready').at(-1).payload.width===486`);
      await client.command("Emulation.setDeviceMetricsOverride", { width: 490, height: 400, deviceScaleFactor: 2, mobile: false }, sessionId);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-usage-alert-surface').getBoundingClientRect().width`), 486);
      const commands = await evaluate(client, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.map(c=>c.command)`) as string[];
      for (const command of ["cmd_get_tools_snapshot", "cmd_get_dashboard_snapshot", "cmd_get_setting_rows", "cmd_get_activity_reminder_web_candidates"]) assert.ok(!commands.includes(command), `notification must not load ${command}`);
    } finally {
      await client.command("Emulation.clearDeviceMetricsOverride", {}, sessionId);
      await evaluate(client, sessionId, `localStorage.clear(); for(const [key,value] of Object.entries(${storage})) localStorage.setItem(key,value); location.href=${JSON.stringify(appUrl)}`);
      await waitForExpression(client, sessionId, `document.documentElement.dataset.windowLabel==='main' && !!document.querySelector('main.qp-canvas')`);
    }
  });
  await runTest("Tools notification settings fit every production language, theme and narrow viewport", async () => {
    const storage = String(await evaluate(client, sessionId, "JSON.stringify({...localStorage})"));
    let soundWidth: number | undefined;
    try {
      for (const language of ["zh-CN", "en-US", "es", "ru-RU"]) {
        for (const theme of ["light", "dark"]) {
          const width = theme === "light" ? 960 : 420;
          await client.command("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: theme === "light" ? 1 : 2, mobile: false }, sessionId);
          await evaluate(client, sessionId, `localStorage.clear();
            localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:${JSON.stringify(language)},theme_mode:${JSON.stringify(theme)}}));
            localStorage.setItem('patina:last-active-view','tools');
            document.documentElement.dataset.settingsReview='loading'; location.reload();`);
          await waitForExpression(client, sessionId, `document.documentElement.dataset.settingsReview!=='loading' && !!document.querySelector('.tools-section-settings-tab')`);
          await evaluate(client, sessionId, "document.querySelector('.tools-section-settings-tab').click()");
          await waitForExpression(client, sessionId, "!!document.querySelector('.tools-notification-setting-row button:not(:disabled)')");
          const layout = await evaluate(client, sessionId, `(() => {
            const surface=document.querySelector('.tools-settings-dialog'), rect=surface.getBoundingClientRect();
            const controls=[...surface.querySelectorAll('.tools-notification-setting-row')].map(row=>row.lastElementChild.getBoundingClientRect());
            const clipped=[...surface.querySelectorAll('button,span,h3,h4')].filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>node.textContent);
            return {left:rect.left,right:rect.right,bottom:rect.bottom,widths:controls.map(r=>r.width),rights:controls.map(r=>r.right),clipped,footer:!!surface.querySelector('.qp-dialog-footer'),theme:document.documentElement.dataset.theme};
          })()`) as {left:number;right:number;bottom:number;widths:number[];rights:number[];clipped:string[];footer:boolean;theme:string};
          assert.ok(layout.left >= 0 && layout.right <= width && layout.bottom <= 700, `${language}/${theme}: dialog must remain in viewport`);
          soundWidth ??= layout.widths[1];
          assert.ok(Math.abs(layout.widths[1]-soundWidth)<1, `${language}/${theme}: changing interface language must not resize the sound selector`);
          assert.ok(Math.abs(layout.rights[0]-layout.rights[1])<1, `${language}/${theme}: controls must align on the right`);
          assert.deepEqual(layout.clipped, [], `${language}/${theme}: settings text must remain readable`);
          assert.equal(layout.footer, false);
          assert.equal(layout.theme, theme);
        }
      }
    } finally {
      await client.command("Emulation.clearDeviceMetricsOverride", {}, sessionId);
      await evaluate(client, sessionId, `localStorage.clear(); for(const [key,value] of Object.entries(${storage})) localStorage.setItem(key,value); location.href=${JSON.stringify(appUrl)}`);
      await waitForExpression(client, sessionId, "!!document.querySelector('main.qp-canvas') && !document.querySelector('.tools-settings-dialog')");
    }
  });
}
