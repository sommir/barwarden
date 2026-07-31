import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { compareEvidenceScreenshotPixels } from "./evidence-integrity";
import * as evidenceIntegrity from "./evidence-integrity";
import { evidenceCapturePath, isAuthoritativeEvidenceWriter } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m9-official-personal-ciphers-2026-07-17",
);
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");
const providerPath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/evidence/personal-cipher-workflow-evidence.ts",
);
const integrityPath = join(process.cwd(), "apps/menubar-tauri/e2e/evidence-integrity.ts");

const states = [
  "card-detail",
  "card-detail-reprompt",
  "card-form-add",
  "card-form-edit",
  "card-form-clone",
  "identity-detail",
  "identity-detail-reprompt",
  "identity-form-add",
  "identity-form-edit",
  "identity-form-clone",
  "note-detail",
  "note-form-add",
  "note-form-edit",
  "note-form-clone",
  "personal-form-validation",
  "personal-form-failure",
  "personal-form-duplicate",
  "personal-form-stale",
] as const;

type PersonalCipherState = (typeof states)[number];
type PersonalCipherType = "card" | "identity" | "note";
type PersonalCipherMode = "add" | "edit" | "clone";

const screenshotFiles = states.map((state) => `${state}-480x600.png`);
const approvedReceipts = new Set([
  "copy_card_number",
  "copy_secure_note_notes",
  "paste_identity_email",
  "create_card",
  "update_card",
  "create_identity",
  "update_identity",
  "create_secure_note",
  "update_secure_note",
]);
const forbiddenMetadataValues = [
  "4242424242424242",
  "4111111111111111",
  "C123EXAMPLE",
  "000-00-0000",
  "P-EXAMPLE-123",
  "L-EXAMPLE-456",
  "P1234567",
  "L7654321",
  "identity@example.test",
  "identity.example.test",
  "Synthetic example.test Card notes",
  "+1 555 0100",
  "1 Example Way",
  "Synthetic example.test Identity notes",
  "ada-example.test",
  "card-hidden-example",
  "identity-hidden-example",
  "note-hidden-example",
  "123",
  "Synthetic example.test secure note body",
  "Synthetic recovery instructions",
  "m9-stale-returned-sentinel",
] as const;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("requires the M9 provider and provenance contract before runtime capture", () => {
  expect(existsSync(providerPath), "M9 evidence provider must exist").toBe(true);
  expect(existsSync(provenancePath), "M9 provenance must exist").toBe(true);
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const integritySource = readFileSync(integrityPath, "utf8");
  const overflowSource = source.slice(
    source.lastIndexOf("async function assertNoTextOverflow"),
    source.lastIndexOf("async function prepareStateForCapture"),
  );
  for (const marker of ["waitFor" + "Timeout", "set" + "Timeout", "mask" + ":"]) {
    expect(source).not.toContain(marker);
  }
  expect(integritySource).toContain("authority.equals(fresh)");
  expect(source).toContain("toBeLessThanOrEqual(8)");
  expect(source).not.toMatch(/screenshot\.toString\(\s*["']latin1["']\s*\)/);
  expect(overflowSource).toContain("document.createTreeWalker(document.body");
  expect(overflowSource).not.toContain("querySelectorAll");
  expect(source).toContain("assertExactPngEvidenceInventory");
  expect(source).toContain("readdirSync");
});

for (const state of states) {
  test(`proves sanitized ${state} official personal cipher state`, async ({ page }, testInfo) => {
    await openState(page, state);
    await assertPopupGeometry(page);
    await assertAccessibility(page);
    await assertNoExcludedSurface(page);
    await assertOfficialAncestry(page, state);
    await assertM9DetailFixture(page, state);
    await assertSecretFreeMetadata(page);

    await prepareStateForCapture(page, state);
    await settleVisualState(page, state);

    await assertPopupGeometry(page);
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
    assertSecretFreeScreenshotMetadata(screenshot);
  });
}

test("uses real pointer actions and records only type-aware action names", async ({ page }) => {
  await openState(page, "card-detail");
  await pointerClick(page, page.getByTestId("copy-number"));
  await expectReceipt(page, "copy_card_number");

  await openState(page, "identity-detail");
  await pointerClick(page, page.getByTestId("fill-email"));
  await expectReceipt(page, "paste_identity_email");

  await openState(page, "note-detail");
  await pointerClick(page, page.locator("bit-form-field").filter({ has: page.locator("#notes") }).getByRole("button"));
  await expectReceipt(page, "copy_secure_note_notes");
});

test("uses keyboard reveal and proves protected Card and Identity reprompt", async ({ page }) => {
  await openState(page, "card-detail");
  const reveal = page.getByTestId("toggle-number");
  await reveal.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cardholder-number")).toHaveAttribute("type", "text");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cardholder-number")).toHaveAttribute("type", "password");

  for (const [state, button] of [
    ["card-detail-reprompt", "toggle-number"],
    ["identity-detail-reprompt", "ssn-toggle"],
  ] as const) {
    await openState(page, state);
    await pointerClick(page, page.getByTestId(button));
    await expect(page.getByRole("heading", { name: "确认主密码", exact: true })).toBeVisible();
    await assertSecretFreeMetadata(page);
  }
});

test("commits exact server results for every personal add, edit, and clone", async ({ page }) => {
  for (const type of ["card", "identity", "note"] as const) {
    for (const mode of ["add", "edit", "clone"] as const) {
      const state = `${type}-form-${mode}` as PersonalCipherState;
      const submittedName = `Submitted ${type} ${mode} example.test`;
      const expectedName = mode === "edit"
        ? serverEditName(type)
        : submittedName;
      const expectedId = mode === "edit" ? existingId(type) : createdId(type);
      const receipt = `${mode === "edit" ? "update" : "create"}_${receiptType(type)}`;

      await openState(page, state);
      await formName(page).fill(submittedName);
      await pointerClick(page, saveButton(page));

      await expect(page).toHaveURL(new RegExp(`#\\/view-cipher\\/${expectedId}$`));
      await expect(page.getByTestId("item-name")).toHaveText(expectedName);
      if (mode === "edit") {
        await assertServerEditState(page, type);
        await expect(page.getByTestId("item-name")).not.toHaveText(submittedName);
      }
      await expectReceipt(page, receipt);
    }
  }
});

test("uses a real cancel command without committing a personal write", async ({ page }) => {
  await openState(page, "identity-form-add");
  await pointerClick(page, page.getByRole("button", { name: "取消", exact: true }));
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-last-host-action", /.+/);
});

test("proves validation, failure, duplicate, and stale ownership outcomes", async ({ page }) => {
  await openState(page, "personal-form-validation");
  await formName(page).fill("");
  await pointerClick(page, saveButton(page));
  await expect(page.locator("bit-error")).toBeVisible();
  await expectNoReceipt(page);

  await openState(page, "personal-form-failure");
  const retainedFailureName = "Retained synthetic failure draft";
  await formName(page).fill(retainedFailureName);
  await pointerClick(page, saveButton(page));
  await expect(saveButton(page)).toBeEnabled();
  await expect(formName(page)).toHaveValue(retainedFailureName);
  await expectNoReceipt(page);

  await openState(page, "personal-form-duplicate");
  await formName(page).fill("Duplicate synthetic card");
  const save = saveButton(page);
  await pointerClick(page, save);
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-pending", "true");
  await save.dispatchEvent("click");
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-call-count", "1");
  await page.evaluate(() => document.dispatchEvent(new Event("bw-evidence-release-personal-write")));
  await expect(page).toHaveURL(/#\/view-cipher\/m9-created-card$/);
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-host-action-count", "1");
  await expectReceipt(page, "create_card");

  await openState(page, "personal-form-stale");
  const staleSentinel = "m9-stale-returned-sentinel";
  await formName(page).fill(staleSentinel);
  await pointerClick(page, saveButton(page));
  await expectReceipt(page, "update_card");
  await expect(page).toHaveURL(/#\/edit-cipher\?cipherId=billing&type=3$/);
  await expect(formName(page)).toHaveValue(staleSentinel);
  await expect(saveButton(page)).toBeEnabled();

  for (const route of ["/tabs/vault", "/archive", "/trash"]) {
    await page.evaluate((nextRoute) => {
      window.location.hash = nextRoute;
    }, route);
    await expect(page).toHaveURL(new RegExp(`#${route.replaceAll("/", "\\/")}$`));
    await expect(page.locator("body")).not.toContainText(staleSentinel);
  }
});

test("keeps stable keyboard order in retained detail and form stacks", async ({ page }) => {
  await openState(page, "card-detail");
  const back = page.getByRole("button", { name: "返回", exact: true });
  await back.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "弹出到新窗口", exact: true })).toBeFocused();

  await openState(page, "card-form-add");
  await formName(page).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "文件夹", exact: true })).toBeFocused();
});

test("short-circuits byte-identical screenshot comparison before decode", async () => {
  let decoded = false;
  const page = {
    evaluate: async () => {
      decoded = true;
      return { width: 480, height: 600, differentPixels: 20 };
    },
  } as unknown as Page;
  const identical = Buffer.from("byte-identical-personal-evidence");

  await expect(compareEvidenceScreenshotPixels(page, identical, identical)).resolves.toEqual({
    differentPixels: 0,
  });
  expect(decoded).toBe(false);
});

test("rejects compressed PNG text metadata without scanning image pixels", () => {
  const assertMetadata = (evidenceIntegrity as Record<string, unknown>)[
    "assertPngTextMetadataDoesNotContain"
  ] as ((png: Uint8Array, forbidden: readonly string[]) => void) | undefined;
  expect(typeof assertMetadata).toBe("function");
  expect(() => assertMetadata!(pngWithCompressedText("Fixture", "note-hidden-example"), [
    "note-hidden-example",
  ])).toThrow("PNG text metadata contains a forbidden value");
});

test("records one complete reproducible Chromium provenance table", ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium is the sole authoritative writer");
  if (process.env.UPDATE_EVIDENCE === "true") {
    writeFileSync(provenancePath, replaceProvenanceHashTable(readFileSync(provenancePath, "utf8")));
  }
  const provenance = readFileSync(provenancePath, "utf8").toLowerCase();
  for (const required of [
    "f47b6946e01aed474875789081966d311d5b8289",
    "chromium is the sole authoritative screenshot writer",
    "webkit is assertion-only",
    "chrome official baseline does not exist",
    "masked regions: none",
    "example.test",
    "update_evidence=true npx playwright test apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts --project=chromium --workers=1",
  ]) {
    expect(provenance).toContain(required);
  }
  for (const fileName of screenshotFiles) {
    const path = join(evidenceDirectory, fileName);
    expect(existsSync(path), `${fileName} authority must exist`).toBe(true);
    const buffer = readFileSync(path);
    const hash = createHash("sha256").update(buffer).digest("hex");
    expect(provenance).toContain(`| ${fileName} | 480x600 | ${hash} |`);
  }
  const assertInventory = (evidenceIntegrity as Record<string, unknown>)[
    "assertExactPngEvidenceInventory"
  ] as ((actual: readonly string[], expected: readonly string[]) => void) | undefined;
  expect(typeof assertInventory).toBe("function");
  assertInventory!(
    readdirSync(evidenceDirectory).filter((fileName) => fileName.endsWith(".png")),
    screenshotFiles,
  );
});

async function openState(page: Page, state: PersonalCipherState): Promise<void> {
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
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("heading", { name: headingFor(state), exact: true }).first()).toBeVisible();
}

function headingFor(state: PersonalCipherState): string {
  if (state === "card-detail" || state === "card-detail-reprompt") return "查看支付卡";
  if (state === "identity-detail" || state === "identity-detail-reprompt") return "查看身份";
  if (state === "note-detail") return "查看笔记";
  if (state.startsWith("personal-form-")) return state === "personal-form-stale" ? "编辑支付卡" : "新增支付卡";
  const [type, , mode] = state.split("-") as [PersonalCipherType, "form", PersonalCipherMode];
  const action = mode === "edit" ? "编辑" : mode === "clone" ? "克隆" : "新增";
  return `${action}${type === "card" ? "支付卡" : type === "identity" ? "身份" : "笔记"}`;
}

async function assertOfficialAncestry(page: Page, state: PersonalCipherState): Promise<void> {
  const type = stateType(state);
  if (state.includes("detail")) {
    await expect(page.locator(
      "barwarden-root > .popup-window-size-source > bw-vault-item-detail-page > popup-page bw-official-personal-cipher-detail",
    )).toHaveCount(1);
    await expect(page.locator("bw-official-personal-cipher-detail official-item-details")).toHaveCount(1);
    await expect(page.locator("bw-official-personal-cipher-detail app-item-history-v2")).toHaveCount(1);
    if (type === "card") {
      await expect(page.locator("bw-official-personal-cipher-detail official-card-details")).toHaveCount(1);
    } else if (type === "identity") {
      await expect(page.locator("bw-official-personal-cipher-detail official-identity-sections")).toHaveCount(1);
    } else {
      await expect(page.locator(
        "bw-official-personal-cipher-detail official-card-details, bw-official-personal-cipher-detail official-identity-sections",
      )).toHaveCount(0);
    }
    return;
  }

  await expect(page.locator(
    "barwarden-root > .popup-window-size-source > bw-vault-add-edit-page > popup-page bw-official-personal-cipher-form",
  )).toHaveCount(1);
  await expect(page.locator("bw-official-personal-cipher-form vault-item-details-section")).toHaveCount(1);
  await expect(page.locator("bw-official-personal-cipher-form vault-additional-options-section")).toHaveCount(1);
  await expect(page.locator("bw-official-personal-cipher-form vault-custom-fields")).toHaveCount(1);
  await expect(page.locator("bw-official-personal-cipher-form vault-card-details-section"))
    .toHaveCount(type === "card" ? 1 : 0);
  await expect(page.locator("bw-official-personal-cipher-form vault-identity-section"))
    .toHaveCount(type === "identity" ? 1 : 0);
}

async function assertM9DetailFixture(page: Page, state: PersonalCipherState): Promise<void> {
  if (!state.includes("detail")) return;
  const type = stateType(state);
  const expected = type === "card"
    ? {
        name: "Example Card",
        hiddenField: "Synthetic hidden",
        linkedField: "链接型: Linked number",
        linkedValue: "号码",
      }
    : type === "identity"
      ? {
          name: "Example Identity",
          hiddenField: "Synthetic hidden",
          linkedField: "链接型: Linked email",
          linkedValue: "电子邮箱",
        }
      : {
          name: "Example Secure Note",
          hiddenField: "Synthetic hidden",
          linkedField: undefined,
          linkedValue: undefined,
        };

  await expect(page.getByTestId("item-name")).toHaveText(expected.name);
  await expect(page.getByRole("textbox", { name: expected.hiddenField, exact: true }))
    .toHaveAttribute("type", "password");
  if (expected.linkedField && expected.linkedValue) {
    await expect(page.getByRole("textbox", { name: expected.linkedField, exact: true }))
      .toHaveValue(expected.linkedValue);
  }
  await expect(page.locator("body")).not.toContainText(/Ada|Lovelace|Travel User/);
}

function stateType(state: PersonalCipherState): PersonalCipherType {
  if (state.startsWith("identity")) return "identity";
  if (state.startsWith("note")) return "note";
  return "card";
}

async function assertNoExcludedSurface(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(
    /附件|保存并填充|通行密钥|SSH 密钥|自动填充到页面|分配集合|组织所有者|银行账户|驾驶证项目|护照项目/,
  );
  await expect(page.locator(
    '[data-testid*="attachment"], [data-testid*="passkey"], [data-testid*="save-and-fill"], vault-login-details-section, vault-autofill-options, vault-sshkey-section',
  )).toHaveCount(0);
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
    if (!root || !scrollHost || !header || !footer) throw new Error("Incomplete fixed popup layout");
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
      footer: box(footer),
    };
  });
  expect(layout.horizontalOverflow).toBe(0);
  expect(layout.scrollOwners).toEqual(["popup-layout-scroll-region"]);
  expect(layout.header).toMatchObject({ x: 0, y: 0, width: 480 });
  expect(layout.footer.x).toBe(0);
  expect(layout.footer.width).toBe(480);
  expect(layout.footer.bottom).toBe(600);

  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const stable = await page.locator("popup-page > popup-header, popup-page > popup-footer")
    .evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    }));
  expect(stable).toEqual([layout.header, layout.footer]);
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
    const escapedText: Array<{
      tag: string;
      text: string;
      container: { left: number; right: number; top: number; bottom: number };
      bounds: { left: number; right: number; top: number; bottom: number };
    }> = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent?.trim() ?? "";
      const parent = node.parentElement;
      if (text && parent && !parent.closest(".tw-truncate")) {
        const style = getComputedStyle(parent);
        const container = parent.getBoundingClientRect();
        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          parent.getClientRects().length > 0 &&
          container.width > 1 &&
          container.height > 1
        ) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const bounds of range.getClientRects()) {
            if (
              bounds.left < container.left - 1 ||
              bounds.right > container.right + 1 ||
              bounds.top < container.top - 3 ||
              bounds.bottom > container.bottom + 3
            ) {
              escapedText.push({
                tag: parent.tagName.toLowerCase(),
                text: text.slice(0, 120),
                container: {
                  left: container.left,
                  right: container.right,
                  top: container.top,
                  bottom: container.bottom,
                },
                bounds: {
                  left: bounds.left,
                  right: bounds.right,
                  top: bounds.top,
                  bottom: bounds.bottom,
                },
              });
            }
          }
        }
      }
      node = walker.nextNode();
    }
    return escapedText;
  });
  expect(overflow).toEqual([]);
}

async function prepareStateForCapture(page: Page, state: PersonalCipherState): Promise<void> {
  if (state === "card-detail-reprompt") {
    await pointerClick(page, page.getByTestId("toggle-number"));
    await expect(page.getByRole("heading", { name: "确认主密码", exact: true })).toBeVisible();
  } else if (state === "identity-detail-reprompt") {
    await pointerClick(page, page.getByTestId("ssn-toggle"));
    await expect(page.getByRole("heading", { name: "确认主密码", exact: true })).toBeVisible();
  } else if (state === "personal-form-validation") {
    await formName(page).fill("");
    await pointerClick(page, saveButton(page));
    await expect(page.locator("bit-error")).toBeVisible();
  } else if (state === "personal-form-failure") {
    await formName(page).fill("Synthetic failed Card");
    await pointerClick(page, saveButton(page));
    await expect(saveButton(page)).toBeEnabled();
  } else if (state === "personal-form-duplicate") {
    await formName(page).fill("Synthetic duplicate Card");
    const save = saveButton(page);
    await pointerClick(page, save);
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-pending", "true");
    await save.dispatchEvent("click");
    await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-transport-call-count", "1");
    await page.evaluate(() => document.dispatchEvent(new Event("bw-evidence-release-personal-write")));
    await expect(page).toHaveURL(/#\/view-cipher\/m9-created-card$/);
  } else if (state === "personal-form-stale") {
    await formName(page).fill("m9-stale-returned-sentinel");
    await pointerClick(page, saveButton(page));
    await expect(saveButton(page)).toBeEnabled();
  }
}

async function settleVisualState(page: Page, state: PersonalCipherState): Promise<void> {
  if (state === "card-detail-reprompt" || state === "identity-detail-reprompt") {
    await settleRepromptDialog(page);
    return;
  }
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    const runningFiniteAnimations = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return animation.playState === "running" && Number.isFinite(timing?.endTime);
    });
    if (runningFiniteAnimations.length > 0) {
      throw new Error("Finite UI animations remain before evidence capture");
    }
  });
}

async function settleRepromptDialog(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const deadline = performance.now() + 5_000;
    let stableFrames = 0;
    let previousSignature = "";
    while (performance.now() < deadline) {
      await frame();
      const form = document.querySelector<HTMLElement>("bw-vault-reprompt-dialog form[bit-dialog]");
      const section = form?.querySelector<HTMLElement>(":scope > section");
      const footer = section?.querySelector<HTMLElement>(":scope > footer");
      const divider = footer?.previousElementSibling as HTMLElement | null;
      const content = section?.querySelector<HTMLElement>('div[tabindex="0"]');
      if (!form || !section || !footer || !divider || !content) continue;
      const scrollable = content.scrollHeight > content.clientHeight;
      const observerSettled = scrollable
        ? divider.classList.contains("tw-border-secondary-100")
        : divider.classList.contains("tw-border-transparent");
      const finiteAnimations = document.getAnimations().filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return animation.playState === "running" && Number.isFinite(timing?.endTime);
      });
      const signature = JSON.stringify({
        clientHeight: content.clientHeight,
        scrollHeight: content.scrollHeight,
        dividerClass: divider.className,
        dividerColor: getComputedStyle(divider).borderTopColor,
        dividerRect: divider.getBoundingClientRect().toJSON(),
      });
      if (observerSettled && finiteAnimations.length === 0) {
        stableFrames = signature === previousSignature ? stableFrames + 1 : 1;
        if (stableFrames >= 2) return;
      } else {
        stableFrames = 0;
      }
      previousSignature = signature;
    }
    throw new Error("Reprompt dialog did not settle before evidence capture");
  });
}

async function assertSecretFreeMetadata(page: Page): Promise<void> {
  const diagnostics = await page.evaluate(() => ({
    url: location.href,
    historyState: history.state,
    localStorage: { ...localStorage },
    receipt: document.documentElement.dataset.bwEvidenceLastHostAction,
    receiptCount: document.documentElement.dataset.bwEvidenceHostActionCount,
  }));
  const serialized = JSON.stringify(diagnostics);
  for (const value of forbiddenMetadataValues) {
    expect(serialized).not.toContain(value);
  }
  if (diagnostics.receipt) {
    expect(approvedReceipts.has(diagnostics.receipt), diagnostics.receipt).toBe(true);
  }
}

function assertSecretFreeScreenshotMetadata(screenshot: Buffer): void {
  evidenceIntegrity.assertPngTextMetadataDoesNotContain(screenshot, forbiddenMetadataValues);
}

async function expectReceipt(page: Page, receipt: string): Promise<void> {
  expect(approvedReceipts.has(receipt), receipt).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-last-host-action", receipt);
  await assertSecretFreeMetadata(page);
}

async function expectNoReceipt(page: Page): Promise<void> {
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-last-host-action", /.+/);
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-host-action-count", /.+/);
}

function formName(page: Page): Locator {
  return page.getByRole("textbox", { name: "项目名称 * (必填)", exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "保存", exact: true });
}

function existingId(type: PersonalCipherType): string {
  return type === "card" ? "billing" : type === "identity" ? "profile" : "recovery";
}

function createdId(type: PersonalCipherType): string {
  return type === "card" ? "m9-created-card" :
    type === "identity" ? "m9-created-identity" : "m9-created-secure-note";
}

function receiptType(type: PersonalCipherType): string {
  return type === "note" ? "secure_note" : type;
}

function serverEditName(type: PersonalCipherType): string {
  return type === "card"
    ? "Server-confirmed Card example.test"
    : type === "identity"
      ? "Server-confirmed Identity example.test"
      : "Server-confirmed Secure Note example.test";
}

async function assertServerEditState(page: Page, type: PersonalCipherType): Promise<void> {
  if (type === "card") {
    await expect(page.locator("#cardholderName")).toHaveValue("Server Cardholder Example");
  } else if (type === "identity") {
    await expect(page.locator("#fullName")).toHaveValue("Server Identity Example");
  } else {
    await expect(page.locator("#notes")).toHaveValue(
      "Server-confirmed synthetic note body example.test",
    );
  }
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

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<Buffer> {
  const authoritativePath = join(evidenceDirectory, fileName);
  const buffer = await page.screenshot({
    path: evidenceCapturePath(testInfo, authoritativePath),
    animations: "disabled",
  });
  if (testInfo.project.name === "chromium" && !isAuthoritativeEvidenceWriter(testInfo)) {
    expect(existsSync(authoritativePath), `${fileName} authority must exist`).toBe(true);
    const comparison = await compareEvidenceScreenshotPixels(
      page,
      readFileSync(authoritativePath),
      buffer,
    );
    expect(
      comparison.differentPixels,
      `${fileName} must stay within the existing 8-pixel reproducibility threshold`,
    ).toBeLessThanOrEqual(8);
  }
  return buffer;
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
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 255) opaquePixels += 1;
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    }
    return { width: canvas.width, height: canvas.height, opaquePixels, uniqueColors: colors.size };
  }, buffer.toString("base64"));
}

function replaceProvenanceHashTable(provenance: string): string {
  evidenceIntegrity.assertExactPngEvidenceInventory(
    readdirSync(evidenceDirectory).filter((fileName) => fileName.endsWith(".png")),
    screenshotFiles,
  );
  const header = "| File | Dimensions | SHA-256 |\n| --- | --- | --- |";
  const start = provenance.indexOf(header);
  if (start < 0) throw new Error("M9 provenance SHA table is missing");
  const nextSection = provenance.indexOf("\n\n", start + header.length);
  const end = nextSection < 0 ? provenance.trimEnd().length : nextSection;
  const rows = [...screenshotFiles].sort().map((fileName) => {
    const path = join(evidenceDirectory, fileName);
    if (!existsSync(path)) throw new Error(`Missing M9 authority: ${fileName}`);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    return `| ${fileName} | 480x600 | ${hash} |`;
  });
  return `${provenance.slice(0, start)}${[header, ...rows].join("\n")}${provenance.slice(end)}`;
}

function pngWithCompressedText(keyword: string, value: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0, 0]),
    deflateSync(Buffer.from(value, "latin1")),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    length,
    Buffer.from("zTXt", "ascii"),
    data,
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.from("IEND", "ascii"),
    Buffer.alloc(4),
  ]);
}
