// External Playwright harness. Keep this outside the Vitest-discovered tree.
import { expect, test } from "@playwright/test";

const serverUrl = process.env.BARWARDEN_TEST_SERVER_URL;
const email = process.env.BARWARDEN_TEST_EMAIL;
const password = process.env.BARWARDEN_TEST_PASSWORD;

test.skip(!serverUrl || !email || !password, "Real-account env vars are required");

test("captures phase 2 popup fidelity flow without committing secrets", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/Server|Server URL/).fill(serverUrl!);
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Master password").fill(password!);
  await page.getByRole("button", { name: /Log in|登录/ }).click();

  const vaultHeading = page.getByRole("heading", { name: "密码库" });
  await expect(vaultHeading).toBeVisible();

  await page.screenshot({
    path: "output/playwright/popup-fidelity-phase-2/vault-redacted.png",
    mask: [page.locator(".bit-item-group"), page.locator(".vault-item-row"), page.locator(".setting-row strong")],
  });
});
