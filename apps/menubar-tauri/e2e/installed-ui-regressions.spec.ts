import { expect, test, type Page } from "@playwright/test";

const minimumPopup = { width: 480, height: 600 } as const;
const intermediatePopout = { width: 700, height: 620 } as const;
const defaultPopout = { width: 900, height: 640 } as const;
const reducedMotionSheetTestTitle =
  "reduced-motion popout sheet states stay centered without vertical travel";
const rootTabs = [
  { label: "密码库", path: "/tabs/vault" },
  { label: "OTP", path: "/tabs/otp" },
  { label: "生成器", path: "/tabs/generator" },
  { label: "Send", path: "/tabs/send" },
  { label: "设置", path: "/tabs/settings" },
] as const;

async function rootLayout(page: Page) {
  return page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>(".floating-tab-switcher")
      ?.getBoundingClientRect();
    const activePage = document.querySelector<HTMLElement>(
      ".popup-tab-scroll-host > :not(router-outlet)",
    )?.getBoundingClientRect();
    return {
      rootWidth: document.querySelector("barwarden-root")?.getBoundingClientRect().width ?? 0,
      activePageWidth: activePage?.width ?? 0,
      navigationWidth: navigation?.width ?? 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  const animationsEnabled = testInfo.title === reducedMotionSheetTestTitle;
  await page.addInitScript((enabled) => {
    localStorage.clear();
    localStorage.setItem("barwarden.settings", JSON.stringify({
      animations: enabled,
      compactMode: false,
      showFavicons: false,
      showQuickCopyActions: true,
      theme: "light",
    }));
  }, animationsEnabled);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
});

test("locked content requests the 600 point minimum after a previously tall route", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: minimumPopup.width, height: 860 });
  await page.goto("/?authEvidence=lock-error");
  await expect(page.getByTestId("lock-master-password-input")).toBeVisible();

  const geometry = await page.locator(".popup-window-size-source").evaluate((source) => ({
    boxHeight: source.getBoundingClientRect().height,
    scrollHeight: source.scrollHeight,
    descendants: [
      "bw-lock-page",
      "bw-official-lock",
      "popup-page",
      ".macos-auth-page",
    ].map((selector) => {
      const element = source.querySelector<HTMLElement>(selector);
      const bounds = element?.getBoundingClientRect();
      return {
        selector,
        boxHeight: bounds?.height,
        top: bounds?.top,
        bottom: bounds?.bottom,
        scrollHeight: element?.scrollHeight,
        boxSizing: element ? getComputedStyle(element).boxSizing : undefined,
        paddingBlock: element
          ? `${getComputedStyle(element).paddingTop} ${getComputedStyle(element).paddingBottom}`
          : undefined,
      };
    }),
  }));

  expect(geometry, JSON.stringify(geometry.descendants))
    .toMatchObject({ boxHeight: minimumPopup.height, scrollHeight: minimumPopup.height });
  await page.screenshot({ path: testInfo.outputPath("lock-tall-viewport.png"), animations: "disabled" });
});

test("official password and search fields render one focus indicator", async ({ page }) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?authEvidence=lock-error");
  await assertSingleFieldFocus(page, "[data-testid='lock-master-password-input']", "bit-form-field");

  await page.goto("/?vaultEvidence=populated");
  await assertSingleFieldFocus(page, "[aria-label='搜索密码库']", ".vault-root-header__search");
});

test("floating navigation renders icons above 12px labels at the installed popup width", async ({ page }, testInfo) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?vaultEvidence=populated");

  const segments = page.locator(".floating-tab-switcher__segment");
  await expect(segments).toHaveCount(5);
  for (const segment of await segments.all()) {
    const icon = segment.locator(".floating-tab-switcher__icon");
    const label = segment.locator(".floating-tab-switcher__label");
    await expect(icon).toBeVisible();
    await expect(label).toBeVisible();

    const geometry = await segment.evaluate((button) => {
      const iconElement = button.querySelector<HTMLElement>(".floating-tab-switcher__icon");
      const labelElement = button.querySelector<HTMLElement>(".floating-tab-switcher__label");
      if (!iconElement || !labelElement) throw new Error("Missing icon-label navigation pair");
      const iconBounds = iconElement.getBoundingClientRect();
      const labelBounds = labelElement.getBoundingClientRect();
      return {
        iconCenter: iconBounds.top + iconBounds.height / 2,
        labelCenter: labelBounds.top + labelBounds.height / 2,
        labelFontSize: getComputedStyle(labelElement).fontSize,
      };
    });

    expect(geometry.iconCenter).toBeLessThan(geometry.labelCenter);
    expect(geometry.labelFontSize).toBe("12px");
  }

  await page.screenshot({ path: testInfo.outputPath("vault-icon-label-navigation.png"), animations: "disabled" });
});

test("vault rows visibly render their name and subtitle at the installed popup width", async ({ page }, testInfo) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?vaultEvidence=populated");
  const name = page.getByTestId("item-name").first();
  const subtitle = page.locator("app-retained-vault-list-item [slot='secondary']").first();
  await expect(name).toBeVisible();
  await expect(subtitle).toBeVisible();

  for (const text of [name, subtitle]) {
    const rendering = await text.evaluate((element) => {
      const row = element.closest("bit-item");
      const textStyle = getComputedStyle(element);
      const rowStyle = row ? getComputedStyle(row) : null;
      const bounds = element.getBoundingClientRect();
      let visibleLeft = bounds.left;
      let visibleRight = bounds.right;
      let ancestor = element.parentElement;
      const clips: Array<{ tag: string; left: number; right: number; width: number }> = [];
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (["auto", "clip", "hidden", "scroll"].includes(style.overflowX)) {
          const clip = ancestor.getBoundingClientRect();
          clips.push({
            tag: `${ancestor.tagName.toLowerCase()}.${ancestor.className}`,
            left: clip.left,
            right: clip.right,
            width: clip.width,
          });
          visibleLeft = Math.max(visibleLeft, clip.left);
          visibleRight = Math.min(visibleRight, clip.right);
        }
        ancestor = ancestor.parentElement;
      }
      return {
        width: bounds.width,
        visibleWidth: Math.max(0, visibleRight - visibleLeft),
        height: bounds.height,
        foreground: textStyle.color,
        background: rowStyle?.backgroundColor ?? "rgb(255, 255, 255)",
        clips,
      };
    });
    expect(rendering.width).toBeGreaterThan(24);
    expect(rendering.visibleWidth, JSON.stringify(rendering.clips)).toBeGreaterThan(24);
    expect(rendering.height).toBeGreaterThan(10);
    expect(contrastRatio(rendering.foreground, rendering.background)).toBeGreaterThanOrEqual(4.5);
  }

  await page.screenshot({ path: testInfo.outputPath("vault-populated.png"), animations: "disabled" });
});

test("vault uses six peer hierarchy nodes without legacy filter chips", async ({ page }, testInfo) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?vaultEvidence=populated");

  await expect(page.locator("[data-vault-node]")).toHaveCount(6);
  await expect(page.locator("app-vault-list-filters")).toHaveCount(0);
  await expect(page.locator('[data-vault-node="unfiled"]')).toBeVisible();
  await expect(page.locator('[data-vault-node="hidden"]')).toBeVisible();
  await page.locator('[data-vault-node="types"]').click();
  await expect(page.locator('[data-vault-child="type:login"]')).toBeVisible();
  await expect.poll(() => page.locator('[data-vault-node="types"]').evaluate((trigger) => {
    const scrollRegion = trigger.closest('[data-testid="popup-layout-scroll-region"]');
    if (!scrollRegion) return false;
    const triggerBounds = trigger.getBoundingClientRect();
    const regionBounds = scrollRegion.getBoundingClientRect();
    return triggerBounds.top >= regionBounds.top && triggerBounds.bottom <= regionBounds.bottom;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("vault-hierarchy-types.png"), animations: "disabled" });
});

test("otp tab renders generated countdown codes and five icon-label segments", async ({ page }, testInfo) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?vaultEvidence=populated");

  await page.getByRole("button", { name: "OTP", exact: true }).click();
  await expect(page).toHaveURL(/\/tabs\/otp$/);
  await expect(page.locator("[data-testid='otp-code']")).toBeVisible();
  await expect(page.locator(".otp-code-row__countdown")).toBeVisible();
  await expect(page.locator(".floating-tab-switcher__segment")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("otp-populated.png"), animations: "disabled" });
});

test("sheet has no visible close glyph and dismisses through the exposed backdrop", async ({ page }, testInfo) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?vaultEvidence=populated");
  await page.locator(".vault-floating-add app-new-item-dropdown > button").click();
  await page.getByRole("menuitem", { name: "文件夹", exact: true }).click();

  const sheet = page.locator(".app-bottom-sheet[open]");
  await expect(sheet).toHaveAttribute("data-state", "open");
  await expect(sheet.locator("button:has(.bwi-close)")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("folder-sheet-open.png"), animations: "disabled" });
  const bounds = await sheet.boundingBox();
  if (!bounds) throw new Error("sheet bounds unavailable");
  await page.mouse.click(12, Math.max(2, bounds.y - 12));
  await expect(sheet).toHaveCount(0);
});

test("folder sheet stays centered within the popout content frame after resize", async ({ page }) => {
  await page.setViewportSize(defaultPopout);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");

  for (const { viewport, maximumWidth } of [
    { viewport: defaultPopout, maximumWidth: 720 },
    { viewport: minimumPopup, maximumWidth: 456 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator(".vault-floating-add app-new-item-dropdown > button").click();
    await page.getByRole("menuitem", { name: "文件夹", exact: true }).click();

    const sheet = page.locator(".app-bottom-sheet[open]");
    await expect(sheet).toHaveAttribute("data-state", "open");
    await expect(sheet).toBeVisible();

    const geometry = await sheet.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        centerDelta: Math.abs(bounds.left * 2 + bounds.width - innerWidth),
        horizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.width).toBeLessThanOrEqual(maximumWidth);
    expect(geometry.centerDelta).toBeLessThanOrEqual(1);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);

    const bounds = await sheet.boundingBox();
    if (!bounds) throw new Error("sheet bounds unavailable");
    await page.mouse.click(12, Math.max(2, bounds.y - 12));
    await expect(sheet).toHaveCount(0);
  }
});

test("folder sheet content fills the responsive popout material", async ({ page }) => {
  await page.setViewportSize(defaultPopout);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");

  await page.locator(".vault-floating-add app-new-item-dropdown > button").click();
  await page.getByRole("menuitem", { name: "文件夹", exact: true }).click();

  const sheet = page.locator(".app-bottom-sheet[open]");
  await expect(sheet).toHaveAttribute("data-state", "open");
  await expect(sheet).toBeVisible();

  const geometry = await sheet.evaluate((element) => {
    const sheetBounds = element.getBoundingClientRect();
    const insetFromSheet = (selector: string) => {
      const bounds = element.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      if (!bounds) throw new Error(`Missing sheet geometry target: ${selector}`);
      return {
        left: bounds.left - sheetBounds.left,
        right: sheetBounds.right - bounds.right,
      };
    };
    return {
      sheetWidth: sheetBounds.width,
      wrapper: insetFromSheet("bw-official-add-edit-folder-dialog"),
      dialog: insetFromSheet("form[bit-dialog]"),
      surface: insetFromSheet("form[bit-dialog] > section"),
    };
  });

  expect(geometry.sheetWidth).toBe(720);
  expect(geometry.wrapper.left).toBeLessThanOrEqual(1);
  expect(geometry.wrapper.right).toBeLessThanOrEqual(1);
  expect(geometry.dialog.left).toBeLessThanOrEqual(1);
  expect(geometry.dialog.right).toBeLessThanOrEqual(1);
  expect(geometry.surface.left).toBeLessThanOrEqual(1);
  expect(geometry.surface.right).toBeLessThanOrEqual(1);
});

test(reducedMotionSheetTestTitle, async ({ page }) => {
  await page.setViewportSize(defaultPopout);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");

  await expect(page.locator("html")).toHaveAttribute("data-bw-animations", "true");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches))
    .toBe(true);

  await page.locator(".vault-floating-add app-new-item-dropdown > button").click();
  await page.getByRole("menuitem", { name: "文件夹", exact: true }).click();

  const sheet = page.locator(".app-bottom-sheet[open]");
  await expect(sheet).toHaveAttribute("data-state", "open");
  await expect(sheet).toBeVisible();

  const readTransforms = () => sheet.evaluate((element) => {
    return ["base", "open", "opening", "closing"].map((state) => {
      element.setAttribute("data-state", state);
      void element.getBoundingClientRect();
      element.getAnimations().forEach((animation) => animation.finish());
      const style = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(style.transform);
      return {
        state,
        transform: style.transform,
        transitionDuration: style.transitionDuration,
        x: matrix.m41,
        y: matrix.m42,
      };
    });
  });

  const transforms = await readTransforms();
  expect(transforms, JSON.stringify(transforms)).toEqual([
    expect.objectContaining({ state: "base", transitionDuration: "0.001s", x: -360, y: 0 }),
    expect.objectContaining({ state: "open", transitionDuration: "0.001s", x: -360, y: 0 }),
    expect.objectContaining({ state: "opening", transitionDuration: "0.001s", x: -360, y: 0 }),
    expect.objectContaining({ state: "closing", transitionDuration: "0.001s", x: -360, y: 0 }),
  ]);

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  const standardMotionTransforms = await readTransforms();
  expect(standardMotionTransforms[1]).toEqual(
    expect.objectContaining({ state: "open", x: -360, y: 0 }),
  );
  for (const index of [0, 2, 3]) {
    expect(standardMotionTransforms[index]!.x).toBe(-360);
    expect(standardMotionTransforms[index]!.y).toBeGreaterThan(0);
  }
});

test("popup canvas exposes transparent 14px rounded native corners", async ({ page }) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?vaultEvidence=populated");

  const contract = await page.locator("barwarden-root").evaluate((root) => {
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(document.body);
    return {
      radius: rootStyle.borderRadius,
      overflow: rootStyle.overflow,
      bodyBackground: bodyStyle.backgroundColor,
      bounds: root.getBoundingClientRect().toJSON(),
    };
  });

  expect(contract.radius).toBe("14px");
  expect(contract.overflow).toBe("hidden");
  expect(contract.bodyBackground).toBe("rgba(0, 0, 0, 0)");
  expect(contract.bounds).toMatchObject({ width: 480, height: 600 });
});

test("marked popout fills the decorated window and widens floating chrome", async ({ page }, testInfo) => {
  await page.setViewportSize(defaultPopout);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");
  await page.getByRole("button", { name: "生成器", exact: true }).click();
  await expect(page).toHaveURL(/\/tabs\/generator$/);
  const generator = page.locator("bw-official-generator-core");
  await expect(generator).toBeVisible();
  await expect.poll(
    () => generator.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(720);

  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) =>
      document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().toJSON();
    return {
      mode: document.documentElement.dataset["bwWindow"],
      viewport: { width: innerWidth, height: innerHeight },
      root: bounds("barwarden-root"),
      shell: bounds(".popup-shell"),
      generator: bounds("bw-official-generator-core"),
      navigation: bounds(".floating-tab-switcher"),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(geometry.mode).toBe("popout");
  expect(geometry.root).toMatchObject({ width: 900, height: 640 });
  expect(geometry.shell).toMatchObject({ width: 900, height: 640 });
  expect(geometry.generator?.width).toBeGreaterThan(480);
  expect(geometry.generator?.width).toBeLessThanOrEqual(720);
  expect(geometry.navigation?.width).toBeGreaterThan(480);
  expect(geometry.navigation?.width).toBeLessThanOrEqual(720);
  expect(Math.abs((geometry.navigation?.x ?? 0) * 2 + (geometry.navigation?.width ?? 0) - 900))
    .toBeLessThanOrEqual(1);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);

  await page.screenshot({
    path: testInfo.outputPath("generator-popout-900x640.png"),
    animations: "disabled",
  });
});

test("intermediate popout centers generator content and navigation without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize(intermediatePopout);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");
  await page.getByRole("button", { name: "生成器", exact: true }).click();
  await expect(page).toHaveURL(/\/tabs\/generator$/);

  const generator = page.locator("bw-official-generator-core");
  await expect(generator).toBeVisible();
  await expect.poll(
    () => generator.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(480);

  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      if (!rect) throw new Error(`Missing geometry target: ${selector}`);
      return {
        width: rect.width,
        centerDelta: Math.abs(rect.left * 2 + rect.width - innerWidth),
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      generator: bounds("bw-official-generator-core"),
      navigation: bounds(".floating-tab-switcher"),
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(geometry.viewport).toEqual(intermediatePopout);
  expect(geometry.generator.width).toBeLessThanOrEqual(720);
  expect(geometry.generator.centerDelta).toBeLessThanOrEqual(1);
  expect(geometry.navigation.width).toBeGreaterThan(480);
  expect(geometry.navigation.width).toBeLessThanOrEqual(720);
  expect(geometry.navigation.centerDelta).toBeLessThanOrEqual(1);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);

  await page.screenshot({
    path: testInfo.outputPath("generator-popout-intermediate-700x620.png"),
    animations: "disabled",
  });
});

test("popout header content stays inside the centered compact work frame", async ({ page }) => {
  await page.setViewportSize(defaultPopout);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");
  await page.getByRole("button", { name: "生成器", exact: true }).click();
  await expect(page).toHaveURL(/\/tabs\/generator$/);

  const generator = page.locator("bw-official-generator-core");
  await expect(generator).toBeVisible();
  await expect.poll(
    () => generator.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(720);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      if (!bounds) throw new Error(`Missing geometry target: ${selector}`);
      return {
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
      };
    };
    return {
      frame: rect("bw-official-generator-core"),
      header: rect(".macos-page-heading"),
      title: rect(".macos-page-heading h1"),
      actions: rect(".macos-page-heading__actions"),
    };
  });

  expect(geometry.frame).toMatchObject({ left: 90, right: 810, width: 720 });
  expect(geometry.header).toMatchObject({ left: 90, right: 810, width: 720 });
  expect(geometry.title.left).toBeGreaterThanOrEqual(geometry.frame.left);
  expect(geometry.actions.right).toBeLessThanOrEqual(geometry.frame.right);
});

test("minimum popup retains the full-width header and 16 point content insets", async ({ page }) => {
  await page.setViewportSize(minimumPopup);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");
  await page.getByRole("button", { name: "生成器", exact: true }).click();
  await expect(page).toHaveURL(/\/tabs\/generator$/);
  await expect(page.locator("bw-official-generator-core")).toBeVisible();
  await expect(page.locator(".macos-page-heading h1")).toHaveText("生成器");

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      if (!bounds) throw new Error(`Missing geometry target: ${selector}`);
      return {
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
      };
    };
    return {
      header: rect(".macos-page-heading"),
      title: rect(".macos-page-heading h1"),
      actions: rect(".macos-page-heading__actions"),
    };
  });

  expect(geometry.header).toMatchObject({ left: 0, right: 480, width: 480 });
  expect(geometry.title.left).toBe(16);
  expect(geometry.actions.right).toBe(464);
});

test("every root tab reflows from default popout width to the 480 point minimum", async ({ page }, testInfo) => {
  await page.setViewportSize(defaultPopout);
  await page.goto("/?vaultEvidence=populated&uilocation=popout");

  for (const tab of rootTabs) {
    const button = page.getByRole("button", { name: tab.label, exact: true });
    await button.click();
    await expect(page).toHaveURL(new RegExp(`${tab.path}$`));
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect.poll(() => rootLayout(page)).toMatchObject({
      rootWidth: 900,
      activePageWidth: 900,
      overflow: 0,
    });
  }

  await page.setViewportSize(minimumPopup);
  for (const tab of rootTabs) {
    const button = page.getByRole("button", { name: tab.label, exact: true });
    await button.click();
    await expect(page).toHaveURL(new RegExp(`${tab.path}$`));
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect.poll(() => rootLayout(page)).toMatchObject({
      rootWidth: 480,
      activePageWidth: 480,
      overflow: 0,
    });
    await expect.poll(
      async () => (await rootLayout(page)).navigationWidth,
    ).toBeLessThanOrEqual(456);

    if (tab.label === "生成器") {
      await page.screenshot({
        path: testInfo.outputPath("generator-popup-480x600.png"),
        animations: "disabled",
      });
    }
  }
});

async function assertSingleFieldFocus(page: Page, inputSelector: string, containerSelector: string): Promise<void> {
  const input = page.locator(inputSelector);
  await input.focus();
  await expect(input).toBeFocused();

  const focusRendering = await input.evaluate((element, selector) => {
    const container = element.closest(selector);
    if (!container) throw new Error(`Missing focus container: ${selector}`);
    const inputStyle = getComputedStyle(element);
    const containerStyle = getComputedStyle(container);
    return {
      inputOutlineStyle: inputStyle.outlineStyle,
      inputOutlineWidth: inputStyle.outlineWidth,
      containerBorderColor: containerStyle.borderColor,
      containerBoxShadow: containerStyle.boxShadow,
    };
  }, containerSelector);

  expect(focusRendering.inputOutlineStyle).toBe("none");
  expect(focusRendering.inputOutlineWidth).toBe("0px");
  expect(`${focusRendering.containerBorderColor} ${focusRendering.containerBoxShadow}`)
    .not.toMatch(/rgba?\(0,\s*0,\s*0,\s*0\).*none/);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${color}`);
  return channels
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((value, channel, index) => value + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}
