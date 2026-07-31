import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";
import { assertExactEvidenceBytes, captureConsecutiveStableScreenshot } from "./evidence-integrity";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14",
);
const fixtureEmail = "auth-evidence@example.test";
const excludedAuthentication =
  /SSO|passkey|device login|approve login|log in with device|Key Connector|Duo|WebAuthn|YubiKey|\bPIN\b|biometric|device trust|trusted device|sign up|注册|通行密钥|设备登录|批准登录|生物识别|设备信任|密钥连接器/i;

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("rejects a mutated authoritative evidence image", () => {
  const authoritative = readFileSync(join(evidenceDirectory, "auth-email-light-480x600.png"));
  const mutated = Buffer.from(authoritative);
  mutated[mutated.length - 1] ^= 1;

  expect(() => assertExactEvidenceBytes(authoritative, mutated)).toThrow(
    "Fresh evidence does not match the authoritative bytes",
  );
});

test("proves official environment, email, password, and hint ancestry and keyboard order", async ({ page }, testInfo) => {
  await openAuthEvidence(page, "email", "/login");
  await expect(page.locator(
    "bw-login-page > bw-official-anonymous-shell popup-page auth-anon-layout bw-official-password-login",
  )).toHaveCount(1);
  await assertNoExcludedAuthentication(page);

  const email = page.getByTestId("login-email-input");
  await expect(email).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("login-remember-email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("login-continue-button")).toBeFocused();
  await capture(page, testInfo, "auth-email-light-480x600.png");

  await email.fill(fixtureEmail);
  await page.getByTestId("login-continue-button").click();
  const masterPassword = page.getByTestId("login-master-password-input");
  await expect(masterPassword).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "切换可见性" })).toBeFocused();
  await page.keyboard.press(testInfo.project.use.browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(page.getByRole("link", { name: "密码提示" })).toBeFocused();
  await capture(page, testInfo, "auth-master-password-480x600.png");

  await openAuthEvidence(page, "hint", "/hint");
  await expect(page.locator(
    "bw-password-hint-page > bw-official-anonymous-shell popup-page auth-anon-layout bw-official-password-hint",
  )).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: /账户电子邮箱/ })).toBeVisible();
  await capture(page, testInfo, "auth-password-hint-480x600.png");

  await openAuthEvidence(page, "environment", "/login");
  const environmentTrigger = page.getByRole("button", { name: "自托管环境", exact: true });
  await environmentTrigger.click();
  await expect(environmentTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem").filter({ hasText: "自托管环境" }).click();
  const dialog = page.getByRole("dialog", { name: "自托管环境" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-state", "open");
  await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).transform))
    .toBe("matrix(1, 0, 0, 1, 0, 0)");
  await assertContainedNativeDialog(dialog);
  await page.getByTestId("self-hosted-server-url").fill("http://invalid.example.test");
  await page.getByTestId("self-hosted-save").click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await capture(page, testInfo, "auth-environment-invalid-480x600.png");
  await page.getByTestId("self-hosted-server-url").focus();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(environmentTrigger).toBeFocused();
});

test("proves retained authenticator and email provider states with announced fixed errors", async ({ page }, testInfo) => {
  await openAuthEvidence(page, "authenticator", "/2fa");
  await expect(page.locator(
    "bw-two-factor-page > bw-official-anonymous-shell auth-anon-layout bw-official-two-factor bw-official-two-factor-authenticator",
  )).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "验证码" })).toBeVisible();
  await expect(page.getByTestId("two-factor-other-method")).toBeVisible();
  await capture(page, testInfo, "auth-two-factor-authenticator-480x600.png");

  await openAuthEvidence(page, "email-two-factor", "/2fa");
  await expect(page.locator("bw-official-two-factor bw-official-two-factor-email")).toHaveCount(1);
  await expect(page.getByTestId("two-factor-email-resend")).toBeVisible();
  await capture(page, testInfo, "auth-two-factor-email-480x600.png");

  for (const [state, message, fileName] of [
    ["offline", "无法连接到服务器。请检查网络后重试。", "auth-offline-480x600.png"],
    ["error", "无法验证代码。请重试。", "auth-error-480x600.png"],
  ] as const) {
    await openAuthEvidence(page, state, "/2fa");
    await expect(page.getByRole("alert")).toHaveText(message);
    await capture(page, testInfo, fileName);
    if (state === "error") {
      const tokenInput = page.getByRole("textbox", { name: "验证码" });
      const backButton = page.getByTestId("two-factor-back");
      await tokenInput.focus();
      for (
        let tabIndex = 0;
        tabIndex < 6 &&
        !(await backButton.evaluate((button) => button === document.activeElement));
        tabIndex += 1
      ) {
        await page.keyboard.press("Tab");
      }
      await expect(backButton).toBeFocused();
      await expect(backButton).toBeInViewport();
    }
  }
  await assertNoExcludedAuthentication(page);
});

test("proves new-device disabled and loading submit states", async ({ page }, testInfo) => {
  await openAuthEvidence(page, "new-device", "/new-device-verification");
  await expect(page.locator(
    "bw-new-device-verification-page > bw-official-anonymous-shell auth-anon-layout bw-official-new-device-verification",
  )).toHaveCount(1);
  const normalCode = page.getByRole("textbox", { name: "验证码" });
  const normalSubmit = page.getByTestId("new-device-continue");
  await normalCode.fill("654321");
  await expect(normalSubmit).not.toHaveAttribute("aria-disabled", "true");
  await capture(page, testInfo, "auth-new-device-enabled-480x600.png");

  await openAuthEvidence(page, "loading", "/new-device-verification");
  const loadingCode = page.getByRole("textbox", { name: "验证码" });
  const loadingSubmit = page.getByTestId("new-device-continue");
  await loadingCode.fill("654321");
  await expect(loadingSubmit).toHaveAttribute("aria-disabled", "true");
  await loadingSubmit.click({ force: true });
  await expect(page).toHaveURL(/#\/new-device-verification$/);
  await expect(loadingCode).toHaveValue("654321");
  await capture(page, testInfo, "auth-new-device-loading-480x600.png");
});

test("proves lock error announcement and account hierarchy with mixed lock states", async ({ page }, testInfo) => {
  await openAuthEvidence(page, "lock-error", "/lock");
  await expect(page.locator(
    "bw-lock-page > bw-official-lock popup-page bw-official-master-password-lock",
  )).toHaveCount(1);
  await page.getByTestId("lock-master-password-input").fill("synthetic-invalid-password");
  await page.getByTestId("lock-unlock-button").click();
  await expect(page.getByRole("alert")).toHaveText("主密码无效。请确认后重试。");
  await expect(page.getByTestId("lock-master-password-input")).toHaveValue("");
  await assertNoExcludedAuthentication(page);
  await capture(page, testInfo, "auth-lock-error-480x600.png");

  await openAuthEvidence(page, "account-switcher", "/account-switcher");
  await expect(page.locator("bw-official-account-switcher > popup-page auth-account")).toHaveCount(3);
  await expect(page.locator("auth-account").filter({ hasText: "evidence@example.test" })).toBeVisible();
  await expect(page.locator("auth-account").filter({ hasText: "locked-fixture@example.test" })).toBeVisible();
  await expect(page.getByText("已锁定", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /当前账户.*evidence@example\.test/ })).toBeVisible();
  await expect(
    page.locator("auth-account").filter({ hasText: "evidence@example.test" })
      .locator(".tw-font-medium.tw-text-success"),
  ).toHaveText("已激活");
  await expect(page.getByRole("button", { name: "Bitwarden 账户 evidence@example.test" })).toBeVisible();
  await assertNoExcludedAuthentication(page);
  await capture(page, testInfo, "auth-account-switcher-mixed-locks-480x600.png");

  await openAuthEvidence(page, "long-text", "/account-switcher");
  const longAccount = page.locator("auth-account").filter({
    hasText: "vault.with-a-deliberately-long-self-hosted-name.example.test",
  });
  await expect(longAccount).toBeVisible();
  const longServer = longAccount.locator(".macos-account-label").nth(1);
  await expect(longServer).toContainText("vault.with-a-deliberately-long-self-hosted-name.example.test");
  await expect(longServer).toBeVisible();
  await expectContained(longServer);
  expect(await longServer.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      overflowWrap: styles.overflowWrap,
      whiteSpace: styles.whiteSpace,
    };
  })).toEqual({
    clientHeight: expect.any(Number),
    horizontalOverflow: 0,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  });
  expect(await longServer.evaluate((element) => element.clientHeight > 20)).toBe(true);
  await expect(longAccount.getByRole("button")).toHaveAccessibleName(
    /vault\.with-a-deliberately-long-self-hosted-name\.example\.test/,
  );
  await capture(page, testInfo, "auth-account-switcher-long-text-480x600.png");
});

test("proves explicit and changing system themes without layout drift", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await openAuthEvidence(page, "light", "/login", false);
  const lightColor = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  await capture(page, testInfo, "auth-theme-light-480x600.png");

  await openAuthEvidence(page, "dark", "/login", false);
  const darkColor = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(darkColor).not.toBe(lightColor);
  await capture(page, testInfo, "auth-theme-dark-480x600.png");

  await page.emulateMedia({ colorScheme: "light" });
  await openAuthEvidence(page, "system-theme", "/login", false);
  const systemLightColor = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() =>
    page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe(systemLightColor);
  await assertViewportAndLayout(page);
  await capture(page, testInfo, "auth-theme-system-change-480x600.png");
});

async function openAuthEvidence(
  page: Page,
  state: string,
  route: string,
  setMedia = true,
): Promise<void> {
  if (setMedia) {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  }
  await page.goto(`/?authEvidence=${state}`);
  await expect(page).toHaveURL(new RegExp(`authEvidence=${state}.*#${route.replace("/", "\\/")}$`));
  await page.evaluate(() => document.fonts.ready);
  await assertViewportAndLayout(page);
  const authRouteSelector = {
    "/login": "bw-login-page",
    "/hint": "bw-password-hint-page",
    "/2fa": "bw-two-factor-page",
    "/new-device-verification": "bw-new-device-verification-page",
    "/lock": "bw-lock-page",
  }[route];
  if (authRouteSelector) {
    await assertAuthCanvas(page, authRouteSelector);
  }
  expect(page.url()).not.toMatch(/[?&](?:email|password|otp|token|host|server)=/i);
}

async function assertViewportAndLayout(page: Page): Promise<void> {
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 480,
    height: 600,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  const scrollOwners = page.locator('[data-testid="popup-layout-scroll-region"]');
  await expect(scrollOwners).toHaveCount(1);
  expect(await scrollOwners.evaluateAll((elements) =>
    elements.filter((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY)).length,
  )).toBe(1);
}

async function assertNoExcludedAuthentication(page: Page): Promise<void> {
  expect(await page.locator("body").innerText()).not.toMatch(excludedAuthentication);
  await expect(page.locator(
    '[data-testid*="sso"], [data-testid*="passkey"], [data-testid*="device-login"], [data-testid*="approve-login"], [data-testid*="device-trust"], [data-testid*="trusted-device"], [data-testid*="duo"], [data-testid*="webauthn"], [data-testid*="yubikey"], [data-testid*="pin"], [data-testid*="biometric"]',
  )).toHaveCount(0);
}

async function assertAuthCanvas(page: Page, routeSelector: string): Promise<void> {
  const canvas = await page.evaluate((selector) => {
    const route = document.querySelector<HTMLElement>(selector);
    const root = document.querySelector<HTMLElement>("barwarden-root");
    if (!route || !root) {
      return null;
    }
    const canvasColor = getComputedStyle(route).backgroundColor;
    const coverage = [0, Math.floor(innerHeight / 2), innerHeight - 1].map((y) =>
      document.elementFromPoint(innerWidth / 2, y)?.closest(selector) === route,
    );
    return {
      coverage,
      rootBackground: getComputedStyle(root).backgroundColor,
      rootHeight: root.getBoundingClientRect().height,
      routeBackground: canvasColor,
      routeHeight: route.getBoundingClientRect().height,
      viewportHeight: innerHeight,
    };
  }, routeSelector);

  expect(canvas).toEqual({
    coverage: [true, true, true],
    rootBackground: expect.any(String),
    rootHeight: expect.any(Number),
    routeBackground: expect.any(String),
    routeHeight: expect.any(Number),
    viewportHeight: 600,
  });
  expect(canvas?.rootHeight).toBeGreaterThanOrEqual(canvas?.viewportHeight ?? 0);
  expect(canvas?.routeHeight).toBeGreaterThanOrEqual(canvas?.viewportHeight ?? 0);
  expect(canvas?.rootBackground).toBe(canvas?.routeBackground);
}

async function expectContained(locator: Locator): Promise<void> {
  const contained = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const parentBox = element.parentElement?.getBoundingClientRect();
    return Boolean(parentBox && box.left >= parentBox.left && box.right <= parentBox.right);
  });
  expect(contained).toBe(true);
}

async function assertContainedNativeDialog(dialog: Locator): Promise<void> {
  const geometry = await dialog.evaluate((element) => {
    const dialogBox = element.getBoundingClientRect();
    const content = element.querySelector<HTMLElement>("form[bit-dialog]");
    const contentBox = content?.getBoundingClientRect();
    const styles = getComputedStyle(element);

    return {
      backdropFilter: styles.backdropFilter,
      background: styles.backgroundColor,
      borderBottomWidth: styles.borderBottomWidth,
      borderTopWidth: styles.borderTopWidth,
      bottom: Math.round(dialogBox.bottom),
      bottomAligned: Math.abs(dialogBox.bottom - innerHeight) <= 1,
      bottomRadius: styles.borderBottomLeftRadius,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      maxHeight: styles.maxHeight,
      padding: styles.paddingTop,
      position: styles.position,
      topRadius: styles.borderTopLeftRadius,
      transform: styles.transform,
      contentContained: Boolean(
        contentBox
        && contentBox.left >= dialogBox.left
        && contentBox.right <= dialogBox.right
      ),
    };
  });

  expect(geometry).toEqual({
    backdropFilter: "saturate(1.45) blur(28px)",
    background: "color(srgb 0.984314 0.984314 0.988235 / 0.94)",
    borderBottomWidth: "1px",
    borderTopWidth: "1px",
    bottom: 600,
    bottomAligned: true,
    bottomRadius: "0px",
    horizontalOverflow: 0,
    maxHeight: "480px",
    padding: "0px",
    position: "fixed",
    topRadius: "16px",
    transform: "matrix(1, 0, 0, 1, 0, 0)",
    contentContained: true,
  });
}

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    globalThis.scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
  });
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));

  const authoritativePath = join(evidenceDirectory, fileName);
  const freshPath = evidenceCapturePath(testInfo, authoritativePath);
  const screenshot = await captureConsecutiveStableScreenshot(page, { animations: "disabled" });
  writeFileSync(freshPath, await canonicalizeEvidencePng(page, screenshot));

  if (freshPath !== authoritativePath && testInfo.project.name === "chromium") {
    expect(() => assertExactEvidenceBytes(
      readFileSync(authoritativePath),
      readFileSync(freshPath),
    )).not.toThrow();
  }

  const paths = [freshPath, authoritativePath]
    .filter((path, index, candidates) => existsSync(path) && candidates.indexOf(path) === index);
  for (const path of paths) {
    const result = await inspectPng(page, readFileSync(path).toString("base64"));
    expect(result).toMatchObject({ width: 480, height: 600, opaque: true });
    expect(result.colors).toBeGreaterThan(16);
  }
  expect(basename(freshPath)).toBe(fileName);
}

async function canonicalizeEvidencePng(page: Page, png: Uint8Array): Promise<Buffer> {
  const base64 = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      image.data[offset] &= 0xf8;
      image.data[offset + 1] &= 0xf8;
      image.data[offset + 2] &= 0xf8;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }, Buffer.from(png).toString("base64"));
  return Buffer.from(base64, "base64");
}

async function inspectPng(page: Page, base64: string): Promise<{
  width: number;
  height: number;
  colors: number;
  opaque: boolean;
}> {
  return page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
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
  }, base64);
}
