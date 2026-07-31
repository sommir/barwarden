import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { type Page } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";
import { expect, test } from "./isolated-webkit-page.fixture";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g2-personal-ciphers-2026-07-13",
);

mkdirSync(evidenceDirectory, { recursive: true });

const cardStates = [
  ["card-detail", "查看支付卡"],
  ["card-add", "新增支付卡"],
  ["card-edit", "编辑支付卡"],
  ["card-clone", "克隆支付卡"],
  ["card-archive", "归档"],
  ["card-trash", "回收站"],
] as const;

const identityStates = [
  ["identity-detail", "查看身份"],
  ["identity-add", "新增身份"],
  ["identity-edit", "编辑身份"],
  ["identity-clone", "克隆身份"],
  ["identity-archive", "归档"],
  ["identity-trash", "回收站"],
] as const;

const noteStates = [
  ["note-detail", "查看笔记"],
  ["note-add", "新增笔记"],
  ["note-edit", "编辑笔记"],
  ["note-clone", "克隆笔记"],
  ["note-archive", "归档"],
  ["note-trash", "回收站"],
] as const;

for (const [state, heading] of [...cardStates, ...identityStates, ...noteStates]) {
  test(`captures sanitized ${state}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?vaultEvidence=${state}`, { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    const titleGeometry = await page.getByRole("heading", { name: heading }).first().evaluate((node) => {
      const title = node.querySelector<HTMLElement>(".tw-truncate") ?? node;
      return { clientWidth: title.clientWidth, scrollWidth: title.scrollWidth };
    });
    expect(titleGeometry.scrollWidth).toBeLessThanOrEqual(titleGeometry.clientWidth);
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
    expect(page.url()).not.toMatch(/[?&](?:number|code|password)=/i);
    await page.screenshot({
      path: evidenceCapturePath(testInfo, join(evidenceDirectory, `${state}-480x600.png`)),
      animations: "disabled",
    });
  });
}

test("protected Card number reveal opens reprompt", async ({ page }) => {
  await page.goto("/?vaultEvidence=card-detail-reprompt", { waitUntil: "commit" });
  await page.getByRole("button", { name: "显示卡号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认主密码" })).toBeVisible();
  await expect(page.locator("#cardNumber")).toHaveAttribute("type", "password");
});

test("protected Card archive and restore actions open reprompt", async ({ page }) => {
  for (const [state, action] of [
    ["card-archive", "取消归档"],
    ["card-trash", "恢复"],
  ] as const) {
    await page.goto(`/?vaultEvidence=${state}`, { waitUntil: "commit" });
    await clickLifecycleMenuAction(page, state, action);
    await expect(page.getByRole("heading", { name: "确认主密码" })).toBeVisible();
  }
});

test("protected Identity concealed fields open reprompt", async ({ page }) => {
  await page.goto("/?vaultEvidence=identity-detail-reprompt", { waitUntil: "commit" });
  await page.getByRole("button", { name: "显示社会安全号码", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认主密码" })).toBeVisible();
  await expect(page.locator("#ssn")).toHaveAttribute("type", "password");
});

test("protected Identity archive and restore actions open reprompt", async ({ page }) => {
  for (const [state, action] of [
    ["identity-archive", "取消归档"],
    ["identity-trash", "恢复"],
  ] as const) {
    await page.goto(`/?vaultEvidence=${state}`, { waitUntil: "commit" });
    await clickLifecycleMenuAction(page, state, action);
    await expect(page.getByRole("heading", { name: "确认主密码" })).toBeVisible();
  }
});

test("protected Secure Note archive and restore actions open reprompt", async ({ page }) => {
  for (const [state, action] of [
    ["note-archive", "取消归档"],
    ["note-trash", "恢复"],
  ] as const) {
    await page.goto(`/?vaultEvidence=${state}`, { waitUntil: "commit" });
    await clickLifecycleMenuAction(page, state, action);
    await expect(page.getByRole("heading", { name: "确认主密码" })).toBeVisible();
  }
});

async function clickLifecycleMenuAction(
  page: Page,
  state: string,
  action: "取消归档" | "恢复",
): Promise<void> {
  const prefix = state.endsWith("-archive") ? "归档选项" : "回收站选项";
  await page.getByRole("button", { name: new RegExp(`^${prefix} `) }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
