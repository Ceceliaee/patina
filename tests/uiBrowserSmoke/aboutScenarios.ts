import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runAboutScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("About page keeps its centered support layout", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true, "missing About navigation entry");

    await waitForExpression(
      client!,
      sessionId,
      "Boolean(document.querySelector('.about-center-panel .about-center-profile'))",
    );

    const layout = await evaluate(client!, sessionId, `
      (() => {
        const panel = document.querySelector('.about-center-panel');
        const profile = document.querySelector('.about-center-profile');
        const actions = Array.from(document.querySelectorAll('.about-pill-action'));
        const update = document.querySelector('.about-center-update.update-status-compact');
        if (!panel || !profile || actions.length !== 4 || !update) return null;

        const firstActionRect = actions[0].getBoundingClientRect();
        const actionRects = actions.map((action) => action.getBoundingClientRect());
        return {
          panelDisplay: getComputedStyle(panel).display,
          profileJustifyItems: getComputedStyle(profile).justifyItems,
          actionDisplay: getComputedStyle(actions[0]).display,
          actionMinHeight: parseFloat(getComputedStyle(actions[0]).minHeight),
          actionBorderRadius: getComputedStyle(actions[0]).borderRadius,
          actionsStayInOneRow: actionRects.every((rect) => Math.abs(rect.top - firstActionRect.top) < 2),
          updatePaddingTop: parseFloat(getComputedStyle(update).paddingTop),
        };
      })()
    `) as {
      panelDisplay: string;
      profileJustifyItems: string;
      actionDisplay: string;
      actionMinHeight: number;
      actionBorderRadius: string;
      actionsStayInOneRow: boolean;
      updatePaddingTop: number;
    } | null;

    assert.ok(layout, "About layout hooks should be present");
    assert.equal(layout.panelDisplay, "grid");
    assert.equal(layout.profileJustifyItems, "center");
    assert.equal(["flex", "inline-flex"].includes(layout.actionDisplay), true);
    assert.equal(layout.actionMinHeight, 30);
    assert.equal(layout.actionBorderRadius, "8px");
    assert.equal(layout.actionsStayInOneRow, true);
    assert.equal(layout.updatePaddingTop > 0, true);
  });

  await runTest("About sponsor dialog shows WeChat and Ko-fi support", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true, "missing About navigation entry");

    const sponsorOpened = await evaluate(client!, sessionId, `
      (() => {
        const sponsor = Array.from(document.querySelectorAll('button'))
          .find((node) => node.textContent?.trim() === ${jsonString("赞助项目")});
        if (!sponsor) return false;
        sponsor.click();
        return true;
      })()
    `);
    assert.equal(sponsorOpened, true, "missing sponsor button");

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[role="dialog"]')?.textContent?.includes(${jsonString("微信赞赏码")})`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        (() => {
          const dialog = document.querySelector('[role="dialog"]');
          const rewardImages = Array.from(dialog?.querySelectorAll('.about-wechat-reward-frame img') ?? []);
          const rewardImage = rewardImages.find((image) => getComputedStyle(image).display !== 'none');
          const kofiImage = dialog?.querySelector('.about-kofi-button img');
          return Boolean(
            rewardImage && rewardImage.naturalWidth > 0 && rewardImage.naturalHeight > 0
              && kofiImage && kofiImage.naturalWidth > 0 && kofiImage.naturalHeight > 0
          );
        })()
      `,
    );

    const supportDialog = await evaluate(client!, sessionId, `
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        const rewardImages = Array.from(dialog?.querySelectorAll('.about-wechat-reward-frame img') ?? []);
        const rewardImage = rewardImages.find((image) => getComputedStyle(image).display !== 'none');
        const kofi = dialog?.querySelector('button.about-kofi-button[aria-label=' + ${jsonString(JSON.stringify("打开 Ko-fi"))} + ']');
        const kofiImage = kofi?.querySelector('img');
        const cards = Array.from(dialog?.querySelectorAll('.about-support-card') ?? []);
        const cardRects = cards.map((card) => card.getBoundingClientRect());
        const close = dialog?.querySelector('button.about-support-dialog-close[aria-label=' + ${jsonString(JSON.stringify("关闭"))} + ']');
        const activeTheme = document.documentElement.dataset.theme ?? null;
        return {
          hasDialog: Boolean(dialog),
          imageLoaded: Boolean(rewardImage && rewardImage.naturalWidth > 0 && rewardImage.naturalHeight > 0),
          rewardTheme: rewardImage?.getAttribute('data-reward-theme') ?? null,
          activeTheme,
          hasKofiButton: Boolean(kofi),
          kofiImageLoaded: Boolean(kofiImage && kofiImage.naturalWidth > 0 && kofiImage.naturalHeight > 0),
          cardsAreStacked:
            cardRects.length === 2 && cardRects[1].top > cardRects[0].bottom,
          hasTopClose: Boolean(close),
        };
      })()
    `) as {
      hasDialog: boolean;
      imageLoaded: boolean;
      rewardTheme: string | null;
      activeTheme: string | null;
      hasKofiButton: boolean;
      kofiImageLoaded: boolean;
      cardsAreStacked: boolean;
      hasTopClose: boolean;
    };

    assert.equal(supportDialog.hasDialog, true);
    assert.equal(supportDialog.imageLoaded, true);
    assert.equal(supportDialog.rewardTheme, supportDialog.activeTheme);
    assert.equal(supportDialog.hasKofiButton, true);
    assert.equal(supportDialog.kofiImageLoaded, true);
    assert.equal(supportDialog.cardsAreStacked, true);
    assert.equal(supportDialog.hasTopClose, true);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('[role="dialog"]');
          const kofi = dialog?.querySelector('button.about-kofi-button[aria-label=' + ${jsonString(JSON.stringify("打开 Ko-fi"))} + ']');
          if (!kofi) return false;
          kofi.click();
          return true;
        })()
      `),
      true,
      "Ko-fi support action should be clickable",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const close = document.querySelector('[role="dialog"] button.about-support-dialog-close[aria-label=' + ${jsonString(JSON.stringify("关闭"))} + ']');
          if (!close) return false;
          close.click();
          return true;
        })()
      `),
      true,
      "Sponsor dialog should expose a close action",
    );
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("About feedback dialog exposes both channels and contains keyboard focus", async () => {
    const opened = await evaluate(client!, sessionId, `
      (() => {
        const feedback = Array.from(document.querySelectorAll('button'))
          .find((node) => node.textContent?.trim() === ${jsonString("问题反馈")});
        if (!feedback) return false;
        feedback.focus();
        feedback.click();
        return true;
      })()
    `);
    assert.equal(opened, true, "missing feedback button");

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[role="dialog"]')?.textContent?.includes(${jsonString("QQ 频道")})`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        (() => {
          const dialog = document.querySelector('[role="dialog"]');
          const image = Array.from(dialog?.querySelectorAll('.about-qq-channel-image') ?? [])
            .find((node) => getComputedStyle(node).display !== 'none');
          return Boolean(image && image.naturalWidth > 0 && image.naturalHeight > 0);
        })()
      `,
    );
    await waitForExpression(
      client!,
      sessionId,
      "document.activeElement?.classList.contains('about-feedback-github-action')",
    );

    const state = await evaluate(client!, sessionId, `
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        const images = Array.from(dialog?.querySelectorAll('.about-qq-channel-image') ?? []);
        const visibleImages = images.filter((node) => getComputedStyle(node).display !== 'none');
        const github = dialog?.querySelector('.about-feedback-github-action');
        const githubFrame = dialog?.querySelector('.about-feedback-github-frame');
        const dialogSurface = dialog?.closest('.about-feedback-dialog-surface');
        const qqCard = images[0]?.closest('.about-feedback-card');
        return {
          githubIsFocused: document.activeElement === github,
          githubLabel: github?.getAttribute('aria-label') ?? null,
          githubButtonUsesBrandTreatment: github
            ? Boolean(
                github.querySelector('img')?.naturalWidth > 0
                && github.querySelector('img')?.naturalHeight > 0
              )
            : false,
          githubButtonTheme: Array.from(github?.querySelectorAll('.about-feedback-github-image') ?? [])
            .find((node) => getComputedStyle(node).display !== 'none')
            ?.getAttribute('data-github-button-theme') ?? null,
          githubButtonHeight: github ? parseFloat(getComputedStyle(github).height) : 0,
          dialogWidth: dialogSurface?.getBoundingClientRect().width ?? 0,
          githubFrameCentered: githubFrame
            ? getComputedStyle(githubFrame).display === 'flex'
              && getComputedStyle(githubFrame).justifyContent === 'center'
              && getComputedStyle(githubFrame).alignItems === 'center'
            : false,
          visibleImageCount: visibleImages.length,
          visibleTheme: visibleImages[0]?.getAttribute('data-qq-theme') ?? null,
          activeTheme: document.documentElement.dataset.theme ?? null,
          redundantSmallCopyAbsent:
            !dialog?.textContent?.includes('适合中文交流')
            && !dialog?.textContent?.includes('频道号：')
            && !dialog?.textContent?.includes('提交 Bug')
            && !dialog?.textContent?.includes('使用 QQ 扫一扫'),
          qqCardIsInteractive: qqCard?.matches('button, a[href]') ?? true,
          hasOfficialQqChannelMark: Boolean(dialog?.querySelector('.about-qq-channel-mark')),
        };
      })()
    `) as {
      githubIsFocused: boolean;
      githubLabel: string | null;
      githubButtonUsesBrandTreatment: boolean;
      githubButtonTheme: string | null;
      githubButtonHeight: number;
      dialogWidth: number;
      githubFrameCentered: boolean;
      visibleImageCount: number;
      visibleTheme: string | null;
      activeTheme: string | null;
      redundantSmallCopyAbsent: boolean;
      qqCardIsInteractive: boolean;
      hasOfficialQqChannelMark: boolean;
    };

    assert.equal(state.githubIsFocused, true);
    assert.equal(state.githubLabel, "GitHub Issues");
    assert.equal(state.githubButtonUsesBrandTreatment, true);
    assert.equal(state.githubButtonTheme, state.activeTheme === "dark" ? "white" : "black");
    assert.equal(state.githubButtonHeight, 36);
    assert.equal(state.dialogWidth, 500);
    assert.equal(state.githubFrameCentered, true);
    assert.equal(state.visibleImageCount, 1);
    assert.equal(state.visibleTheme, state.activeTheme);
    assert.equal(state.redundantSmallCopyAbsent, true);
    assert.equal(state.qqCardIsInteractive, false);
    assert.equal(state.hasOfficialQqChannelMark, true);

    const tabLooped = await evaluate(client!, sessionId, `
      (() => {
        const github = document.querySelector('[role="dialog"] .about-feedback-github-action');
        if (!github) return false;
        github.focus();
        github.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        return document.activeElement?.classList.contains('about-feedback-dialog-close') ?? false;
      })()
    `);
    assert.equal(tabLooped, true, "Tab should loop to the first dialog control");

    const shiftTabLooped = await evaluate(client!, sessionId, `
      (() => {
        const close = document.querySelector('[role="dialog"] .about-feedback-dialog-close');
        if (!close) return false;
        close.focus();
        close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        return document.activeElement?.classList.contains('about-feedback-github-action') ?? false;
      })()
    `);
    assert.equal(shiftTabLooped, true, "Shift+Tab should loop to the last dialog control");

    await evaluate(client!, sessionId, `
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
    assert.equal(
      await evaluate(client!, sessionId, "document.activeElement?.textContent?.trim() === '问题反馈'"),
      true,
      "closing should restore focus to the feedback trigger",
    );
  });

  await runTest("About feedback dialog keeps recovery available when GitHub opening fails", async () => {
    const opened = await evaluate(client!, sessionId, `
      (() => {
        const feedback = Array.from(document.querySelectorAll('button'))
          .find((node) => node.textContent?.trim() === ${jsonString("问题反馈")});
        if (!feedback) return false;
        feedback.focus();
        feedback.click();
        return true;
      })()
    `);
    assert.equal(opened, true);
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.about-feedback-github-action'))");

    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__TIME_TRACKER_REJECT_OPEN_URL = true;
        globalThis.__TIME_TRACKER_ORIGINAL_CONSOLE_ERROR = console.error;
        console.error = () => {};
        document.querySelector('.about-feedback-github-action')?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.body.textContent?.includes(${jsonString("未能打开反馈链接。")})`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        Boolean(document.querySelector('[role="dialog"] .about-feedback-github-action:not(:disabled)'))
      `),
      true,
      "failed opening should keep the dialog usable",
    );

    await evaluate(client!, sessionId, `
      (() => {
        console.error = globalThis.__TIME_TRACKER_ORIGINAL_CONSOLE_ERROR;
        globalThis.__TIME_TRACKER_REJECT_OPEN_URL = false;
        document.querySelector('.about-feedback-github-action')?.click();
      })()
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
    assert.equal(
      await evaluate(client!, sessionId, `
        globalThis.__TIME_TRACKER_OPENED_URLS.includes('https://github.com/Ceceliaee/patina/issues/new/choose')
      `),
      true,
      "successful opening should use the existing GitHub Issues URL",
    );
  });

  await runTest("About page keeps one centered update layout on wide desktop", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1800,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    try {
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, "missing About navigation entry");
      await waitForExpression(
        client!,
        sessionId,
        "Boolean(document.querySelector('.about-center-panel .about-center-update'))",
      );

      const wideLayout = await evaluate(client!, sessionId, `
        (async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const panel = document.querySelector('.about-center-panel');
          const profile = document.querySelector('.about-center-profile');
          const actions = document.querySelector('.about-pill-row');
          const update = document.querySelector('.about-center-update.update-status-compact');
          if (!panel || !profile || !actions || !update) return null;

          const profileRect = profile.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const updateRect = update.getBoundingClientRect();
          return {
            panelColumns: getComputedStyle(panel).gridTemplateColumns,
            updateIsBelowActions: updateRect.top > actionsRect.bottom,
            updateIsCenteredWithActions:
              Math.abs((updateRect.left + updateRect.width / 2) - (actionsRect.left + actionsRect.width / 2)) < 2,
            updateStaysWiderThanActions: updateRect.width > actionsRect.width,
            actionsStayBelowProfile: actionsRect.top > profileRect.bottom,
          };
        })()
      `) as {
        panelColumns: string;
        updateIsBelowActions: boolean;
        updateIsCenteredWithActions: boolean;
        updateStaysWiderThanActions: boolean;
        actionsStayBelowProfile: boolean;
      } | null;

      assert.ok(wideLayout, "About wide layout hooks should be present");
      assert.equal(wideLayout.panelColumns.trim().split(/\s+/).length, 1);
      assert.equal(wideLayout.updateIsBelowActions, true);
      assert.equal(wideLayout.updateIsCenteredWithActions, true);
      assert.equal(wideLayout.updateStaysWiderThanActions, true);
      assert.equal(wideLayout.actionsStayBelowProfile, true);
    } finally {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
    }
  });
}
