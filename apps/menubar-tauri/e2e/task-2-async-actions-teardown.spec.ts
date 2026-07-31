import { expect, test } from "@playwright/test";

test("route-changing official header back actions do not write a destroyed loading output", async ({ page }) => {
  const destroyedOutputErrors: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("NG0953")) {
      destroyedOutputErrors.push(message.text());
    }
  });

  await openPopulatedVault(page);
  await page.locator("[bitbutton]").filter({ hasText: "新增" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("menuitem", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/#\/add-cipher\?type=1$/);
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page).toHaveURL(/#\/tabs\/vault$/);

  await page.evaluate(() => {
    globalThis.location.hash = "/folders";
  });
  await expect(page).toHaveURL(/#\/folders$/);
  await expect(page.getByRole("button", { name: "返回" })).toBeVisible();
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page).toHaveURL(/#\/vault-settings$/);

  await expect.poll(() => destroyedOutputErrors).toEqual([]);
});

async function openPopulatedVault(page: import("@playwright/test").Page) {
  await page.goto("/?vaultEvidence=populated");
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault$/);
  await expect(page.getByRole("heading", { name: "密码库", exact: true })).toBeVisible();
}
