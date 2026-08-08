import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import {
  evaluate,
  jsonString,
  waitFor,
  waitForAnimationFrames,
  waitForExpression,
} from "./browserHarness.ts";

export async function runDashboardScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("dashboard viewport has no horizontal overflow", async () => {
    for (const width of [900, 1100, 1280]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".dashboard-pulse-card"))`);
      await waitForExpression(client!, sessionId, `
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      `);
    }
  });

  await runTest("dashboard focus donut keeps a restrained ring weight", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const ring = document.querySelector(
            '.dashboard-focus-chart svg[aria-label="专注分布"] circle',
          );
          if (!(ring instanceof SVGCircleElement)) return false;
          const radius = Number(ring.getAttribute("r"));
          const strokeWidth = Number(ring.getAttribute("stroke-width"));
          const innerRadius = radius - strokeWidth / 2;
          return strokeWidth === 16 && innerRadius >= radius * 0.8;
        })()
      `),
      true,
      "focus donut should keep a generous center opening",
    );
  });

  await runTest("dashboard hourly chart toggles category layers", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".dashboard-pulse-card");
          const icon = document.querySelector(".dashboard-pulse-mode-toggle svg");
          if (!card || !icon) return false;
          const cardRect = card.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          const contentRight = cardRect.right - parseFloat(getComputedStyle(card).paddingRight);
          return Math.abs(contentRight - iconRect.right) <= 1;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const bars = Array.from(document.querySelectorAll(
            '.dashboard-pulse-chart [data-hourly-activity-chart-mode="total"] .qp-hourly-chart-bar',
          )).filter((bar) => bar.getBoundingClientRect().height > 0);
          return bars.length > 0 && bars.every((bar) => {
            if (!(bar instanceof SVGPathElement)) return false;
            const tokens = (bar.getAttribute("d") ?? "").trim().split(/\\s+/);
            const firstBaseline = Number(tokens[2]);
            const finalBaseline = Number(tokens.at(-2));
            return Number.isFinite(firstBaseline)
              && Math.abs(firstBaseline - finalBaseline) <= 0.001;
          });
        })()
      `),
      true,
      "total hourly bars should round only their top corners and keep a flat baseline",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle || toggle.getAttribute("aria-pressed") !== "false") return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "显示总活动",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
        ?.getAttribute("data-hourly-activity-chart-mode") === "category"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll(".dashboard-pulse-chart svg g"))
          .filter((group) => group.querySelector(".qp-hourly-chart-bar"))
          .every((group) => {
            const segments = Array.from(group.querySelectorAll(".qp-hourly-chart-bar"));
            return segments.at(-1) instanceof SVGPathElement
              && segments.slice(0, -1).every((segment) =>
                segment instanceof SVGRectElement
                && Number(segment.getAttribute("rx") ?? 0) === 0
              );
          })
      `),
      true,
      "stacked hourly bars should round only the outer top edge",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
          ?.getAttribute("data-hourly-activity-chart-mode")`,
      ),
      "category",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "按分类显示",
    );
    await waitForAnimationFrames(client!, sessionId, 4);
    const readBarPoint = () => evaluate(client!, sessionId, `
      (() => {
        const bar = Array.from(document.querySelectorAll(".dashboard-pulse-chart .qp-hourly-chart-bar"))
          .find((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!bar) return null;
        const rect = bar.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 2) };
      })()
    `) as Promise<{ x: number; y: number } | null>;
    const barPoint = await readBarPoint();
    assert.ok(barPoint);
    await waitFor(
      "contained hourly chart tooltip",
      async () => {
        const visible = await evaluate(
          client!,
          sessionId,
          `Boolean(document.querySelector('.dashboard-pulse-chart .qp-chart-tooltip[role="tooltip"]'))`,
        );
        if (visible) return true;

        const currentBarPoint = await readBarPoint();
        if (!currentBarPoint) return null;
        await client!.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 1,
          y: 1,
        }, sessionId);
        await client!.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: currentBarPoint.x,
          y: currentBarPoint.y,
        }, sessionId);
        return null;
      },
    );
    const hourlyTooltipGeometry = await evaluate(client!, sessionId, `
      (() => {
        const chart = document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]");
        const tooltip = chart?.querySelector('.qp-chart-tooltip[role="tooltip"]');
        if (!(chart instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) return null;
        const chartRect = chart.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const axisTop = Math.min(
          ...Array.from(chart.querySelectorAll("svg text"))
            .map((node) => node.getBoundingClientRect().top),
        );
        const barBaseline = Math.max(
          ...Array.from(chart.querySelectorAll(".qp-hourly-chart-bar"))
            .map((node) => node.getBoundingClientRect().bottom),
        );
        return {
          axisTop,
          barBaseline,
          chartBottom: chartRect.bottom,
          chartTop: chartRect.top,
          left: tooltipRect.left,
          right: tooltipRect.right,
          tooltipBottom: tooltipRect.bottom,
          tooltipTop: tooltipRect.top,
        };
      })()
    `) as {
      axisTop: number;
      barBaseline: number;
      chartBottom: number;
      chartTop: number;
      left: number;
      right: number;
      tooltipBottom: number;
      tooltipTop: number;
    } | null;
    assert.ok(hourlyTooltipGeometry);
    assert.equal(
      hourlyTooltipGeometry.left >= barPoint.x + 8
        || hourlyTooltipGeometry.right <= barPoint.x - 8,
      true,
      "hourly tooltip should stay beside the active bar instead of covering it",
    );
    assert.equal(
      hourlyTooltipGeometry.tooltipTop >= hourlyTooltipGeometry.chartTop - 0.5
        && hourlyTooltipGeometry.tooltipBottom <= hourlyTooltipGeometry.chartBottom + 0.5,
      true,
      "hourly tooltip should stay within the chart container",
    );
    assert.equal(
      hourlyTooltipGeometry.tooltipBottom <= hourlyTooltipGeometry.axisTop - 4,
      true,
      "hourly tooltip should stop above the time-axis labels",
    );
    assert.ok(
      Math.abs(hourlyTooltipGeometry.tooltipBottom - hourlyTooltipGeometry.barBaseline) <= 0.5,
      "hourly tooltip bottom should align with the bar baseline",
    );
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector('.dashboard-pulse-chart .qp-chart-tooltip[role="tooltip"]')`,
    );
  });

  await runTest("dashboard hourly chart supports keyboard toggle and keeps category mode across views", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.focus();
          return document.activeElement === toggle;
        })()
      `),
      true,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: " ",
      code: "Space",
      text: " ",
      unmodifiedText: " ",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
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
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
  });

  await runTest("dashboard application icon opens shared detail without changing single-click behavior", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const navigation = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!navigation) return false;
          navigation.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".dashboard-top-app-detail-trigger"))`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!trigger) return false;
          trigger.click();
          return !document.querySelector(".destination-detail-dialog");
        })()
      `),
      true,
      "a normal click should remain inert",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!trigger) return false;
          trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const content = document.querySelector(
          ".destination-detail-dialog .destination-detail-day-content",
        );
        if (!content) return false;
        const now = new Date();
        const todayKey = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        return content.getAttribute("data-destination-detail-requested-date") === todayKey;
      })()`,
    );
    await evaluate(
      client!,
      sessionId,
      `document.querySelector('.destination-detail-dialog [aria-label="关闭详情"]')?.click()`,
    );
    await waitForExpression(client!, sessionId, `!document.querySelector(".destination-detail-dialog")`);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!trigger) return false;
          trigger.focus();
          trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          return document.activeElement === trigger;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))`,
    );
    await evaluate(
      client!,
      sessionId,
      `document.querySelector('.destination-detail-dialog [aria-label="关闭详情"]')?.click()`,
    );
    await waitForExpression(client!, sessionId, `!document.querySelector(".destination-detail-dialog")`);
  });

  await runTest("dashboard app icon supports quick rename and category context actions", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".dashboard-top-app-detail-trigger"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!(trigger instanceof HTMLElement)) return false;
          const rect = trigger.getBoundingClientRect();
          trigger.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }));
          return !trigger.hasAttribute("title");
        })()
      `),
      true,
      "the icon must not rely on a native title tooltip",
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const menu = document.querySelector('.quick-classification-menu[role="menu"]');
          if (!(menu instanceof HTMLElement)) return false;
          const rect = menu.getBoundingClientRect();
          const items = Array.from(menu.querySelectorAll(':scope > .quick-classification-menu-item'));
          return rect.width <= 149
            && rect.height <= 66
            && menu.querySelector(':scope > .quick-classification-menu-item svg') === null
            && items.every((item) => item.getBoundingClientRect().height <= 29);
        })()
      `),
      true,
      "quick actions should use compact desktop-menu density",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll('.quick-classification-menu[role="menu"] > .quick-classification-menu-item'))
          .map((item) => item.textContent?.trim())
      `),
      ["更改名称", "更改分类"],
    );

    await evaluate(client!, sessionId, `
      (() => {
        const trigger = Array.from(document.querySelectorAll('.quick-classification-menu-item'))
          .find((item) => item.textContent?.includes("更改分类"));
        trigger?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      })()
    `);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`),
      false,
      "hovering the category action must not open the submenu",
    );

    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('.quick-classification-menu-item'))
        .find((item) => item.textContent?.includes("更改分类"))?.click()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const menu = document.querySelector('.quick-classification-category-menu');
          if (!(menu instanceof HTMLElement)) return false;
          const rect = menu.getBoundingClientRect();
          const firstItemRect = menu.querySelector('.quick-classification-menu-item')?.getBoundingClientRect();
          return rect.left >= 11 && rect.top >= 11
            && rect.right <= window.innerWidth - 11
            && rect.bottom <= window.innerHeight - 11
            && rect.width <= 185
            && rect.height <= 273
            && Boolean(firstItemRect && firstItemRect.height <= 29);
        })()
      `),
      true,
      "the category submenu should remain inside the viewport",
    );
    const categoryMenuCenter = await evaluate(client!, sessionId, `
      (() => {
        const menu = document.querySelector('.quick-classification-category-menu');
        if (!(menu instanceof HTMLElement)) return null;
        const rect = menu.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          canScroll: menu.scrollHeight > menu.clientHeight,
        };
      })()
    `) as { x: number; y: number; canScroll: boolean } | null;
    assert.equal(categoryMenuCenter?.canScroll, true, "the category submenu fixture should overflow");
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: categoryMenuCenter!.x,
      y: categoryMenuCenter!.y,
      deltaX: 0,
      deltaY: 180,
    }, sessionId);
    await waitForExpression(client!, sessionId, `
      (() => {
        const menu = document.querySelector('.quick-classification-category-menu');
        return menu instanceof HTMLElement && menu.scrollTop > 0;
      })()
    `);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`),
      true,
      "wheel-scrolling the category submenu must not close it",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const options = Array.from(document.querySelectorAll('.quick-classification-category-menu [role="menuitemradio"]'));
          const unclassified = options.find((item) => item.textContent?.includes("未分类"));
          if (!(unclassified instanceof HTMLElement)) return false;
          unclassified.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `
      Boolean(document.querySelector('.dashboard-top-app-name-row .qp-badge')?.textContent?.includes("未分类"))
    `);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('.dashboard-top-app-meta .qp-badge'))`),
      false,
      "the unclassified badge belongs beside the app name, not in the share row",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const badge = document.querySelector('.dashboard-top-app-name-row .qp-badge');
          const nameRow = document.querySelector('.dashboard-top-app-name-row');
          const duration = document.querySelector('.dashboard-top-app-duration');
          if (
            !(badge instanceof HTMLElement)
            || !(nameRow instanceof HTMLElement)
            || !(duration instanceof HTMLElement)
          ) return false;
          const badgeRect = badge.getBoundingClientRect();
          const nameRowRect = nameRow.getBoundingClientRect();
          const durationRect = duration.getBoundingClientRect();
          const badgeStyle = getComputedStyle(badge);
          return badge.classList.contains('qp-badge-regular')
            && badge.classList.contains('qp-badge-neutral')
            && Math.abs(nameRowRect.height - badgeRect.height) <= 2
            && badgeStyle.fontSize === '11px'
            && badgeStyle.fontWeight === '500'
            && badgeRect.right + 8 <= durationRect.left;
        })()
      `),
      true,
      "the badge should match the app-name line height without crowding duration",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS?.some((mutation) =>
          mutation.key === "__app_override::cursor.exe" && mutation.value === null
        ) ?? false
      `),
      true,
      "choosing unclassified should clear only the manual category",
    );

    await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
        if (!(trigger instanceof HTMLElement)) return false;
        const rect = trigger.getBoundingClientRect();
        trigger.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        return true;
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll('.quick-classification-menu[role="menu"] > .quick-classification-menu-item'))
          .map((item) => item.textContent?.trim())
      `),
      ["更改名称", "设置分类"],
      "clearing the category should switch the action back to set category",
    );
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('.quick-classification-menu-item'))
        .find((item) => item.textContent?.includes("更改名称"))?.click()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('#quick-classification-rename-form'))`);
    await waitForExpression(client!, sessionId, `document.activeElement?.matches('.quick-classification-rename-input')`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('.quick-classification-rename-dialog');
          const input = document.querySelector('.quick-classification-rename-input');
          if (!(dialog instanceof HTMLElement) || !(input instanceof HTMLElement)) return false;
          const dialogRect = dialog.getBoundingClientRect();
          const inputRect = input.getBoundingClientRect();
          return dialogRect.width <= 421 && inputRect.height <= 39;
        })()
      `),
      true,
      "quick rename should use compact task-dialog proportions",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const input = document.querySelector('.quick-classification-rename-input');
          if (!(input instanceof HTMLInputElement)) return false;
          const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          valueSetter?.call(input, "Smoke Alias");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return document.activeElement === input;
        })()
      `),
      true,
      "rename dialog should focus its input without a native hover surface",
    );
    await evaluate(client!, sessionId, `
      document.querySelector('#quick-classification-rename-form')?.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      )
    `);
    await waitForExpression(client!, sessionId, `
      (() => {
        const settings = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
        const raw = settings["__app_override::cursor.exe"];
        return raw ? JSON.parse(raw).displayName === "Smoke Alias" : false;
      })()
    `);
    await waitForExpression(client!, sessionId, `
      Array.from(document.querySelectorAll('.dashboard-top-app-detail-trigger + div span'))
        .some((node) => node.textContent?.trim() === "Smoke Alias")
    `);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!(trigger instanceof HTMLElement)) return false;
          trigger.focus();
          trigger.dispatchEvent(new KeyboardEvent("keydown", {
            key: "F10",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    await evaluate(client!, sessionId, `
      document.querySelector('.quick-classification-menu[role="menu"]')?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      )
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
    await waitForExpression(client!, sessionId, `document.activeElement?.matches('.dashboard-top-app-detail-trigger')`);

    await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
        return true;
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    await evaluate(client!, sessionId, `
      document.querySelector('.dashboard-top-apps-list')?.dispatchEvent(new Event("scroll", { bubbles: false }))
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);

    await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
        return true;
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    await waitForExpression(client!, sessionId, `document.activeElement?.matches('.quick-classification-menu-item')`);
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      )
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
    await waitForExpression(client!, sessionId, `
      document.activeElement?.matches('.dashboard-top-app-detail-trigger')
        && document.activeElement !== document.querySelector('.dashboard-top-app-detail-trigger')
    `);
  });
}
