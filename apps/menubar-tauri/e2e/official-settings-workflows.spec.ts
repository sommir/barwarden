import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { chromium, expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  assertEvidenceBuildIdentityUnchanged,
  collectEvidenceBuildIdentity,
  type EvidenceBuildIdentity,
} from "./evidence-build-identity";
import {
  prepareEvidenceWriterPreflight,
  replaceEvidenceDirectoryTransactionally,
} from "./evidence-directory-transaction";
import * as evidenceIntegrity from "./evidence-integrity";
import { evidenceCapturePath, isAuthoritativeEvidenceWriter } from "./evidence-path";
import { assertCleanEvidenceWriterTree } from "./evidence-source-guard";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m13-settings-2026-07-20",
);
const provenancePath = join(evidenceDirectory, "provenance.json");
const controllerOutputPaths = [
  join(process.cwd(), "docs/superpowers/specs/2026-07-20-m13-machine-verification.json"),
  join(process.cwd(), "docs/superpowers/specs/2026-07-20-m13-settings-runtime-result.md"),
] as const;
const screenshotFiles = [
  "settings-main-480x600.png",
  "account-security-480x600.png",
  "vault-settings-480x600.png",
  "vault-settings-sync-failure-480x600.png",
  "one-field-settings-480x600.png",
  "appearance-480x600.png",
  "about-480x600.png",
  "about-dialog-480x600.png",
  "change-password-handoff-480x600.png",
] as const;
const pinnedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const evidenceSetSchema = "m13-settings-evidence-set-v2";
const forbiddenValues = [
  "m13-settings-runtime",
  "Synthetic Settings sync failure",
  "outside.example.test",
  "token=value",
  "accessToken",
  "refreshToken",
  "userKey",
  "clipboard value",
] as const;
const pendingAuthorities = new Map<string, PendingCanonicalAuthority>();
const historicalAuthorities = new Map<string, HistoricalCanonicalAuthority>();
let evidenceWriterSourceRevision: string | null = null;
let evidenceWriterWorktreeRevision: string | null = null;
let evidenceWriterBuildIdentity: EvidenceBuildIdentity | null = null;
const maximumAntiAliasEdgePixels = 256;
const maximumAntiAliasChannelDelta = 8;
const canonicalRebaseEnvironmentName = "M13_REBASE_CANONICAL";
const canonicalAttestationEnvironmentName = "M13_CANONICAL_ATTESTATION_REVISION";

test.describe.configure({ mode: "serial" });

test.beforeAll(({ browser }, testInfo) => {
  if (process.env[canonicalRebaseEnvironmentName] === "true" && !isAuthoritativeEvidenceWriter(testInfo)) {
    throw new Error("M13 canonical rebase requires the explicit Chromium evidence writer");
  }
  if (process.env[canonicalAttestationEnvironmentName] && process.env[canonicalRebaseEnvironmentName] !== "true") {
    throw new Error("M13 canonical attestation finalization requires an explicit canonical rebase");
  }
  if (!isAuthoritativeEvidenceWriter(testInfo)) return;
  evidenceWriterWorktreeRevision = prepareEvidenceWriterPreflight(
    evidenceDirectory,
    (directory) => validateAuthoritySet(directory),
    () => assertCleanEvidenceWriterTree({
      ignoredWorktreePaths: controllerOutputPaths,
    }),
  );
  evidenceWriterSourceRevision = resolveEvidenceWriterSourceRevision(
    evidenceWriterWorktreeRevision,
  );
  evidenceWriterBuildIdentity = collectEvidenceBuildIdentity(
    process.cwd(),
    browser.version(),
    chromium.executablePath(),
  );
  loadHistoricalCanonicalAuthorities(readUnversionedProvenance());
});

test("requires exact M13 authority and provenance integrity in read-only mode", async ({ browser }, testInfo) => {
  if (isAuthoritativeEvidenceWriter(testInfo)) return;

  validateAuthoritySet(evidenceDirectory);
  const provenance = readProvenance();
  expect(provenance.schema).toBe("m13-settings-evidence-v2");
  expect(provenance.writer).toEqual({
    project: "chromium",
    viewport: { width: 480, height: 600 },
    deviceScaleFactor: 1,
  });
  expect(provenance.vendorRevision).toBe(pinnedVendorRevision);
  validateRecordedSourceRevision(provenance.sourceRevision);
  validateProvenanceAuthorities(provenance);
  validateCanonicalAuthorityAttestations(provenance);
  validateRecordedBuildIdentity(provenance, testInfo.project.name === "chromium-read-only"
    ? browser.version()
    : null);
});

test("captures exactly nine real Task 1-4 Settings authorities", async ({ page }, testInfo) => {
  await openEvidence(page, "settings-main");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator("bw-official-settings")).toHaveCount(1);
  await capture(page, testInfo, "settings-main-480x600.png");

  await openEvidence(page, "account-security");
  await selectOption(page, "密码库超时", "15 分钟");
  await selectOption(page, "密码库超时动作", "注销");
  await capture(page, testInfo, "account-security-480x600.png");

  await openEvidence(page, "vault-settings");
  await expect(page.getByRole("button", { name: /立即同步/ })).toBeVisible();
  await capture(page, testInfo, "vault-settings-480x600.png");

  await openEvidence(page, "vault-settings-sync-failure");
  await page.getByRole("button", { name: /立即同步/ }).click();
  await expect(page.getByRole("alert")).toContainText("无法同步密码库。请重试。");
  await capture(page, testInfo, "vault-settings-sync-failure-480x600.png");

  await openEvidence(page, "one-field-settings");
  await selectOption(page, "清空剪贴板", "2 分钟");
  await selectOption(page, "单字段填充", "仅复制到剪贴板");
  await capture(page, testInfo, "one-field-settings-480x600.png");

  await openEvidence(page, "appearance");
  await selectOption(page, "主题", "深色");
  await page.getByRole("checkbox", { name: "紧凑模式" }).check();
  await page.getByRole("checkbox", { name: "显示动画" }).uncheck();
  await page.getByRole("checkbox", { name: "显示网站图标" }).uncheck();
  await page.getByRole("checkbox", { name: "在密码库上显示快速复制操作" }).uncheck();
  await capture(page, testInfo, "appearance-480x600.png");

  await openEvidence(page, "about");
  await expect(page.getByRole("heading", { name: "关于", exact: true })).toBeVisible();
  await capture(page, testInfo, "about-480x600.png");

  await openEvidence(page, "about-dialog");
  await page.getByRole("button", { name: "关于 Barwarden" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, testInfo, "about-dialog-480x600.png");

  await openEvidence(page, "change-password-handoff");
  await page.getByRole("button", { name: "打开 Web Vault 更改主密码" }).click();
  await expect.poll(() => settingsReceipts(page)).toContain("open_url:web-vault-password");
  await capture(page, testInfo, "change-password-handoff-480x600.png");
});

test("drives retained navigation, settings, sync, dialog, and handoff behavior", async ({ page }) => {
  await openEvidence(page, "settings-main");
  await page.getByRole("button", { name: "账户安全" }).click();
  await expect(page).toHaveURL(/#\/account-security$/);
  await selectOption(page, "密码库超时", "30 分钟");
  await selectOption(page, "密码库超时动作", "注销");
  await expect.poll(() => storedAccountTimeout(page)).toMatchObject({
    vaultTimeoutMinutes: 30,
    vaultTimeoutAction: "logout",
  });

  await openEvidence(page, "vault-settings");
  const sync = page.getByRole("button", { name: /立即同步/ });
  await sync.click();
  await expect(sync).toBeDisabled();
  await sync.dispatchEvent("click");
  await expect.poll(() => settingsSyncCalls(page)).toBe(1);
  await page.evaluate(() => globalThis.__bwReleaseSettingsEvidenceSync?.());
  await expect(sync).toBeEnabled();
  await expect(sync).toContainText("2026");

  await openEvidence(page, "vault-settings-sync-failure");
  await sync.click();
  await expect(page.getByRole("alert")).toContainText("无法同步密码库。请重试。");
  await sync.click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await openEvidence(page, "one-field-settings");
  await selectOption(page, "单字段填充", "仅复制到剪贴板");
  await selectOption(page, "单字段填充", "复制并粘贴");
  await expect.poll(() => storedGlobalSettings(page)).toMatchObject({
    fillMode: "clipboard-paste",
  });

  await openEvidence(page, "appearance");
  await selectOption(page, "主题", "深色");
  for (const name of [
    "紧凑模式",
    "显示动画",
    "显示网站图标",
    "在密码库上显示快速复制操作",
  ]) {
    await page.getByRole("checkbox", { name }).click();
  }
  await expect.poll(() => storedGlobalSettings(page)).toMatchObject({
    animations: false,
    compactMode: true,
    showFavicons: false,
    showQuickCopyActions: false,
    theme: "dark",
  });

  await openEvidence(page, "about-dialog");
  const about = page.getByRole("button", { name: "关于 Barwarden" });
  await about.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("非官方独立 macOS 菜单栏客户端");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(about).toBeFocused();

  await openEvidence(page, "change-password-handoff");
  await page.getByRole("button", { name: "打开 Web Vault 更改主密码" }).click();
  expect(await settingsReceipts(page)).toEqual(["open_url:web-vault-password"]);
});

test("rejects external requests, secrets, and excluded Settings surfaces", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
  });
  for (const state of ["settings-main", "account-security", "about", "change-password-handoff"]) {
    await openEvidence(page, state);
  }
  const source = await page.locator("html").evaluate((element) => element.outerHTML);
  expect(source).not.toMatch(
    /accessToken|refreshToken|userKey|credential|clipboard value|blocked-domains|premium-v2|(?:^|["'/:])billing(?:["'/?#:]|$)|reports|import-browser|export-browser|nativeMessaging|singleSignOn/i,
  );
  expect(externalRequests).toEqual([]);
});

test("publishes authorities and provenance only after all workflow assertions pass", ({}, testInfo) => {
  test.skip(!isAuthoritativeEvidenceWriter(testInfo), "Chromium update mode is the sole authority writer");
  evidenceIntegrity.assertExactPngEvidenceInventory([...pendingAuthorities.keys()], screenshotFiles);
  const revision = evidenceWriterSourceRevision;
  const buildIdentity = evidenceWriterBuildIdentity;
  if (!revision) throw new Error("M13 writer source revision is unavailable");
  if (!buildIdentity) throw new Error("M13 writer build identity is unavailable");

  replaceEvidenceDirectoryTransactionally(evidenceDirectory, (stageDirectory) => {
    for (const staleEntry of readdirSync(stageDirectory)) {
      rmSync(join(stageDirectory, staleEntry), { recursive: true, force: true });
    }
    for (const fileName of screenshotFiles) {
      const authority = pendingAuthorities.get(fileName);
      if (!authority) throw new Error(`Missing staged M13 authority ${fileName}`);
      writeFileSync(join(stageDirectory, fileName), authority.bytes);
    }
    validateAuthoritySet(stageDirectory, false);
    const provenance = buildProvenance(stageDirectory, revision, buildIdentity);
    writeFileSync(join(stageDirectory, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
    validateProvenanceAuthorities(provenance, stageDirectory);
  }, (stageDirectory) => {
    assertCleanEvidenceWriterTree({
      expectedRevision: evidenceWriterWorktreeRevision,
      ignoredTransactionStage: stageDirectory,
      ignoredWorktreePaths: controllerOutputPaths,
    });
    assertEvidenceBuildIdentityUnchanged(
      buildIdentity,
      collectEvidenceBuildIdentity(
        process.cwd(),
        buildIdentity.authorityBrowserVersion,
        chromium.executablePath(),
      ),
    );
  });
});

async function openEvidence(page: Page, state: string): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-20T04:00:00.000Z"));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/?settingsEvidence=${encodeURIComponent(state)}`);
  await expect(page).toHaveURL(new RegExp(`settingsEvidence=${state}`));
  await page.evaluate(() => document.fonts.ready);
}

async function selectOption(page: Page, label: string, option: string): Promise<void> {
  const combobox = page.getByRole("combobox", { name: label, exact: true });
  await combobox.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await expect(combobox.locator("xpath=ancestor::ng-select")).not.toHaveClass(/ng-select-opened/);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  fileName: (typeof screenshotFiles)[number],
): Promise<void> {
  await settleScrollAtTop(page);
  const geometry = await assertGeometry(page);
  const screenshot = await evidenceIntegrity.captureConsecutiveStableScreenshot(page, {
    ...(!isAuthoritativeEvidenceWriter(testInfo)
      ? { path: evidenceCapturePath(testInfo, join(evidenceDirectory, fileName)) }
      : {}),
  }, 6);
  const fresh = isAuthoritativeEvidenceWriter(testInfo)
    ? evidenceIntegrity.bindFreshCanonicalEvidence(
      screenshot,
      requireEvidenceWriterBuildIdentity().runtimeIdentitySha256,
    )
    : { bytes: Buffer.from(screenshot) };
  const freshPixels = await inspectPixels(page, fresh.bytes);
  assertCanonicalPixels(freshPixels);
  evidenceIntegrity.assertPngTextMetadataDoesNotContain(fresh.bytes, forbiddenValues);

  if (isAuthoritativeEvidenceWriter(testInfo)) {
    const historical = historicalAuthorities.get(fileName);
    if (!historical) throw new Error(`Missing historical M13 authority ${fileName}`);
    const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(
      page,
      historical.bytes,
      fresh.bytes,
    );
    const selected = process.env[canonicalRebaseEnvironmentName] === "true"
      ? await resolveCanonicalRebaseAuthority(
          page,
          fileName,
          fresh,
          requireEvidenceWriterSourceRevision(),
        )
      : evidenceIntegrity.preserveCanonicalEvidenceAuthority(
        historical,
        fresh.bytes,
        comparison,
        {
          maximumDifferentPixels: maximumAntiAliasEdgePixels,
          maximumChannelDelta: maximumAntiAliasChannelDelta,
        },
      );
    const selectedPixels = await inspectPixels(page, selected.bytes);
    assertCanonicalPixels(selectedPixels);
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(selected.bytes, forbiddenValues);
    pendingAuthorities.set(fileName, {
      ...selected,
      width: selectedPixels.width,
      height: selectedPixels.height,
      opaque: selectedPixels.opaque === selectedPixels.width * selectedPixels.height,
      mostlyBlank: selectedPixels.dominantRatio >= 0.985,
      horizontallyClipped: geometry.overflow !== 0 || geometry.clipped.length > 0,
    });
  }
  if (testInfo.project.name === "chromium-read-only") {
    const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(
      page,
      readFileSync(join(evidenceDirectory, fileName)),
      fresh.bytes,
    );
    expect(comparison.differentPixels).toBeLessThanOrEqual(maximumAntiAliasEdgePixels);
    expect(comparison.maxChannelDelta ?? 0).toBeLessThanOrEqual(maximumAntiAliasChannelDelta);
    expect(comparison.nonEdgeDifferentPixels ?? 0).toBe(0);
  }
}

function assertCanonicalPixels(pixels: Awaited<ReturnType<typeof inspectPixels>>): void {
  expect(pixels).toMatchObject({ width: 480, height: 600, opaque: 480 * 600 });
  expect(pixels.colors).toBeGreaterThan(16);
  expect(pixels.dominantRatio).toBeLessThan(0.985);
}

async function assertGeometry(page: Page): Promise<CaptureGeometry> {
  const geometry = await page.evaluate(() => {
    const rendered = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const controls = [...document.querySelectorAll<HTMLElement>("button, input, select, a[href]")]
      .filter(rendered)
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.bottom > 0 && bounds.top < innerHeight;
      });
    const clipped = controls.filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left < -0.5 || bounds.right > innerWidth + 0.5;
    }).map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40));
    return {
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped,
    };
  });
  expect(geometry).toEqual({ width: 480, height: 600, overflow: 0, clipped: [] });
  return geometry;
}

async function settleScrollAtTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-testid=popup-layout-scroll-region], [data-testid=popup-shell-scroll-region], popup-tab-navigation > div, main",
    )) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
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
    const colors = new Map<number, number>();
    let opaque = 0;
    let dominant = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] === 255) opaque += 1;
      const color = ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
      const count = (colors.get(color) ?? 0) + 1;
      colors.set(color, count);
      dominant = Math.max(dominant, count);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      opaque,
      colors: colors.size,
      dominantRatio: dominant / (canvas.width * canvas.height),
    };
  }, screenshot.toString("base64"));
}

function validateAuthoritySet(directory: string, requireProvenance = true): void {
  evidenceIntegrity.assertExactEvidenceDirectoryInventory(
    readdirSync(directory),
    screenshotFiles,
    requireProvenance,
  );
  for (const file of screenshotFiles) {
    const bytes = readFileSync(join(directory, file));
    expect(pngDimensions(bytes)).toEqual({ width: 480, height: 600 });
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(bytes, forbiddenValues);
  }
  if (requireProvenance) expect(existsSync(join(directory, "provenance.json"))).toBe(true);
}

function readUnversionedProvenance(): M13EvidenceProvenanceV1 | M13EvidenceProvenance {
  return JSON.parse(readFileSync(provenancePath, "utf8")) as
    M13EvidenceProvenanceV1 | M13EvidenceProvenance;
}

function readProvenance(): M13EvidenceProvenance {
  const provenance = readUnversionedProvenance();
  if (provenance.schema !== "m13-settings-evidence-v2") {
    throw new Error("M13 provenance must use the authority-identity v2 schema");
  }
  return provenance;
}

function validateProvenanceAuthorities(
  provenance: M13EvidenceProvenance,
  directory = evidenceDirectory,
): void {
  expect(provenance.authorities).toHaveLength(screenshotFiles.length);
  expect(provenance.authorities.map(({ file }) => file).sort()).toEqual([...screenshotFiles].sort());
  expect(new Set(provenance.authorities.map(({ file }) => file)).size).toBe(screenshotFiles.length);
  for (const authority of provenance.authorities) {
    expect(authority).toMatchObject({
      width: 480,
      height: 600,
      opaque: true,
      mostlyBlank: false,
      horizontallyClipped: false,
    });
    expect(authority.sha256).toBe(
      createHash("sha256").update(readFileSync(join(directory, authority.file))).digest("hex"),
    );
    expect(authority.canonicalSourceRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(authority.canonicalRuntimeIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(authority.canonicalAttestationRevision).toMatch(/^[0-9a-f]{40}$/);
  }
  expect(provenance.evidenceSetSha256).toBe(computeM13EvidenceSetSha256(provenance));
}

function loadHistoricalCanonicalAuthorities(
  provenance: M13EvidenceProvenanceV1 | M13EvidenceProvenance,
): void {
  historicalAuthorities.clear();
  const legacyAttestationRevision = provenance.schema === "m13-settings-evidence-v1"
    ? resolveExistingEvidenceAttestationRevision()
    : null;
  for (const file of screenshotFiles) {
    const authority = provenance.authorities.find((candidate) => candidate.file === file);
    if (!authority) throw new Error(`Missing historical M13 authority row ${file}`);
    const bytes = readFileSync(join(evidenceDirectory, file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (authority.sha256 !== sha256) throw new Error(`Historical M13 authority hash mismatch: ${file}`);
    const canonicalIdentity: CanonicalAuthorityIdentity = provenance.schema === "m13-settings-evidence-v1"
      ? {
        canonicalSourceRevision: provenance.sourceRevision,
        canonicalRuntimeIdentitySha256: provenance.identity.runtimeIdentitySha256,
        canonicalAttestationRevision: legacyAttestationRevision!,
      }
      : authority as M13EvidenceAuthority;
    historicalAuthorities.set(file, {
      bytes,
      ...canonicalIdentity,
    });
  }
  if (provenance.schema === "m13-settings-evidence-v2") {
    validateProvenanceAuthorities(provenance);
    if (process.env[canonicalRebaseEnvironmentName] !== "true") {
      validateCanonicalAuthorityAttestations(provenance);
    }
  } else {
    for (const [file, authority] of historicalAuthorities) {
      validateHistoricalAttestation(
        file,
        authority,
        createHash("sha256").update(authority.bytes).digest("hex"),
      );
    }
  }
}

function resolveExistingEvidenceAttestationRevision(): string {
  const relativeProvenancePath = "docs/superpowers/screenshots/m13-settings-2026-07-20/provenance.json";
  const revision = execFileSync("git", ["log", "-1", "--format=%H", "--", relativeProvenancePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Historical M13 evidence attestation revision is unavailable");
  }
  const committedProvenance = execFileSync("git", ["show", `${revision}:${relativeProvenancePath}`], {
    cwd: process.cwd(),
  });
  if (!committedProvenance.equals(readFileSync(provenancePath))) {
    throw new Error("Historical M13 provenance differs from its attestation revision");
  }
  return revision;
}

function validateCanonicalAuthorityAttestations(provenance: M13EvidenceProvenance): void {
  for (const authority of provenance.authorities) {
    validateHistoricalAttestation(authority.file, authority, authority.sha256);
  }
}

function validateHistoricalAttestation(
  file: string,
  authority: CanonicalAuthorityIdentity,
  expectedSha256: string,
): void {
  execFileSync("git", ["merge-base", "--is-ancestor", authority.canonicalAttestationRevision, "HEAD"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  const relativeDirectory = "docs/superpowers/screenshots/m13-settings-2026-07-20";
  const historicalBytes = execFileSync("git", [
    "show",
    `${authority.canonicalAttestationRevision}:${relativeDirectory}/${file}`,
  ], { cwd: process.cwd() });
  const historicalSha256 = createHash("sha256").update(historicalBytes).digest("hex");
  if (historicalSha256 !== expectedSha256) {
    throw new Error(`Historical M13 authority bytes do not match their attestation: ${file}`);
  }
  const historicalProvenance = JSON.parse(execFileSync("git", [
    "show",
    `${authority.canonicalAttestationRevision}:${relativeDirectory}/provenance.json`,
  ], { cwd: process.cwd(), encoding: "utf8" })) as M13EvidenceProvenanceV1 | M13EvidenceProvenance;
  const historicalRow = historicalProvenance.authorities.find((candidate) => candidate.file === file);
  if (!historicalRow || historicalRow.sha256 !== expectedSha256) {
    throw new Error(`Historical M13 authority provenance is invalid: ${file}`);
  }
  const historicalIdentity: Pick<CanonicalAuthorityIdentity,
    "canonicalSourceRevision" | "canonicalRuntimeIdentitySha256"> =
    historicalProvenance.schema === "m13-settings-evidence-v1"
      ? {
        canonicalSourceRevision: historicalProvenance.sourceRevision,
        canonicalRuntimeIdentitySha256: historicalProvenance.identity.runtimeIdentitySha256,
      }
      : historicalRow as M13EvidenceAuthority;
  const historicalSourceRevision = historicalIdentity.canonicalSourceRevision;
  const historicalRuntimeIdentity = historicalIdentity.canonicalRuntimeIdentitySha256;
  if (historicalSourceRevision !== authority.canonicalSourceRevision
    || historicalRuntimeIdentity !== authority.canonicalRuntimeIdentitySha256) {
    throw new Error(`Historical M13 authority identity is invalid: ${file}`);
  }
}

function validateRecordedSourceRevision(revision: string): void {
  expect(revision).toMatch(/^[0-9a-f]{40}$/);
  execFileSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: process.cwd() });
  execFileSync("git", [
    "diff",
    "--quiet",
    `${revision}..HEAD`,
    "--",
    "apps/menubar-tauri",
    "scripts",
    "package.json",
    "package-lock.json",
    "playwright.config.ts",
    "vitest.config.ts",
    "postcss.config.cjs",
    "tailwind.config.cjs",
    "tsconfig.json",
    "vendor/bitwarden-clients",
  ], { cwd: process.cwd() });
}

function validateRecordedBuildIdentity(
  provenance: M13EvidenceProvenance,
  expectedChromiumVersion: string | null,
): void {
  const actual = collectEvidenceBuildIdentity(
    process.cwd(),
    provenance.identity.authorityBrowserVersion,
    chromium.executablePath(),
  );
  if (expectedChromiumVersion) {
    expect(provenance.identity.authorityBrowserVersion).toBe(expectedChromiumVersion);
  }
  expect(provenance.identity).toEqual(actual);
}

function buildProvenance(
  directory: string,
  revision: string,
  identity: EvidenceBuildIdentity,
): M13EvidenceProvenance {
  const authorities = screenshotFiles.map((file) => {
    const canonical = pendingAuthorities.get(file);
    if (!canonical) throw new Error(`Missing canonical M13 authority ${file}`);
    const bytes = readFileSync(join(directory, file));
    expect(bytes).toEqual(canonical.bytes);
    return {
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: canonical.width,
      height: canonical.height,
      opaque: canonical.opaque,
      mostlyBlank: canonical.mostlyBlank,
      horizontallyClipped: canonical.horizontallyClipped,
      canonicalSourceRevision: canonical.canonicalSourceRevision,
      canonicalRuntimeIdentitySha256: canonical.canonicalRuntimeIdentitySha256,
      canonicalAttestationRevision: canonical.canonicalAttestationRevision,
    };
  });
  const provenance: M13EvidenceProvenance = {
    schema: "m13-settings-evidence-v2",
    sourceRevision: revision,
    vendorRevision: pinnedVendorRevision,
    identity,
    evidenceSetSha256: "",
    writer: {
      project: "chromium",
      viewport: { width: 480, height: 600 },
      deviceScaleFactor: 1,
    },
    authorities,
  };
  provenance.evidenceSetSha256 = computeM13EvidenceSetSha256(provenance);
  return provenance;
}

function computeM13EvidenceSetSha256(provenance: M13EvidenceProvenance): string {
  return createHash("sha256").update(JSON.stringify({
    schema: evidenceSetSchema,
    sourceRevision: provenance.sourceRevision,
    runtimeIdentitySha256: provenance.identity.runtimeIdentitySha256,
    authorities: provenance.authorities.map((authority) => ({
      fileName: authority.file,
      sha256: authority.sha256,
      canonicalSourceRevision: authority.canonicalSourceRevision,
      canonicalRuntimeIdentitySha256: authority.canonicalRuntimeIdentitySha256,
      canonicalAttestationRevision: authority.canonicalAttestationRevision,
    })).sort((left, right) => left.fileName.localeCompare(right.fileName)),
  })).digest("hex");
}

function requireEvidenceWriterBuildIdentity(): EvidenceBuildIdentity {
  if (!evidenceWriterBuildIdentity) {
    throw new Error("M13 writer build identity is unavailable during canonical selection");
  }
  return evidenceWriterBuildIdentity;
}

function requireEvidenceWriterSourceRevision(): string {
  if (!evidenceWriterSourceRevision) {
    throw new Error("M13 writer source revision is unavailable during canonical rebase");
  }
  return evidenceWriterSourceRevision;
}

function requireEvidenceWriterWorktreeRevision(): string {
  if (!evidenceWriterWorktreeRevision) {
    throw new Error("M13 writer worktree revision is unavailable during canonical rebase");
  }
  return evidenceWriterWorktreeRevision;
}

async function resolveCanonicalRebaseAuthority(
  page: Page,
  file: (typeof screenshotFiles)[number],
  fresh: evidenceIntegrity.FreshCanonicalEvidence,
  canonicalSourceRevision: string,
): Promise<HistoricalCanonicalAuthority> {
  const requestedRevision = process.env[canonicalAttestationEnvironmentName];
  if (!requestedRevision) {
    return {
      bytes: fresh.bytes,
      canonicalSourceRevision,
      canonicalRuntimeIdentitySha256: fresh.runtimeIdentitySha256,
      canonicalAttestationRevision: requireEvidenceWriterWorktreeRevision(),
    };
  }
  if (!/^[0-9a-f]{40}$/.test(requestedRevision)) {
    throw new Error("M13 canonical attestation revision must be a full Git commit");
  }
  execFileSync("git", ["merge-base", "--is-ancestor", requestedRevision, "HEAD"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  const relativeDirectory = "docs/superpowers/screenshots/m13-settings-2026-07-20";
  const seedBytes = execFileSync("git", [
    "show",
    `${requestedRevision}:${relativeDirectory}/${file}`,
  ], { cwd: process.cwd() });
  const seedProvenance = JSON.parse(execFileSync("git", [
    "show",
    `${requestedRevision}:${relativeDirectory}/provenance.json`,
  ], { cwd: process.cwd(), encoding: "utf8" })) as M13EvidenceProvenance;
  const seedAuthority = seedProvenance.authorities.find((authority) => authority.file === file);
  if (!seedAuthority
    || seedAuthority.sha256 !== createHash("sha256").update(seedBytes).digest("hex")
    || seedAuthority.canonicalSourceRevision !== canonicalSourceRevision
    || seedAuthority.canonicalRuntimeIdentitySha256 !== fresh.runtimeIdentitySha256) {
    throw new Error(`M13 canonical attestation seed provenance is invalid: ${file}`);
  }
  const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(
    page,
    seedBytes,
    fresh.bytes,
  );
  return evidenceIntegrity.preserveCanonicalEvidenceAuthority({
    bytes: seedBytes,
    canonicalSourceRevision,
    canonicalRuntimeIdentitySha256: fresh.runtimeIdentitySha256,
    canonicalAttestationRevision: requestedRevision,
  }, fresh.bytes, comparison, {
    maximumDifferentPixels: maximumAntiAliasEdgePixels,
    maximumChannelDelta: maximumAntiAliasChannelDelta,
  });
}

function resolveEvidenceWriterSourceRevision(currentRevision: string): string {
  const requestedRevision = process.env.M13_EVIDENCE_SOURCE_REVISION;
  if (!requestedRevision) return currentRevision;
  if (!/^[0-9a-f]{40}$/.test(requestedRevision)) {
    throw new Error("M13 evidence source revision must be a full Git commit");
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
    "vitest.config.ts",
    "postcss.config.cjs",
    "tailwind.config.cjs",
    "tsconfig.json",
    "vendor/bitwarden-clients",
  ], { cwd: process.cwd(), encoding: "utf8" }).trim();
  if (renderingDiff) throw new Error(`M13 evidence source revision is stale:\n${renderingDiff}`);
  return requestedRevision;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.length < 24
    || !bytes.subarray(0, 8).equals(signature)
    || bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Invalid PNG authority");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function settingsReceipts(page: Page): Promise<string[]> {
  return page.locator("html").evaluate((root) =>
    (root.dataset.bwEvidenceSettingsReceipts ?? "").split(",").filter(Boolean));
}

async function settingsSyncCalls(page: Page): Promise<number> {
  return page.locator("html").evaluate((root) =>
    Number(root.dataset.bwEvidenceSettingsSyncCalls ?? "0"));
}

async function storedAccountTimeout(page: Page): Promise<unknown> {
  return page.evaluate(() => JSON.parse(
    localStorage.getItem("barwarden.account-settings.m13-settings-runtime") ?? "null",
  ));
}

async function storedGlobalSettings(page: Page): Promise<unknown> {
  return page.evaluate(() => JSON.parse(
    localStorage.getItem("barwarden.settings") ?? "null",
  ));
}

interface M13EvidenceProvenanceV1 {
  schema: "m13-settings-evidence-v1";
  sourceRevision: string;
  vendorRevision: string;
  identity: EvidenceBuildIdentity;
  evidenceSetSha256: string;
  writer: {
    project: "chromium";
    viewport: { width: 480; height: 600 };
    deviceScaleFactor: 1;
  };
  authorities: M13EvidenceAuthorityV1[];
}

interface M13EvidenceProvenance extends Omit<M13EvidenceProvenanceV1, "schema" | "authorities"> {
  schema: "m13-settings-evidence-v2";
  authorities: M13EvidenceAuthority[];
}

interface M13EvidenceAuthorityV1 {
  file: (typeof screenshotFiles)[number];
  sha256: string;
  width: number;
  height: number;
  opaque: boolean;
  mostlyBlank: boolean;
  horizontallyClipped: boolean;
}

interface CanonicalAuthorityIdentity {
  canonicalSourceRevision: string;
  canonicalRuntimeIdentitySha256: string;
  canonicalAttestationRevision: string;
}

interface M13EvidenceAuthority extends M13EvidenceAuthorityV1, CanonicalAuthorityIdentity {
}

interface HistoricalCanonicalAuthority extends CanonicalAuthorityIdentity {
  bytes: Buffer;
}

interface CaptureGeometry {
  width: number;
  height: number;
  overflow: number;
  clipped: Array<string | null | undefined>;
}

interface PendingCanonicalAuthority extends HistoricalCanonicalAuthority {
  bytes: Buffer;
  width: number;
  height: number;
  opaque: boolean;
  mostlyBlank: boolean;
  horizontallyClipped: boolean;
}

declare global {
  var __bwReleaseSettingsEvidenceSync: (() => void) | undefined;
}
