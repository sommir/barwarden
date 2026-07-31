import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m5-m6-official-vault-main-2026-07-13",
);
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");

const runtimeStates = [
  "populated",
  "large-list",
  "search-results",
  "folder-filter",
  "type-filter",
  "menu-open",
  "loading",
  "empty",
  "no-results",
  "stale",
  "unavailable",
  "long-text",
  "compact",
] as const;

type RuntimeState = (typeof runtimeStates)[number];

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("records reproducible M5-M6 Vault Main provenance and QA limits", () => {
  expect(existsSync(provenancePath)).toBe(true);
  const provenance = readFileSync(provenancePath, "utf8").toLowerCase();

  for (const requiredText of [
    "f47b6946e01aed474875789081966d311d5b8289",
    "chromium is the sole authoritative screenshot writer",
    "masked regions: none",
    "pixel comparison threshold: not-applicable",
    "chrome official baseline does not exist",
    "vite_bw_vault_evidence=true",
    "fixed sanitized fixtures",
    "native substitutions",
    "reviewed overlay differences",
  ]) {
    expect(provenance).toContain(requiredText);
  }

  if (process.env.UPDATE_EVIDENCE !== "true") {
    for (const fileName of authoritativeScreenshotFiles) {
      const screenshotPath = join(evidenceDirectory, fileName);
      expect(existsSync(screenshotPath)).toBe(true);
      const sha256 = createHash("sha256").update(readFileSync(screenshotPath)).digest("hex");
      expect(provenance).toContain(`| ${fileName} | ${sha256} |`);
    }
  }
});

const authoritativeScreenshotFiles = [
  "populated-480x600.png",
  "large-list-480x600.png",
  "search-results-480x600.png",
  "folder-filter-480x600.png",
  "type-filter-480x600.png",
  "menu-open-480x600.png",
  "loading-480x600.png",
  "empty-480x600.png",
  "no-results-480x600.png",
  "stale-retry-480x600.png",
  "unavailable-480x600.png",
  "long-text-480x600.png",
  "compact-480x600.png",
  "light-480x600.png",
  "dark-480x600.png",
] as const;

for (const state of runtimeStates) {
  test(`proves the fixed ${state} Vault Main state`, async ({ page }, testInfo) => {
    await openVaultState(page, state);
    await assertOfficialVaultShell(page);
    await assertState(page, state);
    await assertNoExcludedVaultSurface(page);

    const fileName = `${state === "stale" ? "stale-retry" : state}-480x600.png`;
    const screenshot = await capture(page, testInfo, fileName);
    const decoded = await decodeScreenshot(page, screenshot.buffer);
    expect(decoded).toMatchObject({ width: 480, height: 600, opaquePixels: 480 * 600 });
    expect(decoded.uniqueColors).toBeGreaterThan(16);
  });
}

test("proves real computed-style and screenshot-pixel differences for light and dark", async ({ page }, testInfo) => {
  await openVaultState(page, "light");
  await assertOfficialVaultShell(page);
  const lightColors = await officialSurfaceColors(page);
  const light = await capture(page, testInfo, "light-480x600.png");

  await openVaultState(page, "dark");
  await assertOfficialVaultShell(page);
  const darkColors = await officialSurfaceColors(page);
  const dark = await capture(page, testInfo, "dark-480x600.png");

  expect(darkColors).not.toEqual(lightColors);
  expect(dark.sha256).not.toBe(light.sha256);
  const pixels = await compareScreenshotPixels(page, light.buffer, dark.buffer);
  expect(pixels).toMatchObject({ width: 480, height: 600 });
  expect(pixels.differentPixels).toBeGreaterThan(10_000);
});

test("proves keyboard traversal through the Vault Main controls", async ({ page }) => {
  await openVaultState(page, "populated");
  const search = page.locator("app-vault-search bit-search input");
  const filter = page.getByRole("button", { name: "筛选密码库", exact: true });
  await search.focus();
  await page.keyboard.press("Tab");
  await expect(filter).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(search).toBeFocused();
});

test("proves macOS Vault rows use solid 52px surfaces with distinct interaction states", async ({ page }) => {
  await openVaultState(page, "populated");
  await assertOfficialVaultShell(page);
  const row = sectionFor(page, "所有项目").locator("app-retained-vault-list-item bit-item").first();
  const content = row.getByRole("button").first();

  const resting = await row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderRadius: style.borderTopLeftRadius,
      minHeight: style.minHeight,
    };
  });
  expect(resting).toEqual({
    background: expect.not.stringMatching(/rgba\(0, 0, 0, 0\)/),
    borderRadius: "10px",
    minHeight: "52px",
  });

  await row.hover();
  expect(await row.evaluate((element) => element.matches(":hover"))).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const hoverBackground = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(hoverBackground).not.toBe(resting.background);

  await content.focus();
  await expect(content).toBeFocused();
  expect(await row.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await openVaultState(page, "large-list");
  const scrollRegion = page.locator('[data-testid="popup-layout-scroll-region"]');
  await scrollRegion.evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
    element.dispatchEvent(new Event("scroll"));
  });
  const finalRow = rowFor(page, "Synthetic Vault Item 120");
  await expect(finalRow).toBeVisible();
  const finalAction = finalRow.getByRole("button", { name: "更多", exact: true });
  await finalAction.scrollIntoViewIfNeeded();
  await finalAction.focus();
  await expect(finalAction).toBeFocused();

  const finalGeometry = await finalRow.evaluate((element) => {
    const action = element.querySelector<HTMLElement>('button[aria-label="更多"]');
    const rowSurface = element.querySelector<HTMLElement>("bit-item");
    const navigation = document.querySelector<HTMLElement>("nav.floating-tab-switcher");
    const scrollHost = document.querySelector<HTMLElement>(
      '[data-testid="popup-layout-scroll-region"]',
    );
    if (!action || !rowSurface || !navigation || !scrollHost) {
      throw new Error("Missing final Vault row/action, floating navigation, or scroll host");
    }
    const rowBounds = rowSurface.getBoundingClientRect();
    const actionBounds = action.getBoundingClientRect();
    const navigationBounds = navigation.getBoundingClientRect();
    const scrollBounds = scrollHost.getBoundingClientRect();
    const rowStyle = getComputedStyle(rowSurface);
    const actionStyle = getComputedStyle(action);
    return {
      row: {
        top: rowBounds.top,
        right: rowBounds.right,
        bottom: rowBounds.bottom,
        left: rowBounds.left,
      },
      action: {
        top: actionBounds.top,
        right: actionBounds.right,
        bottom: actionBounds.bottom,
        left: actionBounds.left,
      },
      navigationTop: navigationBounds.top,
      scrollTop: scrollBounds.top,
      viewportWidth: document.documentElement.clientWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      focusPainted:
        rowStyle.boxShadow !== "none"
        || actionStyle.boxShadow !== "none"
        || (actionStyle.outlineStyle !== "none" && actionStyle.outlineWidth !== "0px"),
    };
  });
  const focusRingExtent = 4;
  expect(finalGeometry.focusPainted).toBe(true);
  expect(finalGeometry.row.top - focusRingExtent).toBeGreaterThanOrEqual(finalGeometry.scrollTop);
  expect(finalGeometry.row.bottom + focusRingExtent).toBeLessThanOrEqual(finalGeometry.navigationTop);
  expect(finalGeometry.action.bottom + focusRingExtent).toBeLessThanOrEqual(finalGeometry.navigationTop);
  expect(finalGeometry.row.left - focusRingExtent).toBeGreaterThanOrEqual(0);
  expect(finalGeometry.row.right + focusRingExtent).toBeLessThanOrEqual(finalGeometry.viewportWidth);
  expect(finalGeometry.horizontalOverflow).toBe(0);
});

test("restores all vault items when search is cleared before a tab round trip", async ({ page }) => {
  await openVaultState(page, "populated");
  const search = page.locator("app-vault-search bit-search input");

  await search.pressSequentially("Example Mail");
  await expect(page.getByRole("heading", { name: "搜索结果", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置搜索", exact: true }).click();
  await page.getByRole("button", { name: "生成器", exact: true }).click();
  await expect(page).toHaveURL(/#\/tabs\/generator$/);
  await page.getByRole("button", { name: "密码库", exact: true }).click();

  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect(page.getByRole("heading", { name: "密码库", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "所有项目", exact: true })).toBeVisible();
  await expect(page.getByText("Example Mail", { exact: true }).first()).toBeVisible();
  await expect(search).toHaveValue("");
});

test("proves the official retained New menu and exact folder handoff", async ({ page }) => {
  await openVaultState(page, "folder-filter");
  const newButton = page.locator("popup-header app-new-item-dropdown button[bitbutton]");
  await pointerClick(page, newButton);

  const menuItems = page.getByRole("menuitem");
  expect((await menuItems.allTextContents()).map((text) => text.trim())).toEqual([
    "登录",
    "支付卡",
    "身份",
    "笔记",
    "文件夹",
  ]);
  for (const [index, type] of ["1", "3", "4", "2"].entries()) {
    await expect(menuItems.nth(index)).toHaveAttribute(
      "href",
      new RegExp(`/add-cipher\\?type=${type}&folderId=work$`),
    );
  }
  await expect(page.getByText(/SSH|导入|附件/)).toHaveCount(0);
});

test("invokes retained quick copy-and-fill and row-menu controls through real pointer actions", async ({ page }) => {
  await openVaultState(page, "populated");
  const allItemsRow = sectionFor(page, "所有项目")
    .locator("app-retained-vault-list-item")
    .filter({ hasText: "Example Mail" })
    .first();
  const fillUsername = allItemsRow
    .getByRole("button", { name: "复制并填入用户名", exact: true });
  await fillUsername.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-bw-evidence-last-host-action",
    "paste_text",
  );
  await expect(page).toHaveURL(/#\/tabs\/vault$/);

  const more = allItemsRow.getByRole("button", { name: "更多", exact: true });
  await pointerClick(page, more);
  await expect(page.getByRole("menu", { name: "更多", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "查看", exact: true })).toBeFocused();
});

test("invokes stale and unavailable Retry through real pointer actions", async ({ page }) => {
  for (const state of ["stale", "unavailable"] as const) {
    await openVaultState(page, state);
    await pointerClick(page, page.getByTestId("vault-sync-retry"));
    await expect(page.locator("html")).toHaveAttribute(
      "data-bw-evidence-last-host-action",
      "sync_now",
    );
    await expect(page.getByTestId("vault-sync-retry")).toBeVisible();
  }
});

test("keeps deterministic screenshot bytes aligned with provenance after capture", ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium is the sole authoritative writer");
  if (process.env.UPDATE_EVIDENCE === "true") {
    writeFileSync(
      provenancePath,
      replaceProvenanceHashTable(readFileSync(provenancePath, "utf8")),
    );
  }
  assertAuthoritativeEvidenceHashes();
});

async function openVaultState(page: Page, state: RuntimeState | "light" | "dark"): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ animations: false, compactMode: false, theme: "light" }),
    );
  });
  await page.emulateMedia({
    colorScheme: state === "dark" ? "dark" : "light",
    reducedMotion: "reduce",
  });
  await page.goto(`/?vaultEvidence=${state}`);
  await expect(page).toHaveURL(new RegExp(`vaultEvidence=${state}.*#\/tabs\/vault$`));
  await expect(page.getByRole("heading", { name: "密码库", exact: true }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))).toEqual({
    width: 480,
    height: 600,
    dpr: 1,
  });
  await expect(page.locator("html")).toHaveAttribute("data-bw-theme", state === "dark" ? "dark" : "light");
}

async function assertOfficialVaultShell(page: Page): Promise<void> {
  await expect(
    page.locator("barwarden-root > .popup-window-size-source > bw-popup-shell > section.popup-shell popup-page"),
  ).toHaveCount(1);
  await expect(page.locator("popup-page > popup-header")).toHaveCount(1);
  await expect(page.locator("popup-page > main > div > app-vault-header")).toHaveCount(1);
  await expect(page.locator("app-vault-header app-vault-search > bit-search")).toHaveCount(1);
  await expect(page.locator("app-vault-header bit-disclosure app-vault-list-filters")).toHaveCount(1);
  await expect(page.locator("app-vault-list-filters bit-chip-filter")).toHaveCount(2);
  await expect(page.locator("popup-header bw-retained-new-item-dropdown app-new-item-dropdown")).toHaveCount(1);
  const navigation = page.locator("section.popup-shell bw-floating-tab-switcher > nav.floating-tab-switcher");
  await expect(navigation).toHaveCount(1);
  await expect(page.locator("popup-tab-navigation, bit-bottom-navigation")).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("barwarden-root");
    const popupPage = document.querySelector<HTMLElement>("popup-page");
    const popupShell = document.querySelector<HTMLElement>("section.popup-shell");
    const navigation = document.querySelector<HTMLElement>("nav.floating-tab-switcher");
    const scrollHost = document.querySelector<HTMLElement>(
      'popup-page [data-testid="popup-layout-scroll-region"]',
    );
    if (!root || !popupPage || !popupShell || !navigation || !scrollHost) {
      throw new Error("Missing official popup root/page/scroll host");
    }

    const navigationBounds = navigation.getBoundingClientRect();
    const shellBounds = popupShell.getBoundingClientRect();

    const candidates = [
      document.documentElement,
      document.body,
      root,
      popupPage,
      ...root.querySelectorAll<HTMLElement>("*"),
    ];
    const scrollOwners = [...new Set(candidates)]
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (element === scrollHost || element.scrollHeight > element.clientHeight) &&
          ["auto", "scroll"].includes(style.overflowY) &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          bounds.width > 0 &&
          bounds.height > 0;
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        testId: element.dataset.testid ?? null,
        overflowY: getComputedStyle(element).overflowY,
      }));

    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      navigation: {
        bottomInset: shellBounds.bottom - navigationBounds.bottom,
        leftInset: navigationBounds.left - shellBounds.left,
        rightInset: shellBounds.right - navigationBounds.right,
        borderRadius: getComputedStyle(navigation).borderRadius,
        pagePaddingBottom: getComputedStyle(popupPage).paddingBottom,
      },
      scrollOwners,
    };
  });

  expect(layout.horizontalOverflow).toBe(0);
  expect(layout.navigation).toMatchObject({ borderRadius: "13px", pagePaddingBottom: "79px" });
  expect(layout.navigation.leftInset).toBeCloseTo(14, 1);
  expect(layout.navigation.rightInset).toBeCloseTo(14, 1);
  expect(layout.navigation.bottomInset).toBeCloseTo(13, 1);
  expect(layout.scrollOwners).toEqual([
    { tag: "div", testId: "popup-layout-scroll-region", overflowY: "auto" },
  ]);
}

async function assertState(page: Page, state: RuntimeState): Promise<void> {
  switch (state) {
    case "populated":
      await assertGuardedListAncestry(page);
      await expect(page.getByRole("heading", { name: "收藏夹", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "所有项目", exact: true })).toBeVisible();
      await assertRowPitch(page, 58);
      break;
    case "large-list": {
      await assertGuardedListAncestry(page);
      const allItems = sectionFor(page, "所有项目");
      await expect(allItems).toContainText("120");
      const renderedRows = await allItems.locator("app-retained-vault-list-item").count();
      expect(renderedRows).toBeGreaterThan(0);
      expect(renderedRows).toBeLessThan(120);
      await expect(allItems.locator(".cdk-virtual-scroll-spacer")).toBeAttached();
      await assertRowPitch(page, 58);
      break;
    }
    case "search-results":
      await expect(page.getByRole("heading", { name: "搜索结果", exact: true })).toBeVisible();
      await expect(page.getByText("Example Calendar", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Example Mail", { exact: true })).toHaveCount(0);
      break;
    case "folder-filter":
      await expect(page.getByText("已应用一个筛选", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "移除 Work", exact: true })).toBeVisible();
      await expect(page.getByText("Example Mail", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Travel Card", { exact: true })).toHaveCount(0);
      break;
    case "type-filter":
      await expect(page.getByText("已应用一个筛选", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "支付卡", exact: true })).toBeVisible();
      await expect(page.getByText("Travel Card", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Example Mail", { exact: true })).toHaveCount(0);
      break;
    case "menu-open":
      await assertGuardedListAncestry(page);
      await rowFor(page, "Example Mail")
        .getByRole("button", { name: "更多", exact: true })
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.getByRole("menu", { name: "更多", exact: true })).toHaveCount(1);
      await expect(page.getByRole("menuitem", { name: "查看", exact: true })).toBeFocused();
      expect((await page.getByRole("menuitem").allTextContents()).map((text) => text.trim())).toEqual([
        "查看",
        "取消收藏",
        "编辑",
        "克隆",
        "归档",
        "删除",
      ]);
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      break;
    case "loading":
      await expect(page.locator("popup-page vault-fade-in-out-skeleton vault-loading-skeleton")).toBeVisible();
      await expect(page.locator("vault-loading-skeleton bit-skeleton-group").first()).toBeVisible();
      break;
    case "empty":
      await expect(page.locator("popup-page vault-fade-in-out bit-no-items")).toBeVisible();
      await expect(page.getByText("您的密码库是空的", { exact: true })).toBeVisible();
      await expect(page.getByText(/密码库不仅保护您的密码/)).toBeVisible();
      await expect(page.getByRole("link", { name: "新增登录", exact: true })).toBeVisible();
      break;
    case "no-results":
      await expect(page.locator("popup-page bit-no-items")).toBeVisible();
      await expect(page.getByText("没有搜索到匹配的项目", { exact: true })).toBeVisible();
      await expect(page.getByText("清除筛选或尝试其他搜索词", { exact: true })).toBeVisible();
      break;
    case "stale":
      await assertGuardedListAncestry(page);
      await expect(page.getByText("无法同步，正在显示已保存的密码库数据。", { exact: true })).toBeVisible();
      await expect(page.getByTestId("vault-sync-retry")).toBeVisible();
      break;
    case "unavailable":
      await expect(page.locator("popup-page bit-no-items")).toBeVisible();
      await expect(page.getByText("无法加载密码库，请重试。", { exact: true })).toBeVisible();
      await expect(page.getByTestId("vault-sync-retry")).toBeVisible();
      break;
    case "long-text": {
      const name = page.getByTestId("item-name").first();
      await expect(name).toContainText("An intentionally long Vault item name");
      const truncationHost = name.locator("xpath=..");
      expect(await truncationHost.evaluate((element) => ({
        clipped: element.scrollWidth > element.clientWidth,
        overflow: getComputedStyle(element).overflow,
        textOverflow: getComputedStyle(element).textOverflow,
        whiteSpace: getComputedStyle(element).whiteSpace,
      }))).toEqual({ clipped: true, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
      await expect(name.locator("xpath=ancestor::button[1]")).toHaveAccessibleName(/An intentionally long Vault item name/);
      await assertRowPitch(page, 58);
      break;
    }
    case "compact":
      await expect(page.locator("html")).toHaveAttribute("data-bw-compact-mode", "true");
      await assertRowPitch(page, 54);
      break;
  }
}

async function assertGuardedListAncestry(page: Page): Promise<void> {
  await expect(page.locator("popup-page vault-fade-in-out .vault-sections > app-vault-list-items-container")).not.toHaveCount(0);
  await expect(page.locator("app-vault-list-items-container bit-section cdk-virtual-scroll-viewport")).not.toHaveCount(0);
  await expect(page.locator("app-vault-list-items-container app-retained-vault-list-item > bit-item")).not.toHaveCount(0);
  await expect(
    page.locator('app-retained-vault-list-item > bit-item button[data-testid="vault-item-content"]'),
  ).not.toHaveCount(0);
  await expect(page.locator("app-retained-vault-list-item app-item-more-options")).not.toHaveCount(0);
}

async function assertRowPitch(page: Page, expectedPitch: 54 | 58): Promise<void> {
  const rows = sectionFor(page, "所有项目").locator("app-retained-vault-list-item bit-item");
  await expect(rows).not.toHaveCount(0);
  const tops = await rows.evaluateAll((elements) => elements.slice(0, 2).map((element) => element.getBoundingClientRect().top));
  expect(tops).toHaveLength(2);
  expect(Math.abs((tops[1] ?? 0) - (tops[0] ?? 0) - expectedPitch)).toBeLessThanOrEqual(0.5);
}

async function assertNoExcludedVaultSurface(page: Page): Promise<void> {
  await expect(page.locator("bw-vault-section, bw-vault-item-row")).toHaveCount(0);
  await expect(page.locator('a[href*="/import"], a[href*="/ssh"], a[href*="/premium"]')).toHaveCount(0);
  const text = await page.locator("body").innerText();
  for (const excluded of [
    /自动填充建议/,
    /填入字段/,
    /当前网站/,
    /附件/,
    /通行密钥/,
    /SSH/,
    /分配集合/,
    /导入/,
    /高级版/,
  ]) {
    expect(text).not.toMatch(excluded);
  }
}

function sectionFor(page: Page, heading: string): Locator {
  return page.locator("app-vault-list-items-container").filter({
    has: page.getByRole("heading", { name: heading, exact: true }),
  });
}

function rowFor(page: Page, name: string): Locator {
  return page.locator("app-retained-vault-list-item").filter({ hasText: name }).first();
}

async function officialSurfaceColors(page: Page): Promise<readonly string[]> {
  return page.locator("popup-page > main, popup-page > popup-header > header, bit-item").evaluateAll(
    (elements) => elements.slice(0, 4).map((element) => getComputedStyle(element).backgroundColor),
  );
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  fileName: string,
): Promise<{ readonly buffer: Buffer; readonly sha256: string }> {
  const authoritativePath = join(evidenceDirectory, fileName);
  const buffer = await page.screenshot({
    path: evidenceCapturePath(testInfo, authoritativePath),
    animations: "disabled",
  });
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (testInfo.project.name === "chromium" && process.env.UPDATE_EVIDENCE !== "true") {
    const comparison = await compareScreenshotPixels(page, readFileSync(authoritativePath), buffer);
    expect(
      comparison.differentPixels,
      `${fileName} must stay within the 8-pixel local reproducibility threshold`,
    ).toBeLessThanOrEqual(8);
  }
  return { buffer, sha256 };
}

async function pointerClick(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const point = {
    x: bounds!.x + bounds!.width / 2,
    y: bounds!.y + bounds!.height / 2,
  };
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const hit = await locator.evaluate((target, clickPoint) => {
    const hitTarget = document.elementFromPoint(clickPoint.x, clickPoint.y);
    return {
      insideTarget: hitTarget !== null && target.contains(hitTarget),
      tag: hitTarget?.tagName.toLowerCase() ?? null,
      ariaLabel: hitTarget?.getAttribute("aria-label") ?? null,
      testId: (hitTarget as HTMLElement | null)?.dataset.testid ?? null,
      className: hitTarget?.getAttribute("class") ?? null,
    };
  }, point);
  expect(hit.insideTarget, JSON.stringify(hit)).toBe(true);
  await page.mouse.down();
  await page.mouse.up();
}

function assertAuthoritativeEvidenceHashes(): void {
  const provenance = readFileSync(provenancePath, "utf8").toLowerCase();
  for (const fileName of authoritativeScreenshotFiles) {
    const screenshotPath = join(evidenceDirectory, fileName);
    expect(existsSync(screenshotPath)).toBe(true);
    const sha256 = createHash("sha256").update(readFileSync(screenshotPath)).digest("hex");
    expect(provenance).toContain(`| ${fileName} | ${sha256} |`);
  }
}

function replaceProvenanceHashTable(provenance: string): string {
  const header = "| Screenshot | SHA-256 |\n| --- | --- |";
  const start = provenance.indexOf(header);
  if (start < 0) throw new Error("M5-M6 provenance SHA table is missing");
  const nextSection = provenance.indexOf("\n\n", start + header.length);
  const end = nextSection < 0 ? provenance.trimEnd().length : nextSection;
  const rows = authoritativeScreenshotFiles.map((fileName) => {
    const screenshotPath = join(evidenceDirectory, fileName);
    if (!existsSync(screenshotPath)) throw new Error(`Missing M5-M6 authority: ${fileName}`);
    const sha256 = createHash("sha256").update(readFileSync(screenshotPath)).digest("hex");
    return `| ${fileName} | ${sha256} |`;
  });
  return `${provenance.slice(0, start)}${[header, ...rows].join("\n")}${provenance.slice(end)}`;
}

async function decodeScreenshot(page: Page, buffer: Buffer) {
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Unable to decode screenshot pixels");
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    let opaquePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 255) {
        opaquePixels += 1;
      }
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      opaquePixels,
      uniqueColors: colors.size,
    };
  }, buffer.toString("base64"));
}

async function compareScreenshotPixels(page: Page, light: Buffer, dark: Buffer) {
  return page.evaluate(async ({ lightSource, darkSource }) => {
    const decode = async (source: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("Unable to decode screenshot pixels");
      }
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const [lightImage, darkImage] = await Promise.all([decode(lightSource), decode(darkSource)]);
    if (lightImage.width !== darkImage.width || lightImage.height !== darkImage.height) {
      throw new Error("Theme screenshots have different dimensions");
    }
    let differentPixels = 0;
    for (let index = 0; index < lightImage.pixels.length; index += 4) {
      if (
        lightImage.pixels[index] !== darkImage.pixels[index] ||
        lightImage.pixels[index + 1] !== darkImage.pixels[index + 1] ||
        lightImage.pixels[index + 2] !== darkImage.pixels[index + 2] ||
        lightImage.pixels[index + 3] !== darkImage.pixels[index + 3]
      ) {
        differentPixels += 1;
      }
    }
    return { width: lightImage.width, height: lightImage.height, differentPixels };
  }, { lightSource: light.toString("base64"), darkSource: dark.toString("base64") });
}
