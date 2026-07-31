import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  chromium,
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  collectEvidenceBuildIdentity,
  type EvidenceBuildIdentity,
} from "./evidence-build-identity";
import {
  replaceEvidenceDirectoryTransactionally,
} from "./evidence-directory-transaction";
import * as evidenceIntegrity from "./evidence-integrity";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m16-release-candidate-2026-07-22",
);
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");
const visualSpecPath = join(
  process.cwd(),
  "apps/menubar-tauri/e2e/m16-release-visual-accessibility.spec.ts",
);
const playwrightConfigPath = join(process.cwd(), "playwright.config.ts");
const updateEnvironmentName = "BARWARDEN_M16_UPDATE_VISUALS";
const pinnedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const manifestSchema = "m16-release-visual-accessibility-v1";
const viewport = { width: 480, height: 600, deviceScaleFactor: 1 } as const;
const screenshotTolerance = {
  differentPixels: 64,
  nonEdgeDifferentPixels: 0,
} as const;
const forbiddenPrivateMarkers = [
  "accessToken",
  "refreshToken",
  "client_secret",
  "masterPassword",
  "private-host",
  "localhost",
  "127.0.0.1",
] as const;

type Theme = "light" | "dark" | "system";
type MatrixId =
  | "vault-light"
  | "vault-dark"
  | "vault-system"
  | "login"
  | "vault-empty"
  | "vault-long"
  | "error-banner"
  | "item-detail"
  | "menu"
  | "confirmation-dialog"
  | "generator"
  | "send"
  | "settings";

interface MatrixEntry {
  readonly id: MatrixId;
  readonly fixture: string;
  readonly route: string;
  readonly theme: Theme;
  readonly effectiveTheme: "light" | "dark";
  readonly marker: string;
}

const matrix = [
  matrixEntry("vault-light", "vaultEvidence=populated", "/tabs/vault", "light", "light", "bw-vault-list-page"),
  matrixEntry("vault-dark", "vaultEvidence=populated", "/tabs/vault", "dark", "dark", "bw-vault-list-page"),
  matrixEntry("vault-system", "vaultEvidence=populated", "/tabs/vault", "system", "dark", "bw-vault-list-page"),
  matrixEntry("login", "authEvidence=email", "/login", "light", "light", "bw-login-page"),
  matrixEntry("vault-empty", "vaultEvidence=empty", "/tabs/vault", "light", "light", "bw-vault-list-page bit-no-items"),
  matrixEntry("vault-long", "vaultEvidence=long-text", "/tabs/vault", "light", "light", "[data-testid='item-name']"),
  matrixEntry("error-banner", "vaultEvidence=stale", "/tabs/vault", "light", "light", "[data-testid='vault-sync-retry']"),
  matrixEntry("item-detail", "vaultEvidence=login-workflow-detail-default", "/view-cipher/calendar", "light", "light", "bw-official-login-detail"),
  matrixEntry("menu", "vaultEvidence=menu-open", "/tabs/vault", "light", "light", "[role='menu']"),
  matrixEntry("confirmation-dialog", "vaultEvidence=folders-delete-confirmation", "/folders", "light", "light", "dialog[open]"),
  matrixEntry("generator", "vaultEvidence=populated", "/tabs/generator", "light", "light", "bw-official-credential-generator"),
  matrixEntry("send", "sendEvidence=list-populated", "/tabs/send", "light", "light", "bw-send-page"),
  matrixEntry("settings", "settingsEvidence=settings-main", "/tabs/settings", "system", "light", "bw-settings-page"),
] as const satisfies readonly MatrixEntry[];

const screenshotFiles = matrix.map(({ id }) => `${id}-480x600.png`);
const pendingAuthorities = new Map<string, Buffer>();
let writerSourceRevision: string | null = null;
let writerBuildIdentity: EvidenceBuildIdentity | null = null;
let writerPlaywrightConfigSha256: string | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(({ browser }, testInfo) => {
  if (!isAuthorityWriter(testInfo)) return;
  writerSourceRevision = assertVisualSourceStable();
  writerBuildIdentity = collectEvidenceBuildIdentity(
    process.cwd(),
    browser.version(),
    chromium.executablePath(),
  );
  writerPlaywrightConfigSha256 = sha256(readFileSync(playwrightConfigPath));
  mkdirSync(evidenceDirectory, { recursive: true });
});

test("locks the exact matrix and Chromium-only writer contract", () => {
  expect(matrix.map(({ id }) => id)).toEqual([
    "vault-light",
    "vault-dark",
    "vault-system",
    "login",
    "vault-empty",
    "vault-long",
    "error-banner",
    "item-detail",
    "menu",
    "confirmation-dialog",
    "generator",
    "send",
    "settings",
  ]);
  expect(new Set(matrix.map(({ id }) => id)).size).toBe(matrix.length);
  expect(isAuthorityWriterProject("chromium", "chromium", { [updateEnvironmentName]: "true" })).toBe(true);
  expect(isAuthorityWriterProject("webkit", "webkit", { [updateEnvironmentName]: "true" })).toBe(false);
  expect(isAuthorityWriterProject("webkit-read-only", "webkit", { [updateEnvironmentName]: "true" })).toBe(false);
  expect(isAuthorityWriterProject("chromium", "chromium", {})).toBe(false);
});

test("requires a complete secret-free manifest and provenance in read-only mode", async ({ browser }, testInfo) => {
  if (isAuthorityWriter(testInfo)) return;
  const manifest = validateAuthoritySet(evidenceDirectory);
  expect(existsSync(provenancePath)).toBe(true);
  const provenance = readFileSync(provenancePath, "utf8");
  expect(provenance).toContain("Chromium is the sole authoritative screenshot writer");
  expect(provenance).toContain("WebKit is read-only");
  expect(provenance).toContain(
    `permits at most ${screenshotTolerance.differentPixels} edge pixels`,
  );
  expect(provenance).toContain(`Source revision: \`${manifest.source.revision}\``);
  expect(provenance).toContain(`Source SHA-256: \`${manifest.source.visualSpecSha256}\``);
  expect(provenance).toContain(`Browser executable SHA-256: \`${manifest.browser.executableSha256}\``);
  for (const authority of manifest.authorities) {
    expect(provenance).toContain(`| ${authority.file} | ${authority.sha256} |`);
  }
  assertNoPrivateManifestData(manifest, provenance);

  if (testInfo.project.name === "chromium") {
    const currentIdentity = collectEvidenceBuildIdentity(
      process.cwd(),
      browser.version(),
      chromium.executablePath(),
    );
    expect(manifest.browser.version).toBe(browser.version());
    expect(manifest.browser.executableSha256).toBe(currentIdentity.authorityBrowserExecutableSha256);
    expect(manifest.browser.runtimeTreeSha256).toBe(currentIdentity.authorityBrowserRuntimeTreeSha256);
    expect(manifest.source.productionBundleTreeSha256).toBe(currentIdentity.productionBundleTreeSha256);
    expect(manifest.source.packageLockSha256).toBe(currentIdentity.packageLockSha256);
  }
});

for (const entry of matrix) {
  test(`proves ${entry.id} release visual and accessibility state`, async ({ page }, testInfo) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
    });

    await openMatrixEntry(page, entry);
    await prepareMatrixEntry(page, entry);
    await expect(page.locator(entry.marker).first()).toBeVisible();
    await assertOfficialOwnership(page, entry);
    await assertFixedGeometry(page);
    await assertAccessibleIconButtons(page);
    await assertKeyboardOrderAndFocusRing(page);
    await assertThemeContrast(page, entry);
    await assertLongLabelsRemainContained(page, entry);

    const image = await captureStableOutput(page, testInfo, entry);
    await assertScreenshotPixels(page, image);
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(image, forbiddenPrivateMarkers);
    expect(externalRequests).toEqual([]);

    if (isAuthorityWriter(testInfo)) {
      pendingAuthorities.set(fileFor(entry), image);
    } else if (testInfo.project.name === "chromium") {
      const authorityPath = join(evidenceDirectory, fileFor(entry));
      expect(existsSync(authorityPath), `${entry.id} Chromium authority must exist`).toBe(true);
      const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(
        page,
        readFileSync(authorityPath),
        image,
      );
      expect(comparison.differentPixels, `${entry.id} anti-alias edge pixel count`)
        .toBeLessThanOrEqual(screenshotTolerance.differentPixels);
      expect(comparison.nonEdgeDifferentPixels ?? 0, `${entry.id} non-edge pixel drift`)
        .toBe(screenshotTolerance.nonEdgeDifferentPixels);
    }

    await assertOverlayKeyboardClosure(page, entry);
  });
}

test("publishes the complete Chromium authority set atomically", ({ browser }, testInfo) => {
  test.skip(!isAuthorityWriter(testInfo), "Explicit Chromium update mode is the sole authority writer");
  evidenceIntegrity.assertExactPngEvidenceInventory([...pendingAuthorities.keys()], screenshotFiles);
  const sourceRevision = writerSourceRevision;
  const identity = writerBuildIdentity;
  const playwrightConfigSha256 = writerPlaywrightConfigSha256;
  if (!sourceRevision || !identity || !playwrightConfigSha256) {
    throw new Error("M16 writer preflight identity is unavailable");
  }

  replaceEvidenceDirectoryTransactionally(evidenceDirectory, (stageDirectory) => {
    for (const entry of readdirSync(stageDirectory)) {
      rmSync(join(stageDirectory, entry), { recursive: true, force: true });
    }
    for (const fileName of screenshotFiles) {
      const image = pendingAuthorities.get(fileName);
      if (!image) throw new Error(`Missing M16 authority ${fileName}`);
      writeFileSync(join(stageDirectory, fileName), image);
    }
    const manifest = buildManifest(
      stageDirectory,
      sourceRevision,
      identity,
      browser,
      playwrightConfigSha256,
    );
    writeFileSync(join(stageDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(stageDirectory, "PROVENANCE.md"), buildProvenance(manifest));
    validateAuthoritySet(stageDirectory);
  }, (stageDirectory) => {
    expect(stageDirectory.startsWith(`${evidenceDirectory}.transaction-stage-`)).toBe(true);
    assertVisualSourceStable(sourceRevision);
    const currentIdentity = collectEvidenceBuildIdentity(
      process.cwd(),
      browser.version(),
      chromium.executablePath(),
    );
    expect(currentIdentity).toEqual(identity);
    expect(sha256(readFileSync(playwrightConfigPath))).toBe(playwrightConfigSha256);
  });
});

function matrixEntry(
  id: MatrixId,
  fixture: string,
  route: string,
  theme: Theme,
  effectiveTheme: "light" | "dark",
  marker: string,
): MatrixEntry {
  return { id, fixture, route, theme, effectiveTheme, marker };
}

function fileFor(entry: MatrixEntry): string {
  return `${entry.id}-480x600.png`;
}

function isAuthorityWriter(testInfo: TestInfo): boolean {
  return isAuthorityWriterProject(
    testInfo.project.name,
    String(testInfo.project.use.browserName ?? ""),
    process.env,
  );
}

function isAuthorityWriterProject(
  projectName: string,
  browserName: string,
  environment: NodeJS.ProcessEnv,
): boolean {
  return environment[updateEnvironmentName] === "true"
    && projectName === "chromium"
    && browserName === "chromium";
}

function assertVisualSourceStable(expectedRevision?: string): string {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  if (expectedRevision && revision !== expectedRevision) {
    throw new Error("M16 visual source revision changed during capture");
  }
  const guardedPaths = [
    "apps/menubar-tauri/e2e/m16-release-visual-accessibility.spec.ts",
    "apps/menubar-tauri/src",
    "apps/menubar-tauri/src-tauri",
    "package.json",
    "package-lock.json",
    "vendor/bitwarden-clients",
    ":(exclude)apps/menubar-tauri/src/**/*.spec.ts",
    ":(exclude)apps/menubar-tauri/src-tauri/**/*.spec.rs",
  ];
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...guardedPaths], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  if (dirty.length > 0) {
    throw new Error(`M16 authority writer source is not committed:\n${dirty}`);
  }
  return revision;
}

async function openMatrixEntry(page: Page, entry: MatrixEntry): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-22T04:00:00.000Z"));
  await page.addInitScript(({ theme }) => {
    localStorage.clear();
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({
        animations: false,
        compactMode: false,
        fillMode: "clipboard-paste",
        showFavicons: false,
        showQuickCopyActions: true,
        theme,
      }),
    );
  }, { theme: entry.theme });
  await page.emulateMedia({
    colorScheme: entry.effectiveTheme,
    reducedMotion: "reduce",
  });
  await page.goto(`/?${entry.fixture}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("barwarden-root")).toBeVisible();
  await expect(page).toHaveURL(/#\//);
  await page.evaluate((route) => { globalThis.location.hash = route; }, entry.route);
  await expect(page).toHaveURL(new RegExp(`#${escapeRegExp(entry.route)}$`));
  await page.evaluate(() => document.fonts.ready);
  await settleFrames(page);

  expect(await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }))).toMatchObject({ width: viewport.width, height: expect.any(Number), dpr: viewport.deviceScaleFactor });
  expect(await page.evaluate(() => innerHeight)).toBeGreaterThanOrEqual(viewport.height);
  if (entry.theme !== "system") {
    await expect(page.locator("html")).toHaveAttribute("data-bw-theme", entry.theme);
  }
  if (entry.effectiveTheme === "dark") {
    await expect(page.locator("html")).toHaveClass(/theme_dark/);
  } else {
    await expect(page.locator("html")).not.toHaveClass(/theme_dark/);
  }
}

async function prepareMatrixEntry(page: Page, entry: MatrixEntry): Promise<void> {
  if (entry.id === "menu") {
    const more = page.getByRole("button", { name: "更多", exact: true }).first();
    await more.focus();
    await more.press("Enter");
    await expect(page.getByRole("menu", { name: "更多", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "查看", exact: true })).toBeFocused();
  }
  if (entry.id === "confirmation-dialog") {
    const edit = page.getByTestId("edit-folder-m10-personal");
    await edit.focus();
    await edit.press("Enter");
    const deleteFolder = page.getByRole("button", { name: "删除文件夹", exact: true });
    await expect(deleteFolder).toBeVisible();
    await deleteFolder.focus();
    await deleteFolder.press("Space");
    await expect(page.getByRole("heading", { name: "永久删除文件夹？", exact: true })).toBeVisible();
  }
}

async function assertOfficialOwnership(page: Page, entry: MatrixEntry): Promise<void> {
  await expect(page.locator("barwarden-root")).toHaveCount(1);
  await expect(page.locator("popup-page")).toHaveCount(1);
  await expect(page.locator("popup-page > popup-header")).toHaveCount(1);
  await expect(page.locator('popup-page [data-testid="popup-layout-scroll-region"]')).toHaveCount(1);

  const ownership: Partial<Record<MatrixId, string>> = {
    login:
      "barwarden-root > .popup-window-size-source > bw-login-page > bw-official-anonymous-shell > popup-page",
    "item-detail":
      "barwarden-root > .popup-window-size-source > bw-vault-item-detail-page > popup-page bw-official-login-detail",
    "confirmation-dialog":
      "barwarden-root > .popup-window-size-source > bw-folders-page > bw-official-folders popup-page",
    generator:
      "barwarden-root > .popup-window-size-source > bw-popup-shell bw-official-credential-generator",
    send: "barwarden-root > .popup-window-size-source > bw-popup-shell bw-send-page",
    settings: "barwarden-root > .popup-window-size-source > bw-popup-shell bw-settings-page",
  };
  const expected = ownership[entry.id]
    ?? "barwarden-root > .popup-window-size-source > bw-popup-shell > section.popup-shell popup-page";
  await expect(page.locator(expected)).toHaveCount(1);
  await expect(page.locator("popup-tab-navigation, bit-bottom-navigation, section.popup-shell popup-page > popup-footer")).toHaveCount(0);
  if (entry.route.startsWith("/tabs/")) {
    const navigation = page.locator("section.popup-shell bw-floating-tab-switcher > nav.floating-tab-switcher");
    await expect(navigation).toHaveCount(1);
    const geometry = await navigation.evaluate((element) => {
      const shell = element.closest<HTMLElement>("section.popup-shell");
      const popupPage = shell?.querySelector<HTMLElement>("popup-page");
      if (!shell || !popupPage) throw new Error("M16 floating navigation shell is incomplete");
      const bounds = element.getBoundingClientRect();
      const shellBounds = shell.getBoundingClientRect();
      return {
        borderRadius: getComputedStyle(element).borderRadius,
        bottomInset: shellBounds.bottom - bounds.bottom,
        leftInset: bounds.left - shellBounds.left,
        pagePaddingBottom: getComputedStyle(popupPage).paddingBottom,
        rightInset: shellBounds.right - bounds.right,
      };
    });
    expect(geometry).toMatchObject({ borderRadius: "13px", pagePaddingBottom: "79px" });
    expect(geometry.leftInset).toBeCloseTo(14, 1);
    expect(geometry.rightInset).toBeCloseTo(14, 1);
    expect(geometry.bottomInset).toBeCloseTo(13, 1);
  }
  if (entry.id === "login") {
    await expect(page.locator(
      "barwarden-root > .popup-window-size-source > bw-login-page bw-official-password-login",
    ))
      .toHaveCount(1);
  }
  await expect(page.locator(
    "[data-browser-autofill], [data-content-script], [data-native-messaging], [data-current-tab]",
  )).toHaveCount(0);
}

async function assertFixedGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("barwarden-root");
    const scrollHost = document.querySelector<HTMLElement>(
      'popup-page [data-testid="popup-layout-scroll-region"]',
    );
    if (!root || !scrollHost) throw new Error("M16 popup geometry root is incomplete");
    const visible = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none";
    };
    const candidates = [document.documentElement, document.body, root, ...root.querySelectorAll<HTMLElement>("*")];
    const scrollOwners = [...new Set(candidates)].filter((element) => {
      const style = getComputedStyle(element);
      return visible(element)
        && ["auto", "scroll"].includes(style.overflowY)
        && (element === scrollHost || element.scrollHeight > element.clientHeight + 1);
    }).map((element) => element.dataset.testid ?? element.tagName.toLowerCase());

    const overlays = [...document.querySelectorAll<HTMLElement>("dialog[open], [role=menu]")].filter(visible);
    const activeOverlay = overlays.at(-1) ?? null;
    const controls = [...document.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [role=button]:not([aria-disabled=true]), [role=menuitem]",
    )].filter((element) => visible(element) && (!activeOverlay || activeOverlay.contains(element)));
    const scrollRegionFor = (element: HTMLElement): HTMLElement | null => {
      let ancestor = element.parentElement;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (["auto", "scroll"].includes(style.overflowY)) return ancestor;
        ancestor = ancestor.parentElement;
      }
      return null;
    };
    const clipped: string[] = [];
    const occluded: string[] = [];
    const floatingNavigation = document.querySelector<HTMLElement>("nav.floating-tab-switcher");
    const floatingNavigationTop = floatingNavigation?.getBoundingClientRect().top ?? innerHeight;
    for (const control of controls) {
      const bounds = control.getBoundingClientRect();
      const inPrimaryScrollRegion = scrollHost.contains(control);
      const scrollRegion = inPrimaryScrollRegion ? scrollHost : scrollRegionFor(control);
      const scrollBounds = scrollRegion?.getBoundingClientRect();
      if (scrollBounds && (
        bounds.top < scrollBounds.top - 0.5
        || bounds.bottom > Math.min(
          scrollBounds.bottom,
          inPrimaryScrollRegion ? floatingNavigationTop : scrollBounds.bottom,
        ) + 0.5
      )) continue;
      if (bounds.bottom <= 0 || bounds.top >= innerHeight) continue;
      if (bounds.left < -0.5 || bounds.right > innerWidth + 0.5 || bounds.top < -0.5 || bounds.bottom > innerHeight + 0.5) {
        clipped.push(control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 40) ?? control.tagName);
        continue;
      }
      const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      if (target && !control.contains(target) && !target.contains(control)) {
        occluded.push(control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 40) ?? control.tagName);
      }
    }
    return {
      clipped,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      occluded,
      scrollOwners,
      viewport: { width: innerWidth, height: innerHeight },
      fullWidthChrome: [...document.querySelectorAll<HTMLElement>("popup-header, popup-footer")]
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (style.position === "fixed" || style.position === "sticky")
            && bounds.width >= innerWidth - 1;
        }).length,
    };
  });
  expect(geometry).toMatchObject({
    clipped: [],
    horizontalOverflow: 0,
    occluded: [],
    scrollOwners: ["popup-layout-scroll-region"],
    viewport: { width: viewport.width, height: expect.any(Number) },
    fullWidthChrome: 0,
  });
  expect(geometry.viewport.height).toBeGreaterThanOrEqual(viewport.height);
}

async function assertAccessibleIconButtons(page: Page): Promise<void> {
  const iconButtons = page.locator("button:visible").filter({
    has: page.locator("i.bwi, svg, bit-icon"),
  });
  for (let index = 0; index < await iconButtons.count(); index += 1) {
    const button = iconButtons.nth(index);
    if ((await button.innerText()).trim().length > 0) continue;
    await expect(button, `visible icon button ${index} must have an accessible name`)
      .toHaveAccessibleName(/\S+/);
  }
}

async function assertKeyboardOrderAndFocusRing(page: Page): Promise<void> {
  const activeOverlay = page.locator("dialog[open]:visible, [role=menu]:visible").last();
  const hasActiveOverlay = await activeOverlay.count() > 0;
  const isMenu = hasActiveOverlay && await activeOverlay.getAttribute("role") === "menu";
  const focusables = hasActiveOverlay
    ? activeOverlay.locator(
      "button:not([disabled]):visible, input:not([disabled]):visible, "
        + "a[href]:visible, [role=menuitem]:visible, "
        + "[tabindex='0']:not([aria-hidden='true']):not(.cdk-focus-trap-anchor):visible",
    )
    : page.locator(
      "popup-page button:not([disabled]):visible, popup-page a[href]:visible, "
        + "popup-page input:not([disabled]):visible, popup-page [tabindex='0']:visible",
    );
  expect(await focusables.count()).toBeGreaterThan(1);
  const first = focusables.first();
  await first.focus();
  await page.keyboard.press(isMenu ? "ArrowDown" : "Tab");
  await settleFrames(page);
  const next = page.locator(":focus");
  await expect(next).toBeVisible();
  await expect(next).not.toHaveAttribute("aria-hidden", "true");
  expect(await next.evaluate((element) => element !== document.body)).toBe(true);
  expect(await next.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  const focusPainted = await next.evaluate((element) => {
    const colorIsVisible = (value: string) => {
      if (value.startsWith("color(")) return !/\/\s*0(?:\)|\s)/.test(value);
      const colors = [...value.matchAll(/rgba?\(([^)]+)\)/g)];
      return colors.some((match) => {
        const channels = match[1]!.split(/[ ,/]+/).filter(Boolean);
        return channels.length < 4 || Number(channels[3]) > 0;
      });
    };
    let host: HTMLElement | null = element as HTMLElement;
    for (let depth = 0; host && depth < 4; depth += 1, host = host.parentElement) {
      const style = getComputedStyle(host);
      const visibleOutline = style.outlineStyle !== "none"
        && Number.parseFloat(style.outlineWidth) > 0
        && colorIsVisible(style.outlineColor);
      const visibleShadow = style.boxShadow !== "none" && colorIsVisible(style.boxShadow);
      if (visibleOutline || visibleShadow) return true;
    }
    return false;
  });
  expect(focusPainted, "keyboard focus must paint a visible ring or outline").toBe(true);
  const nextBox = await next.boundingBox();
  await page.keyboard.press(isMenu ? "ArrowUp" : "Shift+Tab");
  await expect(first).toBeFocused();

  const firstBox = await first.boundingBox();
  if (firstBox && nextBox) {
    const firstCenter = {
      x: firstBox.x + firstBox.width / 2,
      y: firstBox.y + firstBox.height / 2,
    };
    const nextCenter = {
      x: nextBox.x + nextBox.width / 2,
      y: nextBox.y + nextBox.height / 2,
    };
    const visuallyForward = nextCenter.y > firstCenter.y - 1
      || (Math.abs(nextCenter.y - firstCenter.y) < 1 && nextCenter.x >= firstCenter.x);
    expect(visuallyForward, "Tab order must follow visual top-to-bottom/left-to-right order").toBe(true);
  }
}

async function assertThemeContrast(page: Page, entry: MatrixEntry): Promise<void> {
  const contrast = await page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const authorities = [...document.querySelectorAll<HTMLElement>(
      "h1, h2, [role=heading], label, legend",
    )].filter(visible);
    if (authorities.length === 0) {
      throw new Error("M16 state has no visible text authority for theme contrast");
    }
    const parse = (value: string): [number, number, number] | null => {
      const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const ratioFor = (authority: HTMLElement) => {
      let backgroundHost: HTMLElement | null = authority;
      let background: [number, number, number] | null = null;
      while (backgroundHost && !background) {
        const style = getComputedStyle(backgroundHost);
        if (!/^rgba\([^)]*,\s*0\)$/.test(style.backgroundColor) && style.backgroundColor !== "transparent") {
          background = parse(style.backgroundColor);
        }
        backgroundHost = backgroundHost.parentElement;
      }
      const foreground = parse(getComputedStyle(authority).color);
      if (!foreground || !background) throw new Error("Unable to resolve shipped theme colors");
      const luminance = ([red, green, blue]: [number, number, number]) => {
        const channels = [red, green, blue].map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return {
        label: authority.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || authority.tagName,
        ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      };
    };
    return {
      authorities: authorities.map(ratioFor),
      theme: document.documentElement.dataset.bwTheme,
    };
  });
  for (const authority of contrast.authorities) {
    expect(authority.ratio, `${entry.id} text contrast: ${authority.label}`).toBeGreaterThanOrEqual(4.5);
  }
  if (entry.theme !== "system") expect(contrast.theme).toBe(entry.theme);
}

async function assertLongLabelsRemainContained(page: Page, entry: MatrixEntry): Promise<void> {
  const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
    "button, a[href], label",
  )].flatMap((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (bounds.width <= 0 || bounds.height <= 0
      || style.visibility === "hidden" || style.display === "none") return [];
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      let ancestor = node.parentElement;
      let visuallyHidden = false;
      let intentionallyTruncated = false;
      while (ancestor) {
        const ancestorStyle = getComputedStyle(ancestor);
        const ancestorBounds = ancestor.getBoundingClientRect();
        if (ancestorStyle.overflow === "hidden" && ancestorStyle.textOverflow === "ellipsis") {
          intentionallyTruncated = true;
        }
        if (ancestorStyle.clip !== "auto"
          || ancestorStyle.clipPath !== "none"
          || ancestorStyle.opacity === "0"
          || (ancestorBounds.width <= 1 && ancestorBounds.height <= 1
            && ancestorStyle.overflow === "hidden")) {
          visuallyHidden = true;
          break;
        }
        if (ancestor === element) break;
        ancestor = ancestor.parentElement;
      }
      if (node.data.trim().length > 0 && !visuallyHidden && !intentionallyTruncated) {
        textNodes.push(node);
      }
    }
    const escaped = textNodes.flatMap((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter((rect) =>
        rect.width > 0 && rect.height > 0 && (
          rect.left < bounds.left - 1
          || rect.right > bounds.right + 1
          || rect.top < bounds.top - 1
          || rect.bottom > bounds.bottom + 1
        ));
    });
    return escaped.length === 0 ? [] : [{
      label: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80),
      escapedGlyphRects: escaped.length,
    }];
  }));
  expect(overflow).toEqual([]);

  if (entry.id === "vault-long") {
    const title = page.getByTestId("item-name").first();
    await expect(title).toContainText("An intentionally long Vault item name");
    const host = title.locator("xpath=..");
    expect(await host.evaluate((element) => ({
      clipped: element.scrollWidth > element.clientWidth,
      overflow: getComputedStyle(element).overflow,
      textOverflow: getComputedStyle(element).textOverflow,
    }))).toEqual({ clipped: true, overflow: "hidden", textOverflow: "ellipsis" });
    await expect(title.locator("xpath=ancestor::button[1]")).toHaveAccessibleName(
      /An intentionally long Vault item name/,
    );
  }
}

async function captureStableOutput(
  page: Page,
  testInfo: TestInfo,
  entry: MatrixEntry,
): Promise<Buffer> {
  if (entry.id === "confirmation-dialog") {
    await page.locator("dialog[open] h2[tabindex='-1']").last().focus();
  } else if (entry.id !== "menu") {
    await page.locator("popup-page").evaluate((element) => {
      const popup = element as HTMLElement;
      popup.tabIndex = -1;
      popup.focus({ preventScroll: true });
    });
  }
  await settleFrames(page);
  return evidenceIntegrity.captureConsecutiveStableScreenshot(page, {
    animations: "disabled",
    path: testInfo.outputPath(fileFor(entry)),
  }, 6);
}

async function assertScreenshotPixels(page: Page, image: Buffer): Promise<void> {
  const pixels = await page.evaluate(async (source) => {
    const bitmap = new Image();
    bitmap.src = source;
    await bitmap.decode();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.naturalWidth;
    canvas.height = bitmap.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    const colors = new Set<string>();
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 255) opaque += 1;
      colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
    }
    return { width: canvas.width, height: canvas.height, opaque, colors: colors.size };
  }, `data:image/png;base64,${image.toString("base64")}`);
  expect(pixels).toMatchObject({ width: viewport.width, height: viewport.height, opaque: viewport.width * viewport.height });
  expect(pixels.colors).toBeGreaterThan(16);
}

async function assertOverlayKeyboardClosure(page: Page, entry: MatrixEntry): Promise<void> {
  if (entry.id === "menu") {
    const more = page.getByRole("button", { name: "更多", exact: true }).first();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "更多", exact: true })).toHaveCount(0);
    await expect(more).toBeFocused();
  }
  if (entry.id === "confirmation-dialog") {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "永久删除文件夹？", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "删除文件夹", exact: true })).toBeFocused();
  }
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

interface M16Manifest {
  readonly schema: typeof manifestSchema;
  readonly source: {
    readonly revision: string;
    readonly visualSpecSha256: string;
    readonly playwrightConfigSha256: string;
    readonly productionBundleTreeSha256: string;
    readonly packageLockSha256: string;
    readonly vendorRevision: string;
  };
  readonly browser: {
    readonly name: "Chromium";
    readonly version: string;
    readonly executableSha256: string;
    readonly runtimeTreeSha256: string;
  };
  readonly writer: {
    readonly project: "chromium";
    readonly updateEnvironment: typeof updateEnvironmentName;
  };
  readonly viewport: typeof viewport;
  readonly authorities: readonly {
    readonly id: MatrixId;
    readonly fixture: string;
    readonly route: string;
    readonly theme: Theme;
    readonly effectiveTheme: "light" | "dark";
    readonly file: string;
    readonly sha256: string;
  }[];
  readonly evidenceSetSha256: string;
  readonly privacy: {
    readonly fixtures: "deterministic-sanitized-only";
    readonly externalRequests: "none";
    readonly maskedRegions: "none";
    readonly privateData: "none";
  };
}

function buildManifest(
  directory: string,
  sourceRevision: string,
  identity: EvidenceBuildIdentity,
  browser: Browser,
  playwrightConfigSha256: string,
): M16Manifest {
  const authorities = matrix.map((entry) => ({
    id: entry.id,
    fixture: entry.fixture,
    route: entry.route,
    theme: entry.theme,
    effectiveTheme: entry.effectiveTheme,
    file: fileFor(entry),
    sha256: sha256(readFileSync(join(directory, fileFor(entry)))),
  }));
  const source = {
    revision: sourceRevision,
    visualSpecSha256: sha256(readFileSync(visualSpecPath)),
    playwrightConfigSha256,
    productionBundleTreeSha256: identity.productionBundleTreeSha256,
    packageLockSha256: identity.packageLockSha256,
    vendorRevision: pinnedVendorRevision,
  };
  const browserIdentity = {
    name: "Chromium" as const,
    version: browser.version(),
    executableSha256: identity.authorityBrowserExecutableSha256,
    runtimeTreeSha256: identity.authorityBrowserRuntimeTreeSha256,
  };
  return {
    schema: manifestSchema,
    source,
    browser: browserIdentity,
    writer: { project: "chromium", updateEnvironment: updateEnvironmentName },
    viewport,
    authorities,
    evidenceSetSha256: computeManifestEvidenceSetSha256(source, browserIdentity, authorities),
    privacy: {
      fixtures: "deterministic-sanitized-only",
      externalRequests: "none",
      maskedRegions: "none",
      privateData: "none",
    },
  };
}

function buildProvenance(manifest: M16Manifest): string {
  const rows = manifest.authorities.map((authority) =>
    `| ${authority.file} | ${authority.sha256} | ${authority.fixture} | ${authority.route} | ${authority.theme} |`,
  ).join("\n");
  return `# M16 Release Visual And Accessibility Provenance

- Source revision: \`${manifest.source.revision}\`
- Source SHA-256: \`${manifest.source.visualSpecSha256}\`
- Playwright config SHA-256: \`${manifest.source.playwrightConfigSha256}\`
- Production bundle tree SHA-256: \`${manifest.source.productionBundleTreeSha256}\`
- Package lock SHA-256: \`${manifest.source.packageLockSha256}\`
- Vendor revision: \`${manifest.source.vendorRevision}\`
- Authority browser: Chromium ${manifest.browser.version}
- Browser executable SHA-256: \`${manifest.browser.executableSha256}\`
- Browser runtime tree SHA-256: \`${manifest.browser.runtimeTreeSha256}\`
- Evidence set SHA-256: \`${manifest.evidenceSetSha256}\`
- Viewport: exactly 480x600 CSS pixels at DPR 1 with reduced motion and loaded fonts.
- Chromium is the sole authoritative screenshot writer, enabled only by \`${updateEnvironmentName}=true\` in project \`chromium\`.
- WebKit is read-only and runs the same ownership, geometry, accessibility, keyboard, contrast, and pixel-integrity checks without writing this directory.
- Read-only Chromium replay permits at most ${screenshotTolerance.differentPixels} edge pixels; any non-edge pixel drift fails.
- Fixtures: deterministic sanitized local evidence states only; reserved \`example.test\` values where visible.
- Private data: none. External requests: none. Masked regions: none.
- These images prove the retained official-source UI in this repository; they are not live account or official Chrome-extension captures.

| Image | Image SHA-256 | Fixture | Route | Theme |
| --- | --- | --- | --- | --- |
${rows}
`;
}

function validateAuthoritySet(directory: string): M16Manifest {
  const expectedEntries = [...screenshotFiles, "manifest.json", "PROVENANCE.md"].sort();
  expect(readdirSync(directory).sort()).toEqual(expectedEntries);
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as M16Manifest;
  expect(manifest.schema).toBe(manifestSchema);
  expect(manifest.source.vendorRevision).toBe(pinnedVendorRevision);
  expect(manifest.source.revision).toMatch(/^[0-9a-f]{40}$/);
  execFileSync("git", ["cat-file", "-e", `${manifest.source.revision}^{commit}`], { cwd: process.cwd() });
  expect(manifest.source.visualSpecSha256).toBe(sha256(readFileSync(visualSpecPath)));
  expect(manifest.source.playwrightConfigSha256).toBe(sha256(readFileSync(playwrightConfigPath)));
  expect(manifest.writer).toEqual({ project: "chromium", updateEnvironment: updateEnvironmentName });
  expect(manifest.viewport).toEqual(viewport);
  expect(manifest.authorities).toHaveLength(matrix.length);
  expect(manifest.authorities.map(({ id }) => id)).toEqual(matrix.map(({ id }) => id));
  for (const [index, authority] of manifest.authorities.entries()) {
    const entry = matrix[index]!;
    expect(authority).toMatchObject({
      id: entry.id,
      fixture: entry.fixture,
      route: entry.route,
      theme: entry.theme,
      effectiveTheme: entry.effectiveTheme,
      file: fileFor(entry),
    });
    expect(authority.sha256).toBe(sha256(readFileSync(join(directory, authority.file))));
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(
      readFileSync(join(directory, authority.file)),
      forbiddenPrivateMarkers,
    );
  }
  expect(manifest.evidenceSetSha256).toBe(computeManifestEvidenceSetSha256(
    manifest.source,
    manifest.browser,
    manifest.authorities,
  ));
  assertNoPrivateManifestData(manifest, readFileSync(join(directory, "PROVENANCE.md"), "utf8"));
  return manifest;
}

function assertNoPrivateManifestData(manifest: M16Manifest, provenance: string): void {
  const text = `${JSON.stringify(manifest)}\n${provenance}`;
  expect(text).not.toMatch(/(?:password|token|secret|otp|key)=/i);
  expect(text).not.toMatch(/https?:\/\/(?![^\s"`]*example\.test)[^\s"`)]+/i);
  expect(text).not.toMatch(/@[a-z0-9.-]+\.(?!test\b)[a-z]{2,}/i);
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function computeManifestEvidenceSetSha256(
  source: M16Manifest["source"],
  browser: M16Manifest["browser"],
  authorities: M16Manifest["authorities"],
): string {
  return sha256(JSON.stringify({ schema: manifestSchema, source, browser, authorities }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
