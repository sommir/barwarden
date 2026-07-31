import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m2-official-popup-shell-2026-07-13",
);
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");

const shellRoutes = [
  { name: "vault", route: "/tabs/vault", query: "vaultEvidence=populated", heading: "密码库", tabbed: true },
  { name: "generator", route: "/tabs/generator", query: "vaultEvidence=populated", heading: "生成器", tabbed: true },
  { name: "send", route: "/tabs/send", query: "sendEvidence=list-populated", heading: "Send", tabbed: true },
  { name: "settings", route: "/tabs/settings", query: "vaultEvidence=populated", heading: "设置", tabbed: true },
  {
    name: "generator-history",
    route: "/generator-history",
    query: "vaultEvidence=populated",
    heading: "生成器历史记录",
    tabbed: false,
  },
] as const;

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("records reproducible M2 shell provenance and QA limits", () => {
  expect(existsSync(provenancePath)).toBe(true);

  const provenance = readFileSync(provenancePath, "utf8");
  for (const requiredText of [
    "f47b6946e01aed474875789081966d311d5b8289",
    "pinned-source-derived",
    "not-applicable",
    "Chrome extension popup was not live-observed",
    "masked regions: none",
    "VITE_BW_VAULT_EVIDENCE=true",
    "Chromium is the sole authoritative screenshot writer",
  ]) {
    expect(provenance).toContain(requiredText);
  }
});

test("captures five retained routes in both themes with floating shell navigation", async ({ page }, testInfo) => {
  const lightEvidence = new Map<string, ShellEvidence>();

  for (const theme of ["light", "dark"] as const) {
    for (const shellRoute of shellRoutes) {
      await openEvidenceRoute(page, shellRoute.query, shellRoute.route, theme);
      await expect(page.getByRole("heading", { name: shellRoute.heading, exact: true }).first()).toBeVisible();
      const shell = await assertOfficialShell(page, shellRoute.tabbed);
      const screenshot = await capture(page, testInfo, `${shellRoute.name}-${theme}-480x600.png`);
      const evidence = { ...shell, screenshotSha256: screenshot.sha256 };

      if (theme === "light") {
        lightEvidence.set(shellRoute.name, evidence);
        continue;
      }

      const light = lightEvidence.get(shellRoute.name);
      expect(light, `${shellRoute.name} light evidence`).toBeDefined();
      expect(evidence.officialSurfaceColors, `${shellRoute.name} visible official shell surfaces`).not.toHaveLength(0);
      expect(evidence.screenshotSha256, `${shellRoute.name} light/dark screenshot SHA-256`).not.toBe(
        light!.screenshotSha256,
      );
      expect(
        evidence.officialSurfaceColors.some(
          (color, index) => color !== light!.officialSurfaceColors[index],
        ),
        `${shellRoute.name} visible official shell color changes between light and dark`,
      ).toBe(true);
    }
  }
});

test("proves WebKit focus wraps through the pinned popup root", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "vaultEvidence=populated", "/tabs/vault", "light");
  await assertOfficialShell(page, true);

  const controls = page.locator(
    "barwarden-root button:not([disabled]):visible, barwarden-root a[href]:visible, barwarden-root input:not([disabled]):visible, barwarden-root [tabindex]:not([tabindex='-1']):visible",
  );
  const first = controls.first();
  const last = controls.last();

  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await capture(page, testInfo, "focus-wrap-light-480x600.png");
});

test("updates visible official surfaces when the system theme changes", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ animations: false, theme: "system" }),
    );
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/?vaultEvidence=populated");
  await expect(page.getByRole("heading", { name: "密码库", exact: true }).first()).toBeVisible();

  const surface = page.locator("popup-page > main");
  const lightColor = await surface.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/theme_dark/);
  await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightColor);

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/theme_dark/);
});

test("uses official route shells for login and retained settings routes", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await page.evaluate(() => { location.hash = "/login"; });
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.locator("popup-page > popup-header")).toHaveCount(1);

  await openEvidenceRoute(page, "vaultEvidence=populated", "/settings-password", "light");
  await expect(page.getByRole("heading", { name: "更改主密码", exact: true })).toBeVisible();
  await expect(page.locator("popup-page > popup-header")).toHaveCount(1);
});

test("captures a deterministic long title without horizontal overflow", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "vaultEvidence=long-text", "/tabs/vault", "light");
  await assertOfficialShell(page, true);

  const title = page.getByTestId("item-name").first();
  const truncationHost = title.locator("xpath=..");
  const itemContent = page.getByTestId("vault-item-content").first();
  await expect(title).toContainText("An intentionally long Vault item name");
  expect(await truncationHost.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    textOverflow: getComputedStyle(node).textOverflow,
    overflow: getComputedStyle(node).overflow,
    whiteSpace: getComputedStyle(node).whiteSpace,
  }))).toMatchObject({
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  });
  expect(await truncationHost.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(itemContent).toHaveAccessibleName(
    /An intentionally long Vault item name that must remain inside the fixed row without resizing actions/,
  );
  await capture(page, testInfo, "vault-long-title-light-480x600.png");
});

async function openEvidenceRoute(
  page: Page,
  query: string,
  route: string,
  theme: "light" | "dark",
): Promise<void> {
  await page.addInitScript((themeValue) => {
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ animations: false, theme: themeValue }),
    );
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto(`/?${query}`);
  await expect(page).toHaveURL(
    query.startsWith("sendEvidence")
      ? new RegExp(`${query}(?:#\\/tabs\\/send)?$`)
      : new RegExp(`${query}.*#\\/tabs\\/vault$`),
  );
  await page.evaluate((nextRoute) => { location.hash = nextRoute; }, route);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveURL(new RegExp(`${query}.*#${route.replace("/", "\\/")}$`));
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))).toEqual({
    width: 480,
    height: 600,
    dpr: 1,
  });
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-bw-theme", theme);
  if (theme === "dark") {
    await expect(html).toHaveClass(/theme_dark/);
  } else {
    await expect(html).not.toHaveClass(/theme_dark/);
  }
}

async function assertOfficialShell(page: Page, hasTabNavigation: boolean): Promise<ShellLayoutEvidence> {
  const shell = page.locator(
    "barwarden-root > .popup-window-size-source > bw-popup-shell > section.popup-shell",
  );
  const navigation = shell.locator("bw-floating-tab-switcher > nav.floating-tab-switcher");
  await expect(shell).toHaveCount(hasTabNavigation ? 1 : 0);
  await expect(navigation).toHaveCount(hasTabNavigation ? 1 : 0);
  await expect(page.locator("popup-tab-navigation, bit-bottom-navigation")).toHaveCount(0);
  if (hasTabNavigation) {
    const floatingGeometry = await navigation.evaluate((element) => {
      const shell = element.closest<HTMLElement>("section.popup-shell");
      const page = shell?.querySelector<HTMLElement>("popup-page");
      if (!shell || !page) throw new Error("Missing floating tab shell or routed page");
      const bounds = element.getBoundingClientRect();
      const shellBounds = shell.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        bottomInset: shellBounds.bottom - bounds.bottom,
        leftInset: bounds.left - shellBounds.left,
        rightInset: shellBounds.right - bounds.right,
        borderRadius: styles.borderRadius,
        backdropFilter: styles.backdropFilter,
        pagePaddingBottom: getComputedStyle(page).paddingBottom,
      };
    });
    expect(floatingGeometry).toMatchObject({
      borderRadius: "13px",
      pagePaddingBottom: "79px",
    });
    expect(floatingGeometry.leftInset).toBeCloseTo(14, 1);
    expect(floatingGeometry.rightInset).toBeCloseTo(14, 1);
    expect(floatingGeometry.bottomInset).toBeCloseTo(13, 1);
    expect(floatingGeometry.backdropFilter).not.toBe("none");
  }
  await expect(page.locator("popup-page")).toHaveCount(1);
  await expect(page.locator("popup-page > popup-header")).toHaveCount(1);
  await expect(page.locator('popup-page [data-testid="popup-layout-scroll-region"]')).toHaveCount(1);
  await expect(page.locator("popup-page > popup-footer")).toHaveCount(0);

  const evidence = await page.evaluate(() => {
    const scrollHost = document.querySelector<HTMLElement>(
      'popup-page [data-testid="popup-layout-scroll-region"]',
    );
    const popupPage = document.querySelector<HTMLElement>("popup-page");
    const root = document.querySelector<HTMLElement>("barwarden-root");
    const header = document.querySelector<HTMLElement>("popup-page > popup-header");
    const pageSurface = document.querySelector<HTMLElement>("popup-page > main");
    const headerSurface = document.querySelector<HTMLElement>("popup-page > popup-header > header");
    if (!scrollHost || !popupPage || !root || !header || !pageSurface || !headerSurface) {
      throw new Error("Missing official popup page scroll host");
    }
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
          style.visibility !== "hidden" && style.display !== "none" &&
          bounds.width > 0 && bounds.height > 0;
      })
      .map((element) => ({ overflowY: getComputedStyle(element).overflowY, testId: element.dataset.testid }));

    const visibleOfficialSurfaces = [pageSurface, headerSurface].filter((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });

    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      officialSurfaceColors: visibleOfficialSurfaces.map((element) => getComputedStyle(element).backgroundColor),
      scrollOwners,
    };
  });
  expect(evidence.scrollOwners).toEqual([
    { overflowY: "auto", testId: "popup-layout-scroll-region" },
  ]);
  expect(evidence.horizontalOverflow).toBe(0);
  return evidence;
}

type ShellLayoutEvidence = {
  readonly horizontalOverflow: number;
  readonly officialSurfaceColors: readonly string[];
  readonly scrollOwners: readonly { readonly overflowY: string; readonly testId?: string }[];
};

type ShellEvidence = ShellLayoutEvidence & {
  readonly screenshotSha256: string;
};

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<{ sha256: string }> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const screenshot = await page.screenshot({
    path: evidenceCapturePath(testInfo, join(evidenceDirectory, fileName)),
    animations: "disabled",
  });
  return { sha256: createHash("sha256").update(screenshot).digest("hex") };
}
