import { expect, test, type Locator, type Page } from "@playwright/test";

test("renders real Send copy feedback outside measured content and protects focus in both orders", async ({ page }) => {
  await openSendEvidence(page);
  const copy = page.locator('button[aria-label^="复制链接"]').first();
  const surface = page.locator("bw-app-feedback .app-feedback");
  const message = surface.locator(".app-feedback__message");
  const announcer = page.locator("bw-app-feedback .app-feedback__announcer");

  await copy.click();
  await expect(surface).toHaveAttribute("data-has-main-switcher", "true");
  await expect(announcer).toHaveText("Send link copied");
  await expect(announcer).toHaveAttribute("role", "status");
  await expect(announcer).toHaveAttribute("aria-live", "polite");
  await expect(message).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".popup-window-size-source .app-feedback")).toHaveCount(0);

  const focusControl = await addOverlappingControl(page);
  await focusControl.focus();
  await expect(surface).toHaveAttribute("data-focus-overlap", "true");
  await expect(surface).not.toHaveAttribute("aria-hidden", "true");
  await expect(message).toHaveCSS("visibility", "hidden");
  await expect(announcer).toHaveAttribute("role", "status");
  await expect(announcer).not.toHaveAttribute("aria-hidden", "true");

  await page.evaluate(() => document.querySelector("#feedback-focus-control")?.remove());
  await copy.focus();
  await expect(message).not.toHaveCSS("visibility", "hidden");
  await addOverlappingControl(page);
  await page.locator("#feedback-focus-control").focus();
  await copy.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(announcer).toHaveText("Send link copied");
  await expect(surface).toHaveAttribute("data-focus-overlap", "true");

  await page.keyboard.press("Escape");
  await expect(announcer).toHaveText("Send link copied");
});

test("moves real feedback to the lower inset when the route loses its main switcher", async ({ page }) => {
  await openSendEvidence(page);
  await page.locator('button[aria-label^="复制链接"]').first().click();
  const surface = page.locator("bw-app-feedback .app-feedback");
  await expect(surface).toHaveAttribute("data-has-main-switcher", "true");

  await page.evaluate(() => { location.hash = "/settings-password"; });
  await expect(page.getByRole("heading", { name: "更改主密码", exact: true })).toBeVisible();
  await expect(surface).toHaveAttribute("data-has-main-switcher", "false");
  await expect(surface).toHaveCSS("bottom", "20px");
});

async function openSendEvidence(page: Page): Promise<void> {
  await page.goto("/?sendEvidence=list-populated");
  await expect(page.getByRole("heading", { name: "Send", exact: true }).first()).toBeVisible();
}

async function addOverlappingControl(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const control = document.createElement("button");
    control.id = "feedback-focus-control";
    control.type = "button";
    control.textContent = "Focused control";
    control.style.cssText = "position:fixed;right:24px;bottom:70px;width:240px;height:40px;z-index:1";
    document.body.append(control);
  });
  return page.locator("#feedback-focus-control");
}
