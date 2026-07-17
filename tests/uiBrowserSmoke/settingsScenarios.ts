import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForAnimationFrames, waitForExpression } from "./browserHarness.ts";
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
    const ordinaryInputStyles = await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('input.qp-input')).map((input) => ({
        minHeight: getComputedStyle(input).minHeight,
        radius: getComputedStyle(input).borderRadius,
        fontSize: getComputedStyle(input).fontSize,
        fontWeight: getComputedStyle(input).fontWeight,
      }))
    `) as Array<{ minHeight: string; radius: string; fontSize: string; fontWeight: string }>;
    assert.ok(ordinaryInputStyles.length > 0, "Settings should render inputs using the Quiet Pro CSS contract");
    assert.equal(ordinaryInputStyles.every((style) => style.minHeight === "34px"), true);
    assert.equal(ordinaryInputStyles.every((style) => style.radius === "10px"), true);
    assert.equal(ordinaryInputStyles.every((style) => style.fontSize === "12px"), true);
    assert.equal(ordinaryInputStyles.every((style) => style.fontWeight === "600"), true);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const slider = document.querySelector('input[type="range"]');
          const stepperButton = slider?.parentElement?.querySelector('.qp-button-secondary');
          return stepperButton ? getComputedStyle(stepperButton).borderRadius : null;
        })()
      `),
      "10px",
      "specialized stepper controls should preserve the Quiet Pro control radius",
    );
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
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.matches('.settings-color-scheme-option[aria-pressed="true"]')`,
      undefined,
      "theme dialog should focus the current color scheme",
    );
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
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="https://github.com/Ceceliaee/patina-web-sync/releases/latest"]'))`),
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
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
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
    await waitForAnimationFrames(client!, sessionId);
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
    await waitForAnimationFrames(client!, sessionId);
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

  await runTest("settings data export explains four formats before six field groups", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const copy = document.querySelector('.settings-data-export-entry-copy')?.getBoundingClientRect();
          const action = document.querySelector('.settings-data-export-entry-action')?.getBoundingClientRect();
          return Boolean(copy && action && Math.abs(copy.bottom - action.bottom) < 0.5);
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "导出");
          if (!trigger) return false;
          trigger.scrollIntoView({ block: "center" });
          trigger.focus();
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.settings-data-export-format-grid'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const copy = document.querySelector('.settings-data-export-range-section .min-w-0')?.getBoundingClientRect();
          const controls = document.querySelector('.settings-data-export-range-control')?.getBoundingClientRect();
          return Boolean(copy && controls && Math.abs((copy.top + copy.height / 2) - (controls.top + controls.height / 2)) < 0.5);
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `getComputedStyle(document.querySelector('.settings-data-export-range-label')).lineHeight`),
      "10px",
    );
    assert.equal(
      await evaluate(client!, sessionId, `getComputedStyle(document.querySelector('.settings-data-export-range-label .qp-range-control-label-text')).translate`),
      "0px 0.5px",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-data-export-format-option strong')).map((node) => node.textContent)`),
      ["CSV", "Markdown", "Parquet", "SQLite"],
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, "document.documentElement.scrollWidth <= window.innerWidth + 1"),
      true,
      "Settings data export dialog overflowed at 390px",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const configure = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "配置字段");
          return !configure?.querySelector('svg')
            && (document.querySelector('.settings-data-export-format-grid').compareDocumentPosition(configure)
              & Node.DOCUMENT_POSITION_FOLLOWING);
        })()
      `),
      4,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.settings-data-export-dialog-surface')?.innerText.includes("恢复当前格式默认字段")`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.settings-data-export-result-success'))`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "配置字段");
          trigger?.focus();
          trigger?.click();
          return Boolean(trigger);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "document.querySelectorAll('.settings-data-export-field-group').length === 6");
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.matches('.settings-data-export-field-dialog .qp-dialog-title')`,
      undefined,
      "field configuration dialog should focus its heading",
    );
    assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector('input[type="search"]'))`), false);
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.qp-tooltip[role="tooltip"]')?.textContent === "恢复当前格式默认字段"`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]'))`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]')?.hasAttribute('aria-describedby')`),
      false,
      "hidden tooltips should not leave a dangling description relationship",
    );
    await evaluate(client!, sessionId, `
      document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]')
        ?.closest('.qp-tooltip-anchor')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    `);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.qp-tooltip[role="tooltip"]'))`),
      false,
      "pointer tooltips should not appear in the entry frame",
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-tooltip[role="tooltip"]'))`);
    await evaluate(client!, sessionId, `
      document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]')
        ?.closest('.qp-tooltip-anchor')
        ?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-tooltip[role="tooltip"]')`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]');
          if (!trigger) return false;
          trigger.focus();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.qp-tooltip[role="tooltip"]')?.textContent === "恢复当前格式默认字段"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]');
          const tooltip = document.querySelector('.qp-tooltip[role="tooltip"]');
          return Boolean(tooltip?.id && trigger?.getAttribute('aria-describedby')?.split(' ').includes(tooltip.id));
        })()
      `),
      true,
      "tooltip should be connected to its focusable trigger",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]');
          trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          return document.activeElement === trigger;
        })()
      `),
      true,
      "Escape should keep focus on the tooltip trigger",
    );
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-tooltip[role="tooltip"]')`);
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]')?.hasAttribute('aria-describedby')`),
      false,
      "dismissing a tooltip should remove its description relationship",
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.settings-data-export-field-dialog'))`),
      true,
      "dismissing a tooltip should not close its dialog",
    );
    await evaluate(client!, sessionId, `
      (() => {
        const title = document.querySelector('.settings-data-export-field-dialog .qp-dialog-title');
        const trigger = document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]');
        title?.focus();
        trigger?.focus();
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-tooltip[role="tooltip"]'))`);
    await evaluate(client!, sessionId, `
      document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-tooltip[role="tooltip"]')`);
    await evaluate(client!, sessionId, `
      (() => {
        const title = document.querySelector('.settings-data-export-field-dialog .qp-dialog-title');
        const trigger = document.querySelector('.qp-dialog-header [aria-label="恢复当前格式默认字段"]');
        title?.focus();
        trigger?.focus();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('.qp-tooltip[role="tooltip"]'))`,
      undefined,
      "keyboard focus should show the tooltip again after a pointer press",
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.qp-dialog-header .settings-data-export-field-header-count'))`),
      false,
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-data-export-field-group-header p')).map((node) => node.textContent)`),
      ["活动基础", "应用信息", "网页信息", "分类信息", "时间分析", "来源与审计"],
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-data-export-field-group-count')).map((node) => node.textContent?.trim())`),
      ["4/8", "3/5", "4/10", "1/3", "0/2", "0/4"],
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const count = document.querySelector('.settings-data-export-field-group-count')?.getBoundingClientRect();
          const action = document.querySelector('.settings-data-export-field-group-action')?.getBoundingClientRect();
          return Boolean(count && action && Math.abs(count.height - action.height) < 0.1);
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-data-export-field-group')).every((node) => node.classList.contains('settings-data-export-field-group-collapsed'))`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const body = document.querySelector('.settings-data-export-field-dialog .qp-dialog-body');
          return Boolean(body && body.scrollHeight <= body.clientHeight);
        })()
      `),
      true,
      "Collapsed field groups should not require scrolling",
    );
    const collapsedDialogHeight = Number(await evaluate(client!, sessionId, `document.querySelector('.settings-data-export-field-dialog')?.getBoundingClientRect().height ?? 0`));
    await evaluate(client!, sessionId, `document.querySelector('.settings-data-export-field-group-action[aria-label="展开"]')?.click()`);
    await waitForExpression(client!, sessionId, `document.querySelectorAll('.settings-data-export-field-row').length === 8`);
    const expandedDialogHeight = Number(await evaluate(client!, sessionId, `document.querySelector('.settings-data-export-field-dialog')?.getBoundingClientRect().height ?? 0`));
    assert.ok(Math.abs(expandedDialogHeight - collapsedDialogHeight) < 1, "Field group expansion changed dialog height");
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelectorAll('.settings-data-export-field-order-index').length`),
      0,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelectorAll('.settings-data-export-field-drag-handle').length`),
      0,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('[aria-label="恢复默认排序"]'))`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, "document.documentElement.scrollWidth <= window.innerWidth + 1"),
      true,
      "Settings export field dialog overflowed at 390px",
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 1");
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.textContent?.trim() === "配置字段"`,
      undefined,
      "nested dialog focus restoration",
    );
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.textContent?.trim() === "导出"`,
      undefined,
      "outer dialog focus restoration",
    );
  });
}
