import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { compareEvidenceScreenshotPixels } from "./evidence-integrity";
import * as evidenceIntegrity from "./evidence-integrity";
import {
  recoverEvidenceDirectoryTransaction,
  replaceEvidenceDirectoryTransactionally,
} from "./evidence-directory-transaction";
import { evidenceCapturePath, isAuthoritativeEvidenceWriter } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m10-recovery-2026-07-18",
);
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");
const providerPath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.ts",
);
const productionShimPath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.production.ts",
);
const workflowSpecPath = join(
  process.cwd(),
  "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts",
);

const states = [
  "password-history-populated",
  "password-history-empty",
  "password-history-reprompt",
  "folders-list",
  "folders-empty",
  "folders-add-dialog",
  "folders-edit-dialog",
  "folders-delete-confirmation",
  "archive-list",
  "archive-menu",
  "archive-empty",
  "trash-list",
  "trash-menu",
  "trash-permanent-delete-confirmation",
  "trash-empty",
  "recovery-operation-error",
] as const;

const screenshotFiles = states.map((state) => `${state}-480x600.png`);
const reloadBoundaryProvenance = [
  "- Reload boundary: the old page/store is destroyed; the persisted account index restores locked at `#/lock`.",
  "  No fresh server sync runs (`freshSyncCalls = 0`) before a supported unlock.",
  "  This fixture has no master-password or alternative-unlock material, so it makes no post-unlock sync claim.",
].join("\n");
const historySecret = (index: 0 | 1): string => index === 0
  ? String.fromCharCode(77, 49, 48, 45, 72, 105, 115, 116, 111, 114, 121, 45, 65, 33)
  : String.fromCharCode(77, 49, 48, 45, 72, 105, 115, 116, 111, 114, 121, 45, 66, 33);
const forbiddenValues = [
  "Previous-Example-4821!",
  "Older-Example-1736!",
  historySecret(0),
  historySecret(1),
  "Synthetic folder private value",
  "evidence-password",
  "fixture-a",
  "fixture-r",
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
  "4111111111111111",
  "M10-CVC-731",
  "000-00-0000",
  "P1234567",
  "L7654321",
  "Synthetic recovery instructions",
] as const;
const approvedActions = new Set([
  "copy_history",
  "create_folder",
  "update_folder",
  "delete_folder",
  "favorite",
  "archive",
  "unarchive",
  "soft_delete",
  "restore",
  "permanent_delete",
]);
const recoveryItems = [
  { id: "calendar", name: "Example Recovery Login", type: "login", favorite: false, folderId: "m10-work" },
  { id: "m10-card", name: "Example Recovery Card", type: "card", favorite: true, folderId: "m10-personal" },
  { id: "m10-identity", name: "Example Recovery Identity", type: "identity", favorite: false, folderId: "m10-work" },
  { id: "m10-note", name: "Example Recovery Note", type: "secure-note", favorite: false, folderId: "m10-personal" },
] as const;

interface RecoveryBoundary {
  readonly copiedValues: string[];
  readonly secureCalls: { readonly operation: "get" | "set" | "delete"; readonly key: string }[];
  freshSyncCalls: number;
  reset(): void;
  clearSecrets(): void;
}

interface BrowserDiagnostics {
  readonly consoleMessages: string[];
  readonly failedResponses: string[];
  readonly pageErrors: string[];
  readonly requestFailures: string[];
}

const recoveryBoundaries = new WeakMap<Page, RecoveryBoundary>();
const browserDiagnostics = new WeakMap<Page, BrowserDiagnostics>();
const pendingAuthorityRefresh = new Map<string, Buffer>();
let authorityRefreshPhase: "unvalidated" | "baseline-validated" | "refreshed" = "unvalidated";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  recoverEvidenceDirectoryTransaction(evidenceDirectory, (directory) => {
    const provenance = readFileSync(join(directory, "PROVENANCE.md"), "utf8").toLowerCase();
    validateExistingAuthoritySet(provenance, directory);
  });
  expect(existsSync(provenancePath), "M10 provenance must exist before capture").toBe(true);
  validateExistingAuthoritySet(readFileSync(provenancePath, "utf8").toLowerCase());
  authorityRefreshPhase = "baseline-validated";
});

test("requires the complete M10 provider, production shim, authority inventory, provenance, and secret scan before capture", () => {
  expect(existsSync(providerPath), "M10 evidence provider must exist").toBe(true);
  expect(existsSync(productionShimPath), "M10 production empty shim must exist").toBe(true);
  expect(existsSync(provenancePath), "M10 provenance must exist before capture").toBe(true);

  const provider = readFileSync(providerPath, "utf8");
  const productionShim = readFileSync(productionShimPath, "utf8");
  const workflowSpec = readFileSync(workflowSpecPath, "utf8");
  const provenance = readFileSync(provenancePath, "utf8").toLowerCase();
  for (const state of states) {
    expect(provider).toContain(`"${state}"`);
  }
  expect(productionShim).toMatch(/return \[\];/);
  expect(provider).toContain("RecoveryEvidenceReceipt");
  expect(provider).not.toMatch(/BARWARDEN_LIVE_|process\.env|import\.meta\.env/);
  for (const forbidden of [
    "waitFor" + "Timeout",
    "set" + "Timeout",
    "requestAnimation" + "Frame",
    "alternate" + "Hash",
    "mask" + ":",
    "dispatch" + "Event(\"cli" + "ck",
    "dispatch" + "Event('cli" + "ck",
  ]) {
    expect(workflowSpec).not.toContain(forbidden);
  }

  for (const required of [
    "f47b6946e01aed474875789081966d311d5b8289",
    "chromium is the sole authoritative screenshot writer",
    "webkit is assertion-only",
    "masked regions: none",
    "example.test",
  ]) {
    expect(provenance).toContain(required);
  }
  validateExistingAuthoritySet(provenance);
  authorityRefreshPhase = "baseline-validated";
});

for (const state of states) {
  test(`proves sanitized ${state} official recovery state`, async ({ page }, testInfo) => {
    await openState(page, state);
    await prepareStateForCapture(page, state);
    await settleVisualState(page);
    await settleSemanticPaint(page, state);
    await settleOfficialDialogFooters(page);
    await assertPopupGeometry(page);
    await assertAccessibility(page);
    await assertOfficialAncestry(page, state);
    await assertNoTextOverflow(page);
    await assertSecretFreeMetadata(page);

    const screenshot = await capture(page, testInfo, `${state}-480x600.png`);
    const decoded = await decodeScreenshot(page, screenshot);
    expect(decoded).toEqual(expect.objectContaining({
      width: 480,
      height: 600,
      opaquePixels: 480 * 600,
    }));
    expect(decoded.uniqueColors).toBeGreaterThan(16);
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(screenshot, forbiddenValues);
  });
}

test("copies exactly one selected password-history value and protects reprompt", async ({ page }) => {
  await openState(page, "password-history-populated");
  const boundary = recoveryBoundaries.get(page)!;
  const copyButtons = page.getByRole("button", { name: "复制密码", exact: true });
  await expect(copyButtons).toHaveCount(2);
  await pointerClick(page, copyButtons.nth(1));
  await expect(page.locator("html")).toHaveAttribute(
    "data-bw-evidence-recovery-receipt",
    JSON.stringify({ action: "copy_history", itemType: "login", outcome: "committed" }),
  );
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-call-count", "1");
  expect(boundary.copiedValues).toEqual([historySecret(1)]);
  boundary.copiedValues.length = 0;
  await sanitizeHistoryRoute(page);
  await assertSecretFreeMetadata(page);

  await openState(page, "password-history-empty");
  await expect(page.getByText("列表中没有密码", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制密码", exact: true })).toHaveCount(0);

  await openState(page, "password-history-reprompt");
  await pointerClick(page, page.getByRole("button", { name: "复制密码", exact: true }).first());
  await expect(page.getByRole("heading", { name: "确认主密码", exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-recovery-receipt", /.+/);
});

test("keeps the official folder dialog keyboard order", async ({ page }) => {
  await openState(page, "folders-list");
  await pointerClick(page, page.getByTestId("new-folder-button"));
  const folderName = page.getByRole("textbox", { name: "文件夹名称", exact: true });
  await pointerClick(page, folderName);
  await expect(folderName).toBeFocused();
  await folderName.fill("Example Keyboard Folder");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "新增文件夹", exact: true })).toHaveCount(0);
  await expectNoReceipt(page);
});

test("uses official folder dialogs for cancel, success, failure, retry, duplicate, and stale ownership", async ({ page }) => {
  await openState(page, "folders-list");
  await pointerClick(page, page.getByTestId("new-folder-button"));
  const folderName = page.getByRole("textbox", { name: "文件夹名称", exact: true });
  await folderName.fill("Synthetic folder private value");
  await pointerClick(page, page.getByRole("button", { name: "取消", exact: true }));
  await expect(page.getByRole("heading", { name: "新增文件夹", exact: true })).toHaveCount(0);
  await expectNoReceipt(page);

  await pointerClick(page, page.getByTestId("new-folder-button"));
  await folderName.fill("Example Created Folder");
  await pointerClick(page, page.getByRole("button", { name: "保存", exact: true }));
  await expect(page.getByText("Example Created Folder", { exact: true })).toBeVisible();
  await expectReceipt(page, "create_folder", "login", "committed");

  await pointerClick(page, page.getByTestId("edit-folder-m10-work"));
  await folderName.fill("Example Renamed Folder");
  await pointerClick(page, page.getByRole("button", { name: "保存", exact: true }));
  await expect(page.getByRole("heading", { name: "编辑文件夹", exact: true })).toHaveCount(0);
  await expectReceipt(page, "update_folder", "login", "committed");
  await expect(page.getByText("Example Renamed Folder", { exact: true })).toBeVisible();
  await expect(page.getByText("Example Work", { exact: true })).toHaveCount(0);

  await openState(page, "folders-list");
  await pointerClick(page, page.getByTestId("edit-folder-m10-personal"));
  await pointerClick(page, page.getByRole("button", { name: "删除文件夹", exact: true }));
  await expect(page.getByRole("heading", { name: "永久删除文件夹？", exact: true })).toBeVisible();
  await pointerClick(page, page.getByRole("button", { name: "取消", exact: true }).last());
  await expect(page.getByRole("heading", { name: "永久删除文件夹？", exact: true })).toHaveCount(0);
  await pointerClick(page, page.getByRole("button", { name: "删除文件夹", exact: true }));
  await pointerClick(page, page.getByRole("button", { name: "删除", exact: true }));
  await expect(page.getByText("Example Personal", { exact: true })).toHaveCount(0);
  await expectReceipt(page, "delete_folder", "login", "committed");

  await openState(page, "recovery-operation-error");
  await page.evaluate(() => { window.location.hash = "/folders"; });
  await expect(page.getByRole("heading", { name: "文件夹", exact: true })).toBeVisible();
  await pointerClick(page, page.getByTestId("new-folder-button"));
  await folderName.fill("Example Retry Folder");
  await pointerClick(page, page.getByRole("button", { name: "保存", exact: true }));
  await expect(page.getByRole("alert")).toHaveText("无法保存文件夹，请重试。");
  await expectReceipt(page, "create_folder", "login", "failure");
  await page.locator("html").evaluate((root) => { root.dataset.bwEvidenceRecoveryBarrier = "true"; });
  const save = page.getByRole("button", { name: "保存", exact: true });
  await pointerDoubleClick(page, save);
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-pending", "true");
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-call-count", "2");
  await page.evaluate(() => document.dispatchEvent(new Event("bw-evidence-release-recovery-transport")));
  await page.keyboard.press("Tab");
  await expect(page.getByText("Example Retry Folder", { exact: true })).toBeVisible();
  await expectReceipt(page, "create_folder", "login", "committed");
  await expect(page).toHaveURL(/#\/folders$/);
  await expect(page.getByText("Example Work", { exact: true })).toBeVisible();
  await expect(page.getByText("Example Personal", { exact: true })).toBeVisible();
  await expect(page.getByText("Example Retry Folder", { exact: true })).toHaveCount(1);

  await openState(page, "folders-list");
  await pointerClick(page, page.getByTestId("edit-folder-m10-work"));
  await folderName.fill("Example Stale Folder");
  await page.locator("html").evaluate((root) => { root.dataset.bwEvidenceRecoveryBarrier = "true"; });
  await pointerClick(page, page.getByRole("button", { name: "保存", exact: true }));
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-pending", "true");
  await transition(page, "source-replacement");
  await page.evaluate(() => document.dispatchEvent(new Event("bw-evidence-release-recovery-transport")));
  await expectReceipt(page, "update_folder", "login", "stale");
  await expect(page.getByText("Example Stale Folder", { exact: true })).toHaveCount(0);
});

test("proves favorite and lifecycle commands for Login, Card, Identity, and Secure Note", async ({ page }) => {
  for (const item of recoveryItems) {
    await openState(page, "folders-list");
    await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
    const row = vaultRow(page, item.name);
    await openRowMenu(page, row);
    await pointerClick(page, page.getByRole("menuitem", { name: item.favorite ? "取消收藏" : "收藏", exact: true }));
    await expectReceipt(page, "favorite", item.type, "committed");

    await openState(page, "folders-list");
    await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
    await openRowMenu(page, vaultRow(page, item.name));
    await pointerClick(page, page.getByRole("menuitem", { name: "归档", exact: true }));
    await expectReceipt(page, "archive", item.type, "committed");
    await page.keyboard.press("Tab");
    await expect(vaultRow(page, item.name)).toHaveCount(0);

    await openState(page, "archive-list");
    await openRecoveryMenu(page, "archive", item.name);
    await pointerClick(page, page.getByRole("menuitem", { name: "取消归档", exact: true }));
    await expectReceipt(page, "unarchive", item.type, "committed");

    await openState(page, "archive-list");
    await openRecoveryMenu(page, "archive", item.name);
    await pointerClick(page, page.getByRole("menuitem", { name: "删除", exact: true }));
    await pointerClick(page, page.getByRole("button", { name: "删除", exact: true }));
    await expectReceipt(page, "soft_delete", item.type, "committed");

    await openState(page, "trash-list");
    await openRecoveryMenu(page, "trash", item.name);
    await pointerClick(page, page.getByRole("menuitem", { name: "恢复", exact: true }));
    await expectReceipt(page, "restore", item.type, "committed");

    await openState(page, "trash-list");
    await openRecoveryMenu(page, "trash", item.name);
    await pointerClick(page, page.getByRole("menuitem", { name: "永久删除", exact: true }));
    await pointerClick(page, page.getByRole("button", { name: "永久删除", exact: true }));
    await expectReceipt(page, "permanent_delete", item.type, "committed");
  }
});

test("keeps newer route and item state when pending favorite loses its captured page guard", async ({ page }) => {
  const item = recoveryItems[0];
  await openState(page, "folders-list");
  await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
  await expect(vaultRow(page, item.name)).toHaveCount(1);
  await page.locator("html").evaluate((root) => { root.dataset.bwEvidenceRecoveryBarrier = "true"; });
  await openRowMenu(page, vaultRow(page, item.name));
  await pointerClick(page, page.getByRole("menuitem", { name: "收藏", exact: true }));
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-pending", "true");
  await page.evaluate(() => { window.location.hash = "/folders"; });
  await expect(page.getByRole("heading", { name: "文件夹", exact: true })).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("bw-evidence-release-recovery-transport")));
  await expect(page).toHaveURL(/#\/folders$/);
  await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
  await openRowMenu(page, vaultRow(page, item.name));
  await expect(page.getByRole("menuitem", { name: "收藏", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-call-count", "1");
});

test("suppresses duplicate, source, lock, account, route, and route-destruction completions", async ({ page }) => {
  for (const transitionKind of ["source-replacement", "lock", "account-switch"] as const) {
    await openState(page, "archive-list");
    await page.locator("html").evaluate((root) => { root.dataset.bwEvidenceRecoveryBarrier = "true"; });
    await openRecoveryMenu(page, "archive", recoveryItems[0].name);
    await pointerClick(page, page.getByRole("menuitem", { name: "取消归档", exact: true }));
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-pending", "true");
    await openRecoveryMenu(page, "archive", recoveryItems[0].name);
    await pointerClick(page, page.getByRole("menuitem", { name: "取消归档", exact: true }));
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-call-count", "1");
    await transition(page, transitionKind);
    await page.keyboard.press("Tab");
    if (transitionKind === "lock") {
      await expect(page.getByText(recoveryItems[0].name, { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText(`Newer ${transitionKind} Login`, { exact: true })).toBeVisible();
    }
    await page.evaluate(() => document.dispatchEvent(new Event("bw-evidence-release-recovery-transport")));
    await page.keyboard.press("Tab");
    if (transitionKind === "lock") {
      await expect(page.getByText(recoveryItems[0].name, { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText(`Newer ${transitionKind} Login`, { exact: true })).toBeVisible();
    }
    await expectReceipt(page, "unarchive", "login", "stale");
  }

  for (const nextRoute of ["/trash", "/tabs/vault"] as const) {
    await openState(page, "archive-list");
    await page.locator("html").evaluate((root) => { root.dataset.bwEvidenceRecoveryBarrier = "true"; });
    await openRecoveryMenu(page, "archive", recoveryItems[0].name);
    await pointerClick(page, page.getByRole("menuitem", { name: "取消归档", exact: true }));
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-pending", "true");
    await page.evaluate((route) => new Promise<void>((resolve) => {
      window.addEventListener("hashchange", () => resolve(), { once: true });
      window.location.hash = route;
    }), nextRoute);
    await expect(page).toHaveURL(new RegExp(`#${nextRoute}$`));
    await page.evaluate(() => document.dispatchEvent(new Event("bw-evidence-release-recovery-transport")));
    await expectReceipt(page, "unarchive", "login", "stale");
  }
});

test("restores archived Trash items to Archive and active Trash items to Vault", async ({ page }) => {
  const item = recoveryItems[0];
  await openState(page, "archive-list");
  await openRecoveryMenu(page, "archive", item.name);
  await pointerClick(page, page.getByRole("menuitem", { name: "删除", exact: true }));
  await pointerClick(page, page.getByRole("button", { name: "删除", exact: true }));
  await page.evaluate(() => { window.location.hash = "/trash"; });
  await openRecoveryMenu(page, "trash", item.name);
  await pointerClick(page, page.getByRole("menuitem", { name: "恢复", exact: true }));
  await expect(page).toHaveURL(/#\/archive$/);
  await expect(page.getByText(item.name, { exact: true })).toBeVisible();

  await openState(page, "archive-list");
  await openRecoveryMenu(page, "archive", item.name);
  await pointerClick(page, page.getByRole("menuitem", { name: "取消归档", exact: true }));
  await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
  await openRowMenu(page, vaultRow(page, item.name));
  await pointerClick(page, page.getByRole("menuitem", { name: "删除", exact: true }));
  await page.evaluate(() => { window.location.hash = "/trash"; });
  await openRecoveryMenu(page, "trash", item.name);
  await pointerClick(page, page.getByRole("menuitem", { name: "恢复", exact: true }));
  await expect(page).toHaveURL(/#\/trash$/);
  await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
  await expect(vaultRow(page, item.name)).toHaveCount(1);
});

test("restores a persisted account locked and does not sync before supported unlock", async ({ page }) => {
  const item = recoveryItems[2];
  await openState(page, "folders-list");
  const boundary = recoveryBoundaries.get(page)!;
  await pointerClick(page, page.getByTestId("new-folder-button"));
  await page.getByRole("textbox", { name: "文件夹名称", exact: true }).fill("Example Relaunch Folder");
  await pointerClick(page, page.getByRole("button", { name: "保存", exact: true }));
  await expect(page.getByText("Example Relaunch Folder", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
  await openRowMenu(page, vaultRow(page, item.name));
  await pointerClick(page, page.getByRole("menuitem", { name: "收藏", exact: true }));
  await expectReceipt(page, "favorite", item.type, "committed");
  await collapseFavoritesSection(page);
  const allItemsRow = vaultSectionRow(page, "所有项目", item.name);
  await expect(allItemsRow).toHaveCount(1);
  await expect(allItemsRow).toBeVisible();
  await openRowMenu(page, allItemsRow);
  await pointerClick(page, page.getByRole("menuitem", { name: "归档", exact: true }));
  await expectReceipt(page, "archive", item.type, "committed");
  const prepared = await page.evaluate(async () => {
    const prepare = (window as unknown as {
      __bwRecoveryPrepareRelaunch?: () => Promise<void>;
    }).__bwRecoveryPrepareRelaunch;
    if (!prepare) return false;
    await prepare();
    const url = new URL(location.href);
    url.searchParams.set("recoveryStartup", "1");
    history.replaceState(history.state, "", url);
    return true;
  });
  expect(prepared).toBe(true);

  await page.reload({ waitUntil: "commit" });
  await expect(page).toHaveURL(/#\/lock$/);
  await expect(page.getByRole("textbox", { name: "主密码 * (必填)", exact: true })).toBeVisible();
  expect(boundary.freshSyncCalls).toBe(0);
  expect(boundary.secureCalls.some((call) => call.operation === "set" && call.key === "auth.accounts")).toBe(true);
  expect(boundary.secureCalls.some((call) => call.operation === "get" && call.key === "auth.accounts")).toBe(true);
  boundary.clearSecrets();
  await assertSecretFreeMetadata(page);
});

test("keeps a fixed secret-free error and retries from the owned Archive source", async ({ page }) => {
  await openState(page, "recovery-operation-error");
  await page.evaluate(() => { window.location.hash = "/archive"; });
  await expect(page.getByRole("heading", { name: "归档", exact: true })).toBeVisible();
  await openRecoveryMenu(page, "archive", recoveryItems[0].name);
  await pointerClick(page, page.getByRole("menuitem", { name: "取消归档", exact: true }));
  await expectReceipt(page, "unarchive", "login", "failure");
  await expect(page.getByText(recoveryItems[0].name, { exact: true })).toBeVisible();
  await openRecoveryMenu(page, "archive", recoveryItems[0].name);
  await pointerClick(page, page.getByRole("menuitem", { name: "取消归档", exact: true }));
  await expectReceipt(page, "unarchive", "login", "committed");
});

test("records complete reproducible Chromium provenance", ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium is the sole authoritative writer");
  if (process.env.UPDATE_EVIDENCE === "true") {
    expect(authorityRefreshPhase).toBe("baseline-validated");
    evidenceIntegrity.assertExactPngEvidenceInventory(
      [...pendingAuthorityRefresh.keys()],
      screenshotFiles,
    );
    for (const fileName of screenshotFiles) {
      const png = pendingAuthorityRefresh.get(fileName);
      expect(png, `${fileName} staged refresh must exist`).toBeDefined();
      expect(readPngDimensions(png!)).toEqual({ width: 480, height: 600 });
      evidenceIntegrity.assertPngTextMetadataDoesNotContain(png!, forbiddenValues);
      for (const value of forbiddenValues) {
        expect(png!.includes(Buffer.from(value, "utf8")), `${fileName} contains forbidden staged bytes`).toBe(false);
      }
    }
    replaceEvidenceDirectoryTransactionally(evidenceDirectory, (stageDirectory) => {
      for (const fileName of screenshotFiles) {
        writeFileSync(join(stageDirectory, fileName), pendingAuthorityRefresh.get(fileName)!);
      }
      const stagedProvenancePath = join(stageDirectory, "PROVENANCE.md");
      writeFileSync(
        stagedProvenancePath,
        replaceProvenanceHashTable(readFileSync(stagedProvenancePath, "utf8"), stageDirectory),
      );
      validateExistingAuthoritySet(
        readFileSync(stagedProvenancePath, "utf8").toLowerCase(),
        stageDirectory,
      );
    });
    authorityRefreshPhase = "refreshed";
  }
  const provenance = readFileSync(provenancePath, "utf8").toLowerCase();
  validateExistingAuthoritySet(provenance);
  expect(provenance).toContain(
    "persisted account index restores locked at `#/lock`.\n  no fresh server sync runs (`freshsynccalls = 0`) before a supported unlock.",
  );
  expect(authorityRefreshPhase).not.toBe("unvalidated");
});

function validateExistingAuthoritySet(
  provenance: string,
  authorityDirectory = evidenceDirectory,
): void {
  const inventory = readdirSync(authorityDirectory).filter((fileName) => fileName.endsWith(".png"));
  evidenceIntegrity.assertExactPngEvidenceInventory(inventory, screenshotFiles);
  for (const fileName of screenshotFiles) {
    const path = join(authorityDirectory, fileName);
    expect(existsSync(path), `${fileName} authority must exist`).toBe(true);
    const png = readFileSync(path);
    expect(readPngDimensions(png)).toEqual({ width: 480, height: 600 });
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(png, forbiddenValues);
    for (const value of forbiddenValues) {
      expect(png.includes(Buffer.from(value, "utf8")), `${fileName} contains forbidden artifact bytes`).toBe(false);
    }
    const hash = createHash("sha256").update(png).digest("hex");
    expect(provenance).toContain(`| ${fileName} | 480x600 | ${hash} |`);
  }
  for (const value of forbiddenValues) expect(provenance).not.toContain(value.toLowerCase());
}

function readPngDimensions(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function ensureRecoveryBoundary(page: Page): Promise<RecoveryBoundary> {
  const existing = recoveryBoundaries.get(page);
  if (existing) return existing;

  const secureValues = new Map<string, string>();
  const copiedValues: string[] = [];
  const secureCalls: { operation: "get" | "set" | "delete"; key: string }[] = [];
  let server = createRecoveryServerState();
  const boundary: RecoveryBoundary = {
    copiedValues,
    secureCalls,
    freshSyncCalls: 0,
    reset(): void {
      secureValues.clear();
      copiedValues.length = 0;
      secureCalls.length = 0;
      boundary.freshSyncCalls = 0;
      server = createRecoveryServerState();
    },
    clearSecrets(): void {
      secureValues.clear();
      copiedValues.length = 0;
    },
  };

  await page.exposeFunction("__bwRecoverySecureGet", (key: string) => {
    secureCalls.push({ operation: "get", key });
    return secureValues.get(key) ?? null;
  });
  await page.exposeFunction("__bwRecoverySecureSet", (key: string, value: string) => {
    secureCalls.push({ operation: "set", key });
    secureValues.set(key, value);
  });
  await page.exposeFunction("__bwRecoverySecureDelete", (key: string) => {
    secureCalls.push({ operation: "delete", key });
    secureValues.delete(key);
  });
  await page.exposeFunction("__bwRecoveryNativeCopy", (value: string) => {
    copiedValues.push(value);
  });
  await page.exposeFunction(
    "__bwRecoveryServerCommit",
    (action: string, itemId: string | null) => applyRecoveryServerCommit(server, action, itemId),
  );
  await page.exposeFunction("__bwRecoveryFreshSync", () => {
    boundary.freshSyncCalls += 1;
    return structuredClone(server);
  });

  recoveryBoundaries.set(page, boundary);
  return boundary;
}

function createRecoveryServerState() {
  const folders = [
    { id: "m10-work", name: "Example Work" },
    { id: "m10-personal", name: "Example Personal" },
  ];
  const items = recoveryItems.map((item) => ({
    ...item,
    subtitle: `${item.type}.example.test`,
    folderName: folders.find((folder) => folder.id === item.folderId)?.name ?? "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [],
    createdDate: "2026-07-12T00:00:00.000Z",
    revisionDate: "2026-07-12T00:00:00.000Z",
    notes: "",
    canLaunch: false,
    canFill: false,
    uri: "",
    collectionIds: ["m10-collection"],
  }));
  return {
    items,
    archivedItems: [] as typeof items,
    deletedItems: [] as typeof items,
    folders,
    organizations: [{ id: "m10-organization", name: "Example Organization", enabled: true, status: 2 }],
    collections: [{
      id: "m10-collection",
      organizationId: "m10-organization",
      name: "Example Collection",
      readOnly: false,
      manage: true,
    }],
    sends: [],
    cipherCount: items.length,
    encryptedCipherCount: 0,
    folderCount: folders.length,
    sendCount: 0,
  };
}

function applyRecoveryServerCommit(
  server: ReturnType<typeof createRecoveryServerState>,
  action: string,
  itemId: string | null,
): void {
  if (action === "create_folder") {
    if (!server.folders.some((folder) => folder.id === "m10-created-folder")) {
      server.folders.push({ id: "m10-created-folder", name: "Example Relaunch Folder" });
      server.folderCount = server.folders.length;
    }
    return;
  }
  if (action === "update_folder" || action === "delete_folder" || action === "copy_history") return;
  if (!itemId) return;

  const locate = () => {
    for (const [location, collection] of [
      ["active", server.items],
      ["archived", server.archivedItems],
      ["deleted", server.deletedItems],
    ] as const) {
      const index = collection.findIndex((item) => item.id === itemId);
      if (index >= 0) return { collection, index, item: collection[index]!, location };
    }
    return null;
  };
  const found = locate();
  if (!found) return;

  if (action === "favorite") {
    found.collection[found.index] = { ...found.item, favorite: !found.item.favorite };
    return;
  }
  found.collection.splice(found.index, 1);
  if (action === "archive") {
    server.archivedItems.push({ ...found.item, archivedDate: "2026-07-18T00:00:00.000Z" });
  } else if (action === "unarchive") {
    const { archivedDate: _archivedDate, ...active } = found.item;
    server.items.push(active as typeof found.item);
  } else if (action === "soft_delete") {
    server.deletedItems.push({ ...found.item, deletedDate: "2026-07-18T00:00:00.000Z" });
  } else if (action === "restore") {
    const { deletedDate: _deletedDate, ...restored } = found.item;
    (found.item.archivedDate ? server.archivedItems : server.items).push(restored as typeof found.item);
  }
}

function installBrowserDiagnostics(page: Page): void {
  const existing = browserDiagnostics.get(page);
  if (existing) {
    existing.consoleMessages.length = 0;
    existing.failedResponses.length = 0;
    existing.pageErrors.length = 0;
    existing.requestFailures.length = 0;
    return;
  }
  const diagnostics: BrowserDiagnostics = {
    consoleMessages: [],
    failedResponses: [],
    pageErrors: [],
    requestFailures: [],
  };
  page.on("console", (message) => diagnostics.consoleMessages.push(message.text()));
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    diagnostics.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.failedResponses.push(`${response.status()} ${response.url()}`);
  });
  browserDiagnostics.set(page, diagnostics);
}

async function openState(page: Page, state: (typeof states)[number]): Promise<void> {
  const boundary = await ensureRecoveryBoundary(page);
  boundary.reset();
  installBrowserDiagnostics(page);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ animations: false, compactMode: false, fillMode: "clipboard-paste", theme: "light" }),
    );
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/?vaultEvidence=${state}`, { waitUntil: "commit" });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { name: headingFor(state), exact: true }).first()).toBeVisible();
}

function headingFor(state: (typeof states)[number]): string {
  if (state.startsWith("password-history")) return "密码历史记录";
  if (state.startsWith("folders") || state === "recovery-operation-error") return "文件夹";
  if (state.startsWith("trash")) return "回收站";
  return "归档";
}

async function prepareStateForCapture(
  page: Page,
  state: (typeof states)[number],
): Promise<void> {
  if (state.startsWith("password-history")) {
    await sanitizeHistoryRoute(page);
  }
  if (state === "password-history-reprompt") {
    await pointerClick(page, page.getByRole("button", { name: "复制密码", exact: true }).first());
    await expect(page.getByRole("heading", { name: "确认主密码", exact: true })).toBeVisible();
    await pointerClick(page, page.locator("bw-vault-reprompt-dialog input"));
  } else if (state === "folders-add-dialog") {
    await pointerClick(page, page.getByTestId("new-folder-button"));
    await pointerClick(page, page.getByRole("textbox", { name: "文件夹名称", exact: true }));
  } else if (state === "folders-edit-dialog") {
    await pointerClick(page, page.getByTestId("edit-folder-m10-work"));
    await pointerClick(page, page.getByRole("textbox", { name: "文件夹名称", exact: true }));
  } else if (state === "folders-delete-confirmation") {
    await pointerClick(page, page.getByTestId("edit-folder-m10-personal"));
    await pointerClick(page, page.getByRole("button", { name: "删除文件夹", exact: true }));
  } else if (state === "archive-menu") {
    await openRecoveryMenu(page, "archive", recoveryItems[0].name);
  } else if (state === "trash-menu") {
    await openRecoveryMenu(page, "trash", recoveryItems[0].name);
  } else if (state === "trash-permanent-delete-confirmation") {
    await openRecoveryMenu(page, "trash", recoveryItems[0].name);
    await pointerClick(page, page.getByRole("menuitem", { name: "永久删除", exact: true }));
  } else if (state === "recovery-operation-error") {
    await pointerClick(page, page.getByTestId("new-folder-button"));
    await page.getByRole("textbox", { name: "文件夹名称", exact: true }).fill("Example Retry Folder");
    await pointerClick(page, page.getByRole("button", { name: "保存", exact: true }));
    await expect(page.getByRole("alert")).toHaveText("无法保存文件夹，请重试。");
  }
}

async function sanitizeHistoryRoute(page: Page): Promise<void> {
  await transition(page, "sanitize-history");
  await page.evaluate(() => { window.location.hash = "/tabs/vault"; });
  await expect(page.getByRole("heading", { name: "密码库", exact: true })).toBeVisible();
  await page.evaluate(() => { window.location.hash = "/cipher-password-history?cipherId=calendar"; });
  await expect(page.getByRole("heading", { name: "密码历史记录", exact: true })).toBeVisible();
}

async function settleVisualState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return animation.playState === "running" && Number.isFinite(timing?.endTime);
    });
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
    const remaining = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return animation.playState === "running" && Number.isFinite(timing?.endTime);
    });
    if (remaining.length > 0) throw new Error("Finite UI animations remain before evidence capture");
  });
}

async function settleSemanticPaint(
  page: Page,
  state: (typeof states)[number],
): Promise<void> {
  const header = page.locator("popup-page > popup-header").first();
  const title = header.getByRole("heading", { name: headingFor(state), exact: true });
  const rightAction = state.startsWith("folders") || state === "recovery-operation-error"
    ? header.getByRole("button", { name: "新增", exact: true })
    : header.getByRole("button", { name: "弹出到新窗口", exact: true });
  await expect(header).toBeVisible();
  await expect(title).toBeVisible();
  await expect(rightAction).toBeVisible();
  expect(await title.evaluate(isVisiblyPainted)).toBe(true);
  expect(await rightAction.evaluate(isVisiblyPainted)).toBe(true);
  await waitForStablePaint(header);
  const titlePixels = await decodeScreenshot(
    page,
    await title.screenshot({ animations: "disabled" }),
  );
  expect(titlePixels.darkPixels, `${state} title must paint text glyphs`).toBeGreaterThan(0);

  const expectedIcon = state.startsWith("folders") || state === "recovery-operation-error"
    ? "bwi-plus"
    : "bwi-popout";
  const icon = rightAction.locator("i.bwi").first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveClass(new RegExp(`(?:^|\\s)${expectedIcon}(?:\\s|$)`));
  const actionPixels = await decodeScreenshot(
    page,
    await rightAction.screenshot({ animations: "disabled" }),
  );
  expect(actionPixels.uniqueColors, `${state} right action must paint foreground pixels`)
    .toBeGreaterThan(1);
}

function isVisiblyPainted(element: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return bounds.width > 0 && bounds.height > 0 && style.visibility === "visible" &&
    style.display !== "none" && Number(style.opacity) > 0;
}

async function waitForStablePaint(locator: Locator): Promise<void> {
  let previous = await locator.screenshot({ animations: "disabled" });
  while (true) {
    const current = await locator.screenshot({ animations: "disabled" });
    if (current.equals(previous)) return;
    previous = current;
  }
}

async function settleOfficialDialogFooters(page: Page): Promise<void> {
  const dialogs = page.locator("dialog[open] form[bit-dialog]");
  const dialogCount = await dialogs.count();
  if (dialogCount === 0) {
    return;
  }

  const focusedInput = page.locator("dialog[open] input:focus");
  if (await focusedInput.count() === 1) {
    await pointerClick(page, focusedInput);
    await expect(focusedInput).toBeFocused();
  }

  for (let index = 0; index < dialogCount; index += 1) {
    const dialog = dialogs.nth(index);
    await waitForStablePaint(dialog.locator("xpath=.."));
    const scrollBody = dialog.locator("[cdkscrollable]");
    expect(await scrollBody.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
    await expect(dialog.locator('[data-chromatic="ignore"]')).toHaveClass(/tw-border-transparent/);
  }
}

async function assertOfficialAncestry(
  page: Page,
  state: (typeof states)[number],
): Promise<void> {
  if (state.startsWith("password-history")) {
    await expect(page.locator(
      "barwarden-root > .popup-window-size-source > bw-vault-password-history-page > popup-page bw-official-password-history-view",
    )).toHaveCount(1);
  } else if (state.startsWith("folders") || state === "recovery-operation-error") {
    await expect(page.locator("barwarden-root > .popup-window-size-source > bw-folders-page > bw-official-folders popup-page"))
      .toHaveCount(1);
    if (state.includes("dialog") || state.includes("confirmation") || state === "recovery-operation-error") {
      await expect(page.locator("bw-folders-page > bw-vault-folder-dialog .app-bottom-sheet[open]"))
        .toHaveCount(1);
    }
  } else if (state.startsWith("trash")) {
    await expect(page.locator("barwarden-root > .popup-window-size-source > bw-trash-page > bw-official-trash popup-page"))
      .toHaveCount(1);
  } else {
    await expect(page.locator("barwarden-root > .popup-window-size-source > bw-archive-page > bw-official-archive popup-page"))
      .toHaveCount(1);
  }
}

async function assertPopupGeometry(page: Page): Promise<void> {
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })))
    .toEqual({ width: 480, height: 600, dpr: 1 });
  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("barwarden-root");
    const scrollHost = document.querySelector<HTMLElement>(
      'popup-page [data-testid="popup-layout-scroll-region"]',
    );
    const header = document.querySelector<HTMLElement>("popup-page > popup-header");
    const footer = document.querySelector<HTMLElement>("popup-page > popup-footer");
    if (!root || !scrollHost || !header) throw new Error("Incomplete fixed popup layout");
    const candidates = [document.documentElement, document.body, root, ...root.querySelectorAll<HTMLElement>("*")];
    const box = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollOwners: [...new Set(candidates)].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (element === scrollHost || element.scrollHeight > element.clientHeight) &&
          ["auto", "scroll"].includes(style.overflowY) && rect.width > 0 && rect.height > 0;
      }).map((element) => element.dataset.testid ?? element.tagName.toLowerCase()),
      header: box(header),
      footer: footer ? box(footer) : null,
    };
  });
  expect(layout.horizontalOverflow).toBe(0);
  expect(layout.scrollOwners).toEqual(["popup-layout-scroll-region"]);
  expect(layout.header).toMatchObject({ x: 0, y: 0, width: 480 });
  if (layout.footer) expect(layout.footer).toMatchObject({ x: 0, width: 480, bottom: 600 });
}

async function assertAccessibility(page: Page): Promise<void> {
  const diagnostic = await page.evaluate(() => {
    const duplicateIds = [...document.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter((id, index, ids) => id && ids.indexOf(id) !== index);
    const unlabeledButtons = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.getClientRects().length > 0)
      .filter((button) => !(
        button.getAttribute("aria-label")?.trim() ||
        button.getAttribute("aria-labelledby")?.trim() ||
        button.textContent?.trim() ||
        button.title.trim()
      ));
    return { duplicateIds, unlabeledButtons: unlabeledButtons.map((button) => button.outerHTML) };
  });
  expect(diagnostic.duplicateIds).toEqual([]);
  expect(diagnostic.unlabeledButtons).toEqual([]);
}

async function assertNoTextOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const escaped: string[] = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent?.trim() ?? "";
      const parent = node.parentElement;
      if (text && parent && !parent.closest(".tw-truncate")) {
        const style = getComputedStyle(parent);
        const container = parent.getBoundingClientRect();
        if (
          style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 &&
          parent.getClientRects().length > 0 && container.width > 1 && container.height > 1
        ) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const bounds of range.getClientRects()) {
            if (
              bounds.left < container.left - 1 || bounds.right > container.right + 1 ||
              bounds.top < container.top - 3 || bounds.bottom > container.bottom + 3
            ) escaped.push(`${parent.tagName.toLowerCase()}:${text.slice(0, 80)}`);
          }
        }
      }
      node = walker.nextNode();
    }
    return escaped;
  });
  expect(overflow).toEqual([]);
}

async function assertSecretFreeMetadata(page: Page): Promise<void> {
  const diagnostics = await page.evaluate(() => ({
    documentHtml: document.documentElement.outerHTML,
    bodyHtml: document.body.innerHTML,
    renderedText: document.body.innerText,
    inputValues: [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")]
      .map((input) => input.value),
    shadowRoots: [...document.querySelectorAll<HTMLElement>("*")]
      .flatMap((element) => element.shadowRoot
        ? [{ html: element.shadowRoot.innerHTML, text: element.shadowRoot.textContent }]
        : []),
    url: location.href,
    historyState: history.state,
    localStorage: Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => key !== null)
        .map((key) => [key, localStorage.getItem(key)]),
    ),
    sessionStorage: Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
        .filter((key): key is string => key !== null)
        .map((key) => [key, sessionStorage.getItem(key)]),
    ),
    datasets: [...document.querySelectorAll<HTMLElement>("*")]
      .filter((element) => Object.keys(element.dataset).length > 0)
      .map((element) => ({ tag: element.tagName, dataset: { ...element.dataset } })),
    networkResources: performance.getEntriesByType("resource").map((entry) => entry.name),
    receipt: document.documentElement.dataset.bwEvidenceRecoveryReceipt,
  }));
  const serialized = JSON.stringify({
    browser: diagnostics,
    pageContent: await page.content(),
    runtime: browserDiagnostics.get(page),
  });
  for (const value of forbiddenValues) expect(serialized).not.toContain(value);
  if (diagnostics.receipt) {
    const receipt = JSON.parse(diagnostics.receipt) as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual(["action", "itemType", "outcome"]);
    expect(approvedActions.has(String(receipt.action))).toBe(true);
  }
}

async function expectReceipt(
  page: Page,
  action: string,
  itemType: string,
  outcome: string,
): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute(
    "data-bw-evidence-recovery-receipt",
    JSON.stringify({ action, itemType, outcome }),
  );
  await assertSecretFreeMetadata(page);
}

async function expectNoReceipt(page: Page): Promise<void> {
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-recovery-receipt", /.+/);
}

function vaultRow(page: Page, name: string): Locator {
  return page.locator("bit-item").filter({ has: page.getByTestId("item-name").filter({ hasText: name }) });
}

function vaultSectionRow(page: Page, sectionName: string, name: string): Locator {
  return page.locator("app-vault-list-items-container")
    .filter({ has: page.getByRole("heading", { name: sectionName, exact: true }) })
    .locator("bit-item")
    .filter({ has: page.getByTestId("item-name").filter({ hasText: name }) });
}

async function collapseFavoritesSection(page: Page): Promise<void> {
  const disclosure = page.locator("button")
    .filter({ has: page.getByRole("heading", { name: "收藏夹", exact: true }) });
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).toBeVisible();
  if (await disclosure.getAttribute("aria-expanded") === "true") {
    await pointerClick(page, disclosure);
  }
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
}

async function openRowMenu(page: Page, row: Locator): Promise<void> {
  const button = await row.last().getByRole("button", { name: "更多", exact: true }).elementHandle();
  expect(button).not.toBeNull();
  await button!.scrollIntoViewIfNeeded();
  const bounds = await button!.boundingBox();
  expect(bounds).not.toBeNull();
  const point = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  await page.mouse.move(point.x, point.y);
  const hit = await button!.evaluate((target, location) => {
    const hitTarget = document.elementFromPoint(location.x, location.y);
    return hitTarget !== null && target.contains(hitTarget);
  }, point);
  expect(hit).toBe(true);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByRole("menu", { name: "更多", exact: true })).toBeVisible();
}

async function openRecoveryMenu(
  page: Page,
  location: "archive" | "trash",
  name: string,
): Promise<void> {
  const label = location === "archive" ? `归档选项 ${name}` : `回收站选项 ${name}`;
  await pointerClick(page, page.getByRole("button", { name: label, exact: true }));
  await expect(page.getByRole("menu", { name: label, exact: true })).toBeVisible();
}

async function transition(page: Page, kind: string): Promise<void> {
  await page.evaluate((detail) => {
    document.dispatchEvent(new CustomEvent("bw-evidence-recovery-transition", { detail }));
  }, kind);
}

async function pointerClick(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const point = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  await page.mouse.move(point.x, point.y);
  const hit = await locator.evaluate((target, location) => {
    const hitTarget = document.elementFromPoint(location.x, location.y);
    return hitTarget !== null && target.contains(hitTarget);
  }, point);
  expect(hit).toBe(true);
  await page.mouse.down();
  await page.mouse.up();
}

async function pointerDoubleClick(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const point = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  await page.mouse.move(point.x, point.y);
  const hit = await locator.evaluate((target, location) => {
    const hitTarget = document.elementFromPoint(location.x, location.y);
    return hitTarget !== null && target.contains(hitTarget);
  }, point);
  expect(hit).toBe(true);
  await page.mouse.dblclick(point.x, point.y);
}

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<Buffer> {
  expect(authorityRefreshPhase, "M10 authority baseline must be validated before capture")
    .toBe("baseline-validated");
  const authorityPath = join(evidenceDirectory, fileName);
  const writer = isAuthoritativeEvidenceWriter(testInfo);
  const screenshot = await page.screenshot({
    ...(!writer ? { path: evidenceCapturePath(testInfo, authorityPath) } : {}),
    animations: "disabled",
  });
  if (writer) {
    pendingAuthorityRefresh.set(fileName, screenshot);
  } else if (testInfo.project.name === "chromium") {
    expect(existsSync(authorityPath), `${fileName} authority must exist`).toBe(true);
    const comparison = await compareEvidenceScreenshotPixels(
      page,
      readFileSync(authorityPath),
      screenshot,
    );
    expect(comparison.differentPixels).toBe(0);
  }
  return screenshot;
}

async function decodeScreenshot(page: Page, buffer: Buffer) {
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Unable to decode evidence screenshot");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    let opaquePixels = 0;
    let darkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 255) opaquePixels += 1;
      if (pixels[index] < 192 && pixels[index + 1] < 192 && pixels[index + 2] < 192) {
        darkPixels += 1;
      }
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    }
    return { width: canvas.width, height: canvas.height, opaquePixels, darkPixels, uniqueColors: colors.size };
  }, buffer.toString("base64"));
}

function replaceProvenanceHashTable(
  provenance: string,
  authorityDirectory = evidenceDirectory,
): string {
  provenance = replaceReloadBoundaryProvenance(provenance);
  evidenceIntegrity.assertExactPngEvidenceInventory(
    readdirSync(authorityDirectory).filter((fileName) => fileName.endsWith(".png")),
    screenshotFiles,
  );
  const header = "| File | Dimensions | SHA-256 |\n| --- | --- | --- |";
  const start = provenance.indexOf(header);
  if (start < 0) throw new Error("M10 provenance SHA table is missing");
  const nextSection = provenance.indexOf("\n\n", start + header.length);
  const end = nextSection < 0 ? provenance.trimEnd().length : nextSection;
  const rows = [...screenshotFiles].sort().map((fileName) => {
    const path = join(authorityDirectory, fileName);
    if (!existsSync(path)) throw new Error(`Missing M10 authority: ${fileName}`);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    return `| ${fileName} | 480x600 | ${hash} |`;
  });
  return `${provenance.slice(0, start)}${[header, ...rows].join("\n")}${provenance.slice(end)}`;
}

function replaceReloadBoundaryProvenance(provenance: string): string {
  const start = provenance.indexOf("- Reload boundary:");
  if (start < 0) throw new Error("M10 provenance reload boundary is missing");
  const end = provenance.indexOf("\n\n", start);
  if (end < 0) throw new Error("M10 provenance reload boundary is incomplete");
  return `${provenance.slice(0, start)}${reloadBoundaryProvenance}${provenance.slice(end)}`;
}
