import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g1-5-task-3-2026-07-12",
);
const evidencePath = join(evidenceDirectory, "shell-populated-480x600.png");

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("routes floating text tabs through click, Enter, and Space while retaining focus", async ({ page }) => {
  await openPopulatedVault(page);

  const navigation = page.getByRole("navigation", { name: "主要导航" });
  const tabs = navigation.getByRole("button");
  const vault = navigation.getByRole("button", { name: "密码库", exact: true });
  const generator = navigation.getByRole("button", { name: "生成器", exact: true });
  const send = navigation.getByRole("button", { name: "Send", exact: true });
  const settings = navigation.getByRole("button", { name: "设置", exact: true });

  await expect(tabs).toHaveCount(4);
  await expect(navigation.locator("svg")).toHaveCount(0);
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(vault).toHaveAttribute("aria-current", "page");

  await generator.click();
  await expect(page).toHaveURL(/#\/tabs\/generator$/);
  await expect(generator).toBeFocused();
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(generator).toHaveAttribute("aria-current", "page");

  await settings.focus();
  await settings.press("Enter");
  await expect(page).toHaveURL(/#\/tabs\/settings$/);
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute("aria-current", "page");

  await send.focus();
  await send.press("Space");
  await expect(page).toHaveURL(/#\/tabs\/send$/);
  await expect(send).toBeFocused();
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
});

test("uses official accessible header controls and captures Task 3 evidence", async ({ page }, testInfo) => {
  await openPopulatedVault(page);

  const newButton = page.locator("[bitbutton]").filter({ hasText: "新增" });
  const popOut = page.getByRole("button", { name: "在新窗口中打开" });
  const account = page.getByRole("button", { name: "Bitwarden 账户 evidence@example.test" });

  await expect(newButton).toHaveAttribute("bitbutton", "");
  await expect(newButton).toHaveAttribute("aria-haspopup", "menu");
  await expect(newButton).not.toHaveAttribute("href", /.+/);
  await expect(newButton.locator(".bwi-plus")).toHaveCount(1);
  await expect(popOut).toHaveAttribute("biticonbutton", "bwi-popout");
  expect(await popOut.evaluate((element) => (element as HTMLButtonElement).tabIndex)).toBe(0);
  const accountAvatar = account.locator("bit-avatar");
  await expect(accountAvatar).toBeVisible();
  await expect(accountAvatar).toHaveAttribute("aria-hidden", "true");
  await expect(accountAvatar.locator("svg text")).toHaveText("EV");

  await newButton.evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("menuitem", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/#\/add-cipher\?type=1$/);

  const back = page.getByRole("button", { name: "返回" });
  await expect(back).toHaveAttribute("biticonbutton", "bwi-angle-left");
  expect(await back.evaluate((element) => (element as HTMLButtonElement).tabIndex)).toBe(0);
  await back.click();
  await expect(page).toHaveURL(/#\/tabs\/vault$/);

  await openPopulatedVault(page);
  await page.screenshot({ path: evidenceCapturePath(testInfo, evidencePath), animations: "disabled" });
});

test("wraps keyboard focus through the pinned root sentinels", async ({ page }) => {
  await openPopulatedVault(page);

  const focusableControls = page.locator(
    "barwarden-root button:not([disabled]):visible, barwarden-root a[href]:visible, barwarden-root input:not([disabled]):visible, barwarden-root [tabindex]:not([tabindex='-1']):visible",
  );
  const first = focusableControls.first();
  const last = focusableControls.last();

  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
});

async function openPopulatedVault(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?vaultEvidence=populated");
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault$/);
  await expect(page.getByRole("heading", { name: "密码库", exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })))
    .toEqual({ width: 480, height: 600, dpr: 1 });
}
