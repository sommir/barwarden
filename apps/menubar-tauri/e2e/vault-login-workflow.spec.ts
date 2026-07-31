import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g2-login-2026-07-13",
);

mkdirSync(evidenceDirectory, { recursive: true });
const recoveryEvidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13",
);
mkdirSync(recoveryEvidenceDirectory, { recursive: true });

const states = [
  ["login-detail", "查看登录"],
  ["login-detail-reprompt", "查看登录"],
  ["login-history", "密码历史记录"],
  ["login-history-empty", "密码历史记录"],
  ["login-history-protected", "查看登录"],
  ["login-add", "新增登录"],
  ["login-edit", "编辑登录"],
  ["login-clone", "克隆登录"],
  ["login-archive", "归档"],
  ["login-trash", "回收站"],
] as const;

for (const [state, heading] of states) {
  test(`captures sanitized ${state}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?vaultEvidence=${state}`);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
      width: 480,
      height: 600,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    expect(page.url()).not.toMatch(/[?&](?:password|totp|username)=/i);
    expect(await page.locator("body").innerText()).not.toMatch(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    );

    await page.screenshot({
      path: evidenceCapturePath(testInfo, join(evidenceDirectory, `${state}-480x600.png`)),
      animations: "disabled",
    });
  });
}

test("protected archive and restore actions open reprompt", async ({ page }) => {
  for (const [state, action] of [
    ["login-archive", "取消归档"],
    ["login-trash", "恢复"],
  ] as const) {
    await page.goto(`/?vaultEvidence=${state}`);
    await clickLifecycleMenuAction(page, state, action);
    await expect(page.getByRole("heading", { name: "确认主密码" })).toBeVisible();
    await expect(page.getByRole("button", { name: /选项 Example Calendar$/ })).toBeVisible();
  }
});

test("permanent delete requires a second explicit confirmation", async ({ page }) => {
  await page.goto("/?vaultEvidence=login-trash");
  await clickLifecycleMenuAction(page, "login-trash", "永久删除");
  await expect(page.getByRole("heading", { name: "永久删除项目？" })).toBeVisible();
  await expect(page.getByText("此操作无法撤销。该项目将从密码库中永久删除。")).toBeVisible();
});

test("detail destructive Cancel and Escape restore the invoking action without resizing the route", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?vaultEvidence=login-detail");
  await expect(page.getByRole("heading", { name: "查看登录", exact: true })).toBeVisible();
  const routeHeight = await popupRouteHeight(page);
  const deleteButton = page.getByRole("button", { name: "删除", exact: true });

  await deleteButton.click();
  let sheet = await expectSingleOpenSheetAtRouteHeight(page, routeHeight);
  await sheet.getByRole("button", { name: "取消", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  sheet = await expectSingleOpenSheetAtRouteHeight(page, routeHeight);
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(deleteButton).toBeFocused();
});

test("reprompt and retained dirty-form sheets stay singular and route-height neutral", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?vaultEvidence=login-detail-reprompt");
  await expect(page.getByRole("heading", { name: "查看登录", exact: true })).toBeVisible();
  let routeHeight = await popupRouteHeight(page);
  const revealPassword = page.getByRole("button", { name: "显示密码", exact: true });
  await revealPassword.click();
  let sheet = await expectSingleOpenSheetAtRouteHeight(page, routeHeight);
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(revealPassword).toBeFocused();

  await page.goto("/?vaultEvidence=login-edit");
  await expect(page.getByRole("heading", { name: "编辑登录", exact: true })).toBeVisible();
  routeHeight = await popupRouteHeight(page);
  await page.getByRole("textbox", { name: "项目名称 * (必填)", exact: true }).fill("Dirty retained edit");
  const cancel = page.getByRole("button", { name: "取消", exact: true });
  await cancel.click();
  sheet = await expectSingleOpenSheetAtRouteHeight(page, routeHeight);
  await expect(sheet.getByRole("heading", { name: "放弃更改？", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "取消", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(cancel).toBeFocused();
});

test("captures official Archive and Trash recovery hierarchy", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/?vaultEvidence=login-archive");
  await expect(page.getByRole("heading", { name: "归档", exact: true })).toBeVisible();
  await captureRecovery(page, testInfo, "archive-list-480x600.png");
  await page.getByRole("button", { name: "归档选项 Example Calendar" }).click();
  await expect(page.getByRole("menuitem", { name: "取消归档", exact: true })).toBeVisible();
  await captureRecovery(page, testInfo, "archive-menu-480x600.png");

  await page.goto("/?vaultEvidence=login-trash");
  await expect(page.getByRole("heading", { name: "回收站", exact: true })).toBeVisible();
  await captureRecovery(page, testInfo, "trash-list-480x600.png");
  await clickLifecycleMenuAction(page, "login-trash", "永久删除");
  await expect(page.getByRole("heading", { name: "永久删除项目？" })).toBeVisible();
  await captureRecovery(page, testInfo, "trash-permanent-delete-confirmation-480x600.png");
});

test("opens archived and deleted records in the location-aware official detail footer", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [state, returnHeading, chip] of [
    ["login-archive", "归档", true],
    ["login-trash", "回收站", false],
  ] as const) {
    await page.goto(`/?vaultEvidence=${state}`);
    await expect(page.getByRole("heading", { name: returnHeading, exact: true })).toBeVisible();
    await page.evaluate(() => {
      location.hash = "#/view-cipher/calendar";
    });
    await expect(page.getByRole("heading", { name: "查看登录" })).toBeVisible();
    await expect(page.getByTestId("item-name")).toHaveText("Example Calendar");
    await expect(page.getByRole("button", { name: "弹出到新窗口" })).toBeVisible();
    await expect(page.getByRole("button", { name: "填入用户名字段" })).toHaveCount(0);
    if (chip) {
      await expect(page.getByRole("button", { name: "已归档" })).toBeVisible();
      await expect(page.getByRole("button", { name: "取消归档" })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "恢复" })).toBeVisible();
      await expect(page.getByRole("button", { name: "永久删除" })).toBeVisible();
    }
    await captureRecovery(page, testInfo, `${state}-detail-480x600.png`);
    await page.getByRole("button", { name: "返回" }).click();
    await expect(page.getByRole("heading", { name: returnHeading, exact: true })).toBeVisible();
  }
});

test("matches official password-history rows and keyboard copy behavior", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?vaultEvidence=login-history");
  await expect(page.getByRole("heading", { name: "密码历史记录" })).toBeVisible();
  await expect(page.locator("bit-color-password")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "复制密码" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /显示密码历史记录/ })).toHaveCount(0);

  const scrollRegion = page.locator('popup-page [data-testid="popup-layout-scroll-region"]');
  await expect(scrollRegion).toHaveCount(1);
  const historyRow = page.locator("bit-item").first();
  expect(await scrollRegion.boundingBox()).toMatchObject({ x: 0, width: 480 });
  expect(await historyRow.boundingBox()).toMatchObject({ x: 12, width: 456 });

  const firstCopy = page.getByRole("button", { name: "复制密码" }).first();
  await firstCopy.focus();
  await firstCopy.press("Enter");
  await expect(firstCopy).toBeFocused();
  await firstCopy.press("Space");
  await expect(firstCopy).toBeFocused();
  await expect(page.locator("bit-color-password").first()).toContainText("Previous-Example-4821!");
  await captureRecovery(page, testInfo, "password-history-populated-480x600.png");

  await page.goto("/?vaultEvidence=login-history-empty");
  await expect(page.getByRole("heading", { name: "密码历史记录" })).toBeVisible();
  await expect(page.getByText("列表中没有密码", { exact: true })).toBeVisible();
  await expect(page.locator("bit-color-password")).toHaveCount(0);
  await captureRecovery(page, testInfo, "password-history-empty-480x600.png");

  await page.goto("/?vaultEvidence=login-history-protected");
  await expect(page.getByRole("heading", { name: "查看登录" })).toBeVisible();
  await page.getByRole("button", { name: "密码历史记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认主密码" })).toBeVisible();
  await captureRecovery(page, testInfo, "password-history-reprompt-480x600.png");
});

async function clickLifecycleMenuAction(
  page: Page,
  state: "login-archive" | "login-trash",
  action: "取消归档" | "恢复" | "永久删除",
): Promise<void> {
  const trigger = state === "login-archive"
    ? "归档选项 Example Calendar"
    : "回收站选项 Example Calendar";
  await page.getByRole("button", { name: trigger }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function captureRecovery(page: Page, testInfo: TestInfo, fileName: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 480,
    height: 600,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({
    path: evidenceCapturePath(testInfo, join(recoveryEvidenceDirectory, fileName)),
    animations: "disabled",
  });
}

async function popupRouteHeight(page: Page): Promise<number> {
  return page.locator(".popup-window-size-source")
    .evaluate((element) => element.getBoundingClientRect().height);
}

async function expectSingleOpenSheetAtRouteHeight(
  page: Page,
  routeHeight: number,
) {
  const sheet = page.locator(".app-bottom-sheet[open]");
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toBeVisible();
  expect(await popupRouteHeight(page)).toBe(routeHeight);
  return sheet;
}
