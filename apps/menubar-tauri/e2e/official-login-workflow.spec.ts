import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { captureConsecutiveStableScreenshot, compareEvidenceScreenshotPixels } from "./evidence-integrity";
import { evidenceCapturePath } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/m7-m8-official-login-workflow-2026-07-15",
);
const provenancePath = join(evidenceDirectory, "PROVENANCE.md");

const detailStates = [
  "detail-default",
  "detail-revealed",
  "detail-reprompt",
  "detail-totp-rollover",
  "detail-multiple-uri",
  "detail-custom-field",
  "detail-archived",
  "detail-trashed",
  "detail-action-failure",
  "detail-long-text",
] as const;

const formStates = [
  "form-add",
  "form-edit",
  "form-clone",
  "form-validation",
  "form-save-failure",
  "form-duplicate",
  "form-stale",
  "form-compact",
  "form-light",
  "form-dark",
] as const;

type WorkflowState = (typeof detailStates)[number] | (typeof formStates)[number];

const screenshotFiles = [...detailStates, ...formStates].map((state) => `${state}-480x600.png`);

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

for (const state of [...detailStates, ...formStates]) {
  test(`proves sanitized ${state} official Login workflow state`, async ({ page }, testInfo) => {
    await openState(page, state);
    await assertPopupGeometry(page);
    await assertNoExcludedSurface(page);
    await assertSecretFreeRuntime(page);

    if (state.startsWith("detail-")) {
      await assertDetailAncestry(page);
    } else {
      await assertFormAncestry(page);
    }
    await prepareStateForCapture(page, state);
    await settleStateForCapture(page, state);
    await assertPopupGeometry(page);
    await blurActiveElementForCapture(page);

    const screenshot = await capture(page, testInfo, `${state}-480x600.png`);
    const decoded = await decodeScreenshot(page, screenshot);
    expect(decoded).toMatchObject({ width: 480, height: 600, opaquePixels: 480 * 600 });
    expect(decoded.uniqueColors).toBeGreaterThan(16);
  });
}

test("uses real pointer actions and records action names without values", async ({ page }) => {
  await openState(page, "detail-default");

  await page.getByRole("button", { name: "复制用户名", exact: true }).click();
  await expectReceipt(page, "copy_text");
  await page.getByRole("button", { name: "填入用户名字段", exact: true }).click();
  await expectReceipt(page, "paste_text");
  await page.getByTestId("launch-website").first().click();
  await expectReceipt(page, "open_url");

  const password = page.getByTestId("login-password");
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");

  await page.getByRole("link", { name: "编辑", exact: true }).click();
  await expect(page).toHaveURL(/#\/edit-cipher\?cipherId=calendar&type=1$/);
  await assertSecretFreeRuntime(page);
});

test("proves reprompt before protected reveal", async ({ page }) => {
  await openState(page, "detail-reprompt");
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认主密码", exact: true })).toBeVisible();
  await assertSecretFreeRuntime(page);
});

test("proves multiple URI, custom-field, archived, trashed, and TOTP behavior", async ({ page }) => {
  await openState(page, "detail-multiple-uri");
  await expect(page.getByTestId("launch-website")).toHaveCount(2);

  await openState(page, "detail-custom-field");
  await page.getByRole("button", { name: "复制 部署区域", exact: true }).click();
  await expectReceipt(page, "copy_text");

  await openState(page, "detail-archived");
  await expect(page.getByRole("button", { name: "已归档", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "填入用户名字段", exact: true })).toHaveCount(0);

  await openState(page, "detail-trashed");
  await expect(page.getByRole("button", { name: "恢复", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "永久删除", exact: true })).toBeVisible();

  await openState(page, "detail-totp-rollover", { freezeTotpForCapture: false });
  const code = page.getByTestId("login-totp");
  const codeBefore = await code.inputValue();
  await page.clock.runFor(31_000);
  await expect(code).not.toHaveValue(codeBefore);
});

test("keeps action failures fixed and secret-free", async ({ page }) => {
  await openState(page, "detail-action-failure");
  await page.getByRole("button", { name: "复制用户名", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-last-host-action", /.+/);
  await assertSecretFreeRuntime(page);
});

test("uses the official form for add/edit/clone and real save/cancel actions", async ({ page }) => {
  for (const [state, heading, receipt, resultId] of [
    ["form-add", "新增登录", "create_login", "evidence-created-login"],
    ["form-edit", "编辑登录", "update_login", "calendar"],
    ["form-clone", "克隆登录", "create_login", "evidence-created-login"],
  ] as const) {
    await openState(page, state);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    const committedName = `Runtime ${state}`;
    await formName(page).fill(committedName);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#\\/view-cipher\\/${resultId}$`));
    await expect(page.getByTestId("item-name")).toHaveText(committedName);
    await expectReceipt(page, receipt);
    await assertSecretFreeRuntime(page);
  }

  await openState(page, "form-edit");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
});

test("proves validation, failure retention, duplicate suppression, and stale ownership", async ({ page }) => {
  await openState(page, "form-validation");
  await formName(page).fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("bit-error")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-last-host-action", /.+/);

  await openState(page, "form-save-failure");
  const retainedName = formName(page);
  await retainedName.fill("Retained after failure");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await expect(retainedName).toHaveValue("Retained after failure");
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-last-host-action", /.+/);
  await expect(page.locator("html")).not.toHaveAttribute("data-bw-evidence-host-action-count", /.+/);

  await openState(page, "form-duplicate");
  await formName(page).fill("Duplicate submission");
  const save = page.getByRole("button", { name: "保存", exact: true });
  await Promise.all([save.click(), save.click()]);
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-host-action-count", "1");

  await openState(page, "form-stale");
  const staleDraft = "Returned stale sentinel must not commit";
  await formName(page).fill(staleDraft);
  await saveFor(page);
  await expectReceipt(page, "update_login");
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-host-action-count", "1");
  await expect(page).toHaveURL(/#\/edit-cipher\?cipherId=calendar&type=1$/);
  await expect(formName(page)).toHaveValue(staleDraft);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();

  await page.evaluate(() => {
    window.location.hash = "/view-cipher/calendar";
  });
  await expect(page).toHaveURL(/#\/view-cipher\/calendar$/);
  await expect(page.getByTestId("item-name")).toHaveText("Example Calendar");
  await expect(page.getByTestId("item-name")).not.toHaveText(staleDraft);
});

test("proves stable keyboard order for detail and form", async ({ page }) => {
  await openState(page, "detail-default");
  const back = page.getByRole("button", { name: "返回", exact: true });
  await back.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "弹出到新窗口", exact: true })).toBeFocused();

  await openState(page, "form-add");
  const name = formName(page);
  await name.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "文件夹", exact: true })).toBeFocused();
});

test("records reproducible provenance and authoritative hashes", ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium is the sole authoritative writer");
  expect(existsSync(provenancePath)).toBe(true);
  if (process.env.UPDATE_EVIDENCE === "true") {
    writeFileSync(
      provenancePath,
      replaceProvenanceHashTable(readFileSync(provenancePath, "utf8")),
    );
  }
  const provenance = readFileSync(provenancePath, "utf8").toLowerCase();
  for (const required of [
    "f47b6946e01aed474875789081966d311d5b8289",
    "chromium is the sole authoritative screenshot writer",
    "chrome official baseline does not exist",
    "masked regions: none",
    "example.test",
    "UPDATE_EVIDENCE=true npx playwright test apps/menubar-tauri/e2e/official-login-workflow.spec.ts --project=chromium --workers=1".toLowerCase(),
  ]) {
    expect(provenance).toContain(required);
  }
  expect(provenance).not.toContain('-g "proves sanitized"');
  for (const fileName of screenshotFiles) {
    const path = join(evidenceDirectory, fileName);
    expect(existsSync(path)).toBe(true);
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(provenance).toContain(`| ${fileName} | ${sha} |`);
  }
});

test("short-circuits byte-identical PNG comparison before browser decode", async () => {
  let decoded = false;
  const page = {
    evaluate: async () => {
      decoded = true;
      return { width: 480, height: 600, differentPixels: 478 };
    },
  } as unknown as Page;
  const identical = Buffer.from("byte-identical-png");

  await expect(compareEvidenceScreenshotPixels(page, identical, identical)).resolves.toMatchObject({
    differentPixels: 0,
  });
  expect(decoded).toBe(false);
});

test("guards final-state settling and geometry verification before capture", () => {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const preparedCapture = source.match(
    /await prepareStateForCapture\(page, state\);([\s\S]*?)const screenshot = await capture/,
  );

  expect(preparedCapture?.[1]).toContain("await settleStateForCapture(page, state);");
  expect(preparedCapture?.[1]).toContain("await assertPopupGeometry(page);");
  expect(preparedCapture?.[1]?.indexOf("settleStateForCapture")).toBeLessThan(
    preparedCapture?.[1]?.indexOf("assertPopupGeometry") ?? -1,
  );
});

test("settles the final reprompt footer observer state before capture", async ({ page }) => {
  await delayIntersectionObserverNotifications(page, 120);
  await openState(page, "detail-reprompt");
  await prepareStateForCapture(page, "detail-reprompt");
  await settleStateForCapture(page, "detail-reprompt");

  const diagnostic = await repromptDialogVisualDiagnostic(page);
  expect(diagnostic, JSON.stringify(diagnostic)).toMatchObject({
    contentScrollable: false,
    dividerClass: expect.stringContaining("tw-border-transparent"),
    dividerBorderTopColor: "rgba(0, 0, 0, 0)",
    runningFiniteAnimations: [],
  });
});

async function openState(
  page: Page,
  state: WorkflowState,
  { freezeTotpForCapture = true }: { freezeTotpForCapture?: boolean } = {},
): Promise<void> {
  const evidenceTime = state === "detail-totp-rollover"
    ? new Date("2026-07-15T12:00:01.000Z")
    : null;
  if (evidenceTime) {
    if (freezeTotpForCapture) {
      await page.clock.setFixedTime(evidenceTime);
    } else {
      await page.clock.install({ time: evidenceTime });
    }
  }
  await page.addInitScript(({ compactMode, theme }) => {
    localStorage.clear();
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ animations: false, compactMode, fillMode: "clipboard-paste", theme }),
    );
  }, { compactMode: state === "form-compact", theme: state === "form-dark" ? "dark" : "light" });
  await page.emulateMedia({
    colorScheme: state === "form-dark" ? "dark" : "light",
    reducedMotion: "reduce",
  });
  await page.goto(`/?vaultEvidence=login-workflow-${state}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertPopupGeometry(page: Page): Promise<void> {
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))).toEqual({
    width: 480,
    height: 600,
    dpr: 1,
  });
  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("barwarden-root");
    const scrollHost = document.querySelector<HTMLElement>('popup-page [data-testid="popup-layout-scroll-region"]');
    if (!root || !scrollHost) throw new Error("Missing popup root or scroll host");
    const candidates = [document.documentElement, document.body, root, ...root.querySelectorAll<HTMLElement>("*")];
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollOwners: [...new Set(candidates)].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (element === scrollHost || element.scrollHeight > element.clientHeight) &&
          ["auto", "scroll"].includes(style.overflowY) && rect.width > 0 && rect.height > 0;
      }).map((element) => element.dataset.testid ?? element.tagName.toLowerCase()),
    };
  });
  expect(layout).toEqual({ horizontalOverflow: 0, scrollOwners: ["popup-layout-scroll-region"] });
}

async function assertDetailAncestry(page: Page): Promise<void> {
  await expect(page.locator(
    "barwarden-root > .popup-window-size-source > bw-vault-item-detail-page > popup-page bw-official-login-detail",
  )).toHaveCount(1);
  await expect(page.locator("bw-official-login-detail official-item-details")).toHaveCount(1);
  await expect(page.locator("bw-official-login-detail official-login-credentials")).toHaveCount(1);
}

async function assertFormAncestry(page: Page): Promise<void> {
  await expect(page.locator(
    "barwarden-root > .popup-window-size-source > bw-vault-add-edit-page > popup-page bw-official-login-cipher-form",
  )).toHaveCount(1);
  await expect(page.locator("bw-official-login-cipher-form vault-item-details-section")).toHaveCount(1);
  await expect(page.locator("bw-official-login-cipher-form vault-login-details-section")).toHaveCount(1);
  await expect(page.locator("bw-official-login-cipher-form vault-additional-options-section")).toHaveCount(1);
  await expect(page.locator("bw-official-login-cipher-form vault-custom-fields")).toHaveCount(1);
}

async function assertNoExcludedSurface(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(/附件|保存并填充|通行密钥|SSH|自动填充到页面|集合|组织/);
  await expect(page.locator('[data-testid*="attachment"], [data-testid*="passkey"], [data-testid*="save-and-fill"]')).toHaveCount(0);
}

async function prepareStateForCapture(page: Page, state: WorkflowState): Promise<void> {
  if (state === "detail-revealed") {
    await page.getByRole("button", { name: "显示密码", exact: true }).click();
  }
  if (state === "detail-reprompt") {
    await page.getByRole("button", { name: "显示密码", exact: true }).click();
    await page.getByRole("heading", { name: "确认主密码", exact: true }).waitFor();
  }
  if (state === "detail-totp-rollover") {
    await page.getByTestId("login-totp").scrollIntoViewIfNeeded();
  }
  if (state === "detail-multiple-uri") {
    await page.getByTestId("launch-website").last().scrollIntoViewIfNeeded();
  }
  if (state === "detail-custom-field") {
    await page.getByRole("button", { name: "复制 部署区域", exact: true }).scrollIntoViewIfNeeded();
  }
  if (state === "detail-action-failure") {
    await page.getByRole("button", { name: "复制用户名", exact: true }).click();
  }
  if (state === "form-validation") {
    await formName(page).fill("");
    await saveFor(page);
  }
  if (state === "form-save-failure") {
    await formName(page).fill("Save failure example");
    await saveFor(page);
  }
  if (state === "form-duplicate") {
    await formName(page).fill("Duplicate example");
    await saveFor(page);
  }
  if (state === "form-stale") {
    await saveFor(page);
  }
}

async function assertSecretFreeRuntime(page: Page): Promise<void> {
  expect(page.url()).not.toMatch(/[?&#](?:password|seed|totp|username)=/i);
  const diagnostics = await page.evaluate(() => ({
    htmlDataset: { ...document.documentElement.dataset },
    historyState: history.state,
    localStorage: { ...localStorage },
  }));
  expect(JSON.stringify(diagnostics)).not.toMatch(/evidence-password|jbswy3dpehpk3pxp|calendar-user/i);
  const receipt = diagnostics.htmlDataset.bwEvidenceLastHostAction;
  if (receipt) expect(["copy_text", "paste_text", "open_url", "create_login", "update_login"]).toContain(receipt);
}

async function expectReceipt(page: Page, receipt: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-bw-evidence-last-host-action", receipt);
  await assertSecretFreeRuntime(page);
}

async function saveFor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "保存", exact: true }).click();
}

function formName(page: Page) {
  return page.getByRole("textbox", { name: "项目名称 * (必填)", exact: true });
}

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<Buffer> {
  const authoritativePath = join(evidenceDirectory, fileName);
  const capturePath = evidenceCapturePath(testInfo, authoritativePath);
  const buffer = await captureConsecutiveStableScreenshot(page, { animations: "disabled" });
  writeFileSync(capturePath, buffer);
  if (testInfo.project.name === "chromium" && process.env.UPDATE_EVIDENCE !== "true") {
    expect(existsSync(authoritativePath), `${fileName} authority must exist`).toBe(true);
    const comparison = await compareEvidenceScreenshotPixels(page, readFileSync(authoritativePath), buffer);
    expect(
      comparison.differentPixels,
      `${fileName} comparison: ${JSON.stringify(comparison)}`,
    ).toBeLessThanOrEqual(256);
    expect(comparison.maxChannelDelta ?? 0, `${fileName} maximum edge delta`).toBeLessThanOrEqual(8);
    expect(comparison.nonEdgeDifferentPixels ?? 0, `${fileName} non-edge drift`).toBe(0);
  }
  return buffer;
}

async function decodeScreenshot(page: Page, buffer: Buffer) {
  return page.evaluate(async (dataUrl) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to decode evidence PNG"));
      image.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    let opaquePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 255) opaquePixels += 1;
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    }
    return { width: canvas.width, height: canvas.height, opaquePixels, uniqueColors: colors.size };
  }, `data:image/png;base64,${buffer.toString("base64")}`);
}

async function delayIntersectionObserverNotifications(page: Page, frames: number): Promise<void> {
  await page.addInitScript((frameCount) => {
    const NativeIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          callback(entries.map((entry) => ({
            boundingClientRect: entry.boundingClientRect,
            intersectionRatio: 0,
            intersectionRect: entry.intersectionRect,
            isIntersecting: false,
            rootBounds: entry.rootBounds,
            target: entry.target,
            time: entry.time,
          })), observer);
          let remaining = frameCount;
          const notify = () => {
            if (remaining-- <= 0) {
              callback(entries, observer);
            } else {
              requestAnimationFrame(notify);
            }
          };
          requestAnimationFrame(notify);
        }, options);
      }
    };
  }, frames);
}

async function settleStateForCapture(page: Page, state: WorkflowState): Promise<void> {
  if (state !== "detail-reprompt") return;

  await page.evaluate(async () => {
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const deadline = performance.now() + 5_000;
    let previousSignature = "";
    let stableFrames = 0;

    while (performance.now() < deadline) {
      await nextFrame();
      const form = document.querySelector<HTMLElement>("bw-vault-reprompt-dialog form[bit-dialog]");
      const section = form?.querySelector<HTMLElement>(":scope > section");
      const footer = section?.querySelector<HTMLElement>(":scope > footer");
      const divider = footer?.previousElementSibling as HTMLElement | null;
      const content = section?.querySelector<HTMLElement>('div[tabindex="0"]');
      if (!form || !section || !footer || !divider || !content) continue;

      const contentScrollable = content.scrollHeight > content.clientHeight;
      const observerStateFinal = contentScrollable
        ? divider.classList.contains("tw-border-secondary-100")
        : divider.classList.contains("tw-border-transparent");
      const runningFiniteAnimations = document.getAnimations().filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return animation.playState === "running" && Number.isFinite(timing?.endTime);
      });
      const signature = JSON.stringify({
        contentClientHeight: content.clientHeight,
        contentScrollHeight: content.scrollHeight,
        dividerBorderTopColor: getComputedStyle(divider).borderTopColor,
        dividerClass: divider.className,
        dividerRect: divider.getBoundingClientRect().toJSON(),
      });

      if (observerStateFinal && runningFiniteAnimations.length === 0) {
        stableFrames = signature === previousSignature ? stableFrames + 1 : 1;
        if (stableFrames >= 2) return;
      } else {
        stableFrames = 0;
      }
      previousSignature = signature;
    }
    throw new Error("Reprompt dialog visual state did not settle before capture");
  });
}

async function blurActiveElementForCapture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function repromptDialogVisualDiagnostic(page: Page) {
  return page.evaluate(() => {
    const form = document.querySelector<HTMLElement>("bw-vault-reprompt-dialog form[bit-dialog]");
    const section = form?.querySelector<HTMLElement>(":scope > section");
    const footer = section?.querySelector<HTMLElement>(":scope > footer");
    const divider = footer?.previousElementSibling as HTMLElement | null;
    const content = section?.querySelector<HTMLElement>('div[tabindex="0"]');
    if (!form || !section || !footer || !divider || !content) {
      throw new Error("Reprompt dialog visual structure is incomplete");
    }
    return {
      contentClientHeight: content.clientHeight,
      contentScrollHeight: content.scrollHeight,
      contentScrollable: content.scrollHeight > content.clientHeight,
      dividerBorderTopColor: getComputedStyle(divider).borderTopColor,
      dividerClass: divider.className,
      dividerRect: divider.getBoundingClientRect().toJSON(),
      runningFiniteAnimations: document.getAnimations()
        .filter((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return animation.playState === "running" && Number.isFinite(timing?.endTime);
        })
        .map((animation) => animation.animationName || "anonymous"),
    };
  });
}

function replaceProvenanceHashTable(provenance: string): string {
  const header = "| File | SHA-256 |\n| --- | --- |";
  const start = provenance.indexOf(header);
  if (start < 0) {
    throw new Error("Task 7 provenance SHA table is missing");
  }
  const nextSection = provenance.indexOf("\n\n", start + header.length);
  const end = nextSection < 0 ? provenance.trimEnd().length : nextSection;
  const rows = [...screenshotFiles]
    .sort()
    .map((fileName) => {
      const path = join(evidenceDirectory, fileName);
      if (!existsSync(path)) throw new Error(`Missing Task 7 authority: ${fileName}`);
      const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
      return `| ${fileName} | ${sha} |`;
    });
  const table = [header, ...rows].join("\n");
  return `${provenance.slice(0, start)}${table}${provenance.slice(end)}`;
}
