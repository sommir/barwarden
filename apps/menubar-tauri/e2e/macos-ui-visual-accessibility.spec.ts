import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, expect, test, type Page, type TestInfo } from "@playwright/test";

import { collectEvidenceBuildIdentity, type EvidenceBuildIdentity } from "./evidence-build-identity";
import { replaceEvidenceDirectoryTransactionally } from "./evidence-directory-transaction";
import * as evidenceIntegrity from "./evidence-integrity";
import { assertCleanEvidenceWriterTree } from "./evidence-source-guard";

const evidenceDirectory = join(process.cwd(), "docs/superpowers/screenshots/macos-ui-2026-07-25");
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");
const updateEnvironmentName = "BARWARDEN_MACOS_UI_UPDATE_VISUALS";
const viewport = { width: 480, height: 600 } as const;
const pinnedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const forbiddenMarkers = ["accessToken", "refreshToken", "masterPassword", "private-host", "localhost", "127.0.0.1"] as const;

type Theme = "light" | "dark";

interface MatrixEntry {
  readonly id: string;
  readonly query: string;
  readonly route?: string;
  readonly theme: Theme;
  readonly marker: string;
  readonly mainRoute?: boolean;
  readonly action?: "menu" | "folder-sheet" | "about-sheet" | "send-error";
  readonly preference?: "transparency" | "contrast";
  readonly tall?: boolean;
  readonly routeHeading?: string;
}

const matrix: readonly MatrixEntry[] = [
  entry("vault-light", "vaultEvidence=populated", "/tabs/vault", "light", "bw-vault-list-page", true),
  entry("vault-dark", "vaultEvidence=populated", "/tabs/vault", "dark", "bw-vault-list-page", true),
  entry("vault-expanded-light", "vaultEvidence=long-text", "/tabs/vault", "light", "[data-testid='item-name']", true, undefined, undefined, true),
  entry("vault-expanded-dark", "vaultEvidence=long-text", "/tabs/vault", "dark", "[data-testid='item-name']", true, undefined, undefined, true),
  entry("login", "authEvidence=email", undefined, "light", "bw-login-page"),
  entry("vault-populated", "vaultEvidence=populated", "/tabs/vault", "light", "[data-testid='item-name']", true),
  entry("vault-empty", "vaultEvidence=empty", "/tabs/vault", "light", "bit-no-items", true),
  entry("vault-long", "vaultEvidence=long-text", "/tabs/vault", "light", "[data-testid='item-name']", true),
  entry("vault-stale", "vaultEvidence=stale", "/tabs/vault", "light", "[data-testid='vault-sync-retry']", true),
  entry("vault-detail", "vaultEvidence=login-workflow-detail-default", "/view-cipher/calendar", "light", "bw-official-login-detail"),
  entry("vault-edit", "vaultEvidence=login-workflow-form-add", "/add-cipher?type=1", "light", "form"),
  entry("generator", "vaultEvidence=populated", "/tabs/generator", "light", "bw-official-credential-generator", true),
  entry("generator-history", "vaultEvidence=populated", "/generator-history", "light", "bw-official-generator-history"),
  entry("send-list", "sendEvidence=list-populated", undefined, "light", "bw-send-page", true),
  entry("send-form", "sendEvidence=form-add", undefined, "light", "popup-page h1", false, undefined, undefined, false, "新增文本 Send"),
  entry("send-created", "sendEvidence=created", undefined, "light", "popup-page h1", false, undefined, undefined, false, "已创建 Send"),
  entry("send-disabled", "sendEvidence=list-disabled", undefined, "light", "bit-callout.send-disabled-callout", true),
  entry("settings", "settingsEvidence=settings-main", undefined, "light", "bw-settings-page", true),
  entry("about", "settingsEvidence=about", undefined, "light", "popup-page h1", false, undefined, undefined, false, "关于"),
  entry("anchored-menu", "vaultEvidence=menu-open", "/tabs/vault", "light", "[role='menu']", true, "menu"),
  entry("bottom-sheet", "settingsEvidence=about-dialog", undefined, "light", ".app-bottom-sheet[open]", false, "about-sheet"),
  entry("validation-error", "sendEvidence=mutation-error", undefined, "light", "[data-testid='send-password-error']", false, "send-error"),
  entry("destructive-confirmation", "vaultEvidence=folders-delete-confirmation", "/folders", "light", "dialog[open]", false, "folder-sheet"),
  entry("reduced-transparency", "vaultEvidence=populated", "/tabs/vault", "light", "bw-vault-list-page", true, undefined, "transparency"),
  entry("increased-contrast", "vaultEvidence=populated", "/tabs/vault", "light", "bw-vault-list-page", true, undefined, "contrast"),
] as const;

const screenshotFiles = matrix.map(({ id }) => `${id}-480x600.png`);
const pendingAuthorities = new Map<string, Buffer>();
let writerRevision: string | null = null;
let writerIdentity: EvidenceBuildIdentity | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(({ browser }, testInfo) => {
  if (!isWriter(testInfo)) return;
  writerRevision = assertCleanEvidenceWriterTree();
  writerIdentity = collectEvidenceBuildIdentity(process.cwd(), browser.version(), chromium.executablePath());
});

test("locks the complete deterministic macOS acceptance matrix", () => {
  expect(matrix.map(({ id }) => id)).toEqual([
    "vault-light", "vault-dark", "vault-expanded-light", "vault-expanded-dark", "login",
    "vault-populated", "vault-empty", "vault-long", "vault-stale", "vault-detail", "vault-edit",
    "generator", "generator-history", "send-list", "send-form", "send-created", "send-disabled",
    "settings", "about", "anchored-menu", "bottom-sheet", "validation-error", "destructive-confirmation",
    "reduced-transparency", "increased-contrast",
  ]);
  expect(new Set(screenshotFiles).size).toBe(matrix.length);
  expect(isWriterProject("chromium", "chromium", { [updateEnvironmentName]: "true" })).toBe(true);
  expect(isWriterProject("webkit", "webkit", { [updateEnvironmentName]: "true" })).toBe(false);
});

test("requires the macOS UI acceptance authority before read-only verification", ({}, testInfo) => {
  if (isWriter(testInfo)) return;
  validateAuthoritySet(evidenceDirectory);
  const provenance = readFileSync(provenancePath, "utf8");
  expect(provenance).toContain("Chromium is the sole authoritative screenshot writer.");
  expect(provenance).toContain("Chromium and WebKit verification are read-only.");
  expect(provenance).toContain(`Source revision: \`${recordedSourceRevision(provenance)}\``);
});

for (const current of matrix) {
  test(`proves ${current.id} visual and accessibility acceptance`, async ({ page }, testInfo) => {
    test.skip(
      current.preference !== undefined && testInfo.project.name !== "chromium",
      "media preference emulation is verified by the authoritative Chromium engine",
    );
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
    });

    await openEntry(page, current);
    await prepareEntry(page, current);
    await expect(page.locator(current.marker).first()).toBeVisible();
    if (current.routeHeading) await expect(page.getByRole("heading", { name: current.routeHeading, exact: true })).toBeVisible();
    if (current.action === "send-error") {
      await expect(page.getByTestId("send-password-error")).toHaveAttribute("role", "status");
      await expect(page.getByTestId("send-password-error")).toContainText("无法保存 Send，请重试。");
    }
    await assertMatrixGeometry(page, current);
    await assertAccessibleRoute(page, current);
    await assertThemeAndPreferenceContract(page, current);
    if (current.tall) await assertTallContentReturnsToMinimum(page, testInfo.project.name);

    const image = await evidenceIntegrity.captureConsecutiveStableScreenshot(page, {
      animations: "disabled",
      path: testInfo.outputPath(fileFor(current)),
    }, 4);
    await assertScreenshotPixels(page, image);
    if (current.action === "menu") {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(image, forbiddenMarkers);
    expect(externalRequests).toEqual([]);

    if (isWriter(testInfo)) {
      pendingAuthorities.set(fileFor(current), image);
    } else if (testInfo.project.name === "chromium") {
      const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(
        page,
        readFileSync(join(evidenceDirectory, fileFor(current))),
        image,
      );
      expect(comparison.differentPixels).toBeLessThanOrEqual(256);
      expect(comparison.nonEdgeDifferentPixels ?? 0).toBeLessThanOrEqual(1);
    }
  });
}

test("publishes the complete Chromium authority set atomically", ({}, testInfo) => {
  test.skip(!isWriter(testInfo), "explicit Chromium update mode is the sole authority writer");
  evidenceIntegrity.assertExactPngEvidenceInventory([...pendingAuthorities.keys()], screenshotFiles);
  if (!writerRevision || !writerIdentity) throw new Error("macOS UI evidence writer preflight is unavailable");
  replaceEvidenceDirectoryTransactionally(evidenceDirectory, (stageDirectory) => {
    for (const file of readdirSync(stageDirectory)) rmSync(join(stageDirectory, file), { recursive: true, force: true });
    for (const file of screenshotFiles) writeFileSync(join(stageDirectory, file), pendingAuthorities.get(file)!);
    writeFileSync(join(stageDirectory, "PROVENANCE.md"), buildProvenance(writerRevision!, writerIdentity!, stageDirectory));
    validateAuthoritySet(stageDirectory);
  }, (stageDirectory) => {
    expect(assertCleanEvidenceWriterTree({ ignoredTransactionStage: stageDirectory })).toBe(writerRevision);
    expect(collectEvidenceBuildIdentity(process.cwd(), writerIdentity!.authorityBrowserVersion, chromium.executablePath()))
      .toEqual(writerIdentity);
  });
});

function entry(
  id: string, query: string, route: string | undefined, theme: Theme, marker: string,
  mainRoute = false, action?: MatrixEntry["action"], preference?: MatrixEntry["preference"], tall = false, routeHeading?: string,
): MatrixEntry {
  return { id, query, route, theme, marker, mainRoute, action, preference, tall, routeHeading };
}

function fileFor(entry: MatrixEntry): string { return `${entry.id}-480x600.png`; }

function isWriter(testInfo: TestInfo): boolean {
  return isWriterProject(testInfo.project.name, String(testInfo.project.use.browserName ?? ""), process.env);
}

function isWriterProject(project: string, browser: string, environment: NodeJS.ProcessEnv): boolean {
  return environment[updateEnvironmentName] === "true" && project === "chromium" && browser === "chromium";
}

async function openEntry(page: Page, current: MatrixEntry): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-25T04:00:00.000Z"));
  await page.addInitScript(({ theme }) => {
    localStorage.clear();
    localStorage.setItem("barwarden.settings", JSON.stringify({
      animations: false, compactMode: false, fillMode: "clipboard-paste", showFavicons: false,
      showQuickCopyActions: true, theme,
    }));
  }, { theme: current.theme });
  await page.emulateMedia({ colorScheme: current.theme, reducedMotion: "reduce" });
  if (current.preference === "transparency" || current.preference === "contrast") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: current.preference === "transparency" ? "prefers-reduced-transparency" : "prefers-contrast", value: current.preference === "transparency" ? "reduce" : "more" }],
    });
  }
  await page.goto(`/?${current.query}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("barwarden-root")).toBeVisible();
  await expect(page).toHaveURL(/#\//);
  if (current.route) {
    await page.evaluate((route) => { globalThis.location.hash = route; }, current.route);
    await expect(page).toHaveURL(new RegExp(`#${escapeRegExp(current.route)}$`));
  }
  await page.evaluate(() => document.fonts.ready);
  await settleFrames(page);
}

async function prepareEntry(page: Page, current: MatrixEntry): Promise<void> {
  if (current.action === "menu") {
    const trigger = page.getByRole("button", { name: "更多", exact: true }).first();
    await trigger.focus();
    await trigger.press("Enter");
  }
  if (current.action === "folder-sheet") {
    await page.getByTestId("edit-folder-m10-personal").press("Enter");
    await page.getByRole("button", { name: "删除文件夹", exact: true }).press("Space");
  }
  if (current.action === "about-sheet") {
    await page.getByRole("button", { name: "关于 Barwarden", exact: true }).press("Enter");
  }
  if (current.action === "send-error") {
    await page.getByTestId("edit-send").press("Enter");
    await page.getByLabel("Send 名称").fill("Retryable update");
    await page.getByRole("button", { name: "保存", exact: true }).press("Enter");
  }
}

async function assertMatrixGeometry(page: Page, current: MatrixEntry): Promise<void> {
  expect(await page.evaluate(() => window.innerWidth)).toBe(viewport.width);
  expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThanOrEqual(viewport.height);
  const geometry = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>("popup-page h1, popup-page h2, popup-page [role=heading]");
    if (!heading) throw new Error("macOS acceptance route has no in-flow heading");
    const bounds = heading.getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      heading: { top: bounds.top, width: bounds.width, height: bounds.height },
      topChrome: [...document.querySelectorAll<HTMLElement>("popup-header")].some((element) => {
        const style = getComputedStyle(element);
        return style.position === "fixed" || style.position === "sticky";
      }),
      fullWidthFooterChrome: [...document.querySelectorAll<HTMLElement>("popup-footer, bit-bottom-navigation, popup-tab-navigation")]
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (style.position === "fixed" || style.position === "sticky") && bounds.width >= window.innerWidth - 1;
        }).length,
    };
  });
  expect(geometry.horizontalOverflow).toBe(0);
  expect(geometry.heading).toMatchObject({ top: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
  expect(geometry.heading.height).toBeGreaterThan(0);
  expect(geometry.topChrome).toBe(false);
  expect(geometry.fullWidthFooterChrome).toBe(0);
  const navigation = page.locator("nav.floating-tab-switcher");
  if (current.mainRoute) {
    await expect(navigation).toHaveCount(1);
    await expect(navigation).toHaveAttribute("aria-label", "主要导航");
    await expect(navigation.locator("[aria-current='page']")).toHaveCount(1);
  } else {
    await expect(navigation).toHaveCount(0);
  }
}

async function assertAccessibleRoute(page: Page, current: MatrixEntry): Promise<void> {
  const focusScope = current.action === "about-sheet" || current.action === "folder-sheet"
    ? page.locator(".app-bottom-sheet[open]")
    : page;
  const control = focusScope.locator("button:not([disabled]):visible, input:not([disabled]):visible, [role=menuitem]:visible").first();
  await expect(control).toBeVisible();
  await control.focus();
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  const role = await control.getAttribute("role");
  if (role === "menuitem") await expect(control).toHaveAccessibleName(/\S+/);
  if (current.action === "menu") {
    await expect(page.getByRole("menu")).toBeVisible();
  }
}

async function assertThemeAndPreferenceContract(page: Page, current: MatrixEntry): Promise<void> {
  const result = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const navigation = document.querySelector<HTMLElement>("nav.floating-tab-switcher");
    const selected = navigation?.querySelector<HTMLElement>("[aria-current='page']");
    return {
      canvas: root.getPropertyValue("--mac-canvas").trim(),
      border: root.getPropertyValue("--mac-border").trim(),
      selectedDecoration: selected ? getComputedStyle(selected).textDecorationLine : "none",
      navigationBlur: navigation ? getComputedStyle(navigation).backdropFilter : "none",
    };
  });
  expect(result.canvas).not.toBe("");
  expect(result.border).not.toBe("");
  if (current.preference === "transparency") expect(result.navigationBlur).toBe("none");
  if (current.preference === "contrast") expect(result.selectedDecoration).toContain("underline");
}

async function assertTallContentReturnsToMinimum(page: Page, projectName: string): Promise<void> {
  const measured = await page.locator(".popup-window-size-source").evaluate((source) => {
    const tall = document.createElement("div");
    tall.style.height = "780px";
    tall.dataset.testid = "macos-ui-tall-fixture";
    source.append(tall);
    const tallHeight = source.scrollHeight;
    tall.remove();
    return { tallHeight, shortHeight: source.scrollHeight };
  });
  expect(measured.tallHeight).toBeGreaterThan(viewport.height);
  expect(measured.shortHeight).toBeLessThanOrEqual(measured.tallHeight);
  // WebKit runs in this suite's fixed viewport context; its 480×600 geometry
  // remains covered below, while Chromium exercises live native-size emulation.
  if (projectName !== "chromium") return;
  await page.setViewportSize({ width: viewport.width, height: 780 });
  const expanded = await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>(".popup-window-size-source");
    const shell = document.querySelector<HTMLElement>(".popup-window-size-source > bw-popup-shell > .popup-shell");
    const navigation = document.querySelector<HTMLElement>("nav.floating-tab-switcher");
    if (!source || !shell || !navigation) throw new Error("Tall popup shell is incomplete");
    return {
      navigationBottom: navigation.getBoundingClientRect().bottom,
      shellHeight: shell.getBoundingClientRect().height,
      sourceHeight: source.getBoundingClientRect().height,
    };
  });
  expect(expanded).toMatchObject({ sourceHeight: 780, shellHeight: 780 });
  expect(expanded.navigationBottom).toBeCloseTo(767, 1);

  await page.setViewportSize(viewport);
  const restored = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".popup-window-size-source > bw-popup-shell > .popup-shell");
    const navigation = document.querySelector<HTMLElement>("nav.floating-tab-switcher");
    if (!shell || !navigation) throw new Error("Restored popup shell is incomplete");
    return { navigationBottom: navigation.getBoundingClientRect().bottom, shellHeight: shell.getBoundingClientRect().height };
  });
  expect(restored).toMatchObject({ shellHeight: 600 });
  expect(restored.navigationBottom).toBeCloseTo(587, 1);
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
    const colors = new Set<string>();
    for (let index = 0; index < data.length; index += 4) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
    return { width: canvas.width, height: canvas.height, colors: colors.size };
  }, `data:image/png;base64,${image.toString("base64")}`);
  expect(pixels).toMatchObject({ width: 480, height: 600 });
  expect(pixels.colors).toBeGreaterThan(16);
}

function buildProvenance(revision: string, identity: EvidenceBuildIdentity, directory: string): string {
  const rows = screenshotFiles.map((file) => `| ${file} | ${sha256(readFileSync(join(directory, file)))} | 480x600 |`);
  return `# macOS UI Visual and Accessibility Evidence\n\n- Source revision: \`${revision}\`\n- Vendor revision: \`${pinnedVendorRevision}\`\n- Browser: Chromium ${identity.authorityBrowserVersion}; executable SHA-256: \`${identity.authorityBrowserExecutableSha256}\`\n- Runtime identity SHA-256: \`${identity.runtimeIdentitySha256}\`\n- Viewport: 480x600; default/minimum popup height: 600px.\n- Chromium is the sole authoritative screenshot writer.\n- Chromium and WebKit verification are read-only.\n- Evidence contains deterministic example fixtures only; no external requests, accounts, credentials, or private hosts.\n- Browser geometry records exact width and minimum height. Native placement, hardware, VoiceOver, Touch ID, and mixed-display checks remain separately recorded as not run until observed.\n\n| Authority | SHA-256 | Dimensions |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
}

function validateAuthoritySet(directory: string): void {
  const actual = readdirSync(directory).filter((file) => file.endsWith(".png")).sort();
  expect(actual).toEqual([...screenshotFiles].sort());
  expect(existsSync(join(directory, "PROVENANCE.md"))).toBe(true);
  for (const file of screenshotFiles) expect(readFileSync(join(directory, file)).subarray(1, 4).toString("ascii")).toBe("PNG");
}

function recordedSourceRevision(provenance: string): string {
  const match = provenance.match(/^- Source revision: `([0-9a-f]{40})`$/m);
  if (!match) throw new Error("macOS UI provenance source revision is missing");
  return match[1]!;
}

function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
