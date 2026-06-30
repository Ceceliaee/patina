import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { SETTINGS_MARKER } from "./constants.ts";

export async function runSettingsScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("settings theme dialog opens and closes in a real browser", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString(SETTINGS_MARKER)})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".settings-theme-entry");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.settings-color-scheme-list'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const cancel = Array.from(document.querySelectorAll(".qp-dialog-action"))[0];
          if (!cancel) return false;
          cancel.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "!document.querySelector('.settings-color-scheme-list')");
  });

  await runTest("settings web sync guide appears only while setup is incomplete", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify({
          "web_activity_enabled": "0",
          "web_activity_port": "12345",
          "web_activity_token": "smoke-token"
        }));
        window.location.reload();
        return true;
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']'))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString(SETTINGS_MARKER)})`);
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("使用说明")})`),
      false,
    );

    await evaluate(client!, sessionId, `
      globalThis.__TIME_TRACKER_WEB_ACTIVITY_BRIDGE_SNAPSHOT = {
        enabled: true,
        connected: false,
        browserClientId: null,
        browserKind: null,
        extensionVersion: null,
        lastActivityAtMs: null
      };
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换网页同步"))} + ']');
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("使用说明")})`);
    const webSyncHeightWithGuide = await evaluate(client!, sessionId, `
      document.querySelector(".settings-web-activity-subpanel")?.getBoundingClientRect().height ?? 0
    `) as number;
    assert.ok(webSyncHeightWithGuide > 0, "missing web sync settings subpanel height");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "使用说明");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("网页同步使用说明")})`);
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("Patina 收到当前配置的网页活动后，使用说明入口会自动隐藏。")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="https://github.com/Ceceliaee/patina/releases/latest"]'))`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("默认端口是 12345")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("安装并运行 Patina 桌面端")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("在 Patina 设置中开启网页同步")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("复制端口")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("复制 Token")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("patina-chromium-extension-v...zip")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("patina-firefox-extension-v...zip")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("patina-firefox-extension-v...xpi")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("about:addons")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("about:debugging#/runtime/this-firefox")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="chrome://extensions/"]'))`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="edge://extensions/"]'))`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const close = document.querySelector('[role="dialog"] button');
          if (!close) return false;
          close.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");

    await evaluate(client!, sessionId, `
      globalThis.__TIME_TRACKER_WEB_ACTIVITY_BRIDGE_SNAPSHOT = {
        enabled: true,
        connected: true,
        browserClientId: "smoke-client",
        browserKind: "chrome",
        extensionVersion: "0.0.0",
        lastActivityAtMs: Date.now()
      };
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const save = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "保存" && !node.disabled);
          if (!save) return false;
          save.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `!document.body.innerText.includes(${jsonString("使用说明")})`);
    const webSyncHeightWithoutGuide = await evaluate(client!, sessionId, `
      document.querySelector(".settings-web-activity-subpanel")?.getBoundingClientRect().height ?? 0
    `) as number;
    assert.ok(
      Math.abs(webSyncHeightWithGuide - webSyncHeightWithoutGuide) <= 1,
      `Web sync settings subpanel shifted from ${webSyncHeightWithGuide}px to ${webSyncHeightWithoutGuide}px`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector("#settings-web-activity-address");
          if (!(input instanceof HTMLInputElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          input.focus();
          setter?.call(input, "12346");
          input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "12346", inputType: "insertText" }));
          await new Promise((resolve) => setTimeout(resolve, 50));
          input.blur();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("使用说明")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "使用说明");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("网页同步使用说明")})`);

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await delay(100);
    assert.equal(
      await evaluate(client!, sessionId, "document.documentElement.scrollWidth <= window.innerWidth + 1"),
      true,
      "Settings web sync guide dialog overflowed at 390px",
    );

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
    await evaluate(client!, sessionId, `
      (() => {
        const cancel = Array.from(document.querySelectorAll("button"))
          .find((node) => node.textContent?.trim() === "取消" && !node.disabled);
        cancel?.click();
      })()
    `);
    await waitForExpression(client!, sessionId, `!document.body.innerText.includes(${jsonString("有未保存更改")})`);
  });

  await runTest("settings remote backup panel opens WebDAV config dialog without narrow overflow", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("远程备份")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "配置");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("WebDAV 配置")})`);
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("服务器地址")})`),
      true,
    );

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await delay(100);
    assert.equal(
      await evaluate(client!, sessionId, "document.documentElement.scrollWidth <= window.innerWidth + 1"),
      true,
      "Settings remote backup dialog overflowed at 390px",
    );

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });
}
