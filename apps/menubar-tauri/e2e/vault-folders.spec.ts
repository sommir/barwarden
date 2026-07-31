import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";
import { expect, test } from "./isolated-webkit-page.fixture";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13",
);

mkdirSync(evidenceDirectory, { recursive: true });

test.describe.configure({ timeout: 120_000 });

test("renders the pinned folder list hierarchy at 480x600", async ({ page }, testInfo) => {
  page = await openFolders(page);

  await expect(page.locator("bit-item-group")).toBeVisible();
  await expect(page.locator("bit-item")).toHaveCount(2);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await expect(page.getByText("Personal", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "弹出到新窗口", exact: true })).toBeVisible();
  await expect(page.getByText(/个项目/)).toHaveCount(0);
  await expect(page.locator(".detail-card.folder-edit-card")).toHaveCount(0);
  await capture(page, testInfo, "folders-list-480x600.png");
});

test("opens the add dialog through the keyboard-safe official control", async ({ page }, testInfo) => {
  page = await openFolders(page);
  const routeHeight = await page.locator(".popup-window-size-source").evaluate((element) => element.getBoundingClientRect().height);

  const newFolder = page.getByRole("button", { name: "新增", exact: true });
  await newFolder.focus();
  await newFolder.press("Enter");
  await expect(page.getByRole("heading", { name: "新增文件夹", exact: true })).toBeVisible();
  await expect(page.locator("#folderName")).toBeFocused();
  const nativeDialog = page.locator(".app-bottom-sheet[open]");
  await expect(nativeDialog).toHaveCount(1);
  await expect(nativeDialog).toHaveAttribute("data-testid", "folder-dialog");
  expect(await page.locator(".popup-window-size-source").evaluate((element) => element.getBoundingClientRect().height))
    .toBe(routeHeight);
  expect(await page.evaluate(() => innerHeight)).toBe(600);
  const sheetStyle = await nativeDialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderTopWidth: style.borderTopWidth,
      paddingTop: style.paddingTop,
      backgroundColor: style.backgroundColor,
    };
  });
  expect(sheetStyle).toMatchObject({ borderTopWidth: "1px", paddingTop: "0px" });
  expect(sheetStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  await capture(page, testInfo, "folders-add-dialog-480x600.png");
});

test("opens the edit dialog through the keyboard-safe official control", async ({ page }, testInfo) => {
  page = await openFolders(page);
  const routeHeight = await popupRouteHeight(page);
  const editWork = page.getByRole("button", { name: "编辑文件夹 Work", exact: true });
  await editWork.focus();
  await editWork.press("Enter");
  await expect(page.getByRole("heading", { name: "编辑文件夹", exact: true })).toBeVisible();
  await expect(page.locator("#folderName")).toHaveValue("Work");
  await expectSingleOpenSheetAtRouteHeight(page, routeHeight);
  await capture(page, testInfo, "folders-edit-dialog-480x600.png");
});

test("opens the irreversible delete confirmation from the edit dialog", async ({ page }, testInfo) => {
  page = await openFolders(page);
  const routeHeight = await popupRouteHeight(page);
  await page.getByRole("button", { name: "编辑文件夹 Work", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑文件夹", exact: true })).toBeVisible();
  await expectSingleOpenSheetAtRouteHeight(page, routeHeight);
  await page.getByRole("button", { name: "删除文件夹", exact: true }).click();
  await expect(page.getByRole("heading", { name: "永久删除文件夹？", exact: true })).toBeVisible();
  await expect(page.getByText("此操作无法撤销", { exact: false })).toBeVisible();
  await expectSingleOpenSheetAtRouteHeight(page, routeHeight);
  await capture(page, testInfo, "folders-delete-confirmation-480x600.png");
});

async function openFolders(
  page: import("@playwright/test").Page,
): Promise<import("@playwright/test").Page> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    await page.goto("/?vaultEvidence=populated", { waitUntil: "commit", timeout: 20_000 });
  } catch {
    const context = page.context();
    await page.close();
    page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?vaultEvidence=populated", { waitUntil: "commit", timeout: 60_000 });
  }
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault/, { timeout: 60_000 });
  await page.evaluate(() => {
    globalThis.location.hash = "/folders";
  });
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/folders$/);
  await expect(page.getByRole("heading", { name: "文件夹", exact: true })).toBeVisible({
    timeout: 60_000,
  });
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
  return page;
}

async function capture(
  page: import("@playwright/test").Page,
  testInfo: TestInfo,
  fileName: string,
): Promise<void> {
  await page.screenshot({
    path: evidenceCapturePath(testInfo, join(evidenceDirectory, fileName)),
    animations: "disabled",
  });
}

async function popupRouteHeight(page: import("@playwright/test").Page): Promise<number> {
  return page.locator(".popup-window-size-source")
    .evaluate((element) => element.getBoundingClientRect().height);
}

async function expectSingleOpenSheetAtRouteHeight(
  page: import("@playwright/test").Page,
  routeHeight: number,
): Promise<void> {
  const sheet = page.locator(".app-bottom-sheet[open]");
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toBeVisible();
  expect(await popupRouteHeight(page)).toBe(routeHeight);
}
