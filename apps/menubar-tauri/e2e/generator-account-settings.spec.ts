import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g3-generator-account-settings-2026-07-13",
);

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("captures retained password, passphrase, and populated history", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/tabs/generator");
  await expect(page.locator("bit-toggle-group")).toBeVisible();
  await expect(generatorValueCard(page)).toBeVisible();
  await expect(generatorValueCard(page)).toContainText("Mango-River-47!");
  await expect(page.getByText("无法生成凭据。请重试。")).toHaveCount(0);
  await expect(page.locator("bit-section")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成密码" })).toBeVisible();
  await capture(page, testInfo, "generator-password-480x600.png");

  await page.getByText("密码短语", { exact: true }).click();
  await expect(generatorValueCard(page)).toContainText("orbit-lantern-copper-signal");
  await page.getByRole("button", { name: "生成密码短语", exact: true }).click();
  await expect(generatorValueCard(page)).toContainText("orbit-lantern-copper-signal");
  await capture(page, testInfo, "generator-passphrase-480x600.png");

  await page.getByRole("link", { name: "生成器历史" }).click();
  await expect(page.locator("bw-official-generator-history")).toBeVisible();
  const historyRows = page.locator("bit-credential-generator-history bit-item");
  await expect(historyRows).toHaveCount(2);
  await expect(historyRows.nth(0).locator("bit-color-password")).toHaveText("orbit-lantern-copper-signal");
  await expect(historyRows.nth(1).locator("bit-color-password")).toHaveText("Mango-River-47!");
  await expect(historyRows.locator('[slot="secondary"]')).toHaveText([/2026/, /2026/]);
  const copyPassphrase = page.getByRole("button", { name: "复制密码短语" }).first();
  await expect(copyPassphrase).toBeEnabled();
  await copyPassphrase.click();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-last-host-action", "copy_text");
  await expect(page.locator("html").evaluate((element) => Object.values(element.dataset).join("|")))
    .resolves.not.toMatch(/orbit-lantern-copper-signal|Mango-River-47!/);
  const clearHistory = page
    .getByRole("contentinfo")
    .getByRole("button", { name: "清除历史记录", exact: true });
  await clearHistory.click();
  const clearDialog = page.getByRole("dialog");
  await expect(clearDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(clearDialog).not.toBeVisible();
  await expect(clearHistory).toBeFocused();
  await capture(page, testInfo, "generator-history-populated-480x600.png");
});

test("captures the official account switcher", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/account-switcher");
  const currentAccount = page.getByRole("button", { name: "Bitwarden 账户 evidence@example.test" });
  await expect(currentAccount).toBeVisible();
  const accountRows = page.locator("bw-official-account-switcher auth-account");
  await expect(accountRows.locator("bit-avatar")).toHaveCount(2);
  await expect(currentAccount.locator("bit-avatar")).toHaveCount(1);
  await expectReadableWidth(accountRows.first().locator(".tw-max-w-64.tw-truncate").first(), 120);
  await expectReadableWidth(accountRows.first().locator(".tw-max-w-64.tw-truncate").nth(1), 100);
  await expect(page.getByRole("heading", { name: "可用账户" })).toBeVisible();
  await expect(page.getByRole("button").filter({ hasText: "locked-fixture@example.test" })).toBeVisible();
  await expect(page.getByText("已锁定", { exact: true })).toBeVisible();
  await capture(page, testInfo, "account-switcher-480x600.png");
});

test("captures a sanitized manual sync failure", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/vault-settings");
  await page.getByRole("button", { name: /立即同步/ }).click();
  await expect(page.getByRole("alert")).toHaveText("无法同步密码库。请重试。");
  await capture(page, testInfo, "vault-settings-sync-failure-480x600.png");
});

test("captures both native single-field modes with a bounded clipboard timeout", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/autofill");

  const clearClipboard = page.locator('bit-select[aria-label="清空剪贴板"] .ng-select-container');
  const fillMode = page.locator('bit-select[aria-label="单字段填充"] .ng-select-container');
  await expect(clearClipboard).toBeVisible();
  await expect(fillMode).toBeVisible();

  await clearClipboard.click();
  await page.getByText("从不", { exact: true }).last().click();
  await expect(page.locator('bit-select[aria-label="清空剪贴板"]')).toContainText("从不");

  await fillMode.click();
  await page.getByText("仅复制到剪贴板", { exact: true }).last().click();
  await expect(page.locator('bit-select[aria-label="单字段填充"]')).toContainText("仅复制到剪贴板");

  await fillMode.click();
  await page.getByText("复制并粘贴", { exact: true }).last().click();
  await expect(page.locator('bit-select[aria-label="单字段填充"]')).toContainText("复制并粘贴");
  await capture(page, testInfo, "autofill-single-field-modes-480x600.png");
});

test("captures retained About metadata in the official dialog", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/about");
  await page.getByRole("button", { name: "关于 Barwarden", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const metadata = dialog.locator(".about-metadata-list");
  await expect(metadata.locator("dt", { hasText: "版本" }).locator("+ dd")).toHaveText("0.1.0");
  await expect(metadata.locator("dt", { hasText: "上游 revision" }).locator("+ dd")).toContainText("f47b6946e01a");
  await expect(metadata.locator("dt", { hasText: "当前 Web Vault" }).locator("+ dd")).toHaveText("https://vault.example.test");
  await expect(metadata.locator("dt", { hasText: "许可证" }).locator("+ dd")).toHaveText("GPL-3.0-only");
  await capture(page, testInfo, "about-metadata-480x600.png");
});

for (const [route, landmark, fileName] of [
  ["/tabs/settings", "设置", "settings-main-480x600.png"],
  ["/account-security", "会话超时", "account-security-480x600.png"],
  ["/appearance", "界面", "appearance-480x600.png"],
  ["/about", "故障排除", "about-480x600.png"],
] as const) {
  test(`captures ${route}`, async ({ page }, testInfo) => {
    await openEvidenceRoute(page, route);
    await expect(page.getByText(landmark, { exact: true }).first()).toBeVisible();
    if (route === "/tabs/settings") {
      for (const [label, width] of [
        ["账户安全", 48],
        ["单字段填充", 60],
        ["密码库选项", 60],
        ["外观", 28],
        ["关于", 28],
      ] as const) {
        await expectReadableWidth(page.getByText(label, { exact: true }), width);
      }
    }
    await capture(page, testInfo, fileName);
  });
}

async function expectReadableWidth(locator: ReturnType<Page["getByText"]>, minimum: number): Promise<void> {
  const box = await locator.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(minimum - 0.5);
  expect(await locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const parentBounds = element.parentElement?.getBoundingClientRect();
    return Boolean(
      parentBounds &&
      bounds.left >= parentBounds.left - 0.5 &&
      bounds.right <= parentBounds.right + 0.5,
    );
  })).toBe(true);
}

function generatorValueCard(page: Page) {
  return page.locator("bit-card").filter({ has: page.locator("bit-color-password") });
}

async function openEvidenceRoute(page: Page, route: string): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-13T02:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?vaultEvidence=populated");
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault/);
  await page.evaluate((nextRoute) => { globalThis.location.hash = nextRoute; }, route);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveURL(new RegExp(`vaultEvidence=populated.*#${route}`));
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 480,
    height: 600,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.evaluate(() => {
    globalThis.scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
  });
  const authoritativePath = join(evidenceDirectory, fileName);
  const freshPath = evidenceCapturePath(testInfo, authoritativePath);
  await page.screenshot({ path: freshPath, animations: "disabled" });
  const images = [freshPath, authoritativePath]
    .filter((path, index, paths) => existsSync(path) && paths.indexOf(path) === index)
    .map((path) => readFileSync(path).toString("base64"));
  const results = await page.evaluate(async (encodedImages) => Promise.all(encodedImages.map(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    let opaque = true;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (colors.size <= 256) {
        colors.add(((pixels[offset] << 24) | (pixels[offset + 1] << 16) | (pixels[offset + 2] << 8) | pixels[offset + 3]) >>> 0);
      }
      opaque &&= pixels[offset + 3] === 255;
    }
    return { width: canvas.width, height: canvas.height, colors: colors.size, opaque };
  })), images);
  for (const result of results) {
    expect(result).toMatchObject({ width: 480, height: 600, opaque: true });
    expect(result.colors).toBeGreaterThan(16);
  }
}
