import { expect, test, type Page } from "@playwright/test";

const semanticTokenNames = [
  "canvas",
  "surface-solid",
  "surface-raised",
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "border",
  "border-subtle",
  "hover",
  "pressed",
  "selected",
  "focus",
  "disabled",
  "scrim",
  "shadow",
  "destructive",
  "warning",
  "success",
] as const;

test("publishes distinct semantic tokens and fixed popup geometry in light and dark appearances", async ({ page }) => {
  const light = await openAppearance(page, "light");
  const dark = await openAppearance(page, "dark");

  for (const token of semanticTokenNames) {
    expect(light.tokens[token], `light ${token}`).not.toBe("");
    expect(dark.tokens[token], `dark ${token}`).not.toBe("");
    expect(dark.tokens[token], `${token} changes with the appearance`).not.toBe(light.tokens[token]);
  }

  expect(light.fontFamily.startsWith("-apple-system")).toBe(true);
  expect(light.geometry).toEqual({ width: "480px", minHeight: "600px", overflowX: "hidden" });
});

test("applies floating materials and one stronger bottom-sheet material without nesting projected panels", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-transparency", value: "no-preference" },
      { name: "prefers-contrast", value: "no-preference" },
    ],
  });
  await openAppearance(page, "light");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<nav data-testid="macos-navigation" class="macos-glass-navigation">Navigation</nav>
       <menu data-testid="macos-menu" class="macos-glass-menu">Menu</menu>
       <dialog data-testid="macos-sheet" class="app-bottom-sheet" style="pointer-events: none" open>
         <form data-testid="macos-sheet-panel" class="app-bottom-sheet-panel">Sheet</form>
       </dialog>
       <button data-testid="macos-pressable" class="macos-pressable">Press</button>`,
    );
  });
  await expect(page.getByTestId("macos-sheet")).toHaveCSS("opacity", "1");

  const materialStyles = await page.locator("[data-testid='macos-navigation'], [data-testid='macos-menu'], [data-testid='macos-sheet'], [data-testid='macos-sheet-panel']").evaluateAll(
    (elements) => elements.map((element) => {
      const styles = getComputedStyle(element);
      return {
        backdropFilter: styles.backdropFilter,
        opacity: styles.opacity,
        borderRadius: styles.borderRadius,
      };
    }),
  );
  expect(materialStyles).toEqual([
    expect.objectContaining({ backdropFilter: expect.stringContaining("blur(20px)"), opacity: "1" }),
    expect.objectContaining({ backdropFilter: expect.stringContaining("blur(16px)"), opacity: "1" }),
    expect.objectContaining({ backdropFilter: expect.stringContaining("blur(28px)"), opacity: "1", borderRadius: "16px 16px 0px 0px" }),
    expect.objectContaining({ backdropFilter: "none", opacity: "1", borderRadius: "0px" }),
  ]);

  const pressable = page.getByTestId("macos-pressable");
  await expect(pressable).toHaveCSS("transition-duration", "0.1s, 0.1s, 0.1s");
  await pressable.hover();
  await page.mouse.down();
  await expect(pressable).toHaveCSS("transform", "matrix(0.975, 0, 0, 0.975, 0, 0)");
  await page.mouse.up();
});

test("honors reduced motion for a real pressable, skeleton, and bottom sheet fixture", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAppearance(page, "light");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button data-testid="macos-pressable" class="macos-pressable">Press</button>
       <span data-testid="macos-skeleton" class="vault-skeleton-line"></span>
       <dialog data-testid="macos-sheet" class="app-bottom-sheet" open>
         <section class="app-bottom-sheet-panel">Sheet</section>
       </dialog>`,
    );
  });

  await expect(page.getByTestId("macos-pressable")).toHaveCSS("transition-duration", "0.001s, 0.001s, 0.001s");
  await expect.poll(() => page.getByTestId("macos-skeleton").evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("none");
  await expect(page.getByTestId("macos-sheet")).toHaveCSS("transition-duration", "0.001s");
});

test("uses semantic hover and disabled state colors for dark shared controls", async ({ page }) => {
  await openAppearance(page, "dark");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<span data-testid="semantic-hover" style="background: var(--mac-hover)"></span>
       <span data-testid="semantic-disabled" style="color: var(--mac-disabled)"></span>
       <button data-testid="secondary-action" class="secondary-action">Secondary</button>
       <button data-testid="disabled-secondary-action" class="secondary-action" disabled>Disabled</button>
       <button data-testid="environment-option" class="official-login-environment-option">Environment</button>`,
    );
  });

  const semanticHover = await page.getByTestId("semantic-hover").evaluate((element) => getComputedStyle(element).backgroundColor);
  const semanticDisabled = await page.getByTestId("semantic-disabled").evaluate((element) => getComputedStyle(element).color);
  const secondaryAction = page.getByTestId("secondary-action");
  const environmentOption = page.getByTestId("environment-option");

  await secondaryAction.hover();
  await expect(secondaryAction).toHaveCSS("background-color", semanticHover);
  await environmentOption.hover();
  await expect(environmentOption).toHaveCSS("background-color", semanticHover);
  await expect(page.getByTestId("disabled-secondary-action")).toHaveCSS("color", semanticDisabled);
});

test("honors reduced transparency and increased contrast in real material fixtures", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium CDP controls the macOS media preferences.");
  const session = await page.context().newCDPSession(page);
  await openAppearance(page, "light");
  await addMaterialFixture(page);

  const ordinary = await page.getByTestId("macos-navigation").evaluate((element) => {
    const styles = getComputedStyle(element);
    return { backdropFilter: styles.backdropFilter, background: styles.backgroundColor, border: styles.borderTopColor, color: styles.color };
  });

  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  await expect(page.getByTestId("macos-navigation")).toHaveCSS("backdrop-filter", "none");
  const reducedTransparency = await page.getByTestId("macos-navigation").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(reducedTransparency).not.toBe(ordinary.background);
  expect(reducedTransparency.endsWith(")")).toBe(true);

  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "no-preference" }, { name: "prefers-contrast", value: "more" }],
  });
  const increasedContrast = await page.getByTestId("macos-navigation").evaluate((element) => {
    const styles = getComputedStyle(element);
    return { border: styles.borderTopColor, color: styles.color };
  });
  expect(increasedContrast.border).not.toBe(ordinary.border);
  expect(increasedContrast.color).not.toBe(ordinary.color);
});

test("applies explicit high contrast tokens for the system-dark appearance", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium CDP controls the macOS media preferences.");
  const session = await page.context().newCDPSession(page);
  await openSystemDarkAppearance(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-contrast", value: "more" }],
  });

  const highContrastTokens = await page.locator(":root").evaluate((root) => {
    const styles = getComputedStyle(root);
    return {
      border: styles.getPropertyValue("--mac-border").trim(),
      borderSubtle: styles.getPropertyValue("--mac-border-subtle").trim(),
      textPrimary: styles.getPropertyValue("--mac-text-primary").trim(),
      surfaceRaised: styles.getPropertyValue("--mac-surface-raised").trim(),
    };
  });

  expect(highContrastTokens).toEqual({
    border: "#fff",
    borderSubtle: "#d7d7dc",
    textPrimary: "#fff",
    surfaceRaised: "#1d1d1f",
  });
});

async function openAppearance(page: Page, appearance: "light" | "dark") {
  await page.addInitScript((theme) => {
    localStorage.setItem("barwarden.settings", JSON.stringify({ animations: true, theme }));
  }, appearance);
  await page.emulateMedia({ colorScheme: appearance });
  await page.goto("/?vaultEvidence=populated");
  await expect(page.locator("html")).toHaveAttribute("data-bw-theme", appearance);

  return page.locator(":root").evaluate((root) => {
    const styles = getComputedStyle(root);
    const tokens = Object.fromEntries(
      [
        "canvas", "surface-solid", "surface-raised", "text-primary", "text-secondary", "text-tertiary",
        "border", "border-subtle", "hover", "pressed", "selected", "focus", "disabled", "scrim", "shadow",
        "destructive", "warning", "success",
      ].map((name) => [name, styles.getPropertyValue(`--mac-${name}`).trim()]),
    );
    const popup = document.querySelector("barwarden-root");
    if (!popup) throw new Error("The popup root is missing");
    const popupStyles = getComputedStyle(popup);
    return {
      tokens,
      fontFamily: getComputedStyle(document.body).fontFamily,
      geometry: { width: popupStyles.width, minHeight: popupStyles.minHeight, overflowX: popupStyles.overflowX },
    };
  });
}

async function addMaterialFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<nav data-testid="macos-navigation" class="macos-glass-navigation">Navigation</nav>`,
    );
  });
}

async function openSystemDarkAppearance(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("barwarden.settings", JSON.stringify({ animations: true, theme: "system" }));
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/?vaultEvidence=populated");
  await expect(page.locator("html")).toHaveAttribute("data-bw-theme", "system");
}
