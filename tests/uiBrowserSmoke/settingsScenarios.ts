import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import {
  delay,
  evaluate,
  jsonString,
  waitForAnimationFrames,
  waitForExpression,
} from "./browserHarness.ts";
import { SETTINGS_MARKER } from "./constants.ts";
import { LOCALE_METADATA, SUPPORTED_LOCALES } from "../../src/shared/i18n/generated/contract.ts";

type SelectKeyboardKey = "Enter" | "ArrowUp" | "ArrowDown" | "Home" | "End" | "Escape" | "简";

async function dispatchSelectKey(
  context: Pick<BrowserSmokeContext, "client" | "sessionId">,
  selector: string,
  key: SelectKeyboardKey,
) {
  assert.deepEqual(
    JSON.parse(String(await evaluate(context.client, context.sessionId, `
      (() => {
        const target = document.querySelector(${jsonString(selector)});
        if (!(target instanceof HTMLElement)) {
          return JSON.stringify({ found: false, focused: false, handled: false });
        }
        target.focus();
        const event = new KeyboardEvent("keydown", {
          key: ${jsonString(key)},
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return JSON.stringify({
          found: true,
          focused: document.activeElement === target,
          handled: event.defaultPrevented,
        });
      })()
    `))),
    { found: true, focused: true, handled: true },
    `${key} should be handled by its focused select control`,
  );
}

export async function runSettingsScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;

  await runTest("select keyboard highlight survives equivalent options after parent refresh", async () => {
    await evaluate(client, sessionId, `(async () => {
      const fixture = await import("/tests/uiBrowserSmoke/selectFixture.ts");
      window.__selectRefreshFixture = fixture.mountSelectFixture();
    })()`);
    const trigger = '#select-refresh-fixture button[aria-haspopup="listbox"]';
    const listbox = '.qp-select-menu[role="listbox"]';
    const activeText = `(() => {
      const id = document.querySelector(${jsonString(listbox)})?.getAttribute("aria-activedescendant");
      return id ? document.getElementById(id)?.textContent : null;
    })()`;
    try {
      await waitForExpression(client, sessionId, `document.querySelector('#select-refresh-fixture')?.dataset.revision === "0"`);
      await dispatchSelectKey(context, trigger, "Enter");
      await waitForExpression(client, sessionId, `${activeText} === "Second"`);
      await dispatchSelectKey(context, listbox, "Home");
      await waitForExpression(client, sessionId, `${activeText} === "First"`);
      await evaluate(client, sessionId, `window.__selectRefreshFixture.render(1)`);
      await waitForExpression(client, sessionId, `document.querySelector('#select-refresh-fixture')?.dataset.revision === "1"`);
      await waitForAnimationFrames(client, sessionId);
      assert.equal(await evaluate(client, sessionId, activeText), "First");
      await dispatchSelectKey(context, listbox, "Enter");
      await waitForExpression(client, sessionId, `document.querySelector('#select-refresh-fixture')?.dataset.chosen === "first"`);
    } finally {
      await evaluate(client, sessionId, `window.__selectRefreshFixture.dispose(); delete window.__selectRefreshFixture;`);
    }
  });

  await runTest("settings cold navigation keeps the current view until its final state is ready", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          localStorage.setItem("patina:last-active-view", "dashboard");
          localStorage.setItem("__time_tracker_settings_query_delay_ms", "900");
          location.reload();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']'))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']');
          node?.click();
          return Boolean(node);
        })()
      `),
      true,
    );
    await delay(150);
    const pendingState = JSON.parse(String(await evaluate(client!, sessionId, `JSON.stringify({
      presentedView: document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") ?? null,
      settingsMounted: Boolean(document.querySelector(".settings-button-preview")),
    })`))) as { presentedView: string | null; settingsMounted: boolean };
    assert.equal(pendingState.presentedView, "dashboard");
    assert.equal(pendingState.settingsMounted, false);

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") === "settings"
        && Boolean(document.querySelector(".settings-button-preview"))`,
      15_000,
      "Settings cold bootstrap should settle before presentation",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_settings_query_delay_ms")`);
  });

  await runTest("settings cold failure is explicit and retryable", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const dashboard = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          dashboard?.click();
          if (!dashboard) return false;
          const cache = await import("/src/features/settings/services/settingsBootstrapCache.ts");
          cache.setSettingsBootstrapCache(null);
          globalThis.__TIME_TRACKER_REJECT_SETTINGS_QUERY_COUNT = 1;
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("main.qp-canvas")?.dataset.presentedView === "dashboard"`,
    );
    await evaluate(client!, sessionId, `
      document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']')?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("main.qp-canvas")?.dataset.presentedView === "settings"
        && document.body.innerText.includes(${jsonString("设置加载失败。")})
        && !document.querySelector(".settings-button-preview")`,
      15_000,
      "Settings cold failure should expose a stable recovery state",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          globalThis.__TIME_TRACKER_REJECT_SETTINGS_QUERY_COUNT = 0;
          const retry = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === ${jsonString("重试")});
          retry?.click();
          return Boolean(retry);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".settings-button-preview"))
        && !document.body.innerText.includes(${jsonString("设置加载失败。")})`,
      15_000,
      "Settings retry should restore the form",
    );
  });

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

  await runTest("settings language select switches, persists, and restores all production locales", async () => {
    const openSettings = async (label: string) => {
      const languageAriaLabel = label === "Settings" ? "Language: English" : "语言: 简体中文";
      await waitForExpression(
        client!,
        sessionId,
        `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']'))`,
        15_000,
      );
      await evaluate(client!, sessionId, `
        document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.click()
      `);
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector("main.qp-canvas")?.dataset.presentedView === "settings"
          && Boolean(document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(languageAriaLabel))} + ']'))`,
        15_000,
        `${label} should finish presenting before the language selector is used`,
      );
      await waitForAnimationFrames(client!, sessionId);
    };

    let languageTriggerWidth: number | null = null;
    const chooseLanguage = async (currentAriaLabel: string, targetLabel: string) => {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(currentAriaLabel))} + ']');
            trigger?.scrollIntoView({ block: "center" });
            return Boolean(trigger);
          })()
        `),
        true,
      );
      await waitForAnimationFrames(client!, sessionId);
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(currentAriaLabel))} + ']');
            trigger?.click();
            return Boolean(trigger);
          })()
        `),
        true,
      );
      await waitForExpression(client!, sessionId, `(() => {
        const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(currentAriaLabel))} + ']');
        const listboxId = trigger?.getAttribute("aria-controls");
        return Boolean(listboxId && document.getElementById(listboxId));
      })()`);
      await waitForExpression(
        client!,
        sessionId,
        `(() => {
          const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(currentAriaLabel))} + ']');
          const listboxId = trigger?.getAttribute("aria-controls");
          const menu = listboxId ? document.getElementById(listboxId) : null;
          return Boolean(menu && getComputedStyle(menu).visibility !== "hidden");
        })()`,
        15_000,
        "compact language menu should finish measuring before it becomes visible",
      );
      const selectA11yState = JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify((() => {
          const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(currentAriaLabel))} + ']');
          const controls = trigger?.getAttribute("aria-controls");
          const listbox = controls ? document.getElementById(controls) : null;
          const triggerRect = trigger?.getBoundingClientRect();
          const menuRect = listbox?.getBoundingClientRect();
          const triggerStyle = trigger ? getComputedStyle(trigger) : null;
          const menuStyle = listbox ? getComputedStyle(listbox) : null;
          const labelStackRect = trigger?.querySelector('.qp-select-label-stack')?.getBoundingClientRect();
          const caretRect = trigger?.querySelector('.qp-select-caret')?.getBoundingClientRect();
          const options = Array.from(listbox?.querySelectorAll('[role="option"]') ?? []);
          const optionStyles = options.map((option) => getComputedStyle(option));
          const selectedOption = listbox?.querySelector('[role="option"][aria-selected="true"]');
          const compactSegmentSelected = document.querySelector('.qp-segmented-filter-compact .qp-segmented-filter-item-selected');
          const compactSegmentDefault = document.querySelector('.qp-segmented-filter-compact .qp-segmented-filter-item:not(.qp-segmented-filter-item-selected)');
          const defaultOption = listbox?.querySelector('[role="option"][aria-selected="false"]');
          return {
            hasPopup: trigger?.getAttribute("aria-haspopup"),
            expanded: trigger?.getAttribute("aria-expanded"),
            controls: trigger?.getAttribute("aria-controls"),
            listboxId: listbox?.id,
            selectedCount: options.filter((option) => option.getAttribute("aria-selected") === "true").length,
            menuContainsViewport: Boolean(menuRect && menuRect.left >= 0 && menuRect.right <= innerWidth + 1),
            menuCoversTrigger: Boolean(menuRect && triggerRect && menuRect.width + 0.5 >= triggerRect.width),
            triggerWidth: triggerRect ? Math.round(triggerRect.width) : 0,
            triggerHeight: triggerRect ? Math.round(triggerRect.height) : 0,
            triggerHorizontalChrome: triggerRect && labelStackRect && caretRect
              ? Math.round(triggerRect.width - labelStackRect.width - caretRect.width)
              : 0,
            triggerFontSize: triggerStyle?.fontSize ?? null,
            triggerFontWeight: triggerStyle?.fontWeight ?? null,
            triggerMatchesPreviousSelectedText: Boolean(
              triggerStyle
              && compactSegmentSelected
              && triggerStyle.color === getComputedStyle(compactSegmentSelected).color
            ),
            menuWidth: menuRect ? Math.round(menuRect.width) : 0,
            menuHeight: menuRect ? Math.round(menuRect.height) : 0,
            menuGap: menuRect && triggerRect
              ? Math.round(menuRect.top >= triggerRect.bottom
                ? menuRect.top - triggerRect.bottom
                : triggerRect.top - menuRect.bottom)
              : 0,
            menuPadding: menuStyle?.paddingTop ?? null,
            optionHeights: options.map((option) => Math.round(option.getBoundingClientRect().height)),
            optionFontSizes: [...new Set(optionStyles.map((style) => style.fontSize))],
            optionFontWeights: [...new Set(optionStyles.map((style) => style.fontWeight))],
            selectedMatchesPreviousSelectedText: Boolean(
              selectedOption
              && compactSegmentSelected
              && getComputedStyle(selectedOption).color === getComputedStyle(compactSegmentSelected).color
            ),
            defaultMatchesPreviousDefaultText: Boolean(
              defaultOption
              && compactSegmentDefault
              && getComputedStyle(defaultOption).color === getComputedStyle(compactSegmentDefault).color
            ),
          };
        })())
      `))) as {
        hasPopup: string | null;
        expanded: string | null;
        controls: string | null;
        listboxId: string | null;
        selectedCount: number;
        menuContainsViewport: boolean;
        menuCoversTrigger: boolean;
        triggerWidth: number;
        triggerHeight: number;
        triggerHorizontalChrome: number;
        triggerFontSize: string | null;
        triggerFontWeight: string | null;
        triggerMatchesPreviousSelectedText: boolean;
        menuWidth: number;
        menuHeight: number;
        menuGap: number;
        menuPadding: string | null;
        optionHeights: number[];
        optionFontSizes: string[];
        optionFontWeights: string[];
        selectedMatchesPreviousSelectedText: boolean;
        defaultMatchesPreviousDefaultText: boolean;
      };
      assert.equal(selectA11yState.hasPopup, "listbox");
      assert.equal(selectA11yState.expanded, "true");
      assert.equal(selectA11yState.controls, selectA11yState.listboxId);
      assert.equal(selectA11yState.selectedCount, 1);
      assert.equal(selectA11yState.menuContainsViewport, true);
      assert.equal(selectA11yState.menuCoversTrigger, true);
      assert.ok(selectA11yState.triggerWidth > 0 && selectA11yState.triggerWidth <= 220);
      assert.equal(selectA11yState.triggerHeight, 28);
      assert.equal(selectA11yState.triggerHorizontalChrome, 24);
      languageTriggerWidth ??= selectA11yState.triggerWidth;
      assert.equal(selectA11yState.triggerWidth, languageTriggerWidth);
      assert.equal(selectA11yState.triggerFontSize, "11px");
      assert.equal(selectA11yState.triggerFontWeight, "650");
      assert.equal(selectA11yState.triggerMatchesPreviousSelectedText, true);
      assert.ok(
        selectA11yState.menuWidth >= selectA11yState.triggerWidth
        && selectA11yState.menuWidth <= 220,
      );
      assert.equal(
        selectA11yState.menuHeight,
        Math.min(selectA11yState.optionHeights.reduce((total, height) => total + height, 10), 220),
      );
      assert.equal(selectA11yState.menuGap, 4);
      assert.equal(selectA11yState.menuPadding, "4px");
      assert.deepEqual(selectA11yState.optionHeights, SUPPORTED_LOCALES.map(() => 28));
      assert.deepEqual(selectA11yState.optionFontSizes, ["11px"]);
      assert.deepEqual(selectA11yState.optionFontWeights, ["650"]);
      assert.equal(selectA11yState.selectedMatchesPreviousSelectedText, true);
      assert.equal(selectA11yState.defaultMatchesPreviousDefaultText, true);
      assert.deepEqual(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(currentAriaLabel))} + ']');
            const listboxId = trigger?.getAttribute("aria-controls");
            const listbox = listboxId ? document.getElementById(listboxId) : null;
            return Array.from(listbox?.querySelectorAll('[role="option"]') ?? [])
              .map((option) => option.textContent?.trim());
          })()
        `),
        SUPPORTED_LOCALES.map((locale) => LOCALE_METADATA[locale].label),
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify(currentAriaLabel))} + ']');
            const listboxId = trigger?.getAttribute("aria-controls");
            const listbox = listboxId ? document.getElementById(listboxId) : null;
            const option = Array.from(listbox?.querySelectorAll('[role="option"]') ?? [])
              .find((node) => node.textContent?.trim() === ${jsonString(targetLabel)});
            option?.click();
            return Boolean(option);
          })()
        `),
        true,
      );
    };

    await openSettings("设置");
    await chooseLanguage("语言: 简体中文", "English");
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.lang === "en-US"
        && Boolean(document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']'))`,
      15_000,
      "English locale chunk should load from the language selector",
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`),
      true,
      "language selector should not introduce horizontal overflow",
    );
    for (const viewport of [
      { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false },
      { width: 900, height: 760, deviceScaleFactor: 1.5, mobile: false },
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    ]) {
      await client!.command("Emulation.setDeviceMetricsOverride", viewport, sessionId);
      await evaluate(client!, sessionId, `
        document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']')
          ?.scrollIntoView({ block: "center" })
      `);
      await waitForAnimationFrames(client!, sessionId);
      const layoutState = JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify((() => {
          const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']');
          const label = trigger?.querySelector("span");
          const caret = trigger?.querySelector("svg");
          const triggerRect = trigger?.getBoundingClientRect();
          const labelStackRect = trigger?.querySelector('.qp-select-label-stack')?.getBoundingClientRect();
          const labelRect = label?.getBoundingClientRect();
          const caretRect = caret?.getBoundingClientRect();
          const headerLeftRect = document.querySelector(".qp-page-header-left")?.getBoundingClientRect();
          const headerRight = document.querySelector(".qp-page-header-right");
          const headerRightRect = headerRight?.getBoundingClientRect();
          const title = document.querySelector(".qp-page-header-title");
          const titleRect = title?.getBoundingClientRect();
          const titleFontSize = title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0;
          return {
            noPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
            triggerInsideViewport: Boolean(triggerRect && triggerRect.left >= -1 && triggerRect.right <= innerWidth + 1),
            triggerUsesCompactSize: Boolean(
              triggerRect
              && labelStackRect
              && caretRect
              && triggerRect.width <= 220
              && Math.abs(triggerRect.height - 28) <= 0.5
              && Math.abs(triggerRect.width - labelStackRect.width - caretRect.width - 24) <= 0.5
            ),
            labelClearsCaret: Boolean(labelRect && caretRect && labelRect.right <= caretRect.left + 1),
            titleStaysReadable: Boolean(titleRect && titleFontSize && titleRect.height <= titleFontSize * 1.7),
            headerActionsFit: Boolean(headerRight && headerRight.scrollWidth <= headerRight.clientWidth + 1),
            headerRegionsDoNotOverlap: Boolean(
              headerLeftRect
              && headerRightRect
              && (
                headerLeftRect.right <= headerRightRect.left + 1
                || headerLeftRect.bottom <= headerRightRect.top + 1
                || headerRightRect.bottom <= headerLeftRect.top + 1
              )
            ),
          };
        })())
      `))) as {
        noPageOverflow: boolean;
        triggerInsideViewport: boolean;
        triggerUsesCompactSize: boolean;
        labelClearsCaret: boolean;
        titleStaysReadable: boolean;
        headerActionsFit: boolean;
        headerRegionsDoNotOverlap: boolean;
      };
      assert.deepEqual(layoutState, {
        noPageOverflow: true,
        triggerInsideViewport: true,
        triggerUsesCompactSize: true,
        labelClearsCaret: true,
        titleStaysReadable: true,
        headerActionsFit: true,
        headerRegionsDoNotOverlap: true,
      });
      await evaluate(client!, sessionId, `
        document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']')?.click()
      `);
      await waitForExpression(client!, sessionId, `(() => {
        const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']');
        const listboxId = trigger?.getAttribute("aria-controls");
        const listbox = listboxId ? document.getElementById(listboxId) : null;
        return Boolean(listbox && getComputedStyle(listbox).visibility !== "hidden");
      })()`);
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']');
            const listboxId = trigger?.getAttribute("aria-controls");
            const rect = listboxId ? document.getElementById(listboxId)?.getBoundingClientRect() : null;
            return Boolean(rect && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1);
          })()
        `),
        true,
      );
      await evaluate(client!, sessionId, `
        document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']')?.click()
      `);
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']')?.getAttribute("aria-expanded") === "false"`,
      );
    }
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId);
    assert.notEqual(
      await evaluate(client!, sessionId, `JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}").language ?? null`),
      "en-US",
      "language preview must not persist before Save",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const cancel = Array.from(document.querySelectorAll("button"))
            .find((button) => button.textContent?.trim() === "Cancel" && !button.disabled);
          cancel?.click();
          return Boolean(cancel);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.lang === "zh-CN"
        && Boolean(document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("语言: 简体中文"))} + ']'))`,
      15_000,
      "Cancel should restore the saved locale",
    );
    assert.notEqual(
      await evaluate(client!, sessionId, `JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}").language ?? null`),
      "en-US",
    );

    await chooseLanguage("语言: 简体中文", "English");
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.lang === "en-US"
        && Boolean(document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']'))`,
      15_000,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const save = Array.from(document.querySelectorAll("button"))
            .find((button) => button.textContent?.trim() === "Save");
          save?.click();
          return Boolean(save);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("Settings updated")})`);
    assert.equal(
      await evaluate(client!, sessionId, `JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}").language`),
      "en-US",
    );

    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.lang === "en-US"
        && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("Settings"))} + ']'))`,
      15_000,
      "saved English locale should survive a reload",
    );
    for (const destination of [
      { label: "Today", view: "dashboard" },
      { label: "History", view: "history" },
      { label: "Data", view: "data" },
      { label: "Classification", view: "mapping" },
      { label: "Tools", view: "tools" },
      { label: "Settings", view: "settings" },
      { label: "About", view: "about" },
    ]) {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const destination = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(destination.label))} + ']');
            destination?.click();
            return Boolean(destination);
          })()
        `),
        true,
      );
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector("main.qp-canvas")?.dataset.presentedView === ${jsonString(destination.view)}`,
        15_000,
        `English ${destination.view} view should settle`,
      );
      assert.deepEqual(
        JSON.parse(String(await evaluate(client!, sessionId, `JSON.stringify({
          lang: document.documentElement.lang,
          hasHeading: Boolean(document.querySelector("main h1")?.textContent?.trim()),
          noReplacementCharacter: !document.body.innerText.includes("\\uFFFD"),
          noPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        })`))),
        {
          lang: "en-US",
          hasHeading: true,
          noReplacementCharacter: true,
          noPageOverflow: true,
        },
      );
    }
    await evaluate(client!, sessionId, `localStorage.setItem("patina:last-active-view", "settings")`);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.lang === "en-US"
        && document.querySelector("main.qp-canvas")?.dataset.presentedView === "settings"
        && document.querySelector("main.qp-canvas")?.dataset.viewTransitionState === "settled"
        && Boolean(document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']'))`,
      15_000,
      "rebuilt English Settings view should settle before keyboard interaction",
    );
    await waitForAnimationFrames(client!, sessionId, 4);

    const languageTriggerSelector = '.qp-select-trigger[aria-label="Language: English"]';
    const languageListboxSelector = '[role="listbox"]';
    const openLanguageListbox = async () => {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector(${jsonString(languageTriggerSelector)});
            if (!(trigger instanceof HTMLElement)) return false;
            trigger.scrollIntoView({ block: "center" });
            return true;
          })()
        `),
        true,
      );
      await waitForAnimationFrames(client!, sessionId, 4);
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector(${jsonString(languageTriggerSelector)});
            trigger?.click();
            return Boolean(trigger);
          })()
        `),
        true,
      );
    };
    const focusVisibleLanguageListbox = async (message: string) => {
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector(${jsonString(languageTriggerSelector)})?.getAttribute("aria-expanded") === "true"
          && (() => {
            const listbox = document.querySelector(${jsonString(languageListboxSelector)});
            const activeId = listbox?.getAttribute("aria-activedescendant");
            const activeOption = activeId ? document.getElementById(activeId) : null;
            return Boolean(listbox && getComputedStyle(listbox).visibility !== "hidden"
              && activeOption?.getAttribute("aria-selected") === "true");
          })()`,
        15_000,
        message,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const listbox = document.querySelector(${jsonString(languageListboxSelector)});
            if (!(listbox instanceof HTMLElement)) return false;
            listbox.focus();
            return document.activeElement === listbox;
          })()
        `),
        true,
        "language listbox should accept focus before keyboard navigation",
      );
    };
    await openLanguageListbox();
    await focusVisibleLanguageListbox(
      "language trigger should open and finish measuring the listbox",
    );
    const activeOptionText = async () => evaluate(client!, sessionId, `
      (() => {
        const id = document.activeElement?.getAttribute("aria-activedescendant");
        return id ? document.getElementById(id)?.textContent?.trim() ?? null : null;
      })()
    `);
    await dispatchSelectKey(context, languageListboxSelector, "ArrowUp");
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(await activeOptionText(), "简体中文");
    await dispatchSelectKey(context, languageListboxSelector, "ArrowDown");
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(await activeOptionText(), "English");
    await dispatchSelectKey(context, languageListboxSelector, "Home");
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(await activeOptionText(), "简体中文");
    await dispatchSelectKey(context, languageListboxSelector, "简");
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(await activeOptionText(), "简体中文");
    await dispatchSelectKey(context, languageListboxSelector, "End");
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(await activeOptionText(), "Español");
    await dispatchSelectKey(context, languageListboxSelector, "Escape");
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']')?.getAttribute("aria-expanded") === "false"
        && document.activeElement?.matches('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("Language: English"))} + ']')`,
      15_000,
      "Escape should remove the portal and restore trigger focus",
    );
    await dispatchSelectKey(context, languageTriggerSelector, "Enter");
    await focusVisibleLanguageListbox(
      "language listbox should reopen from restored trigger focus",
    );
    await dispatchSelectKey(context, languageListboxSelector, "Home");
    await waitForExpression(client!, sessionId, `
      (() => {
        const listbox = document.querySelector(${jsonString(languageListboxSelector)});
        const activeId = listbox?.getAttribute("aria-activedescendant");
        return Boolean(activeId && document.getElementById(activeId)?.textContent?.trim() === "简体中文");
      })()
    `, 15_000, "Home should commit the first language option before Enter");
    await dispatchSelectKey(context, languageListboxSelector, "Enter");
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.lang === "zh-CN"
        && Boolean(document.querySelector('.qp-select-trigger[aria-label=' + ${jsonString(JSON.stringify("语言: 简体中文"))} + ']'))`,
      15_000,
      "keyboard selection should restore Simplified Chinese",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const save = Array.from(document.querySelectorAll("button"))
            .find((button) => button.textContent?.trim() === "保存");
          save?.click();
          return Boolean(save);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("配置已更新")})`);
    assert.equal(
      await evaluate(client!, sessionId, `JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}").language`),
      "zh-CN",
    );
    await chooseLanguage("语言: 简体中文", "Español");
    await waitForExpression(client!, sessionId, "document.documentElement.lang === 'es'");
    assert.equal(await evaluate(client!, sessionId, "JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') ?? '{}').language"), "zh-CN", "Spanish preview must not persist before Save");
    await evaluate(client!, sessionId, "Array.from(document.querySelectorAll('button')).find(n => n.textContent?.trim() === 'Guardar')?.click()");
    await waitForExpression(client!, sessionId, "JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') ?? '{}').language === 'es'");
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(client!, sessionId, "document.documentElement.lang === 'es' && Boolean(document.querySelector('.qp-select-trigger[aria-label=\"Idioma: Español\"]'))");
    await chooseLanguage("Idioma: Español", "简体中文");
    await waitForExpression(client!, sessionId, "document.documentElement.lang === 'zh-CN'");
    await evaluate(client!, sessionId, "Array.from(document.querySelectorAll('button')).find(n => n.textContent?.trim() === '保存')?.click()");
    await waitForExpression(client!, sessionId, "JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') ?? '{}').language === 'zh-CN'");
  });

  await runTest("start minimized stays editable and persists while launch at login is off", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify({
          "launch_at_login": "0",
          "start_minimized": "0"
        }));
        window.location.reload();
        return true;
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']'))`);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']')?.click()`);
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("静默启动")})`);

    const launchBehaviorSyncs = await evaluate(client!, sessionId, `
        globalThis.__PATINA_INVOKED_COMMANDS
          .filter((entry) => entry.command === "cmd_set_launch_behavior")
          .map((entry) => entry.payload)
      `) as Array<{ launchAtLogin?: boolean; startMinimized?: boolean }>;
    assert.ok(launchBehaviorSyncs.length > 0, "persisted desktop behavior should sync after loading");
    assert.equal(
      launchBehaviorSyncs.every((payload) => payload.launchAtLogin === false),
      true,
      "startup must not sync launch-at-login defaults before persisted settings load",
    );

    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const launch = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换开机自启动"))} + ']');
          const minimized = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换静默启动"))} + ']');
          return {
            launchChecked: launch?.getAttribute("aria-checked"),
            launchDisabled: launch?.disabled,
            minimizedChecked: minimized?.getAttribute("aria-checked"),
            minimizedDisabled: minimized?.disabled,
          };
        })()
      `),
      {
        launchChecked: "false",
        launchDisabled: false,
        minimizedChecked: "false",
        minimizedDisabled: false,
      },
    );

    await evaluate(client!, sessionId, `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换静默启动"))} + ']')?.click()`);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换静默启动"))} + ']')?.getAttribute("aria-checked") === "true"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换开机自启动"))} + ']')?.getAttribute("aria-checked")`),
      "false",
    );
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll("button"))
        .find((node) => node.textContent?.trim() === "保存" && !node.disabled)?.click()
    `);
    await waitForExpression(client!, sessionId, `
      (() => {
        const stored = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
        return stored.launch_at_login === "0" && stored.start_minimized === "1";
      })()
    `);

    await evaluate(client!, sessionId, `window.location.reload()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']'))`);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']')?.click()`);
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("静默启动")})`);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const launch = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换开机自启动"))} + ']');
          const minimized = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换静默启动"))} + ']');
          return [launch?.getAttribute("aria-checked"), minimized?.getAttribute("aria-checked"), minimized?.disabled];
        })()
      `),
      ["false", "true", false],
    );
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
      await evaluate(client!, sessionId, `document.querySelectorAll(".settings-web-activity-store-badge-row a").length`),
      3,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="https://chromewebstore.google.com/detail/patina-web-sync/gimdckblhckibmeklhemgccabmbnoemd"]'))`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="https://addons.mozilla.org/firefox/addon/patina-web-sync/"]'))`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="https://microsoftedge.microsoft.com/addons/detail/gogmlpjhbfjghilmpcciedplifdiibai"]'))`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("选择浏览器，从对应商店安装 Patina Web Sync。")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("商店不可用时，可从 Patina Web Sync 发布页手动安装。")})`),
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
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("patina-firefox-extension-v...zip")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("patina-firefox-extension-v...xpi")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("about:addons")})`),
      false,
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
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('[role="dialog"]');
          const inputs = Array.from(dialog?.querySelectorAll('input') ?? []);
          if (inputs.length !== 3) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          for (const [input, value] of inputs.map((input, index) => [
            input,
            ["https://dav.jianguoyun.com/dav/", "patina-smoke", "app-password"][index],
          ])) {
            setter?.call(input, value);
            input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
          }
          return true;
        })()
      `),
      true,
    );
    await waitForAnimationFrames(client!, sessionId);
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[role="dialog"] button'))
        .find((node) => node.textContent?.trim() === "保存")?.click()
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("编辑")})`);
  });

  await runTest("settings WebDAV password reveals only after an explicit click and clears when hidden", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "编辑");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("WebDAV 配置")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('[role="dialog"]');
          const password = dialog?.querySelectorAll('input')[2];
          const revealCalls = globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_reveal_webdav_backup_secret");
          return password?.value === ""
            && password?.getAttribute("placeholder") === "••••••••"
            && revealCalls.length === 0;
        })()
      `),
      true,
      "Opening the dialog eagerly fetched the saved password",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector('button[aria-label="显示密码"]');
          if (!button) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        const password = dialog?.querySelectorAll('input')[2];
        return password?.type === "text" && password?.value === "app-password";
      })()
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        globalThis.__PATINA_INVOKED_COMMANDS
          .filter((entry) => entry.command === "cmd_reveal_webdav_backup_secret").length
      `),
      1,
    );

    await evaluate(client!, sessionId, `document.querySelector('button[aria-label="隐藏密码"]')?.click()`);
    await waitForExpression(client!, sessionId, `
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        const password = dialog?.querySelectorAll('input')[2];
        return password?.type === "password"
          && password?.value === ""
          && password?.getAttribute("placeholder") === "••••••••";
      })()
    `);
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[role="dialog"] button'))
        .find((node) => node.textContent?.trim() === "取消")?.click()
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("settings backup dialog opens scheduled local backup as a secondary dialog", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll('.qp-action-row button'))
            .find((node) => node.textContent?.trim() === "备份" && !node.disabled);
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("选择备份位置")})`);
    assert.equal(
      await evaluate(client!, sessionId, "Math.round(document.querySelector('.settings-backup-dialog')?.getBoundingClientRect().width ?? 0)"),
      600,
      "The primary backup dialog width changed",
    );
    assert.equal(
      await evaluate(client!, sessionId, "document.querySelector('.settings-scheduled-backup') === null"),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `!document.body.innerText.includes(${jsonString("加载中...")})`),
      true,
      "The primary backup dialog exposed a loading placeholder",
    );
    await evaluate(client!, sessionId, `
      document.querySelector('button.settings-backup-schedule-action')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('[role=\"tooltip\"]'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('button.settings-backup-schedule-action');
          const tooltip = document.querySelector('[role="tooltip"]');
          if (!trigger || !tooltip) return false;
          return tooltip.getBoundingClientRect().bottom <= trigger.getBoundingClientRect().top;
        })()
      `),
      true,
      "The scheduled backup tooltip was not positioned above its icon trigger",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('button.settings-backup-schedule-action[aria-label="定时备份"]');
          if (!trigger) return false;
          trigger.focus();
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 2");
    assert.equal(
      await evaluate(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 2"),
      true,
    );
    const scheduledBadgeMetrics = await evaluate(client!, sessionId, `
        (() => {
          const dialogs = document.querySelectorAll('[role="dialog"]');
          const scheduledDialog = Array.from(dialogs).find((dialog) =>
            dialog.querySelector('.qp-dialog-title')?.textContent?.includes('定时备份')
          );
          const title = scheduledDialog?.querySelector('.qp-dialog-title');
          const badge = title?.querySelector('.qp-badge-beta');
          if (!title || !badge) return { found: false };
          const titleRect = title.getBoundingClientRect();
          const badgeRect = badge.getBoundingClientRect();
          const titleCenter = titleRect.top + titleRect.height / 2;
          const badgeCenter = badgeRect.top + badgeRect.height / 2;
          const titleFontSize = Number.parseFloat(getComputedStyle(title).fontSize);
          const badgeFontSize = Number.parseFloat(getComputedStyle(badge).fontSize);
          return {
            found: true,
            text: badge.textContent?.trim(),
            regular: badge.classList.contains('qp-badge-regular'),
            fontRatio: badgeFontSize / titleFontSize,
            heightRatio: badgeRect.height / titleRect.height,
            centerDelta: Math.abs(titleCenter - badgeCenter),
          };
        })()
      `) as {
        found: boolean;
        text?: string;
        regular?: boolean;
        fontRatio?: number;
        heightRatio?: number;
        centerDelta?: number;
      };
    assert.ok(
      scheduledBadgeMetrics.found
        && scheduledBadgeMetrics.text?.toUpperCase() === "BETA"
        && scheduledBadgeMetrics.regular
        && (scheduledBadgeMetrics.fontRatio ?? 0) >= 0.6
        && (scheduledBadgeMetrics.heightRatio ?? 0) >= 0.8
        && (scheduledBadgeMetrics.centerDelta ?? Number.POSITIVE_INFINITY) <= 2,
      `The scheduled backup dialog BETA badge did not match the title scale: ${JSON.stringify(scheduledBadgeMetrics)}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialogs = document.querySelectorAll('[role="dialog"]');
          return dialogs.length === 2 && !dialogs[1].querySelector('.qp-dialog-close-button');
        })()
      `),
      true,
      "The secondary scheduled backup dialog exposed a redundant close button",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const controls = Array.from(document.querySelector('.settings-scheduled-backup-schedule-controls')?.children ?? []);
          const tops = controls.map((node) => Math.round(node.getBoundingClientRect().top));
          return tops.length === 3 && Math.max(...tops) - Math.min(...tops) <= 1;
        })()
      `),
      true,
      "Weekly scheduled backup controls did not stay on one row",
    );
    assert.equal(
      await evaluate(client!, sessionId, "document.querySelector('.settings-scheduled-backup-status') === null"),
      true,
      "Disabled scheduled backup exposed a redundant empty status row",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const path = document.querySelector('.settings-scheduled-backup-directory-value');
          return path?.tagName === 'SPAN'
            && Boolean(path.textContent?.trim())
            && !path.textContent?.startsWith('\\\\?\\\\')
            && Boolean(path.querySelector('svg'))
            && !document.querySelector('.settings-scheduled-backup-directory-field input');
        })()
      `),
      true,
      "Scheduled backup directory looked like an editable input",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        !document.body.innerText.includes('保留最近')
          && !document.body.innerText.includes('每份均可独立恢复')
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector('[role="switch"][aria-label="定时备份"]');
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `
      (() => {
        const save = Array.from(document.querySelectorAll('[role="dialog"] button'))
          .find((node) => node.textContent?.trim() === "保存");
        return Boolean(save && !save.disabled);
      })()
    `);
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[role="dialog"] button'))
        .find((node) => node.textContent?.trim() === "保存")?.click()
    `);
    await waitForExpression(client!, sessionId, `
      globalThis.__PATINA_INVOKED_COMMANDS.some((entry) =>
        entry.command === "cmd_save_scheduled_backup_config"
        && entry.payload?.input?.enabled === true
        && !("retentionCount" in entry.payload.input)
      )
    `);
    await waitForExpression(client!, sessionId, `
      document.querySelectorAll('.settings-scheduled-backup-status > div').length === 1
        && document.querySelector('.settings-scheduled-backup-status dt')?.textContent?.trim() === '下次执行'
    `);

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
      "Scheduled backup dialog overflowed at 390px",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const scheduledDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) =>
            dialog.querySelector('.qp-dialog-title')?.textContent?.includes('定时备份')
          );
          const badge = scheduledDialog?.querySelector('.qp-badge-beta');
          const toggle = scheduledDialog?.querySelector('[role="switch"]');
          if (!badge || !toggle) return false;
          return badge.getBoundingClientRect().right <= toggle.getBoundingClientRect().left;
        })()
      `),
      true,
      "The scheduled backup BETA badge collided with the toggle at 390px",
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
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 1");
    assert.equal(
      await evaluate(client!, sessionId, "document.activeElement?.classList.contains('settings-backup-schedule-action')"),
      true,
      "Closing the scheduled backup dialog did not restore focus to its icon trigger",
    );
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("settings backup dialog opens WebDAV scheduling without a fake editable path", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll('.qp-action-row button'))
            .find((node) => node.textContent?.trim() === "备份" && !node.disabled);
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("选择备份位置")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const triggers = document.querySelectorAll('button.settings-backup-schedule-action[aria-label="定时备份"]');
          if (triggers.length !== 2) return false;
          triggers[1].focus();
          triggers[1].click();
          return true;
        })()
      `),
      true,
      "The WebDAV target did not expose the same secondary scheduling action",
    );
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 2");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const value = document.querySelector('.settings-scheduled-backup-directory-value');
          return value?.tagName === 'SPAN'
            && Boolean(value.querySelector('svg'))
            && value.textContent?.trim() === 'https://dav.jianguoyun.com/dav/Patina'
            && !document.querySelector('.settings-scheduled-backup-directory-field input')
            && !document.body.innerText.includes('更改目录');
        })()
      `),
      true,
      "The WebDAV scheduling target was not a complete, read-only HTTPS location",
    );
    await evaluate(client!, sessionId, `
      (() => {
        const toggle = document.querySelector('[role="switch"][aria-label="定时备份"]');
        if (toggle?.getAttribute("aria-checked") !== "true") toggle?.click();
      })()
    `);
    await waitForExpression(client!, sessionId, `
      (() => {
        const save = Array.from(document.querySelectorAll('[role="dialog"] button'))
          .find((node) => node.textContent?.trim() === "保存");
        return Boolean(save && !save.disabled);
      })()
    `);
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[role="dialog"] button'))
        .find((node) => node.textContent?.trim() === "保存")?.click()
    `);
    await waitForExpression(client!, sessionId, `
      globalThis.__PATINA_INVOKED_COMMANDS.some((entry) =>
        entry.command === "cmd_save_scheduled_backup_config"
        && entry.payload?.input?.enabled === true
        && entry.payload?.input?.target?.kind === "webdav"
        && !("targetDir" in entry.payload.input.target)
      )
    `);
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 1");
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("settings local scheduling keeps its first-install default after WebDAV becomes active", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll('.qp-action-row button'))
            .find((node) => node.textContent?.trim() === "备份" && !node.disabled);
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("选择备份位置")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('button.settings-backup-schedule-action[aria-label="定时备份"]');
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 2");
    assert.equal(
      await evaluate(client!, sessionId, `
        document.querySelector('.settings-scheduled-backup-directory-value > span')?.textContent
      `),
      "C:\\Smoke\\Patina\\backups",
      "The local scheduling dialog lost the authoritative first-install backup directory",
    );
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 1");
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("settings data export explains four formats before six field groups", async () => {
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll('.qp-action-row button'))
          .map((node) => node.textContent?.trim())
          .filter((label) => label === "导出" || label === "导入")
      `),
      ["导出", "导入"],
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

  await runTest("settings scheduled export captures the outer format and fields without changing the primary dialog", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "导出");
          trigger?.scrollIntoView({ block: "center" });
          trigger?.click();
          return Boolean(trigger);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.settings-data-export-dialog-surface'))");
    const primaryWidth = Number(await evaluate(
      client!,
      sessionId,
      "document.querySelector('.settings-data-export-dialog-surface')?.getBoundingClientRect().width ?? 0",
    ));
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.settings-data-export-dialog-surface [aria-label="定时导出"]');
          trigger?.focus();
          trigger?.click();
          return Boolean(trigger);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 2");
    assert.equal(
      Number(await evaluate(
        client!,
        sessionId,
        "document.querySelector('.settings-data-export-dialog-surface')?.getBoundingClientRect().width ?? 0",
      )),
      primaryWidth,
      "Opening scheduled export changed the primary export dialog width",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('.settings-scheduled-export-dialog');
          const controls = Array.from(dialog?.querySelector('.settings-scheduled-export-schedule')?.children ?? []);
          const tops = controls.map((node) => Math.round(node.getBoundingClientRect().top));
          const path = dialog?.querySelector('.settings-scheduled-export-directory-value');
          return Boolean(dialog)
            && !dialog.querySelector('.qp-dialog-close-button')
            && !dialog.innerText.includes('导出格式')
            && !dialog.innerText.includes('配置字段')
            && !document.body.innerText.includes('加载中...')
            && controls.length === 2
            && Math.max(...tops) - Math.min(...tops) <= 1
            && path?.tagName === 'SPAN'
            && Boolean(path.querySelector('svg'))
            && !path.hasAttribute('title')
            && !dialog.querySelector('.settings-scheduled-export-directory input');
        })()
      `),
      true,
      "Scheduled export did not preserve the approved compact secondary-dialog structure",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const badge = document.querySelector('.settings-scheduled-export-dialog .qp-badge');
          const title = document.querySelector('.settings-scheduled-export-dialog .qp-dialog-title');
          if (!badge || !title) return false;
          const badgeRect = badge.getBoundingClientRect();
          const titleRect = title.getBoundingClientRect();
          return badge.classList.contains('qp-badge-regular')
            && badgeRect.height >= titleRect.height * 0.6;
        })()
      `),
      true,
      "Scheduled export BETA badge did not adapt to the dialog title",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('.settings-scheduled-export-dialog');
          const schedule = dialog?.querySelector('.settings-scheduled-export-schedule');
          const scheduleButtons = Array.from(schedule?.querySelectorAll('button') ?? []);
          const changeDirectory = Array.from(dialog?.querySelectorAll('button') ?? [])
            .find((node) => node.textContent?.trim() === '更改目录');
          return schedule?.getAttribute('aria-disabled') === 'true'
            && scheduleButtons.length === 2
            && scheduleButtons.every((button) => button.disabled)
            && changeDirectory?.disabled === true;
        })()
      `),
      true,
      "Disabled scheduled export controls did not match the scheduled backup disabled state",
    );
    await evaluate(client!, sessionId, `
      document.querySelector('.settings-scheduled-export-dialog [role="switch"]')?.click();
    `);
    await waitForExpression(
      client!,
      sessionId,
      "document.querySelector('.settings-scheduled-export-dialog [role=\"switch\"]')?.getAttribute('aria-checked') === 'true'",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('.settings-scheduled-export-dialog');
          const schedule = dialog?.querySelector('.settings-scheduled-export-schedule');
          const scheduleButtons = Array.from(schedule?.querySelectorAll('button') ?? []);
          const changeDirectory = Array.from(dialog?.querySelectorAll('button') ?? [])
            .find((node) => node.textContent?.trim() === '更改目录');
          return schedule?.getAttribute('aria-disabled') === 'false'
            && scheduleButtons.every((button) => !button.disabled)
            && changeDirectory?.disabled === false;
        })()
      `),
      true,
      "Enabled scheduled export controls remained disabled",
    );
    await evaluate(client!, sessionId, `
      document.querySelector('.settings-scheduled-export-dialog [aria-label^="频率:"]')?.click();
    `);
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('[role=\"option\"]'))");
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[role="option"]'))
        .find((node) => node.textContent?.trim() === '每周')
        ?.click();
    `);
    await waitForExpression(
      client!,
      sessionId,
      "document.querySelector('.settings-scheduled-export-schedule')?.children.length === 3",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const controls = Array.from(document.querySelector('.settings-scheduled-export-schedule')?.children ?? []);
          const tops = controls.map((node) => Math.round(node.getBoundingClientRect().top));
          return controls.length === 3 && Math.max(...tops) - Math.min(...tops) <= 1;
        })()
      `),
      true,
      "Weekly scheduled export controls did not stay on one row",
    );
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('.settings-scheduled-export-dialog button'))
        .find((node) => node.textContent?.trim() === '保存')
        ?.click();
    `);
    await waitForExpression(client!, sessionId, `
      globalThis.__PATINA_INVOKED_COMMANDS.some((entry) =>
        entry.command === 'cmd_save_scheduled_export_config'
        && entry.payload.input.enabled === true
        && entry.payload.input.cadence === 'weekly'
        && entry.payload.input.weekday === 1
        && entry.payload.input.format === 'csv'
        && entry.payload.input.selectedFields.length === 12
      )
    `);
    await waitForExpression(client!, sessionId, "document.querySelectorAll('.settings-scheduled-export-status > div').length === 1");

    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitForExpression(client!, sessionId, "document.querySelectorAll('[role=\"dialog\"]').length === 1");
    await waitForExpression(
      client!,
      sessionId,
      "document.activeElement?.getAttribute('aria-label') === '定时导出'",
      undefined,
      "Closing scheduled export did not restore focus to its icon trigger",
    );
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("settings generic import previews only available granularity and deletes by batch", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "导入");
          trigger?.scrollIntoView({ block: "center" });
          trigger?.click();
          return Boolean(trigger);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.settings-import-action-list') !== null`);
    assert.deepEqual(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-import-action-title')).map((node) => node.textContent)`),
      ["导入 CSV", "解构工具"],
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('[aria-label="删除外部导入数据"]'))`),
      false,
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, "document.documentElement.scrollWidth <= window.innerWidth + 1"),
      true,
      "Settings import action dialog overflowed at 390px",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const rows = Array.from(document.querySelectorAll('.settings-import-action-list > .qp-action-row'));
          if (rows.length !== 2) return false;
          return rows[1].getBoundingClientRect().top > rows[0].getBoundingClientRect().bottom;
        })()
      `),
      true,
      "Settings import actions did not stack at 390px",
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="导入 CSV"]')?.click()`);
    await waitForExpression(client!, sessionId, `document.querySelector('.settings-import-preview') !== null`);
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.settings-import-preview')?.innerText.includes("小时汇总")`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.settings-import-preview')?.innerText.includes("精确记录")`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-import-preview-detail-group > div')).some((node) => node.querySelector('dt')?.textContent === '含分类应用：' && node.querySelector('dd')?.textContent === '1')`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-import-preview-detail-group > div')).some((node) => node.querySelector('dt')?.textContent === '分类冲突应用：' && node.querySelector('dd')?.textContent === '1')`),
      true,
    );
    await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-dialog-actions button')).find((node) => node.textContent?.trim() === "导入")?.click()`);
    await waitForExpression(client!, sessionId, `document.querySelector('.settings-import-action-list') !== null && Boolean(document.querySelector('[aria-label="删除外部导入数据"]'))`);
    assert.equal(
      await evaluate(client!, sessionId, `globalThis.__PATINA_LAST_IMPORT_PAYLOAD?.classificationMutations?.length > 0`),
      true,
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="删除外部导入数据"]')?.click()`);
    await waitForExpression(client!, sessionId, `document.querySelector('.settings-import-batch-list')?.innerText.includes("第 1 次导入")`);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="删除第 1 次导入"]')?.click()`);
    await waitForExpression(client!, sessionId, `Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.innerText.includes("删除这次导入？"))`);
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[role="dialog"] .qp-button-danger'))
        .find((node) => node.textContent?.trim() === "删除")?.click()
    `);
    await waitForExpression(client!, sessionId, `document.querySelector('.settings-import-action-list') !== null`);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('[aria-label="删除外部导入数据"]'))`),
      false,
    );
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitForExpression(client!, sessionId, `!document.querySelector('[role="dialog"]')`);
  });
}
