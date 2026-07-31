import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { chromium } from "@playwright/test";

import {
  assertEvidenceBuildIdentityUnchanged,
  collectEvidenceBuildIdentity,
  computeEvidenceSetSha256,
  type EvidenceBuildIdentity,
} from "./evidence-build-identity";
import {
  recoverEvidenceDirectoryTransaction,
  replaceEvidenceDirectoryTransactionally,
} from "./evidence-directory-transaction";
import * as evidenceIntegrity from "./evidence-integrity";
import { isAuthoritativeEvidenceWriter } from "./evidence-path";
import { assertCleanEvidenceWriterTree } from "./evidence-source-guard";

const evidenceDirectory = join(process.cwd(), "docs/superpowers/screenshots/m12-text-send-2026-07-19");
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");
const screenshotFiles = [
  "send-list-populated-480x600.png",
  "send-list-loading-480x600.png",
  "send-list-empty-480x600.png",
  "send-list-no-results-480x600.png",
  "send-list-disabled-480x600.png",
  "send-view-480x600.png",
  "send-form-add-480x600.png",
  "send-form-edit-480x600.png",
  "send-created-480x600.png",
  "send-mutation-error-480x600.png",
  "send-row-actions-480x600.png",
] as const;
const pinnedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const forbiddenValues = [
  "send-fixture.invalid",
  "m12-local-fixture",
  "opaque-local-session-material",
  "local-link-material",
  "m12-text-send",
  "m12-text-access",
  "m12-created-send",
  "m12-created-access",
  "send-evidence-failure",
] as const;
const pendingAuthorities = new Map<string, Buffer>();
let evidenceWriterSourceRevision: string | null = null;
let evidenceWriterWorktreeRevision: string | null = null;
let evidenceWriterBuildIdentity: EvidenceBuildIdentity | null = null;
const maximumAntiAliasEdgePixels = 256;
const maximumAntiAliasChannelDelta = 8;

test.describe.configure({ mode: "serial" });

test.beforeAll(({ browser }, testInfo) => {
  if (!isAuthoritativeEvidenceWriter(testInfo)) return;
  recoverEvidenceDirectoryTransaction(evidenceDirectory, validateAuthoritySet);
  evidenceWriterWorktreeRevision = assertCleanEvidenceWriterTree();
  evidenceWriterSourceRevision = resolveEvidenceWriterSourceRevision(evidenceWriterWorktreeRevision);
  evidenceWriterBuildIdentity = collectEvidenceBuildIdentity(
    process.cwd(),
    browser.version(),
    chromium.executablePath(),
  );
});

test("requires exact M12 authority and provenance integrity in read-only mode", async ({ browser }, testInfo) => {
  const published = Buffer.from("published-authority");
  const fresh = Buffer.from("fresh-render");
  const comparisonPage = (differentPixels: number) => ({
    evaluate: async () => ({
      width: 480,
      height: 600,
      differentPixels,
      maxChannelDelta: 1,
      nonEdgeDifferentPixels: 0,
    }),
  }) as unknown as Page;
  await expect(selectStableAuthorityBytes(comparisonPage(81), published, fresh)).resolves.toBe(published);
  await expect(selectStableAuthorityBytes(comparisonPage(257), published, fresh)).resolves.toBe(fresh);

  expect(existsSync(provenancePath)).toBe(true);
  if (process.env.UPDATE_EVIDENCE === "true") return;
  validateAuthoritySet(evidenceDirectory);
  const provenance = readFileSync(provenancePath, "utf8");
  expect(provenance).toContain("Chromium is the sole authoritative screenshot writer");
  expect(provenance).toContain("Chromium read-only and WebKit are assertion-only");
  expect(provenance).toContain("in-flow heading and floating navigation with no footer");
  expect(provenance).toMatch(/^- Production bundle tree SHA-256: [0-9a-f]{64}$/m);
  expect(provenance).toMatch(/^- Package lock SHA-256: [0-9a-f]{64}$/m);
  expect(provenance).toMatch(/^- Playwright version: \d+\.\d+\.\d+$/m);
  expect(provenance).toMatch(/^- Host runtime: node v\d+\.\d+\.\d+; (?:darwin|linux|win32)-(?:arm64|x64)$/m);
  expect(provenance).toMatch(/^- Authority browser: Chromium [^;\n]+; executable SHA-256: [0-9a-f]{64}$/m);
  if (testInfo.project.name === "chromium") {
    expect(provenance).toContain(`- Authority browser: Chromium ${browser.version()};`);
  }
  validateRecordedBuildIdentity(provenance, testInfo.project.name === "chromium" ? browser.version() : null);
  validateRecordedSourceRevision(provenance);
  validateProvenanceHashes(provenance, evidenceDirectory);
});

test("captures all eleven real Task 1-4 route states", async ({ page }, testInfo) => {
  await openEvidence(page, "list-populated");
  await expect(page.getByRole("heading", { name: "Send", exact: true })).toBeVisible();
  await expect(page.getByText("Release instructions", { exact: true })).toBeVisible();
  await capture(page, testInfo, "send-list-populated-480x600.png");

  await openEvidence(page, "list-loading");
  await assertListChrome(page);
  await expect(page.locator('bit-item-group[aria-label="正在加载 Send"]')).toBeVisible();
  await capture(page, testInfo, "send-list-loading-480x600.png");

  await openEvidence(page, "list-loading", "no-preference");
  const skeletons = page.locator("bit-skeleton .tw-animate-pulse");
  await expect(skeletons).toHaveCount(10);
  const normalSkeletonAnimations = await skeletonAnimations(skeletons);
  expect(normalSkeletonAnimations.every((animation) => (
    animation.name !== "none" && animation.duration !== "0s"
  ))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedSkeletonAnimations = await skeletonAnimations(skeletons);
  expect(reducedSkeletonAnimations.every((animation) => (
    animation.name === "none" || animation.duration === "0s"
  ))).toBe(true);

  await openEvidence(page, "list-empty");
  await expect(page.getByRole("heading", { name: "安全地发送敏感信息" })).toBeVisible();
  await capture(page, testInfo, "send-list-empty-480x600.png");

  await openEvidence(page, "list-no-results");
  await page.getByRole("textbox", { name: "搜索" }).fill("absent deterministic result");
  await assertListChrome(page);
  await expect(page.getByRole("heading", { name: "没有匹配的 Send" })).toBeVisible();
  await capture(page, testInfo, "send-list-no-results-480x600.png");

  await openEvidence(page, "list-disabled");
  await expect(page.getByText("组织策略已关闭 Bitwarden Send。")).toBeVisible();
  await expect(page.getByRole("button", { name: "新增文本 Send" })).toHaveCount(0);
  await capture(page, testInfo, "send-list-disabled-480x600.png");

  await openEvidence(page, "view");
  await expect(page.getByRole("heading", { name: "查看文本 Send" })).toBeVisible();
  await expect(page.locator("textarea#text")).toHaveValue("Deterministic example text for local verification.");
  await capture(page, testInfo, "send-view-480x600.png");

  await openEvidence(page, "form-add");
  await expect(page.getByRole("heading", { name: "新增文本 Send" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  await capture(page, testInfo, "send-form-add-480x600.png");

  await openEvidence(page, "form-edit");
  await page.getByTestId("edit-send").click();
  await expect(page.getByRole("heading", { name: "编辑文本 Send" })).toBeVisible();
  await expect(page.getByLabel("Send 名称")).toHaveValue("Release instructions");
  await capture(page, testInfo, "send-form-edit-480x600.png");

  await openEvidence(page, "created");
  await expect(page.getByRole("heading", { name: "已创建 Send" })).toBeVisible();
  await expect(page.getByText("Send 创建成功")).toBeVisible();
  await capture(page, testInfo, "send-created-480x600.png");

  await openEvidence(page, "mutation-error");
  await page.getByTestId("edit-send").click();
  await page.getByLabel("Send 名称").fill("Retryable update");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("send-password-error")).toContainText("无法保存 Send，请重试。");
  await capture(page, testInfo, "send-mutation-error-480x600.png");

  await openEvidence(page, "row-actions");
  const copy = page.getByRole("button", { name: "复制链接 - Release instructions" });
  const baseline = await page.screenshot({ animations: "disabled" });
  await focusWithKeyboard(page, copy);
  await expect(copy).toBeFocused();
  const focused = await page.screenshot({ animations: "disabled" });
  await expectPixelChangeInside(page, baseline, focused, await copy.boundingBox());
  await capture(page, testInfo, "send-row-actions-480x600.png");
});

test("exercises deterministic create update password copy remove delete stale and cleanup", async ({ page }) => {
  await openEvidence(page, "form-add");
  await page.getByLabel("Send 名称").fill("Created local Send");
  await page.getByLabel("要分享的文本", { exact: true }).fill("Local mutation body");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "已创建 Send" })).toBeVisible();
  await page.getByTestId("created-copy").click();
  await expect.poll(() => recordedActions(page)).toContain("create");
  await expect.poll(() => recordedActions(page)).toContain("copy");
  await page.getByTestId("created-close").click();
  await expect(page).toHaveURL(/#\/tabs\/send$/);

  const createdRow = page.getByRole("button", { name: "查看 - Created local Send" });
  await clickVerifiedCenter(page, createdRow);
  await expect(page).toHaveURL(/#\/edit-send\?sendId=m12-created-send&type=text$/);
  await page.getByTestId("edit-send").click();
  await page.getByLabel("Send 名称").fill("Updated local Send");
  await page.getByRole("combobox", { name: "谁可以访问" }).click();
  await page.getByRole("option", { name: "任何拥有密码的人" }).click();
  await page.getByLabel("密码", { exact: true }).fill("reserved-local-password");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "查看文本 Send" })).toBeVisible();
  await expect(page.getByLabel("Send 名称")).toHaveValue("Updated local Send");

  await page.getByTestId("edit-send").click();
  await page.locator('button[biticonbutton="bwi-minus-circle"]').click();
  await expect(page.getByRole("heading", { name: "移除 Send 密码？", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await expect.poll(() => recordedActions(page)).toContain("password-remove");
  await expect.poll(() => recordedActions(page)).toContain("refresh");

  await page.getByTestId("edit-send").click();
  await page.getByLabel("Send 名称").fill("Stale local result");
  await page.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => recordedActions(page).then((actions) => actions.filter((action) => action === "update").length)).toBe(2);
  await page.evaluate(() => { location.hash = "#/tabs/send"; });
  await expect(page.getByRole("heading", { name: "Send", exact: true })).toBeVisible();
  await page.evaluate(() => globalThis.__bwReleaseSendStaleResult?.());
  await expect(page.getByText("Stale local result", { exact: true })).toHaveCount(0);

  const deleteAction = page.getByRole("button", { name: "删除 - Updated local Send" });
  await clickVerifiedCenter(page, deleteAction);
  await expect(page.getByRole("heading", { name: "永久删除 Send？", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(page.getByRole("heading", { name: "安全地发送敏感信息" })).toBeVisible();
  await expect.poll(() => recordedActions(page)).toContain("delete");
  await page.evaluate(() => globalThis.__bwResetSendEvidenceFixture?.());
  await expect.poll(() => recordedActions(page)).toContain("cleanup");
  expect(await recordedActions(page)).toEqual(expect.arrayContaining([
    "create", "copy", "update", "password-remove", "refresh", "stale-result-released", "delete", "cleanup",
  ]));
});

test("rejects external requests and forbidden retained surfaces", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
  });
  await openEvidence(page, "form-edit");
  const source = await page.locator("html").evaluate((element) => element.outerHTML);
  expect(source).not.toMatch(/send-file|FileReader|SpecificPeople|PremiumUpgrade|OrganizationService|nativeMessaging|singleSignOn/i);
  expect(externalRequests).toEqual([]);
});

test("publishes authorities only after all workflow assertions pass", ({}, testInfo) => {
  test.skip(!isAuthoritativeEvidenceWriter(testInfo), "Chromium update mode is the sole authority writer");
  evidenceIntegrity.assertExactPngEvidenceInventory([...pendingAuthorities.keys()], screenshotFiles);
  const revision = evidenceWriterSourceRevision;
  if (!revision) throw new Error("M12 writer source revision is unavailable");
  const buildIdentity = evidenceWriterBuildIdentity;
  if (!buildIdentity) throw new Error("M12 writer build identity is unavailable");
  replaceEvidenceDirectoryTransactionally(evidenceDirectory, (stageDirectory) => {
    for (const stalePng of readdirSync(stageDirectory).filter((file) => file.endsWith(".png"))) {
      rmSync(join(stageDirectory, stalePng));
    }
    for (const fileName of screenshotFiles) {
      const image = pendingAuthorities.get(fileName);
      if (!image) throw new Error(`Missing staged M12 authority ${fileName}`);
      writeFileSync(join(stageDirectory, fileName), image);
    }
    validateAuthoritySet(stageDirectory);
    const provenance = buildProvenance(stageDirectory, revision, buildIdentity);
    writeFileSync(join(stageDirectory, "PROVENANCE.md"), provenance);
    validateProvenanceHashes(provenance, stageDirectory);
  }, (stageDirectory) => {
    assertCleanEvidenceWriterTree({
      expectedRevision: evidenceWriterWorktreeRevision,
      ignoredTransactionStage: stageDirectory,
    });
    const finalIdentity = collectEvidenceBuildIdentity(
      process.cwd(),
      buildIdentity.authorityBrowserVersion,
      chromium.executablePath(),
    );
    assertEvidenceBuildIdentityUnchanged(buildIdentity, finalIdentity);
  });
});

async function openEvidence(
  page: Page,
  state: string,
  reducedMotion: "reduce" | "no-preference" = "reduce",
): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-19T04:00:00.000Z"));
  await page.emulateMedia({ reducedMotion });
  await page.goto(`/?sendEvidence=${encodeURIComponent(state)}`);
  await expect(page).toHaveURL(new RegExp(`sendEvidence=${state}`));
  await page.evaluate(() => document.fonts.ready);
}

async function skeletonAnimations(locator: Locator): Promise<Array<{ name: string; duration: string }>> {
  return locator.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  }));
}

async function capture(page: Page, testInfo: TestInfo, fileName: typeof screenshotFiles[number]): Promise<void> {
  await settleScrollAtTop(page);
  if (fileName.startsWith("send-list-")) {
    await assertFloatingShellContract(page);
    await assertListChrome(page);
  }
  await assertGeometry(page);
  const screenshot = await page.screenshot({
    path: testInfo.outputPath(fileName),
    animations: "disabled",
  });
  const pixels = await inspectPixels(page, screenshot);
  expect(pixels).toEqual({ width: 480, height: 600, opaque: 480 * 600, colors: expect.any(Number) });
  expect(pixels.colors).toBeGreaterThan(16);
  evidenceIntegrity.assertPngTextMetadataDoesNotContain(screenshot, forbiddenValues);
  if (isAuthoritativeEvidenceWriter(testInfo)) {
    const publishedPath = join(evidenceDirectory, fileName);
    const authority = existsSync(publishedPath)
      ? await selectStableAuthorityBytes(page, readFileSync(publishedPath), screenshot)
      : screenshot;
    pendingAuthorities.set(fileName, authority);
  }
  if (testInfo.project.name === "chromium" && !isAuthoritativeEvidenceWriter(testInfo)) {
    const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(page, readFileSync(join(evidenceDirectory, fileName)), screenshot);
    expect(comparison.differentPixels).toBeLessThanOrEqual(maximumAntiAliasEdgePixels);
    expect(comparison.maxChannelDelta ?? 0).toBeLessThanOrEqual(maximumAntiAliasChannelDelta);
    expect(comparison.nonEdgeDifferentPixels ?? 0).toBe(0);
  }
}

async function selectStableAuthorityBytes(page: Page, published: Buffer, fresh: Buffer): Promise<Buffer> {
  const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(page, published, fresh);
  return comparison.differentPixels <= maximumAntiAliasEdgePixels &&
    (comparison.maxChannelDelta ?? 0) <= maximumAntiAliasChannelDelta &&
    (comparison.nonEdgeDifferentPixels ?? 0) === 0
    ? published
    : fresh;
}

function resolveEvidenceWriterSourceRevision(currentRevision: string): string {
  const requestedRevision = process.env.M12_EVIDENCE_SOURCE_REVISION;
  if (!requestedRevision) return currentRevision;
  if (!/^[0-9a-f]{40}$/.test(requestedRevision)) {
    throw new Error("M12 evidence source revision must be a full Git commit");
  }
  execFileSync("git", ["cat-file", "-e", `${requestedRevision}^{commit}`], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  const renderingDiff = execFileSync("git", [
    "diff",
    "--name-only",
    `${requestedRevision}..${currentRevision}`,
    "--",
    "apps/menubar-tauri",
    "scripts",
    "package.json",
    "package-lock.json",
    "playwright.config.ts",
    "postcss.config.cjs",
    "tailwind.config.cjs",
    "tsconfig.json",
    "vendor/bitwarden-clients",
  ], { cwd: process.cwd(), encoding: "utf8" }).trim();
  if (renderingDiff) {
    throw new Error(`M12 evidence source revision is stale:\n${renderingDiff}`);
  }
  return requestedRevision;
}

async function assertListChrome(page: Page): Promise<void> {
  const headers = page.locator("popup-header:visible");
  await expect(headers).toHaveCount(1);
  await expect(headers.getByRole("heading", { name: "Send", exact: true })).toBeVisible();
  const headerBounds = await headers.boundingBox();
  expect(headerBounds?.y).toBeGreaterThanOrEqual(0);
  expect((headerBounds?.y ?? 0) + (headerBounds?.height ?? 0)).toBeLessThanOrEqual(600);
}

async function assertFloatingShellContract(page: Page): Promise<void> {
  const navigation = page.locator("section.popup-shell bw-floating-tab-switcher > nav.floating-tab-switcher:visible");
  await expect(navigation).toHaveCount(1);
  await expect(page.locator("popup-tab-navigation, bit-bottom-navigation, popup-page > popup-footer")).toHaveCount(0);
  const [navigationBounds, navigationStyles] = await Promise.all([
    navigation.boundingBox(),
    navigation.evaluate((element) => {
      const shell = element.closest<HTMLElement>("section.popup-shell");
      const popupPage = shell?.querySelector<HTMLElement>("popup-page");
      if (!shell || !popupPage) throw new Error("Missing floating Send shell landmarks");
      const bounds = element.getBoundingClientRect();
      const shellBounds = shell.getBoundingClientRect();
      return {
        borderRadius: getComputedStyle(element).borderRadius,
        bottomInset: shellBounds.bottom - bounds.bottom,
        leftInset: bounds.left - shellBounds.left,
        pagePaddingBottom: getComputedStyle(popupPage).paddingBottom,
        rightInset: shellBounds.right - bounds.right,
      };
    }),
  ]);
  expect(navigationBounds?.y).toBeGreaterThanOrEqual(0);
  expect((navigationBounds?.y ?? 0) + (navigationBounds?.height ?? 0)).toBeLessThanOrEqual(600);
  expect(navigationStyles).toMatchObject({ borderRadius: "13px", pagePaddingBottom: "79px" });
  expect(navigationStyles.leftInset).toBeCloseTo(14, 1);
  expect(navigationStyles.rightInset).toBeCloseTo(14, 1);
  expect(navigationStyles.bottomInset).toBeCloseTo(13, 1);
}

async function focusWithKeyboard(page: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard traversal did not reach the Send row action");
}

async function clickVerifiedCenter(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  const hit = await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, bounds.left + bounds.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, bounds.top + bounds.height / 2));
    const resolved = document.elementFromPoint(x, y);
    return {
      x,
      y,
      target: element.getAttribute("aria-label"),
      resolved: resolved instanceof Element
        ? resolved.closest("button")?.getAttribute("aria-label") ?? resolved.tagName
        : null,
      ownsHit: resolved === element || (resolved instanceof Node && element.contains(resolved)),
    };
  });
  expect(hit.ownsHit, JSON.stringify(hit)).toBe(true);
  expect(hit.resolved).toBe(hit.target);
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await target.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
}

async function expectPixelChangeInside(
  page: Page,
  baseline: Buffer,
  focused: Buffer,
  bounds: { x: number; y: number; width: number; height: number } | null,
): Promise<void> {
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  const result = await page.evaluate(async ({ baselineSource, focusedSource, bounds }) => {
    const decode = async (source: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const [before, after] = await Promise.all([decode(baselineSource), decode(focusedSource)]);
    let changed = 0;
    let changedInside = 0;
    for (let offset = 0; offset < before.data.length; offset += 4) {
      if (
        before.data[offset] === after.data[offset]
        && before.data[offset + 1] === after.data[offset + 1]
        && before.data[offset + 2] === after.data[offset + 2]
        && before.data[offset + 3] === after.data[offset + 3]
      ) continue;
      changed += 1;
      const pixel = offset / 4;
      const x = pixel % before.width;
      const y = Math.floor(pixel / before.width);
      if (
        x >= Math.floor(bounds.x)
        && x < Math.ceil(bounds.x + bounds.width)
        && y >= Math.floor(bounds.y)
        && y < Math.ceil(bounds.y + bounds.height)
      ) changedInside += 1;
    }
    return { changed, changedInside };
  }, {
    baselineSource: baseline.toString("base64"),
    focusedSource: focused.toString("base64"),
    bounds,
  });
  expect(result.changed).toBeGreaterThan(0);
  expect(result.changedInside).toBeGreaterThan(0);
}

async function assertGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    type Bounds = { left: number; top: number; right: number; bottom: number };
    const rendered = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const describe = (element: HTMLElement) => element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 40) || element.tagName;
    const intersect = (a: Bounds, b: Bounds): Bounds | null => {
      const left = Math.max(a.left, b.left);
      const top = Math.max(a.top, b.top);
      const right = Math.min(a.right, b.right);
      const bottom = Math.min(a.bottom, b.bottom);
      return right > left && bottom > top ? { left, top, right, bottom } : null;
    };
    const effectiveVisibleBounds = (element: HTMLElement): Bounds | null => {
      let bounds: Bounds | null = element.getBoundingClientRect();
      for (let ancestor = element.parentElement; bounds && ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (["hidden", "scroll", "auto", "clip"].includes(style.overflowX)
          || ["hidden", "scroll", "auto", "clip"].includes(style.overflowY)) {
          bounds = intersect(bounds, ancestor.getBoundingClientRect());
        }
      }
      return bounds;
    };
    const exclusionReason = (element: HTMLElement): string | null => {
      if (!rendered(element)) return "not rendered";
      if (element.getAttribute("aria-hidden") === "true") return "aria-hidden";
      if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return "non-actionable";
      const bounds = effectiveVisibleBounds(element);
      if (!bounds) return "clipped by ancestor";
      if (bounds.bottom <= 0 || bounds.top >= innerHeight) return "outside viewport";
      return null;
    };
    const controls = [...document.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href]")]
      .filter((element) => exclusionReason(element) === null);
    const clipped = controls.filter((element) => {
      const bounds = effectiveVisibleBounds(element)!;
      return bounds.left < -0.5 || bounds.right > innerWidth + 0.5 || bounds.top < -0.5 || bounds.bottom > innerHeight + 0.5;
    }).map(describe);
    const chromeInside = [...document.querySelectorAll<HTMLElement>("popup-header, nav.floating-tab-switcher")]
      .filter(rendered)
      .every((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= -0.5 && bounds.right <= innerWidth + 0.5 && bounds.top >= -0.5 && bounds.bottom <= innerHeight + 0.5;
      });
    const navigation = document.querySelector<HTMLElement>("nav.floating-tab-switcher");
    const navOccluded = controls.filter((control) => {
      if (!navigation || navigation.contains(control)) return false;
      const bounds = effectiveVisibleBounds(control)!;
      const navigationBounds = navigation.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(bounds.right, navigationBounds.right) - Math.max(bounds.left, navigationBounds.left))
        * Math.max(0, Math.min(bounds.bottom, navigationBounds.bottom) - Math.max(bounds.top, navigationBounds.top));
      return overlap > 1;
    }).map(describe);
    const overlap = controls.flatMap((control, index) => controls.slice(index + 1).flatMap((candidate) => {
      if (control.contains(candidate) || candidate.contains(control)) return [];
      if (control.closest("bit-form-field") === candidate.closest("bit-form-field") && control.closest("bit-form-field")) return [];
      if (control.closest('[role="menu"]') || candidate.closest('[role="menu"]')) return [];
      const a = effectiveVisibleBounds(control)!;
      const b = effectiveVisibleBounds(candidate)!;
      const area = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return area > 16 ? [`${describe(control)} <> ${describe(candidate)}`] : [];
    }));
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped, navOccluded, overlap, chromeInside };
  });
  expect(geometry).toEqual({ width: 480, height: 600, overflow: 0, clipped: [], navOccluded: [], overlap: [], chromeInside: true });
}

async function settleScrollAtTop(page: Page): Promise<void> {
  await page.evaluate(async () => {
    scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("[data-testid=popup-layout-scroll-region], [data-testid=popup-shell-scroll-region], popup-tab-navigation > div, main")) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function inspectPixels(page: Page, screenshot: Buffer) {
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    let opaque = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] === 255) opaque += 1;
      if (colors.size <= 256) colors.add(((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0);
    }
    return { width: canvas.width, height: canvas.height, opaque, colors: colors.size };
  }, screenshot.toString("base64"));
}

async function recordedActions(page: Page): Promise<string[]> {
  return page.locator("html").evaluate((root) => (root.dataset.bwEvidenceSendActions ?? "").split(",").filter(Boolean));
}

function validateAuthoritySet(directory: string): void {
  evidenceIntegrity.assertExactPngEvidenceInventory(readdirSync(directory).filter((file) => file.endsWith(".png")), screenshotFiles);
  for (const file of screenshotFiles) evidenceIntegrity.assertPngTextMetadataDoesNotContain(readFileSync(join(directory, file)), forbiddenValues);
}

function validateRecordedSourceRevision(provenance: string): void {
  const revision = provenance.match(/^- Source revision: ([0-9a-f]{40})$/m)?.[1];
  expect(revision).toBeDefined();
  execFileSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: process.cwd() });
  execFileSync("git", ["diff", "--quiet", `${revision}..HEAD`, "--", "apps/menubar-tauri", "scripts", "package.json", "package-lock.json", "playwright.config.ts", "postcss.config.cjs", "tailwind.config.cjs", "tsconfig.json", "vendor/bitwarden-clients"], { cwd: process.cwd() });
}

function validateRecordedBuildIdentity(provenance: string, expectedChromiumVersion: string | null): void {
  const productionBundleTreeSha256 = requiredProvenanceValue(provenance, "Production bundle tree SHA-256", "[0-9a-f]{64}");
  const packageLockSha256 = requiredProvenanceValue(provenance, "Package lock SHA-256", "[0-9a-f]{64}");
  const playwrightVersion = requiredProvenanceValue(provenance, "Playwright version", "\\d+\\.\\d+\\.\\d+");
  const hostRuntime = provenance.match(/^- Host runtime: node (v\d+\.\d+\.\d+); ([a-z0-9]+)-([a-z0-9_]+)$/m);
  expect(hostRuntime).toHaveLength(4);
  const authorityBrowser = provenance.match(/^- Authority browser: Chromium ([^;\n]+); executable SHA-256: ([0-9a-f]{64})$/m);
  expect(authorityBrowser).toHaveLength(3);
  const authorityBrowserRuntimeTreeSha256 = requiredProvenanceValue(provenance, "Chromium runtime tree SHA-256", "[0-9a-f]{64}");
  const runtimeIdentitySha256 = requiredProvenanceValue(provenance, "Runtime identity SHA-256", "[0-9a-f]{64}");
  const evidenceSetSha256 = requiredProvenanceValue(provenance, "Evidence set SHA-256", "[0-9a-f]{64}");
  if (!hostRuntime || !authorityBrowser) return;
  if (expectedChromiumVersion) expect(authorityBrowser[1]).toBe(expectedChromiumVersion);

  const actual = collectEvidenceBuildIdentity(process.cwd(), authorityBrowser[1]!, chromium.executablePath());
  expect({
    productionBundleTreeSha256,
    packageLockSha256,
    playwrightVersion,
    nodeVersion: hostRuntime[1],
    platform: hostRuntime[2],
    architecture: hostRuntime[3],
    authorityBrowserVersion: authorityBrowser[1],
    authorityBrowserExecutableSha256: authorityBrowser[2],
    authorityBrowserRuntimeTreeSha256,
    runtimeIdentitySha256,
  }).toEqual({
    productionBundleTreeSha256: actual.productionBundleTreeSha256,
    packageLockSha256: actual.packageLockSha256,
    playwrightVersion: actual.playwrightVersion,
    nodeVersion: actual.nodeVersion,
    platform: actual.platform,
    architecture: actual.architecture,
    authorityBrowserVersion: actual.authorityBrowserVersion,
    authorityBrowserExecutableSha256: actual.authorityBrowserExecutableSha256,
    authorityBrowserRuntimeTreeSha256: actual.authorityBrowserRuntimeTreeSha256,
    runtimeIdentitySha256: actual.runtimeIdentitySha256,
  });
  expect(evidenceSetSha256).toBe(computeEvidenceSetSha256(actual, readAuthorityHashes(provenance)));
}

function validateProvenanceHashes(provenance: string, directory: string): void {
  expect(provenance.match(/^- Vendor revision: .+$/gm)).toEqual([`- Vendor revision: ${pinnedVendorRevision}`]);
  const rows = [...provenance.matchAll(/^\| (send-[^|]+\.png) \| ([0-9a-f]{64}) \| 480x600 \| passed \|$/gm)];
  expect(rows).toHaveLength(screenshotFiles.length);
  expect(rows.map((row) => row[1]).sort()).toEqual([...screenshotFiles].sort());
  for (const file of screenshotFiles) {
    const hash = createHash("sha256").update(readFileSync(join(directory, file))).digest("hex");
    expect(rows.find((row) => row[1] === file)?.[2]).toBe(hash);
  }
}

function buildProvenance(directory: string, revision: string, identity: EvidenceBuildIdentity): string {
  const authorities = screenshotFiles.map((fileName) => ({
    fileName,
    sha256: createHash("sha256").update(readFileSync(join(directory, fileName))).digest("hex"),
  }));
  const rows = authorities.map(({ fileName, sha256 }) => `| ${fileName} | ${sha256} | 480x600 | passed |`);
  const evidenceSetSha256 = computeEvidenceSetSha256(identity, authorities);
  return `# M12 Text Send Evidence Provenance\n\n- Source revision: ${revision}\n- Vendor revision: ${pinnedVendorRevision}\n- Production bundle tree SHA-256: ${identity.productionBundleTreeSha256}\n- Package lock SHA-256: ${identity.packageLockSha256}\n- Playwright version: ${identity.playwrightVersion}\n- Host runtime: node ${identity.nodeVersion}; ${identity.platform}-${identity.architecture}\n- Authority browser: Chromium ${identity.authorityBrowserVersion}; executable SHA-256: ${identity.authorityBrowserExecutableSha256}\n- Chromium runtime tree SHA-256: ${identity.authorityBrowserRuntimeTreeSha256}\n- Runtime identity SHA-256: ${identity.runtimeIdentitySha256}\n- Evidence set SHA-256: ${evidenceSetSha256}\n- Browser authority viewport: 480x600; DPR: 1.\n- Chromium is the sole authoritative screenshot writer.\n- Chromium read-only and WebKit are assertion-only and cannot refresh authority files.\n- Evidence-only fixture code runs in the isolated Vite development server and remains excluded from the production bundle identified above.\n- All fixtures and transport receipts are deterministic local examples; live credentials, external network, real links, account data, environment credential fields, and Keychain secrets are never read.\n- File Send, SSO, premium, organization administration, browser runtime, and nativeMessaging remain absent.\n- Pixel checks: exact dimensions, fully opaque nonblank canvas, more than 16 colors, one visible in-bounds in-flow heading and floating navigation with no footer on every list authority, unclipped visible controls, zero horizontal overflow, no incoherent interactive overlap, and keyboard-focus pixel change inside the row action.\n- Activation checks: created-row open and final delete use normal pointer clicks only after center-point hit testing resolves the intended official control.\n- Masked regions: none.\n\n| Authority | SHA-256 | Dimensions | Geometry |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

function requiredProvenanceValue(provenance: string, label: string, valuePattern: string): string {
  const matches = [...provenance.matchAll(new RegExp(`^- ${label}: (${valuePattern})$`, "gm"))];
  expect(matches).toHaveLength(1);
  return matches[0]?.[1] ?? "";
}

function readAuthorityHashes(provenance: string): { fileName: string; sha256: string }[] {
  return [...provenance.matchAll(/^\| (send-[^|]+\.png) \| ([0-9a-f]{64}) \| 480x600 \| passed \|$/gm)]
    .map((row) => ({ fileName: row[1]!, sha256: row[2]! }));
}
