import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runClassificationScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;
  const pressArrowDown = async () => {
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
    }, sessionId);
  };

  await runTest("classification cold navigation never renders page loading copy", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          localStorage.setItem("__time_tracker_classification_query_delay_ms", "900");
          location.reload();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']'))`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const samples = [];
          const record = () => {
            const state = document.querySelector("[data-classification-content-state]")
              ?.getAttribute("data-classification-content-state") ?? null;
            const showsLoadingCopy = document.body.innerText.includes("加载中...");
            const key = JSON.stringify({ state, showsLoadingCopy });
            if (samples.at(-1) !== key) samples.push(key);
          };
          const observer = new MutationObserver(record);
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          const timer = window.setInterval(record, 1);
          globalThis.__TIME_TRACKER_STOP_CLASSIFICATION_LOADING_SAMPLING = () => {
            window.clearInterval(timer);
            observer.disconnect();
            record();
            return samples;
          };
          const navigation = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']');
          navigation?.click();
          return Boolean(navigation);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-classification-content-state="cold"]'))`,
      undefined,
      "Classification should expose its stable cold frame",
    );
    await delay(150);

    const samples = await evaluate(
      client!,
      sessionId,
      `globalThis.__TIME_TRACKER_STOP_CLASSIFICATION_LOADING_SAMPLING()`,
    ) as string[];
    assert.ok(samples.length >= 1, "expected classification first-frame samples");
    assert.equal(
      samples.some((sample) => JSON.parse(sample).showsLoadingCopy === true),
      false,
      JSON.stringify(samples),
    );

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[data-classification-content-state]')?.getAttribute('data-classification-content-state') === 'ready'`,
      15_000,
      "Classification cold bootstrap should settle",
    );
    const searchFieldStyle = await evaluate(client!, sessionId, `
      (() => {
        const field = document.querySelector('.qp-search-field');
        const input = field?.querySelector('input');
        if (!field || !input) return null;
        return {
          height: field.getBoundingClientRect().height,
          radius: getComputedStyle(field).borderRadius,
          fontSize: getComputedStyle(input).fontSize,
          fontWeight: getComputedStyle(input).fontWeight,
        };
      })()
    `) as { height: number; radius: string; fontSize: string; fontWeight: string } | null;
    assert.ok(searchFieldStyle, "Classification should expose the Quiet Pro search field");
    assert.equal(searchFieldStyle.height, 34);
    assert.equal(searchFieldStyle.radius, "10px");
    assert.equal(searchFieldStyle.fontSize, "12px");
    assert.equal(searchFieldStyle.fontWeight, "600");
    await evaluate(
      client!,
      sessionId,
      `localStorage.removeItem("__time_tracker_classification_query_delay_ms")`,
    );
  });

  await runTest("classification cold start preserves unknown upgrade settings", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const storageKey = "__time_tracker_smoke_settings";
          const unknownKey = "__deleted_category::future-category";
          const settings = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
          settings[unknownKey] = "legacy-marker";
          localStorage.setItem(storageKey, JSON.stringify(settings));
          location.reload();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']'))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const storageKey = "__time_tracker_smoke_settings";
          const unknownKey = "__deleted_category::future-category";
          const settings = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
          const mutations = globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS ?? [];
          return settings[unknownKey] === "legacy-marker"
            && !mutations.some((mutation) => mutation.key === unknownKey && mutation.value === null);
        })()
      `),
      true,
    );
  });

  await runTest("icon theme colors survive a rebuilt main WebView without category-color fallback", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const navigation = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          navigation?.click();
          return Boolean(navigation);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `
      (() => {
        const shadows = Array.from(document.querySelectorAll('[style*="box-shadow"]'))
          .map((node) => node.style.boxShadow);
        return shadows.some((value) => value.includes('227, 74, 58'))
          && shadows.some((value) => value.includes('37, 127, 98'));
      })()
    `, undefined, "Dashboard icon theme colors should be warmed");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          location.reload();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']'))`,
      15_000,
      "Rebuilt main WebView should become interactive",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const samples = [];
          let last = "";
          const sample = () => {
            const values = Array.from(document.querySelectorAll('.qp-color-trigger-value'))
              .map((node) => node.textContent?.trim() ?? '')
              .filter(Boolean);
            const key = JSON.stringify(values);
            if (values.length > 0 && key !== last) {
              last = key;
              samples.push(values);
            }
          };
          const observer = new MutationObserver(sample);
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          const timer = window.setInterval(sample, 1);
          globalThis.__TIME_TRACKER_STOP_COLOR_SAMPLING = () => {
            window.clearInterval(timer);
            observer.disconnect();
            sample();
            return samples;
          };
          const navigation = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']');
          navigation?.click();
          return Boolean(navigation);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `
      (() => {
        const values = Array.from(document.querySelectorAll('.qp-color-trigger-value'))
          .map((node) => node.textContent?.trim() ?? '');
        return values.includes('#E34A3A') && values.includes('#257F62');
      })()
    `, undefined, "Classification should synchronously reuse icon theme colors");
    await delay(100);

    const samples = await evaluate(
      client!,
      sessionId,
      `globalThis.__TIME_TRACKER_STOP_COLOR_SAMPLING()`,
    ) as string[][];
    assert.ok(samples.length >= 1, "expected at least one classification color sample");
    for (const sample of samples) {
      assert.ok(sample.includes("#E34A3A"), JSON.stringify(samples));
      assert.ok(sample.includes("#257F62"), JSON.stringify(samples));
      assert.equal(sample.includes("#4790CF"), false, JSON.stringify(samples));
      assert.equal(sample.includes("#6F7AE6"), false, JSON.stringify(samples));
    }
  });

  await runTest("app mapping only offers explicit manual categories", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-select-trigger"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const triggers = Array.from(document.querySelectorAll('.qp-select-trigger'));
          return triggers.length > 0
            && triggers.every((trigger) => {
              const label = trigger.getAttribute('aria-label');
              const selectedValue = trigger.textContent?.trim();
              return Boolean(label?.includes(' 的分类: ') && selectedValue && label.endsWith(selectedValue));
            });
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        !document.body.innerText.includes("自动识别")
          && !document.body.innerText.includes("恢复默认识别")
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-color-trigger');
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
      "missing color field trigger",
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-color-popover'))");
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-color-popover-title')`,
      undefined,
      "color dialog should focus its heading",
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length`),
      0,
      "color dialog should not reveal a tooltip on open",
    );
    const originalColor = String(await evaluate(
      client!,
      sessionId,
      `document.querySelector('.qp-color-trigger-value')?.textContent?.trim() ?? ''`,
    ));
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const tabs = Array.from(document.querySelectorAll('.qp-color-format-switch [role="tab"]'));
          const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
          const formatRect = document.querySelector('.qp-color-format-switch')?.getBoundingClientRect();
          const hue = document.querySelector('.qp-color-hue-slider');
          const hueRect = hue?.getBoundingClientRect();
          return {
            tabCount: tabs.filter((tab) => tab.getAttribute('role') === 'tab').length,
            selectedLabel: selected?.textContent?.trim() ?? null,
            selectedTabStopCount: tabs.filter((tab) => tab.tabIndex === 0).length,
            panelLabelledBy: document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby') ?? null,
            hueRange: hue instanceof HTMLInputElement ? [hue.min, hue.max, hue.step] : null,
            controlsShareRow: Boolean(
              formatRect
              && hueRect
              && Math.abs(
                (formatRect.top + formatRect.height / 2)
                - (hueRect.top + hueRect.height / 2)
              ) < 3
              && formatRect.right < hueRect.left
            ),
          };
        })()
      `),
      {
        tabCount: 3,
        selectedLabel: "HEX",
        selectedTabStopCount: 1,
        panelLabelledBy: await evaluate(client!, sessionId, `document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null`),
        hueRange: ["0", "359", "1"],
        controlsShareRow: true,
      },
    );
    await evaluate(client!, sessionId, `
      (() => {
        const hue = document.querySelector('.qp-color-hue-slider');
        if (!(hue instanceof HTMLInputElement)) return;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(hue, '120');
        hue.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await waitForExpression(client!, sessionId, `document.querySelector('.qp-color-hue-slider')?.value === '120'`);
    await evaluate(client!, sessionId, `
      (() => {
        const area = document.querySelector('.qp-color-sv-area');
        if (!(area instanceof HTMLElement)) return;
        const rect = area.getBoundingClientRect();
        area.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: rect.right - 1,
          clientY: rect.top + rect.height / 2,
        }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      })()
    `);
    await waitForExpression(client!, sessionId, `document.querySelector('.qp-color-trigger-value')?.textContent?.trim() === '#00FF00'`);
    await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="十六进制颜色值"]');
        if (!(input instanceof HTMLInputElement)) return;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(input, ${jsonString(originalColor)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('.qp-color-trigger-value')?.textContent?.trim() === ${jsonString(originalColor)}`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const selected = document.querySelector('[role="tab"][aria-selected="true"]');
        selected?.focus();
        selected?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      })()
    `);
    await waitForExpression(client!, sessionId, `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() === 'RGB'`);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('input[aria-label="红色通道"]'))`),
      true,
    );
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-color-popover')`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-color-trigger')`,
      undefined,
      "color trigger focus restoration",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".qp-select-trigger");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-select-menu"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const labels = Array.from(document.querySelectorAll(".qp-select-option"))
            .map((node) => node.textContent?.trim());
          const options = Array.from(document.querySelectorAll('.qp-select-option[role="option"]'));
          return labels.at(-1) === "未分类"
            && !labels.includes("自动识别")
            && options.every((option) => !option.querySelector('button, input, select, textarea'));
        })()
      `),
      true,
    );
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector(".qp-select-menu")`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-select-trigger')`,
      undefined,
      "select trigger should regain focus before reopening",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-select-trigger');
          if (!trigger) return false;
          trigger.focus();
          return true;
        })()
      `),
      true,
    );
    await pressArrowDown();
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('.qp-select-menu'))`,
      undefined,
      "select should open from ArrowDown",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-select-menu')`,
      undefined,
      "select menu should receive focus after ArrowDown",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const listbox = document.querySelector('.qp-select-menu[role="listbox"]');
          const activeId = listbox?.getAttribute('aria-activedescendant');
          return Boolean(activeId && document.getElementById(activeId)?.getAttribute('role') === 'option');
        })()
      `),
      true,
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `
      (() => {
        const listbox = document.querySelector('.qp-select-menu[role="listbox"]');
        const activeId = listbox?.getAttribute('aria-activedescendant');
        return document.getElementById(activeId ?? '')?.textContent?.trim() === '未分类';
      })()
    `);
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `
      (() => {
        const listbox = document.querySelector('.qp-select-menu[role="listbox"]');
        const activeId = listbox?.getAttribute('aria-activedescendant');
        return document.getElementById(activeId ?? '')?.textContent?.trim() !== '未分类';
      })()
    `);
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: '未', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `
      (() => {
        const listbox = document.querySelector('.qp-select-menu[role="listbox"]');
        const activeId = listbox?.getAttribute('aria-activedescendant');
        return document.getElementById(activeId ?? '')?.textContent?.trim() === '未分类';
      })()
    `);
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-select-menu')`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-select-trigger')`,
      undefined,
      "select trigger focus restoration",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-select-trigger');
          if (!(trigger instanceof HTMLElement)) return false;
          const controls = Array.from(document.querySelectorAll(
            "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
          )).filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
          const next = controls[controls.indexOf(trigger) + 1];
          if (!(next instanceof HTMLElement)) return false;
          next.dataset.selectTabTarget = 'true';
          trigger.focus();
          return true;
        })()
      `),
      true,
    );
    await pressArrowDown();
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-select-menu')`,
      undefined,
      "select menu should receive focus before Tab navigation",
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-select-menu')`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.dataset.selectTabTarget === 'true'`,
      undefined,
      "select Tab should continue from its trigger",
    );
    await evaluate(client!, sessionId, `
      document.querySelector('[data-select-tab-target="true"]')?.removeAttribute('data-select-tab-target');
    `);
    await evaluate(client!, sessionId, `
      (() => {
        const cancel = Array.from(document.querySelectorAll('button'))
          .find((button) => button.textContent?.trim() === '取消' && !button.disabled);
        cancel?.click();
      })()
    `);
    await waitForExpression(client!, sessionId, `
      !Array.from(document.querySelectorAll('button'))
        .some((button) => button.textContent?.trim() === '取消' && !button.disabled)
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
  });

  await runTest("category management dialog owns focus without opening a tooltip", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const navigation = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']');
          navigation?.click();
          return Boolean(navigation);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-select-trigger'))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll('button'))
            .find((button) => button.textContent?.trim() === '管理分类');
          trigger?.focus();
          trigger?.click();
          return Boolean(trigger);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-category-dialog-surface'))`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.matches('.qp-category-dialog-surface .qp-dialog-title')`,
      undefined,
      "category dialog should focus its heading",
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length`),
      0,
      "category dialog should not reveal a row tooltip on open",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const color = document.querySelector('.qp-category-dialog-surface .qp-color-trigger');
          color?.click();
          return Boolean(color);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-color-popover'))`);
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-color-popover')`);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.qp-category-dialog-surface'))`),
      true,
      "Escape should close only the nested color dialog",
    );
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-dialog-surface')`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.textContent?.trim() === '管理分类'`,
      undefined,
      "category dialog opener focus restoration",
    );
  });
}
