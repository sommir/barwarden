import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  recoverEvidenceDirectoryTransaction,
  replaceEvidenceDirectoryTransactionally,
} from "./evidence-directory-transaction";
import * as evidenceIntegrity from "./evidence-integrity";
import { isAuthoritativeEvidenceWriter } from "./evidence-path";
import { assertCleanEvidenceWriterTree } from "./evidence-source-guard";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m11-generator-2026-07-19",
);
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");
const runtimeResultPath = join(
  process.cwd(),
  "docs/superpowers/specs/2026-07-19-m11-generator-runtime-result.md",
);
const workflowSpecPath = join(process.cwd(), "apps/menubar-tauri/e2e/official-generator-workflows.spec.ts");
const screenshotFiles = [
  "generator-password-480x600.png",
  "generator-passphrase-480x600.png",
  "generator-username-word-480x600.png",
  "generator-username-plus-address-480x600.png",
  "generator-username-catchall-480x600.png",
  "generator-long-value-480x600.png",
  "generator-history-populated-480x600.png",
  "generator-history-clear-confirmation-480x600.png",
  "generator-history-empty-480x600.png",
] as const;
const forbiddenValues = [
  "Mango-River-47!",
  "orbit-lantern-copper-signal",
  "evidence-user-4821",
  "evidence4821",
] as const;
const pinnedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";

const pendingAuthorities = new Map<string, Buffer>();
let evidenceWriterSourceRevision: string | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(({}, testInfo) => {
  if (!isAuthoritativeEvidenceWriter(testInfo)) return;
  recoverEvidenceDirectoryTransaction(evidenceDirectory, validateAuthoritySet);
  evidenceWriterSourceRevision = assertCleanEvidenceWriterTree();
});

test("requires the complete M11 authority inventory before generator workflow execution", () => {
  expect(existsSync(provenancePath), "M11 provenance must exist").toBe(true);
  expect(existsSync(runtimeResultPath), "M11 runtime result must exist").toBe(true);
  const source = readFileSync(workflowSpecPath, "utf8");
  expect(source).toContain("replaceEvidenceDirectoryTransactionally");
  expect(source).not.toContain("waitFor" + "Timeout");
  expect(source).not.toContain("mask" + ":");
  if (process.env.UPDATE_EVIDENCE === "true") return;
  validateAuthoritySet(evidenceDirectory);
  const provenance = readFileSync(provenancePath, "utf8");
  expect(provenance).toContain("Chromium is the sole authoritative screenshot writer");
  expect(provenance).toContain("WebKit is assertion-only");
  validateRecordedSourceRevision(provenance);
  validateProvenanceHashes(provenance, evidenceDirectory);
});

test("geometry gate rejects a fully horizontally displaced control", async ({ page }) => {
  await openGenerator(page);
  const headerAction = page.locator(
    "bw-official-credential-generator popup-header app-pop-out button",
  );
  await expect(headerAction).toBeVisible();
  await headerAction.evaluate((element) => {
    element.style.position = "fixed";
    element.style.left = "720px";
    element.style.top = "20px";
    element.style.transform = "none";
    element.style.zIndex = "1000";
  });
  await expect.poll(() => headerAction.evaluate((element) => element.getBoundingClientRect().left))
    .toBeGreaterThan(480);

  await expect(assertGeometry(page)).rejects.toThrow();
});

test("geometry gate rejects a partially clipped control at a scroll-region boundary", async ({ page }) => {
  await openGenerator(page);
  const length = page.getByRole("spinbutton", { name: "长度", exact: true });
  await expect(length).toBeVisible();
  await length.evaluate((element) => {
    let region = element.parentElement;
    while (region) {
      const style = getComputedStyle(region);
      if (
        region.scrollHeight > region.clientHeight
        && (style.overflowY === "auto" || style.overflowY === "scroll")
      ) break;
      region = region.parentElement;
    }
    if (!region) throw new Error("Official Generator scroll region is unavailable");
    const regionBounds = region.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    element.style.position = "fixed";
    element.style.left = `${bounds.left}px`;
    element.style.top = `${regionBounds.bottom - bounds.height / 2}px`;
    element.style.width = `${bounds.width}px`;
    element.style.zIndex = "1000";
  });

  await expect(assertGeometry(page)).rejects.toThrow();
});

test("geometry gate rejects a partially clipped anchor at a scroll-region boundary", async ({ page }) => {
  await openGenerator(page, "plus-address");
  const history = page.getByRole("link", { name: "生成器历史记录", exact: true });
  await expect(history).toBeVisible();
  await history.evaluate((element) => {
    let region = element.parentElement;
    while (region) {
      const style = getComputedStyle(region);
      if (
        region.scrollHeight > region.clientHeight
        && (style.overflowY === "auto" || style.overflowY === "scroll")
      ) break;
      region = region.parentElement;
    }
    if (!region) throw new Error("Official Generator scroll region is unavailable");
    const regionBounds = region.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    element.style.position = "fixed";
    element.style.left = `${bounds.left}px`;
    element.style.top = `${regionBounds.bottom - bounds.height / 2}px`;
    element.style.width = `${bounds.width}px`;
    element.style.zIndex = "1000";
  });

  await expect(assertGeometry(page)).rejects.toThrow();
});

test("geometry gate permits normal wholly offscreen scroll content", async ({ page }) => {
  await openGenerator(page);
  await page.getByTestId("popup-layout-scroll-region").evaluate((region) => {
    const control = document.createElement("button");
    control.id = "normal-offscreen-scroll-control";
    control.textContent = "offscreen";
    control.style.position = "absolute";
    control.style.left = "20px";
    control.style.top = `${region.scrollHeight + 100}px`;
    control.style.width = "80px";
    control.style.height = "32px";
    region.append(control);
  });

  await assertGeometry(page);
});

test("header paint guard rejects opacity and occlusion mutations", async ({ page }) => {
  await openGenerator(page);
  const header = page.locator("bw-official-credential-generator popup-header");
  const title = header.locator("h1");
  await title.evaluate((element) => { element.style.opacity = "0"; });
  await expect(assertOfficialGeneratorHeader(page, "generator-password-480x600.png")).rejects.toThrow();
  await title.evaluate((element) => { element.style.opacity = ""; });

  const accountAction = header.locator("app-current-account button");
  await accountAction.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const occluder = document.createElement("div");
    occluder.id = "m11-header-occluder";
    Object.assign(occluder.style, {
      position: "fixed",
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      zIndex: "2147483647",
      background: "rgb(0 0 0)",
    });
    document.body.append(occluder);
  });
  await expect(assertOfficialGeneratorHeader(page, "generator-password-480x600.png")).rejects.toThrow();
  await page.locator("#m11-header-occluder").evaluate((element) => element.remove());
  await assertOfficialGeneratorHeader(page, "generator-password-480x600.png");
});

test("provenance rejects invalid vendor attestations and non one-to-one authority hash rows", () => {
  const provenance = buildProvenance(evidenceDirectory);
  expect(() => validateProvenanceHashes(provenance, evidenceDirectory)).not.toThrow();
  expect(() => validateProvenanceHashes(
    provenance.replace(/^- Vendor revision: .*\n/m, ""),
    evidenceDirectory,
  )).toThrow();
  expect(() => validateProvenanceHashes(
    provenance.replace(
      "- Vendor revision: f47b6946e01aed474875789081966d311d5b8289 (pinned and unchanged)",
      "- Vendor revision: deadbeef (pinned and unchanged)",
    ),
    evidenceDirectory,
  )).toThrow();
  expect(() => validateProvenanceHashes(
    provenance.replace(
      "- Vendor revision: f47b6946e01aed474875789081966d311d5b8289 (pinned and unchanged)",
      "- Vendor revision: f47b6946e01aed474875789081966d311d5b8289 (pinned and unchanged)\n- Vendor revision: f47b6946e01aed474875789081966d311d5b8289 (pinned and unchanged)",
    ),
    evidenceDirectory,
  )).toThrow();
  expect(() => validateProvenanceHashes(
    provenance.replace(
      "| generator-password-480x600.png |",
      "| generator-password-480x600.png |\n| generator-password-480x600.png |",
    ),
    evidenceDirectory,
  )).toThrow();
  expect(() => validateProvenanceHashes(
    `${provenance.trimEnd()}\n| unexpected-authority-480x600.png | ${"0".repeat(64)} |\n`,
    evidenceDirectory,
  )).toThrow();
});

test("proves retained password and passphrase controls, keyboard copy, and long-value wrapping", async ({ page }, testInfo) => {
  await openGenerator(page);
  await expect(page.locator("bw-official-credential-generator bw-official-generator-core")).toBeVisible();
  await expect(page.locator("bit-toggle-group + bit-card bit-color-password")).toBeVisible();
  const passwordLength = page.getByRole("spinbutton", { name: "长度", exact: true });
  const minNumbers = page.getByRole("spinbutton", { name: "最少数字", exact: true });
  const minSpecial = page.getByRole("spinbutton", { name: "最少特殊字符", exact: true });
  await expect(passwordLength).toHaveAttribute("min", "5");
  await expect(passwordLength).toHaveAttribute("max", "128");
  await expect(page.getByRole("checkbox", { name: "A-Z", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "a-z", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "0-9", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "特殊字符", exact: true })).not.toBeChecked();
  await expect(minNumbers).toHaveValue("1");
  await expect(minSpecial).toHaveValue("0");
  await capture(page, testInfo, "generator-password-480x600.png");

  const generate = page.getByRole("button", { name: "生成密码", exact: true });
  await page.getByRole("checkbox", { name: "特殊字符", exact: true }).click();
  await updateGeneratorSetting(minNumbers, "2");
  await updateGeneratorSetting(minSpecial, "2");
  await passwordLength.fill("5");
  await passwordLength.press("Tab");
  await expect(passwordLength).toHaveValue("6");
  await updateGeneratorSetting(passwordLength, "128");
  await expect(passwordLength).toHaveValue("128");
  await page.getByRole("checkbox", { name: "避免易混淆字符", exact: true }).click();
  await page.getByRole("checkbox", { name: "避免易混淆字符", exact: true }).click();
  await generate.focus();
  await page.keyboard.press("Enter");
  await generate.click();
  await expect(page.getByRole("button", { name: "复制密码", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "复制密码", exact: true }).focus();
  await page.keyboard.press("Enter");

  await page.getByText("密码短语", { exact: true }).click();
  const passphraseWords = page.getByRole("spinbutton", { name: "单词数量", exact: true });
  await updateGeneratorSetting(passphraseWords, "3");
  await expect(passphraseWords).toHaveValue("3");
  await page.evaluate(() => {
    const words = document.querySelector<HTMLInputElement>("#num-words");
    const separator = document.querySelector<HTMLInputElement>("#word-separator");
    if (!words || !separator) throw new Error("Official passphrase controls are unavailable");
    words.value = "20";
    separator.value = ".";
    words.dispatchEvent(new Event("input", { bubbles: true }));
    separator.dispatchEvent(new Event("input", { bubbles: true }));
    words.dispatchEvent(new Event("change", { bubbles: true }));
    separator.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(passphraseWords).toHaveValue("20");
  await expect(page.locator("#word-separator")).toHaveValue(".");
  await page.getByRole("checkbox", { name: "首字母大写", exact: true }).click();
  await page.getByRole("checkbox", { name: "包含数字", exact: true }).click();
  const generatePassphrase = page.getByRole("button", { name: "生成密码短语", exact: true });
  await expect(generatePassphrase).toBeEnabled();
  await generatePassphrase.click();
  await generatePassphrase.click();
  await capture(page, testInfo, "generator-passphrase-480x600.png");

  await page.getByText("密码", { exact: true }).first().click();
  const length = page.getByRole("spinbutton", { name: "长度", exact: true });
  await expect(length).toHaveValue("128");
  await expect(page.locator("bit-color-password")).toContainText("Mango-River-47!");
  await capture(page, testInfo, "generator-long-value-480x600.png");
});

test("proves retained username modes without browser context or forwarded-email providers", async ({ page }, testInfo) => {
  await openGenerator(page, "username");
  await expect(page.getByTestId("username-type")).toBeVisible();
  await expect(page.locator("text=转发")).toHaveCount(0);
  await expect(page.locator("text=当前标签页")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "首字母大写", exact: true }).click();
  await page.getByRole("checkbox", { name: "包含数字", exact: true }).click();
  await expect(page.locator("bit-color-password")).not.toHaveText("-");
  await capture(page, testInfo, "generator-username-word-480x600.png");

  await openGenerator(page, "plus-address");
  await expect(page.locator("tools-subaddress-settings")).toBeVisible();
  const plusAddress = page.getByRole("textbox", { name: "电子邮箱", exact: true });
  await expect(page.locator("bit-color-password")).toHaveText("-");
  await updateGeneratorSetting(plusAddress, "invalid");
  await expect(page.locator("bit-color-password")).toHaveText("-");
  await updateGeneratorSetting(plusAddress, "owner@example.test");
  await expect(page.locator("bit-color-password")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "复制电子邮箱", exact: true })).toBeEnabled();
  await capture(page, testInfo, "generator-username-plus-address-480x600.png");

  await openGenerator(page, "catchall");
  await expect(page.locator("tools-catchall-settings")).toBeVisible();
  const catchallDomain = page.getByRole("textbox", { name: "域名", exact: true });
  await expect(catchallDomain).toHaveValue("");
  await expect(page.locator("bit-color-password")).toHaveText("-");
  await updateGeneratorSetting(catchallDomain, "mail.example.test");
  await expect(page.locator("bit-color-password")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "复制电子邮箱", exact: true })).toBeEnabled();
  await capture(page, testInfo, "generator-username-catchall-480x600.png");
});

test("proves official history copy, clear cancel and confirmation focus restoration", async ({ page }, testInfo) => {
  await openGenerator(page);
  const button = page.getByRole("button", { name: "生成密码", exact: true });
  await button.click();
  await button.click();
  await page.clock.setFixedTime(new Date("2026-07-19T02:00:01.000Z"));
  const usernameMode = page.getByRole("radio", { name: "用户名", exact: true });
  await page.getByText("用户名", { exact: true }).click();
  await expect(usernameMode).toBeChecked();
  const generateUsername = page.getByRole("button", { name: "生成用户名", exact: true });
  await expect(generateUsername).toBeVisible();
  await generateUsername.click();
  await page.getByRole("link", { name: "生成器历史记录", exact: true }).click();
  await expect(page.locator("bw-official-generator-history")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制密码", exact: true }).first()).toBeEnabled();
  await expect(page.getByRole("button", { name: "复制用户名", exact: true }).first()).toBeEnabled();
  await capture(page, testInfo, "generator-history-populated-480x600.png");

  const clear = page.getByRole("contentinfo").getByRole("button", { name: "清除历史记录", exact: true });
  await clear.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "清除历史记录", exact: true })).toBeFocused();
  await capture(page, testInfo, "generator-history-clear-confirmation-480x600.png");
  await page.keyboard.press("Escape");
  await expect(clear).toBeFocused();

  await clear.click();
  await dialog.getByRole("button", { name: "清除历史记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "没有可显示的内容", exact: true })).toBeVisible();
  await expect(clear).toHaveCount(0);
  await capture(page, testInfo, "generator-history-empty-480x600.png");
});

test("proves source-direct history loading, retry, copy failure, and clear retry", async ({ page }) => {
  await openGeneratorHistoryEvidence(page, "history-loading");
  await expect(page.locator("popup-page[aria-busy=true]")).toBeVisible();
  await page.evaluate(() => globalThis.dispatchEvent(new Event("bw-generator-evidence-release")));
  await expect(page.locator("popup-page[aria-busy=true]")).toHaveCount(0);
  await expect(page.locator("bit-credential-generator-history bit-item")).toHaveCount(2);

  await openGeneratorHistoryEvidence(page, "history-load-retry");
  await expect(page.getByRole("alert")).toHaveText("无法加载生成器历史记录。");
  await page.evaluate(() => { globalThis.location.hash = "/tabs/vault"; });
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect(page.locator("bw-official-generator-history")).toHaveCount(0);
  await page.evaluate(() => { globalThis.location.hash = "/generator-history"; });
  await expect(page.locator("bw-official-generator-history")).toBeVisible();
  await expect(page.locator("bit-credential-generator-history bit-item")).toHaveCount(2);

  await openGeneratorHistoryEvidence(page, "history-copy-retry");
  const copy = page.getByRole("button", { name: "复制密码", exact: true }).first();
  await copy.click();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-copy-attempts", "1");
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-last-host-action", "copy_text");
  await expect(page.getByRole("alert")).toHaveText("无法复制生成的内容。");
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-copy-attempts", "2");
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-last-host-action", "copy_text");

  await openGeneratorHistoryEvidence(page, "history-clear-retry");
  const clear = page
    .getByRole("contentinfo")
    .getByRole("button", { name: "清除历史记录", exact: true });
  await clear.click();
  await page.getByRole("dialog").getByRole("button", { name: "清除历史记录", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("无法清除生成器历史记录。");
  await expect(page.locator("bit-credential-generator-history bit-item")).toHaveCount(2);
  await clear.click();
  await page.getByRole("dialog").getByRole("button", { name: "清除历史记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "没有可显示的内容", exact: true })).toBeVisible();
});

test("proves retained Login-form handoff patches only the current controls without serialization", async ({ page }) => {
  await openEvidenceRoute(page, "/add-cipher?type=1", "login-workflow-form-add");
  const username = page.getByRole("textbox", { name: "用户名", exact: true });
  const password = page.getByLabel("密码", { exact: true });
  await expect(username).toBeVisible();
  await expect(password).toBeVisible();
  await expect(username).toHaveValue("");
  await expect(password).toHaveValue("");

  await page.getByTestId("generate-username-button").click();
  await expect(username).not.toHaveValue("");
  await expect(password).toHaveValue("");
  const usernameValue = await username.inputValue();

  await page.getByTestId("generate-password-button").click();
  await expect(password).not.toHaveValue("");
  await expect(username).toHaveValue(usernameValue);
  const passwordValue = await password.inputValue();
  await expect(page).not.toHaveURL(new RegExp(`${escapeRegExp(usernameValue)}|${escapeRegExp(passwordValue)}`));
  await expect(page.evaluate(([generatedUsername, generatedPassword]) => {
    const persisted = [localStorage, sessionStorage]
      .flatMap((storage) => Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? ""))
      .join("\n");
    return !persisted.includes(generatedUsername) && !persisted.includes(generatedPassword);
  }, [usernameValue, passwordValue])).resolves.toBe(true);

  await page.evaluate(() => { globalThis.location.hash = "/tabs/vault"; });
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect(page.locator("bw-official-login-cipher-form")).toHaveCount(0);
});

test("proves generation ownership across account, lock, same-ID route, duplicate, and form-failure lifecycles", async ({ page }) => {
  for (const [scenario, mutation] of [
    ["generation-account-switch", "account-switch"],
    ["generation-lock", "lock"],
    ["generation-same-id", "same-id-session"],
  ] as const) {
    await openGeneratorLifecycle(page, scenario);
    const value = page.locator("bit-color-password");
    await expect(value).toHaveText("evidence-lifecycle-initial");
    const initial = await value.innerText();
    const tracks = await evidenceCount(page, "bwEvidenceGeneratorHistoryTracks");
    await page.getByRole("button", { name: "生成密码", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-pending", "1");
    await page.evaluate((detail) => {
      document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-account", { detail }));
      document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-release", { detail: "oldest" }));
    }, mutation);
    await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-generator-pending", /.+/);
    await expect(value).toHaveText(initial);
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-history-tracks", String(tracks));
  }

  await openGeneratorLifecycle(page, "generation-route-teardown");
  await page.getByRole("button", { name: "生成密码", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-pending", "1");
  await page.evaluate(() => { globalThis.location.hash = "/tabs/vault"; });
  await expect(page.locator("bw-official-credential-generator")).toHaveCount(0);
  await page.evaluate(() => { globalThis.location.hash = "/tabs/generator"; });
  await expect(page.locator("bw-official-credential-generator")).toBeVisible();
  const currentRouteValue = await page.locator("bit-color-password").innerText();
  const currentRouteTracks = await evidenceCount(page, "bwEvidenceGeneratorHistoryTracks");
  await page.evaluate(() => document.dispatchEvent(
    new CustomEvent("bw-generator-lifecycle-release", { detail: "oldest" }),
  ));
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-generator-pending", /.+/);
  await expect(page.locator("bit-color-password")).toHaveText(currentRouteValue);
  await expect(page.locator("html")).toHaveAttribute(
    "data-bw-evidence-generator-history-tracks",
    String(currentRouteTracks),
  );

  await openGeneratorLifecycle(page, "generation-duplicate");
  const generate = page.getByRole("button", { name: "生成密码", exact: true });
  await generate.click();
  await generate.click();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-pending", "1");
  await page.evaluate(() => document.dispatchEvent(
    new CustomEvent("bw-generator-lifecycle-release", { detail: "newest" }),
  ));
  await expect(page.locator("bit-color-password")).toHaveText("evidence-lifecycle-latest");
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-generator-pending", /.+/);
  const duplicateTracks = await evidenceCount(page, "bwEvidenceGeneratorHistoryTracks");
  await page.evaluate(() => document.dispatchEvent(
    new CustomEvent("bw-generator-lifecycle-release", { detail: "oldest" }),
  ));
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-generator-pending", /.+/);
  await expect(page.locator("bit-color-password")).toHaveText("evidence-lifecycle-latest");
  await expect(page.locator("html")).toHaveAttribute(
    "data-bw-evidence-generator-history-tracks",
    String(duplicateTracks),
  );

  await openGeneratorHistoryEvidence(page, "history-same-id-stale");
  await expect(page.locator("bit-credential-generator-history bit-item")).toHaveCount(2);
  const clear = page.getByRole("button", { name: "清除历史记录", exact: true });
  await clear.click();
  await page.getByRole("dialog").getByRole("button", { name: "清除历史记录", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-clear-pending", "true");
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-account", { detail: "same-id-session" }));
    document.dispatchEvent(new Event("bw-generator-lifecycle-clear-release"));
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-generator-clear-pending", /.+/);
  await expect(page.locator("bit-credential-generator-history bit-item")).toHaveCount(2);
  await page.evaluate(() => { globalThis.location.hash = "/tabs/vault"; });
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect(page.locator("bw-official-generator-history")).toHaveCount(0);
  await page.evaluate(() => { globalThis.location.hash = "/generator-history"; });
  await expect(page.locator("bw-official-generator-history")).toBeVisible();
  await expect(page.locator("bit-credential-generator-history bit-item")).toHaveCount(2);

  for (const [scenario, mutation] of [
    ["generation-account-switch", "account-switch"],
    ["generation-lock", "lock"],
    ["generation-same-id", "same-id-session"],
  ] as const) {
    await openEvidenceRoute(page, "/add-cipher?type=1", "login-workflow-form-add", scenario);
    const formUsername = page.getByRole("textbox", { name: "用户名", exact: true });
    await formUsername.fill("preserved@example.test");
    const tracks = await evidenceCount(page, "bwEvidenceGeneratorHistoryTracks");
    await page.getByTestId("generate-username-button").click();
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-pending", "1");
    await page.evaluate((detail) => {
      document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-account", { detail }));
      document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-release", { detail: "oldest" }));
    }, mutation);
    await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-generator-pending", /.+/);
    await expect(formUsername).toHaveValue("preserved@example.test");
    await expect.poll(() => evidenceCount(page, "bwEvidenceGeneratorHistoryTracks")).toBe(tracks);
  }

  await openEvidenceRoute(
    page,
    "/add-cipher?type=1",
    "login-workflow-form-add",
    "generation-route-teardown",
  );
  const routeUsername = page.getByRole("textbox", { name: "用户名", exact: true });
  await routeUsername.fill("preserved@example.test");
  const routeTracks = await evidenceCount(page, "bwEvidenceGeneratorHistoryTracks");
  await page.getByTestId("generate-username-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-pending", "1");
  await page.evaluate(() => { globalThis.location.hash = "/tabs/vault"; });
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect(page.locator("bw-official-login-cipher-form")).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(
    new CustomEvent("bw-generator-lifecycle-release", { detail: "oldest" }),
  ));
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-generator-pending", /.+/);
  await expect.poll(() => evidenceCount(page, "bwEvidenceGeneratorHistoryTracks")).toBe(routeTracks);

  await openEvidenceRoute(
    page,
    "/add-cipher?type=1",
    "login-workflow-form-add",
    "form-generation-failure",
  );
  const username = page.getByRole("textbox", { name: "用户名", exact: true });
  await username.fill("preserved@example.test");
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.getByTestId("generate-username-button").click();
  await expect(username).toHaveValue("preserved@example.test");
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-engine-attempts", "1");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await page.getByTestId("generate-username-button").click();
  await expect(username).toHaveValue("evidence-lifecycle-form-retry");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("publishes authorities only after all workflow assertions pass", ({}, testInfo) => {
  test.skip(!isAuthoritativeEvidenceWriter(testInfo), "Chromium update mode is the sole authority writer");
  evidenceIntegrity.assertExactPngEvidenceInventory([...pendingAuthorities.keys()], screenshotFiles);
  replaceEvidenceDirectoryTransactionally(evidenceDirectory, (stageDirectory) => {
    for (const fileName of screenshotFiles) {
      const image = pendingAuthorities.get(fileName);
      if (!image) throw new Error(`Missing staged M11 authority ${fileName}`);
      writeFileSync(join(stageDirectory, fileName), image);
    }
    validateAuthoritySet(stageDirectory);
    const stagedProvenance = buildProvenance(stageDirectory);
    writeFileSync(join(stageDirectory, "PROVENANCE.md"), stagedProvenance);
    validateProvenanceHashes(stagedProvenance, stageDirectory);
  }, (stageDirectory) => assertCleanEvidenceWriterTree({
    expectedRevision: evidenceWriterSourceRevision,
    ignoredTransactionStage: stageDirectory,
  }));
});

async function openGenerator(
  page: Page,
  generatorMode?: "username" | "plus-address" | "catchall",
): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-19T02:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const query = generatorMode ? `&generatorMode=${generatorMode}` : "";
  await page.goto(`/?vaultEvidence=populated${query}`);
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault/);
  await page.evaluate(() => { globalThis.location.hash = "/tabs/generator"; });
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/generator/);
  await expect(page.locator("bw-official-credential-generator")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function openEvidenceRoute(
  page: Page,
  route: string,
  state: string,
  generatorEvidence?: string,
): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-19T02:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const generatorQuery = generatorEvidence
    ? `&generatorEvidence=${encodeURIComponent(generatorEvidence)}`
    : "";
  await page.goto(`/?vaultEvidence=${encodeURIComponent(state)}${generatorQuery}`);
  await expect(page).toHaveURL(new RegExp(`vaultEvidence=${escapeRegExp(state)}`));
  await page.evaluate((nextRoute) => { globalThis.location.hash = nextRoute; }, route);
  await expect(page).toHaveURL(new RegExp(`#${escapeRegExp(route)}$`));
  await page.evaluate(() => document.fonts.ready);
}

async function openGeneratorLifecycle(
  page: Page,
  scenario: "generation-account-switch" | "generation-lock" | "generation-same-id" | "generation-route-teardown" | "generation-duplicate",
): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-19T02:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?vaultEvidence=populated&generatorEvidence=${scenario}`);
  await expect(page).toHaveURL(new RegExp(`generatorEvidence=${escapeRegExp(scenario)}.*#\\/tabs\\/vault`));
  await page.evaluate(() => { globalThis.location.hash = "/tabs/generator"; });
  await expect(page.locator("bw-official-credential-generator")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-generator-history-tracks", "1");
}

async function evidenceCount(page: Page, datasetKey: string): Promise<number> {
  return page.evaluate((key) => Number(document.documentElement.dataset[key] ?? "0"), datasetKey);
}

async function openGeneratorHistoryEvidence(
  page: Page,
  scenario: "history-loading" | "history-load-retry" | "history-copy-retry" | "history-clear-retry" | "history-same-id-stale",
): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-19T02:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?vaultEvidence=populated&generatorEvidence=${scenario}`);
  await expect(page).toHaveURL(new RegExp(`generatorEvidence=${escapeRegExp(scenario)}.*#\\/tabs\\/vault`));
  await page.evaluate(() => { globalThis.location.hash = "/generator-history"; });
  await expect(page).toHaveURL(new RegExp(`generatorEvidence=${escapeRegExp(scenario)}.*#\\/generator-history`));
  await expect(page.locator("bw-official-generator-history")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function updateGeneratorSetting(locator: ReturnType<Page["getByRole"]>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Tab");
  await expect(locator).toHaveValue(value);
}

async function assertGeometry(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(await page.evaluate(() => {
    const openDialog = [...document.querySelectorAll<HTMLElement>("dialog[open], [role=dialog]")]
      .find((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).visibility !== "hidden";
      });
    const interactionRegion = (element: HTMLElement): HTMLElement | null => {
      let ancestor = element.parentElement;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (
          ancestor.scrollHeight > ancestor.clientHeight
          && (style.overflowY === "auto" || style.overflowY === "scroll")
        ) {
          return ancestor;
        }
        ancestor = ancestor.parentElement;
      }
      return element.closest<HTMLElement>(
        "[role=dialog], dialog, main, header, footer, [role=banner], [role=contentinfo], popup-header, popup-footer",
      );
    };
    const renderedControls = [...document.querySelectorAll<HTMLElement>("button, input, a[href]")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0
          && getComputedStyle(element).visibility !== "hidden"
          && (!openDialog || openDialog.contains(element));
      });
    const isNormalOffscreenScrollContent = (element: HTMLElement): boolean => {
      const bounds = element.getBoundingClientRect();
      const region = interactionRegion(element);
      if (!region) return false;
      const style = getComputedStyle(region);
      if (
        region.scrollHeight <= region.clientHeight
        || (style.overflowY !== "auto" && style.overflowY !== "scroll")
      ) return false;
      const regionBounds = region.getBoundingClientRect();
      return bounds.bottom <= regionBounds.top + 0.5
        || bounds.top >= regionBounds.bottom - 0.5;
    };
    const isClipped = (element: HTMLElement): boolean => {
      const bounds = element.getBoundingClientRect();
      const region = interactionRegion(element);
      const regionBounds = region?.getBoundingClientRect();
      const intersectsViewportVertically = bounds.bottom > 0.5 && bounds.top < innerHeight - 0.5;
      const intersectsRegionVertically = !regionBounds
        || (bounds.bottom > regionBounds.top + 0.5 && bounds.top < regionBounds.bottom - 0.5);
      return bounds.left < -0.5 || bounds.right > innerWidth + 0.5
        || (intersectsViewportVertically && (bounds.top < -0.5 || bounds.bottom > innerHeight + 0.5))
        || Boolean(regionBounds && (
          bounds.left < regionBounds.left - 0.5
          || bounds.right > regionBounds.right + 0.5
          || (intersectsRegionVertically && (
            bounds.top < regionBounds.top - 0.5
            || bounds.bottom > regionBounds.bottom + 0.5
          ))
        ));
    };
    const intersectsVisibleRegion = (element: HTMLElement): boolean => {
      const bounds = element.getBoundingClientRect();
      const regionBounds = interactionRegion(element)?.getBoundingClientRect();
      return bounds.right > 0 && bounds.left < innerWidth
        && bounds.bottom > 0 && bounds.top < innerHeight
        && (!regionBounds || (
          bounds.right > regionBounds.left
          && bounds.left < regionBounds.right
          && bounds.bottom > regionBounds.top
          && bounds.top < regionBounds.bottom
        ));
    };
    const controls = renderedControls.filter((element) => (
      !isNormalOffscreenScrollContent(element)
      && !isClipped(element)
      && intersectsVisibleRegion(element)
    ));
    const describe = (control: HTMLElement) => `${control.tagName.toLowerCase()}#${control.id}`;
    const clippedControls = renderedControls.filter((element) => (
      !isNormalOffscreenScrollContent(element) && isClipped(element)
    )).map((control) => {
      const bounds = control.getBoundingClientRect();
      const region = interactionRegion(control);
      const regionBounds = region?.getBoundingClientRect();
      return `${describe(control)} region=${region ? describe(region) : "none"} bounds=${bounds.left},${bounds.top},${bounds.right},${bounds.bottom} regionBounds=${regionBounds ? `${regionBounds.left},${regionBounds.top},${regionBounds.right},${regionBounds.bottom}` : "none"}`;
    });
    const clippedSurfaces = [...document.querySelectorAll<HTMLElement>("popup-header, popup-footer, bit-toggle-group, bit-color-password, dialog, [role=dialog]")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < -0.5 || bounds.right > innerWidth + 0.5 || bounds.top < -0.5 || bounds.bottom > innerHeight + 0.5);
      })
      .map(describe);
    return {
      width: innerWidth,
      height: innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: [...clippedControls, ...clippedSurfaces],
      overlappingControls: controls.flatMap((element, index) => controls.slice(index + 1).flatMap((candidate) => {
        if (element.contains(candidate) || candidate.contains(element)) return [];
        if (element.closest("bit-form-field") === candidate.closest("bit-form-field")) return [];
        if (interactionRegion(element) !== interactionRegion(candidate)) return [];
        const a = element.getBoundingClientRect();
        const b = candidate.getBoundingClientRect();
        const overlaps = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4;
        if (!overlaps) return [];
        return [`${describe(element)} <> ${describe(candidate)}`];
      })),
    };
  })).toEqual({ width: 480, height: 600, horizontalOverflow: 0, clipped: [], overlappingControls: [] });
}

async function capture(page: Page, testInfo: TestInfo, fileName: typeof screenshotFiles[number]): Promise<void> {
  await settleCaptureScrollOwnerAtTop(page);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    globalThis.scrollTo(0, 0);
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await assertOfficialGeneratorHeader(page, fileName);
  await assertGeometry(page);
  await page.screenshot({ animations: "disabled" });
  const screenshot = await page.screenshot({
    path: testInfo.outputPath(fileName),
    animations: "disabled",
  });
  const decoded = await page.evaluate(async (source) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(source), (character) => character.charCodeAt(0))], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    let opaquePixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 255) opaquePixels += 1;
      if (colors.size <= 256) colors.add(((pixels[offset] << 24) | (pixels[offset + 1] << 16) | (pixels[offset + 2] << 8) | pixels[offset + 3]) >>> 0);
    }
    bitmap.close();
    return { width: canvas.width, height: canvas.height, opaquePixels, uniqueColors: colors.size };
  }, screenshot.toString("base64"));
  expect(decoded).toEqual({ width: 480, height: 600, opaquePixels: 480 * 600, uniqueColors: expect.any(Number) });
  expect(decoded.uniqueColors).toBeGreaterThan(16);
  evidenceIntegrity.assertPngTextMetadataDoesNotContain(screenshot, forbiddenValues);
  if (isAuthoritativeEvidenceWriter(testInfo)) pendingAuthorities.set(fileName, screenshot);
  if (testInfo.project.name === "chromium" && !isAuthoritativeEvidenceWriter(testInfo) && existsSync(join(evidenceDirectory, fileName))) {
    const authority = readFileSync(join(evidenceDirectory, fileName));
    const comparison = await evidenceIntegrity.compareEvidenceScreenshotPixels(page, authority, screenshot);
    expect(comparison.differentPixels, `${fileName} anti-alias edge pixel count`).toBeLessThanOrEqual(256);
    expect(comparison.maxChannelDelta ?? 0, `${fileName} anti-alias drift channel delta`).toBeLessThanOrEqual(8);
    expect(comparison.nonEdgeDifferentPixels ?? 0, `${fileName} non-edge pixel drift`).toBe(0);
  }
}

async function assertOfficialGeneratorHeader(
  page: Page,
  fileName: typeof screenshotFiles[number],
): Promise<void> {
  const generator = page.locator("bw-official-credential-generator");
  if (await generator.count() > 0) {
    const header = generator.locator("popup-header");
    await expect(header, `${fileName} Generator title`).toContainText("生成器");
    await assertFullyPaintedHeaderElement(header.locator("h1"), header, `${fileName} Generator title`);
    await assertFullyPaintedHeaderElement(
      header.locator("app-pop-out button"),
      header,
      `${fileName} pop-out action`,
    );
    await assertFullyPaintedHeaderElement(
      header.locator("app-current-account button"),
      header,
      `${fileName} account action`,
    );
    return;
  }
  const history = page.locator("bw-official-generator-history popup-header");
  await expect(history, `${fileName} history title`).toContainText("生成器历史");
  await assertFullyPaintedHeaderElement(
    history.getByRole("button", { name: "返回", exact: true }),
    history,
    `${fileName} history back action`,
  );
  await assertFullyPaintedHeaderElement(history.locator("h1"), history, `${fileName} history title`);
  await assertFullyPaintedHeaderElement(
    history.locator("app-pop-out button"),
    history,
    `${fileName} history pop-out action`,
  );
}

async function settleCaptureScrollOwnerAtTop(page: Page): Promise<void> {
  const generator = page.locator("bw-official-credential-generator");
  const root = await generator.count() > 0
    ? generator
    : page.locator("bw-official-generator-history");
  const scrollRegion = root.getByTestId("popup-layout-scroll-region");
  await expect(scrollRegion).toBeVisible();
  const settledTop = await scrollRegion.evaluate((element) => {
    element.scrollTop = 0;
    element.scrollLeft = 0;
    const regionBounds = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>("button, input, a[href]")]
      .map((control) => {
        const bounds = control.getBoundingClientRect();
        return {
          bottom: bounds.bottom - regionBounds.top,
          height: bounds.height,
          visible: bounds.width > 0
            && bounds.height > 0
            && getComputedStyle(control).visibility !== "hidden",
        };
      })
      .filter((control) => control.visible);
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    for (let candidate = 0; candidate <= maxScrollTop; candidate += 1) {
      const clipsControl = controls.some((control) => {
        const top = control.bottom - control.height - candidate;
        const bottom = control.bottom - candidate;
        const intersects = bottom > 0.5 && top < element.clientHeight - 0.5;
        const fullyInside = top >= -0.5 && bottom <= element.clientHeight + 0.5;
        return intersects && !fullyInside;
      });
      if (!clipsControl) {
        element.scrollTop = candidate;
        return element.scrollTop;
      }
    }
    return element.scrollTop;
  });
  await expect.poll(() => scrollRegion.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }))).toEqual({ left: 0, top: settledTop });
}

async function assertFullyPaintedHeaderElement(
  element: ReturnType<Page["locator"]>,
  header: ReturnType<Page["locator"]>,
  description: string,
): Promise<void> {
  await expect(element, description).toBeVisible();
  const headerHandle = await header.elementHandle();
  if (!headerHandle) throw new Error(`${description} header is unavailable`);
  const painted = await element.evaluate((node, headerNode) => {
    const bounds = node.getBoundingClientRect();
    const headerBounds = (headerNode as HTMLElement).getBoundingClientRect();
    return {
      hasArea: bounds.width > 0 && bounds.height > 0,
      hasVisibleOpacity: (() => {
        let ancestor: HTMLElement | null = node as HTMLElement;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0) {
            return false;
          }
          ancestor = ancestor.parentElement;
        }
        return true;
      })(),
      insideHeader: bounds.left >= headerBounds.left - 0.5
        && bounds.right <= headerBounds.right + 0.5
        && bounds.top >= headerBounds.top - 0.5
        && bounds.bottom <= headerBounds.bottom + 0.5,
      insideViewport: bounds.left >= -0.5
        && bounds.right <= innerWidth + 0.5
        && bounds.top >= -0.5
        && bounds.bottom <= innerHeight + 0.5,
      notOccluded: (() => {
        if (document.querySelector("dialog[open], [role=dialog]")) return true;
        const topmost = document.elementsFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        )[0];
        return topmost === node || node.contains(topmost);
      })(),
    };
  }, headerHandle);
  expect(painted, description).toEqual({
    hasArea: true,
    hasVisibleOpacity: true,
    insideHeader: true,
    insideViewport: true,
    notOccluded: true,
  });
}

function validateAuthoritySet(directory: string): void {
  evidenceIntegrity.assertExactPngEvidenceInventory(
    readdirSync(directory).filter((fileName) => fileName.endsWith(".png")),
    screenshotFiles,
  );
  for (const fileName of screenshotFiles) {
    const image = readFileSync(join(directory, fileName));
    evidenceIntegrity.assertPngTextMetadataDoesNotContain(image, forbiddenValues);
  }
}

function validateRecordedSourceRevision(provenance: string): void {
  const revision = provenance.match(/^- Source revision: ([0-9a-f]{40})$/m)?.[1];
  expect(revision, "M11 provenance must record a full source revision").toBeDefined();
  execFileSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: process.cwd() });
  execFileSync("git", [
    "diff",
    "--quiet",
    `${revision}..HEAD`,
    "--",
    "apps/menubar-tauri",
    "scripts",
    "package.json",
    "playwright.config.ts",
    "vendor/bitwarden-clients",
  ], { cwd: process.cwd() });
}

function validateProvenanceHashes(provenance: string, directory: string): void {
  const vendorRevision = readPinnedVendorRevision();
  const vendorAttestations = provenance.match(/^- Vendor revision: .+$/gm) ?? [];
  expect(vendorAttestations, "M11 provenance must have exactly one vendor revision attestation")
    .toEqual([`- Vendor revision: ${vendorRevision} (pinned and unchanged)`]);

  const lines = provenance.split(/\r?\n/);
  const headerIndex = lines.indexOf("| Authority | SHA-256 |");
  expect(headerIndex, "M11 provenance authority hash table is required").toBeGreaterThanOrEqual(0);
  expect(lines[headerIndex + 1], "M11 provenance authority hash table separator is required")
    .toBe("| --- | --- |");
  const tableRows = lines.slice(headerIndex + 2).filter((line) => line.startsWith("|"));
  expect(tableRows, "M11 provenance authority rows must be one-to-one")
    .toHaveLength(screenshotFiles.length);
  const rows = tableRows.map((row) => {
    const parsed = row.match(/^\| ([^|]+) \| ([0-9a-f]{64}) \|$/);
    expect(parsed, `M11 provenance authority row is malformed: ${row}`).not.toBeNull();
    return { fileName: parsed![1], hash: parsed![2] };
  });
  expect(rows.map((row) => row.fileName).sort(), "M11 provenance authorities must be exact")
    .toEqual([...screenshotFiles].sort());
  for (const fileName of screenshotFiles) {
    const hash = createHash("sha256").update(readFileSync(join(directory, fileName))).digest("hex");
    expect(rows.find((row) => row.fileName === fileName)?.hash, `${fileName} provenance hash`)
      .toBe(hash);
  }
}

function readPinnedVendorRevision(): string {
  const uiSourceCommit = readFileSync(
    join(process.cwd(), "vendor/bitwarden-clients/UI_SOURCE_COMMIT"),
    "utf8",
  ).trim();
  const sourceRevision = readFileSync(
    join(process.cwd(), "vendor/bitwarden-clients/.source-revision"),
    "utf8",
  ).trimEnd().split(/\r?\n/);
  expect(uiSourceCommit, "UI_SOURCE_COMMIT must contain the pinned vendor revision")
    .toBe(pinnedVendorRevision);
  expect(sourceRevision, ".source-revision must uniquely attest the pinned vendor revision")
    .toEqual([
      "https://github.com/bitwarden/clients.git",
      pinnedVendorRevision,
    ]);
  return pinnedVendorRevision;
}

function buildProvenance(directory: string): string {
  const rows = screenshotFiles.map((fileName) => {
    const image = readFileSync(join(directory, fileName));
    return `| ${fileName} | ${createHash("sha256").update(image).digest("hex")} |`;
  });
  return `# M11 Generator Evidence Provenance\n\n- Source revision: ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim()}\n- Vendor revision: ${readPinnedVendorRevision()} (pinned and unchanged)\n- Browser: Chromium; viewport: 480x600; DPR: 1.\n- Chromium is the sole authoritative screenshot writer.\n- WebKit is assertion-only.\n- Evidence command: UPDATE_EVIDENCE=true VITE_BW_VAULT_EVIDENCE=true npx playwright test apps/menubar-tauri/e2e/official-generator-workflows.spec.ts --project=chromium --workers=1 --reporter=line.\n- Update mode stages all nine authorities and atomically replaces the canonical directory.\n- Synthetic-only policy: visible evidence uses reserved example.test data. Generated values are never recorded in provenance, filenames, reports, receipts, metadata, or machine output.\n- PNG text metadata is scanned for controlled synthetic generated values; masked regions: none.\n- Read-only Chromium comparison allows at most 256 low-bit anti-alias edge pixels with a maximum eight-level RGBA channel delta; non-edge pixels remain exact.\n\n| Authority | SHA-256 |\n| --- | --- |\n${rows.join("\n")}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
