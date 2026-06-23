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
          actionsStayInOneRow: actionRects.every((rect) => Math.abs(rect.top - firstActionRect.top) < 2),
          updatePaddingTop: parseFloat(getComputedStyle(update).paddingTop),
        };
      })()
    `) as {
      panelDisplay: string;
      profileJustifyItems: string;
      actionDisplay: string;
      actionMinHeight: number;
      actionsStayInOneRow: boolean;
      updatePaddingTop: number;
    } | null;

    assert.ok(layout, "About layout hooks should be present");
    assert.equal(layout.panelDisplay, "grid");
    assert.equal(layout.profileJustifyItems, "center");
    assert.equal(["flex", "inline-flex"].includes(layout.actionDisplay), true);
    assert.equal(layout.actionMinHeight >= 32, true);
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
