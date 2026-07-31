import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type TestInfo } from "@playwright/test";

import { evidenceCapturePath } from "./evidence-path";

const evidenceDirectory = join(
  process.cwd(),
  "docs/superpowers/screenshots/g1-5-task-4-2026-07-12",
);

test("captures direct official Vault main", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/tabs/vault");
  await expect(page.locator("bit-search")).toBeVisible();
  await expect(page.locator("bit-section").first()).toBeVisible();
  await expect(page.locator("bit-item").first()).toBeVisible();
  await expect(page.getByText("Example Mail", { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, "final-vault-main-480x600.png");
});

test("captures the selected-folder official New menu and retained add forms", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/tabs/vault");
  await selectWorkFolderAndOpenNewMenu(page);
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "文件夹", exact: true })).toBeVisible();
  await capture(page, testInfo, "task-5-new-item-folder-work-480x600.png");

  for (const [type, chooserLabel, pageLabel] of [
    ["1", "登录", "登录"],
    ["3", "支付卡", "支付卡"],
    ["4", "身份", "身份"],
    ["2", "笔记", "笔记"],
  ] as const) {
    const addItem = page.getByRole("menuitem", { name: chooserLabel, exact: true });
    await expect(addItem).toHaveAttribute("href", new RegExp(`/add-cipher\\?type=${type}&folderId=work$`));
    await addItem.click();
    await expect(page.getByRole("heading", { name: new RegExp(`新增${pageLabel}$`) })).toBeVisible();
    if (type === "1") {
      await expect(page.locator("bw-official-login-cipher-form vault-item-details-section")).toBeVisible();
      const folderCombobox = page.getByRole("combobox", { name: "文件夹", exact: true });
      await expect(page.locator("bit-form-field").filter({ has: folderCombobox })).toContainText("Work");
    } else {
      const folderCombobox = page.getByRole("combobox", { name: "文件夹", exact: true });
      await expect(folderCombobox).toBeVisible();
      await expect(page.locator("bit-form-field").filter({ has: folderCombobox })).toContainText("Work");
    }
    await capture(page, testInfo, `task-5-add-${type}-folder-work-480x600.png`);
    await page.goBack();
    await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault$/);
    if (type !== "2") {
      await openOfficialNewMenu(page);
    }
  }
});

test("captures direct official Login detail", async ({ page }, testInfo) => {
  await openEvidenceRoute(page, "/view-cipher/calendar");
  await expect(page.getByRole("heading", { name: "查看登录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录凭据" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "自动填充选项" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "网站", exact: true })).toBeVisible();
  await expect(page.locator("bw-official-login-detail official-login-credentials")).toBeVisible();
  await expect(page.getByTestId("login-password")).toBeVisible();
  await expectExcludedBrowserControls(page);
  await capture(page, testInfo, "final-login-detail-480x600.png");
});

for (const route of ["add-cipher", "edit-cipher", "clone-cipher"] as const) {
  test(`captures direct official Login ${route}`, async ({ page }, testInfo) => {
    const query = route === "add-cipher" ? "type=1" : "cipherId=calendar&type=1";
    await openEvidenceRoute(page, `/${route}?${query}`);
    await expect(page.locator("bw-official-login-cipher-form vault-item-details-section")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "项目名称 * (必填)", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "文件夹", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "收藏" })).toBeAttached();
    await expect(page.getByRole("heading", { name: /登录$/ })).toBeVisible();
    await expectExcludedBrowserControls(page);
    await capture(
      page,
      testInfo,
      `final-login-${route.replace("-cipher", "")}-480x600.png`,
    );
  });
}

async function openEvidenceRoute(page: import("@playwright/test").Page, route: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?vaultEvidence=populated", { waitUntil: "load" });
  await expect(page).toHaveURL(/vaultEvidence=populated.*#\/tabs\/vault/);
  if (route !== "/tabs/vault") {
    await page.evaluate((nextRoute) => {
      globalThis.location.hash = nextRoute;
    }, route);
  }
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveURL(new RegExp(`vaultEvidence=populated.*#${route.split("?")[0]}`));
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 480,
    height: 600,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

async function expectExcludedBrowserControls(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect(page.locator("body")).not.toContainText(
    /自动填充到页面|保存并填充|附件|通行密钥/,
  );
  await expect(
    page.locator(
      '[data-testid*="attachment"], [data-testid*="passkey"], [data-testid*="save-and-fill"]',
    ),
  ).toHaveCount(0);
}

async function selectWorkFolderAndOpenNewMenu(page: import("@playwright/test").Page): Promise<void> {
  const filterToggle = page.getByRole("button", { name: "筛选密码库" });
  if (await filterToggle.getAttribute("aria-expanded") !== "true") {
    await filterToggle.click();
  }
  const folderFilter = page.getByTitle("文件夹", { exact: true });
  await folderFilter.evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("menuitem", { name: "Work", exact: true }).click();
  await expect(page.getByRole("button", { name: "移除 Work", exact: true })).toBeVisible();

  await openOfficialNewMenu(page);
}

async function openOfficialNewMenu(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("popup-header app-new-item-dropdown button[bitbutton]")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("menu")).toBeVisible();
}

async function capture(
  page: import("@playwright/test").Page,
  testInfo: TestInfo,
  fileName: string,
) {
  const authoritativePath = join(evidenceDirectory, fileName);
  const freshPath = evidenceCapturePath(testInfo, authoritativePath);
  await page.screenshot({ path: freshPath, animations: "disabled" });

  const comparison = await compareDecodedPngs(
    page,
    readFileSync(authoritativePath).toString("base64"),
    readFileSync(freshPath).toString("base64"),
  );
  expect(comparison.authoritative).toMatchObject({
    width: 480,
    height: 600,
    nonMonochrome: true,
    opaque: true,
    anomalousBlackRectangle: false,
  });
  expect(comparison.fresh).toMatchObject({
    width: 480,
    height: 600,
    nonMonochrome: true,
    opaque: true,
    anomalousBlackRectangle: false,
  });
  // This historical capture predates the M5-M6 official Vault migration. Current visual authority
  // is locked by official-vault-main.spec.ts; here both old and current images only stay decodable.
}

async function compareDecodedPngs(
  page: import("@playwright/test").Page,
  authoritativeBase64: string,
  freshBase64: string,
) {
  return page.evaluate(
    async ([authoritative, fresh]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          throw new Error("Canvas 2D context is unavailable");
        }
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<number>();
        let consecutiveBlackRows = 0;
        let anomalousBlackRectangle = false;
        let opaque = true;
        for (let y = 0; y < canvas.height; y += 1) {
          let longestBlackRun = 0;
          let blackRun = 0;
          for (let x = 0; x < canvas.width; x += 1) {
            const offset = (y * canvas.width + x) * 4;
            if (colors.size <= 256) {
              colors.add(
                ((pixels[offset] << 24) |
                  (pixels[offset + 1] << 16) |
                  (pixels[offset + 2] << 8) |
                  pixels[offset + 3]) >>>
                  0,
              );
            }
            opaque &&= pixels[offset + 3] === 255;
            if (
              pixels[offset] === 0 &&
              pixels[offset + 1] === 0 &&
              pixels[offset + 2] === 0 &&
              pixels[offset + 3] === 255
            ) {
              blackRun += 1;
              longestBlackRun = Math.max(longestBlackRun, blackRun);
            } else {
              blackRun = 0;
            }
          }
          consecutiveBlackRows =
            longestBlackRun >= Math.floor(canvas.width / 4) ? consecutiveBlackRows + 1 : 0;
          anomalousBlackRectangle ||= consecutiveBlackRows >= Math.floor(canvas.height / 10);
        }
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: Array.from(pixels),
          nonMonochrome: colors.size > 16,
          opaque,
          anomalousBlackRectangle,
        };
      };

      const authoritativeImage = await decode(authoritative);
      const freshImage = await decode(fresh);
      let mismatchedPixels = 0;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      if (
        authoritativeImage.width !== freshImage.width ||
        authoritativeImage.height !== freshImage.height
      ) {
        mismatchedPixels = Number.POSITIVE_INFINITY;
      } else {
        for (let offset = 0; offset < authoritativeImage.pixels.length; offset += 4) {
          if (
            (authoritativeImage.pixels[offset] & 0xf8) !== (freshImage.pixels[offset] & 0xf8) ||
            (authoritativeImage.pixels[offset + 1] & 0xf8) !== (freshImage.pixels[offset + 1] & 0xf8) ||
            (authoritativeImage.pixels[offset + 2] & 0xf8) !== (freshImage.pixels[offset + 2] & 0xf8) ||
            authoritativeImage.pixels[offset + 3] !== freshImage.pixels[offset + 3]
          ) {
            mismatchedPixels += 1;
            const pixel = offset / 4;
            const x = pixel % authoritativeImage.width;
            const y = Math.floor(pixel / authoritativeImage.width);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }

      const { pixels: _authoritativePixels, ...authoritativeStats } = authoritativeImage;
      const { pixels: _freshPixels, ...freshStats } = freshImage;
      return {
        authoritative: authoritativeStats,
        fresh: freshStats,
        mismatchedPixels,
        mismatchBounds: mismatchedPixels > 0 ? { minX, minY, maxX, maxY } : null,
      };
    },
    [authoritativeBase64, freshBase64] as const,
  );
}
