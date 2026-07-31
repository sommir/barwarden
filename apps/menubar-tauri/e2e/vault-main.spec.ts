import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { evidenceCapturePath } from "./evidence-path";
import { expect, test } from "./isolated-webkit-page.fixture";

const evidenceStates = [
  "populated",
  "filtered",
  "menu-open",
  "long-text",
  "loading",
  "empty",
  "no-results",
  "stale",
] as const;

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g1-vault-main-2026-07-12",
);

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

for (const state of evidenceStates) {
  test(`captures deterministic ${state} Vault Main evidence`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?vaultEvidence=${state}`);
    await expect(page).toHaveURL(new RegExp(`vaultEvidence=${state}.*#/tabs/vault`));
    await expect(page.getByRole("heading", { name: "密码库", exact: true })).toBeVisible();
    await assertFixedPopupGeometry(page, state);
    await assertState(page, state);

    const screenshotPath = join(evidenceDirectory, `${state}-480x600.png`);
    await page.screenshot({ path: evidenceCapturePath(testInfo, screenshotPath), animations: "disabled" });
  });
}

test("moves a retained item into Favorites through the pinned overflow menu", async ({ page }) => {
  await page.goto("/?vaultEvidence=populated");
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault/);
  const identityRows = page.locator("bit-item").filter({ hasText: "Sample Identity" });
  await expect(identityRows).toHaveCount(1);

  await identityRows
    .getByRole("button", { name: "更多", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("menuitem", { name: "查看", exact: true })).toBeFocused();
  const favoriteAction = page.getByRole("menuitem", { name: "收藏", exact: true });
  await favoriteAction.evaluate((button: HTMLButtonElement) => button.click());

  await expect(page.getByText("Sample Identity", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "收藏夹", exact: true })).toBeVisible();
});

async function assertFixedPopupGeometry(
  page: import("@playwright/test").Page,
  state: (typeof evidenceStates)[number],
) {
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))).toEqual({
    width: 480,
    height: 600,
    dpr: 1,
  });

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Missing layout landmark: ${selector}`);
      }
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
    };
    const pageScrollHost = document.querySelector<HTMLElement>(
      'popup-page [data-testid="popup-layout-scroll-region"]',
    );
    if (!pageScrollHost) {
      throw new Error("Missing popup-page scroll host");
    }
    const visibleScrollOwners = [...pageScrollHost.closest("popup-page")!.querySelectorAll<HTMLElement>(
      "*",
    )]
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          ["auto", "scroll"].includes(style.overflowY) &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      })
      .map((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        testId: element.dataset.testid,
      }));

    return {
      shell: rect(".popup-shell"),
      page: rect("popup-page"),
      header: rect("popup-page > popup-header"),
      scroll: rect('popup-page [data-testid="popup-layout-scroll-region"]'),
      nav: rect("nav.floating-tab-switcher"),
      navBorderRadius: getComputedStyle(document.querySelector<HTMLElement>("nav.floating-tab-switcher")!).borderRadius,
      pagePaddingBottom: getComputedStyle(document.querySelector<HTMLElement>("popup-page")!).paddingBottom,
      pageScrollOverflowY: getComputedStyle(pageScrollHost).overflowY,
      visibleScrollOwners,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(geometry.shell).toEqual({ left: 0, top: 0, bottom: 600, width: 480, height: 600 });
  expect(geometry.page.top).toBe(0);
  expect(geometry.page.bottom).toBe(600);
  expect(geometry.nav.left).toBeCloseTo(14, 1);
  expect(geometry.nav.width).toBeCloseTo(452, 1);
  expect(geometry.nav.bottom).toBeCloseTo(587, 1);
  expect(geometry.navBorderRadius).toBe("13px");
  expect(geometry.pagePaddingBottom).toBe("79px");
  expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.scroll.top);
  expect(geometry.scroll.height).toBeGreaterThan(0);
  expect(geometry.pageScrollOverflowY).toBe("auto");
  expect(geometry.visibleScrollOwners).toEqual([
    { overflowY: "auto", testId: "popup-layout-scroll-region" },
  ]);
  expect(geometry.horizontalOverflow).toBe(0);
}

async function assertState(
  page: import("@playwright/test").Page,
  state: (typeof evidenceStates)[number],
) {
  switch (state) {
    case "populated":
      await expect(page.getByText("Example Mail", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "收藏夹" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "所有项目" })).toBeVisible();
      break;
    case "filtered":
      await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();
      await expect(page.getByText("Travel Card", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("已应用一个筛选", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "支付卡", exact: true })).toBeVisible();
      break;
    case "menu-open":
      await page.getByText("Example Mail", { exact: true }).first().locator("xpath=ancestor::bit-item[1]")
        .getByRole("button", { name: "更多", exact: true })
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.getByRole("menu", { name: "更多" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "查看" }).first()).toBeFocused();
      break;
    case "long-text": {
      const label = page.locator('[data-testid="item-name"]').first();
      await expect(label).toContainText("An intentionally long Vault item name");
      const truncationOwner = label.locator("xpath=parent::div");
      expect(await truncationOwner.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })))
        .toMatchObject({ clientWidth: expect.any(Number), scrollWidth: expect.any(Number) });
      expect(await truncationOwner.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      break;
    }
    case "loading":
      await expect(page.locator("vault-loading-skeleton bit-skeleton-group").first()).toBeVisible();
      break;
    case "empty":
      await expect(page.getByText("您的密码库是空的", { exact: true })).toBeVisible();
      break;
    case "no-results":
      await expect(page.getByText("没有搜索到匹配的项目", { exact: true })).toBeVisible();
      break;
    case "stale":
      await expect(page.getByText("无法同步，正在显示已保存的密码库数据。")).toBeVisible();
      await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
      break;
  }
}
