import "zone.js";
import "@angular/compiler";

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogService } from "@bitwarden/components";
import { beforeEach, describe, expect, it } from "vitest";

import { GeneratorPageComponent } from "./generator/generator-page.component";
import { GeneratorService } from "./generator/generator.service";
import { PopupStateStore } from "./popup-state";
import { SendPageComponent } from "./send/send-page.component";
import { SettingsPageComponent } from "./settings/settings-page.component";
import { SettingsService } from "./settings/settings.service";
import { AuthFacade } from "./auth/auth.facade";
import { demoVaultItems } from "./vault-demo";
import { AccountSecurityPageComponent } from "./settings/account-security-page.component";
import { VaultActionsService } from "./vault/vault-actions.service";
import { VaultFacade } from "./vault/vault.facade";
import { VaultListPageComponent } from "./vault/vault-list-page.component";
import { VaultSessionService } from "./vault/vault-session.service";
import { VaultSettingsPageComponent } from "./settings/vault-settings-page.component";
import { OfficialI18nService } from "./official-ui/official-i18n.service";
import { officialCurrentAccountTestProviders } from "./official-ui/official-current-account.test-support";
import { OfficialAccountSwitcherComponent } from "./upstream-overlays/auth/account-switching/official-account-switcher.component";

function officialIconStyles(): string {
  return readFileSync(
    join(
      process.cwd(),
      "vendor/bitwarden-clients/libs/angular/src/scss/bwicons/styles/style.css",
    ),
    "utf8",
  );
}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

function frontendTemplateSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return frontendTemplateSources(path);
    }

    if (
      !entry.name.endsWith(".html") &&
      (!entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts"))
    ) {
      return [];
    }

    return [readFileSync(path, "utf8")];
  });
}

function cssDeclarations(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const selectorMatch = new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{`, "u").exec(css);
  expect(selectorMatch?.index ?? -1).toBeGreaterThanOrEqual(0);
  const blockStart = css.indexOf("{", selectorMatch!.index);
  const blockEnd = css.indexOf("}", blockStart);
  return css.slice(blockStart + 1, blockEnd);
}

function installVisualCss(...paths: readonly string[]): () => void {
  const style = document.createElement("style");
  const source = paths
    .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const macTokens = new Map(
    [...rootDeclarations.matchAll(/(--mac-[\w-]+):\s*([^;]+);/g)]
      .map(([, token, value]) => [token, value.trim()]),
  );
  style.textContent = source.replace(/var\((--mac-[\w-]+)\)/g, (reference, token) =>
    macTokens.get(token) ?? reference,
  );
  document.head.append(style);
  return () => style.remove();
}

describe("popup visual smoke classes", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideNoopAnimations(), ...officialCurrentAccountTestProviders()],
    });
  });

  it("resolves the approved luminous palette and semantic field colors", () => {
    const cleanup = installVisualCss("apps/menubar-tauri/src/styles/macos-tokens.css");
    const root = document.documentElement;
    root.setAttribute("data-bw-window", "popout");
    root.removeAttribute("data-bw-theme");
    const style = getComputedStyle(root);

    expect(style.getPropertyValue("--mac-canvas").trim()).toBe("#f4f8ff");
    expect(style.getPropertyValue("--mac-surface-solid").trim()).toBe("#fbfdff");
    expect(style.getPropertyValue("--mac-surface-contextual").trim()).toBe("#eaf2ff");
    expect(style.getPropertyValue("--mac-text-primary").trim()).toBe("#111827");
    expect(style.getPropertyValue("--mac-text-secondary").trim()).toBe("#536784");
    expect(style.getPropertyValue("--mac-action-username").trim()).toBe("#0a66ff");
    expect(style.getPropertyValue("--mac-action-password").trim()).toBe("#6657d9");
    expect(style.getPropertyValue("--mac-action-totp").trim()).toBe("#e98a15");
    expect(style.getPropertyValue("--mac-control-min-size").trim()).toBe("44px");

    root.removeAttribute("data-bw-window");
    cleanup();
  });

  it("uses unboxed semantic field glyphs inside 44px action targets", () => {
    const cleanup = installVisualCss(
      "apps/menubar-tauri/src/styles/macos-tokens.css",
      "apps/menubar-tauri/src/styles/global.css",
    );
    const row = document.createElement("bit-item");
    row.className = "vault-list-row";
    row.innerHTML = `
      <bit-item-action><button biticonbutton data-field="username"><i class="bwi"></i></button></bit-item-action>
      <bit-item-action><button biticonbutton data-field="password"><i class="bwi"></i></button></bit-item-action>
      <bit-item-action><button biticonbutton data-field="totp"><i class="bwi"></i></button></bit-item-action>
    `;
    document.body.append(row);

    const username = row.querySelector<HTMLElement>('[data-field="username"]')!;
    const usernameGlyph = username.querySelector<HTMLElement>(".bwi")!;
    const passwordGlyph = row.querySelector<HTMLElement>('[data-field="password"] .bwi')!;
    const totpGlyph = row.querySelector<HTMLElement>('[data-field="totp"] .bwi')!;
    const target = getComputedStyle(username);

    expect(target.width).toBe("44px");
    expect(target.minWidth).toBe("44px");
    expect(target.height).toBe("44px");
    expect(target.borderTopWidth).toBe("0px");
    expect(target.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(usernameGlyph).color).toBe("rgb(10, 102, 255)");
    expect(getComputedStyle(passwordGlyph).color).toBe("rgb(102, 87, 217)");
    expect(getComputedStyle(totpGlyph).color).toBe("rgb(233, 138, 21)");

    row.remove();
    cleanup();
  });

  it("defines a solid dark surface ladder and brighter semantic actions", () => {
    const cleanup = installVisualCss("apps/menubar-tauri/src/styles/macos-tokens.css");
    const root = document.documentElement;
    root.setAttribute("data-bw-window", "popout");
    root.setAttribute("data-bw-theme", "dark");
    const style = getComputedStyle(root);

    expect(style.getPropertyValue("--mac-canvas").trim()).toBe("#101621");
    expect(style.getPropertyValue("--mac-surface-solid").trim()).toBe("#151d2a");
    expect(style.getPropertyValue("--mac-surface-contextual").trim()).toBe("#1a2638");
    expect(style.getPropertyValue("--mac-action-username").trim()).toBe("#4c8dff");
    expect(style.getPropertyValue("--mac-action-password").trim()).toBe("#9b8cff");
    expect(style.getPropertyValue("--mac-action-totp").trim()).toBe("#ffb454");

    root.removeAttribute("data-bw-theme");
    root.removeAttribute("data-bw-window");
    cleanup();
  });

  it("uses the official default popup dimensions and application icon in Tauri configuration", () => {
    const iconStyles = officialIconStyles();
    const tauriConfig = JSON.parse(
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as {
      app: { windows: Array<{ label: string; width: number; height: number; minHeight: number }> };
      bundle: { icon?: string[] };
    };

    expect(iconStyles).toMatch(/\.bwi-ellipsis-v:before\s*{[^}]*content:\s*"\\f127";/s);
    expect(iconStyles).toMatch(/\.bwi-close:before\s*{[^}]*content:\s*"\\f153";/s);
    expect(tauriConfig.app.windows.find((window) => window.label === "main")).toMatchObject({
      width: 480,
      height: 600,
      minHeight: 600,
    });
    expect(tauriConfig.bundle.icon).toEqual(["icons/icon.icns"]);
    const applicationIcon = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src-tauri/icons/icon.icns"),
    );
    expect(createHash("sha256").update(applicationIcon).digest("hex")).toBe(
      "853661e0b6faa1e62e53beebf0ab0bef6c3d87be63f56ae945a83591beab3fc9",
    );
  });

  it("clips the transparent native popup to the Apple window radius", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const rootTokens = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"),
      "utf8",
    );
    const root = cssDeclarations(globalCss, "barwarden-root");
    const canvas = globalCss.match(/html,\s*body\s*{([^}]*)}/s)?.[1];

    expect(rootTokens).toContain("--mac-window-radius: 14px;");
    expect(root).toContain("border-radius: var(--mac-window-radius);");
    expect(root).toContain("overflow: hidden;");
    expect(root).toContain("contain: paint;");
    expect(canvas).toContain("background: transparent;");
  });

  it("uses one visible, continuous material surface for menu-bar and popout auth routes", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const rootTokens = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"),
      "utf8",
    );

    expect(rootTokens).toContain("--mac-popup-material: #f4f8ff;");
    expect(globalCss).toMatch(
      /:root:not\(\[data-bw-window="popout"\]\) barwarden-root\s*{[^}]*background:\s*var\(--mac-popup-material\);/s,
    );
    expect(globalCss).toMatch(
      /popup-page > main,[\s\S]*?background:\s*transparent !important;/,
    );
    expect(rootTokens).toContain("--mac-auth-background: #f4f8ff;");
  });

  it("uses a paint-only 2px glass scrollbar without scroll-time backdrop recomposition", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toMatch(
      /:where\(\*\)\s*{[^}]*scrollbar-color:\s*rgb\(82 99 126 \/ 52%\) transparent;[^}]*scrollbar-width:\s*thin;/s,
    );
    expect(globalCss).toMatch(
      /:where\(\*\)::\-webkit-scrollbar\s*{[^}]*width:\s*2px;[^}]*height:\s*2px;/s,
    );
    expect(globalCss).toMatch(
      /:where\(\*\)::\-webkit-scrollbar-track\s*{[^}]*background:\s*transparent;/s,
    );
    const thumb = cssDeclarations(globalCss, ":where(*)::-webkit-scrollbar-thumb");
    expect(thumb).toContain("background: linear-gradient(");
    expect(thumb).not.toContain("backdrop-filter");
  });

  it("blurs routed content behind the floating navigation glass", () => {
    const materialCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/macos-materials.css"),
      "utf8",
    );
    const navigation = cssDeclarations(materialCss, ".macos-glass-navigation");

    expect(navigation).toContain("backdrop-filter: saturate(1.25) blur(16px);");
    expect(navigation).toContain("-webkit-backdrop-filter: saturate(1.25) blur(16px);");
  });

  it("keeps the settings group canvas transparent while retaining solid setting rows", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    )
      .replace(/^@import[^;]+;\s*/gm, "")
      .replaceAll("var(--mac-surface-solid)", "rgb(255, 255, 255)");
    document.head.append(style);

    const page = document.createElement("div");
    page.className = "macos-page macos-page--settings";
    const group = document.createElement("bit-item-group");
    const item = document.createElement("bit-item");
    group.append(item);
    page.append(group);
    document.body.append(page);

    expect(getComputedStyle(group).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(item).backgroundColor).toBe("rgb(255, 255, 255)");

    page.remove();
    style.remove();
  });

  it("keeps detail layout wrappers transparent and reserves cards for leaf content", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const detailPage = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts"),
      "utf8",
    );
    const wrapper = cssDeclarations(globalCss, ".macos-page--vault-detail .cipher-view");

    expect(detailPage).toContain('<div class="cipher-view">');
    expect(detailPage).not.toContain('class="cipher-view macos-card"');
    expect(wrapper).toContain("background: transparent;");
    expect(wrapper).toContain("border: 0;");
    expect(wrapper).toContain("box-shadow: none;");
  });

  it("uses a shared translucent material for persistent page action bars", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const footer = cssDeclarations(globalCss, "popup-page > popup-footer > footer");

    expect(footer).toContain("background: color-mix(in srgb, var(--mac-surface-raised) 78%, transparent) !important;");
    expect(footer).toContain("backdrop-filter: saturate(1.25) blur(18px);");
    expect(footer).toContain("box-shadow: 0 -8px 20px");
    expect(globalCss).toMatch(
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?popup-page\s*>\s*popup-footer\s*>\s*footer\s*{[^}]*background:\s*var\(--mac-surface-solid\) !important;[^}]*backdrop-filter:\s*none;/s,
    );
  });

  it("does not stack opaque utility backgrounds inside Send success or vault form cards", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const sendCreated = cssDeclarations(globalCss, ".macos-page--send-created .tw-bg-background-alt");
    const customFields = cssDeclarations(
      globalCss,
      ".macos-page--vault-form [data-testid=\"custom-fields\"] > .tw-bg-background,\n.macos-page--vault-form [data-testid=\"custom-fields\"] > .tw-bg-background-alt",
    );

    expect(sendCreated).toContain("background: transparent !important;");
    expect(customFields).toContain("background: transparent !important;");
    expect(customFields).toContain("border-radius: 0 !important;");
  });

  it("scopes the responsive canvas to marked popout windows", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toMatch(
      /:root\[data-bw-window="popout"\]\s+barwarden-root\s*{[^}]*width:\s*100vw;/s,
    );
    expect(cssDeclarations(globalCss, "barwarden-root"))
      .toContain("width: var(--bw-popup-width);");
  });

  it("shows an accessible startup state while session restoration is pending", () => {
    const index = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/index.html"),
      "utf8",
    );
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const loading = cssDeclarations(globalCss, ".app-bootstrap-loading");

    expect(index).toMatch(
      /<barwarden-root>\s*<div class="app-bootstrap-loading" role="status" aria-live="polite">/,
    );
    expect(index).toContain("<strong>Barwarden</strong>");
    expect(index).toContain("<span>正在启动…</span>");
    expect(loading).toContain("place-items: center;");
    expect(loading).toContain("min-height: var(--bw-popup-height);");
  });

  it("lets official field containers own the single 2px focus ring", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toMatch(
      /bit-form-field \[bitfieldcontainer\]:has\(:focus-visible\),[\s\S]*?outline-width:\s*var\(--mac-focus-ring-width\);[\s\S]*?outline-style:\s*solid;/,
    );
    expect(globalCss).toMatch(
      /bit-form-field \[bitfieldcontainer\] :is\(input, select, textarea\):focus-visible,[\s\S]*?outline-width:\s*0 !important;[\s\S]*?outline-style:\s*none !important;/,
    );
    expect(globalCss).not.toMatch(/box-shadow:\s*0 0 0 3px[^;]*--mac-focus/);
  });

  it("applies the official button preflight before Tailwind component utilities", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toMatch(
      /button\s*{[^}]*padding:\s*0;[^}]*border:\s*0 solid transparent;[^}]*background-color:\s*transparent;[^}]*background-image:\s*none;[^}]*color:\s*inherit;/s,
    );
  });

  it("keeps the router outlet anchor out of the popup scroll layout", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toMatch(
      /\.popup-tab-scroll-host\s*>\s*router-outlet\s*{[^}]*display:\s*none;/s,
    );
    expect(globalCss).toMatch(
      /\.popup-tab-scroll-host\s*>\s*router-outlet\s*\+\s*\*\s*{[^}]*height:\s*100%;/s,
    );
    expect(globalCss).not.toMatch(
      /\.popup-tab-scroll-host\s*>\s*\*\s*{[^}]*height:\s*100%;/s,
    );
    expect(globalCss).toMatch(
      /barwarden-root\s*>\s*router-outlet\s*{[^}]*display:\s*none;/s,
    );
    expect(globalCss).toMatch(
      /barwarden-root\s*>\s*router-outlet\s*\+\s*\*\s*{[^}]*height:\s*100%;/s,
    );
    expect(globalCss).toMatch(
      /popup-header,\s*popup-footer\s*{[^}]*display:\s*block;/s,
    );
    expect(globalCss).not.toContain(".popup-page-header");
    expect(globalCss).not.toContain(".popup-page-above-scroll");
    expect(globalCss).not.toContain(".popup-page-footer");
  });

  it("lays out the floating tab switcher over the popup canvas instead of reserving a footer", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const switcher = cssDeclarations(globalCss, ".floating-tab-switcher");
    const segment = cssDeclarations(globalCss, ".floating-tab-switcher__segment");
    const icon = cssDeclarations(globalCss, ".floating-tab-switcher__icon");
    const label = cssDeclarations(globalCss, ".floating-tab-switcher__label");
    const indicator = cssDeclarations(globalCss, ".floating-tab-switcher__indicator");

    expect(switcher).toContain("position: absolute;");
    expect(switcher).toContain("right: 14px;");
    expect(switcher).toContain("bottom: 13px;");
    expect(switcher).toContain("left: 14px;");
    expect(switcher).toContain("height: var(--mac-tabbar-height);");
    expect(switcher).toContain("min-height: var(--mac-tabbar-height);");
    expect(switcher).toContain("padding: 4px 8px;");
    expect(switcher).toContain("border-radius: 12px 12px 0 0;");
    expect(switcher).toContain("grid-template-columns: repeat(var(--segment-count), minmax(0, 1fr));");
    expect(segment).toContain("grid-template-rows: auto auto;");
    expect(segment).toContain("min-height: var(--mac-hit-size);");
    expect(icon).toContain("font-size: 18px;");
    expect(label).toContain("font-size: 10.5px;");
    expect(indicator).toContain("background: var(--mac-selected);");
    expect(indicator).toContain("box-shadow: none;");
    expect(indicator).toContain("transform: translateX(calc(var(--selected-index) * 100%));");
    expect(indicator).toContain("transition: transform var(--mac-motion-navigation)");
    expect(globalCss).not.toContain("padding-bottom: calc(58px + 13px + var(--mac-space-5));");
    expect(switcher).toContain("isolation: isolate;");
  });

  it("uses the application accent for the selected tab icon and label", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const selected = cssDeclarations(
      globalCss,
      '.floating-tab-switcher__segment[aria-current="page"]',
    );

    expect(selected).toContain("color: var(--mac-accent);");
  });

  it("lays out page headings as a symmetric leading/title/trailing grid", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    const heading = cssDeclarations(globalCss, ".macos-page-heading");
    const title = cssDeclarations(globalCss, "popup-header > header h1");
    const actions = cssDeclarations(globalCss, ".macos-page-heading__actions");

    expect(heading).toContain("display: grid;");
    expect(heading).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);");
    expect(heading).toContain("width: 100%;");
    expect(title).toContain("font-size: 17px;");
    expect(title).toContain("line-height: 22px;");
    expect(title).toContain("font-weight: 650;");
    expect(title).toContain("letter-spacing: -0.01em;");
    expect(title).toContain("text-align: center;");
    expect(actions).toContain("display: flex;");
    expect(actions).toContain("grid-column: 3;");
    expect(actions).toContain("justify-self: end;");
  });

  it("centers official popup titles without painting a toolbar band", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const header = cssDeclarations(globalCss, "popup-header > header");
    const title = cssDeclarations(globalCss, "popup-header > header h1");

    expect(header).toContain("background: transparent !important;");
    expect(header).toContain("border-color: transparent !important;");
    expect(header).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);");
    expect(title).not.toContain("position: absolute;");
    expect(title).not.toContain("transform:");
  });

  it("uses one responsive form-field geometry and state vocabulary", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toContain("--mac-form-control-height: 40px;");
    expect(globalCss).toContain("--mac-form-control-radius: 10px;");
    expect(globalCss).toContain(
      ":is(.macos-field, .form-field, .send-form-field, .cipher-form-field)",
    );
    expect(globalCss).toContain("min-height: var(--mac-form-control-height);");
    expect(globalCss).toContain("border-radius: var(--mac-form-control-radius);");
    expect(globalCss).toContain(':is(input, select, textarea)[aria-invalid="true"]');
    expect(globalCss).toContain(":is(input, select, textarea):disabled");
    expect(globalCss).toContain(":is(input, select, textarea)[readonly]");
    expect(globalCss).not.toMatch(
      /\.(?:form-field|send-form-field) (?:input|select)[\s\S]*?min-height:\s*38px;/,
    );
    expect(globalCss).not.toMatch(
      /\.cipher-form-control (?:input|select|textarea)[\s\S]*?border-radius:\s*6px;/,
    );
  });

  it("resolves the final retained auth field geometry to the shared 40px by 10px token", () => {
    const style = document.createElement("style");
    style.textContent = [
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"),
        "utf8",
      ),
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
        "utf8",
      )
        .replace(/^@import[^;]+;\s*/gm, "")
        // jsdom intentionally leaves custom properties unresolved in getComputedStyle.
        // Substitute the declared token values so this still exercises the real cascade.
        .replaceAll("var(--mac-form-control-height)", "40px")
        .replaceAll("var(--mac-form-control-radius)", "10px"),
    ].join("\n");
    document.head.append(style);
    const field = document.createElement("div");
    field.className = "macos-field";
    const container = document.createElement("div");
    container.setAttribute("bitfieldcontainer", "");
    field.append(container);
    document.body.append(field);

    const computed = getComputedStyle(container);

    expect(computed.minHeight).toBe("40px");
    expect(computed.borderRadius).toBe("10px");

    field.remove();
    style.remove();
  });

  it("delegates Vault row sizing to the pinned official item primitives", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const officialItem = readFileSync(
      join(
        process.cwd(),
        "vendor/bitwarden-clients/libs/components/src/item/item.component.ts",
      ),
      "utf8",
    );
    const officialItemContent = readFileSync(
      join(
        process.cwd(),
        "vendor/bitwarden-clients/libs/components/src/item/item-content.component.ts",
      ),
      "utf8",
    );

    expect(globalCss).not.toMatch(/\.vault-item-row\s*{/);
    expect(globalCss).toMatch(
      /\.cdk-virtual-scroll-content-wrapper\s*{[^}]*width:\s*100%;/s,
    );
    expect(officialItem).toContain("tw-min-h-9 tw-mb-1.5 bit-compact:tw-mb-0");
    expect(officialItemContent).toContain("bit-compact:tw-py-1.5 bit-compact:tw-px-2");
  });

  it("styles the Vault hierarchy as one continuous native surface with a title-bar add control", () => {
    const cleanup = installVisualCss(
      "apps/menubar-tauri/src/styles/macos-tokens.css",
      "apps/menubar-tauri/src/styles/global.css",
    );
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const motionCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/macos-motion.css"),
      "utf8",
    );
    const header = cssDeclarations(globalCss, ".vault-root-header");
    const title = cssDeclarations(globalCss, ".vault-root-header__title");
    const hierarchy = cssDeclarations(globalCss, ".vault-hierarchy");
    const node = cssDeclarations(globalCss, ".vault-hierarchy__node");
    const content = cssDeclarations(globalCss, ".vault-hierarchy__content");
    const openContent = cssDeclarations(globalCss, ".vault-hierarchy__content.is-open");
    const headerAdd = cssDeclarations(
      globalCss,
      ":is(.header-actions, .macos-page-heading__actions) > bw-retained-new-item-dropdown app-new-item-dropdown > button[bitbutton]",
    );
    const headerAddContent = cssDeclarations(
      globalCss,
      ":is(.header-actions, .macos-page-heading__actions) > bw-retained-new-item-dropdown app-new-item-dropdown > button[bitbutton] > span > span",
    );
    const headerAddLabel = cssDeclarations(
      globalCss,
      ":is(.header-actions, .macos-page-heading__actions) > bw-retained-new-item-dropdown app-new-item-dropdown > button[bitbutton] > span > span > div",
    );
    const headerAddIcon = cssDeclarations(
      globalCss,
      ":is(.header-actions, .macos-page-heading__actions) > bw-retained-new-item-dropdown app-new-item-dropdown > button[bitbutton] .bwi",
    );
    const vault = document.createElement("div");
    vault.innerHTML = `
      <div class="vault-root-header__search"></div>
      <button class="vault-hierarchy__trigger" aria-expanded="true"></button>
      <div class="vault-hierarchy__items">
        <bit-item-group>
          <bit-item class="vault-list-row"></bit-item>
          <bit-item class="vault-list-row"></bit-item>
        </bit-item-group>
      </div>
      <div class="vault-hierarchy__children">
        <button class="vault-hierarchy__child macos-pressable" aria-expanded="true"></button>
      </div>
      <div class="vault-hierarchy__content">
        <p class="vault-hierarchy__empty"></p>
      </div>
    `;
    document.body.append(vault);

    const search = vault.querySelector<HTMLElement>(".vault-root-header__search")!;
    const trigger = vault.querySelector<HTMLElement>(".vault-hierarchy__trigger")!;
    const group = vault.querySelector<HTMLElement>("bit-item-group")!;
    const row = vault.querySelector<HTMLElement>(".vault-list-row")!;
    const childTrigger = vault.querySelector<HTMLElement>(".vault-hierarchy__child")!;
    const empty = vault.querySelector<HTMLElement>(".vault-hierarchy__empty")!;

    expect(header).toContain("display: grid;");
    expect(header).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);",
    );
    expect(title).toContain("text-align: center;");
    expect(getComputedStyle(search).minHeight).toBe("44px");
    expect(getComputedStyle(search).borderRadius).toBe("12px");
    expect(getComputedStyle(search).backgroundColor).toBe("rgb(234, 242, 255)");
    expect(getComputedStyle(search).boxShadow).toBe("none");
    expect(getComputedStyle(trigger).minHeight).toBe("44px");
    expect(getComputedStyle(trigger).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(trigger).borderTopWidth).toBe("0px");
    expect(getComputedStyle(group).borderTopWidth).toBe("0px");
    expect(getComputedStyle(group).borderRadius).toBe("0px");
    expect(getComputedStyle(row).minHeight).toBe("52px");
    expect(getComputedStyle(row).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(row).borderRadius).toBe("0px");
    expect(getComputedStyle(row).boxShadow).toBe("none");
    expect(getComputedStyle(childTrigger).minHeight).toBe("44px");
    expect(getComputedStyle(empty).borderTopWidth).toBe("0px");
    expect(getComputedStyle(empty).borderBottomWidth).toBe("0px");
    expect(getComputedStyle(empty).borderRadius).toBe("0px");
    expect(getComputedStyle(empty).boxShadow).toBe("none");
    expect(globalCss).toMatch(
      /popup-page\s*>\s*main\s*>\s*div:has\(bw-root-search\),[\s\S]*?popup-page\s*>\s*main\s*>\s*div:has\(bit-search\)\s*{[^}]*padding-block:\s*var\(--mac-space-2\) !important;/,
    );
    expect(globalCss).toMatch(
      /div:has\(bw-root-search\)\s*\+\s*\[data-testid="popup-layout-scroll-region"\],[\s\S]*?div:has\(bit-search\)\s*\+\s*\[data-testid="popup-layout-scroll-region"\]\s*{[^}]*padding-top:\s*var\(--mac-space-2\) !important;/,
    );
    expect(hierarchy).toContain("display: flex;");
    expect(hierarchy).toContain("flex-direction: column;");
    expect(node).toContain("display: block;");
    expect(node).toContain("flex: 0 0 auto;");
    expect(motionCss).toContain("--mac-motion-standard: 180ms;");
    expect(motionCss).toContain("--mac-disclosure-motion: var(--mac-motion-standard);");
    expect(motionCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition:\s*none !important;/,
    );
    expect(content).toContain("display: none;");
    expect(content).toContain("transform: translateY(-4px);");
    expect(content).toContain("transition:");
    expect(content).toContain(
      "display 0s var(--mac-disclosure-motion) allow-discrete;",
    );
    expect(openContent).toContain("display: block;");
    expect(openContent).toContain("transform: translateY(0);");
    expect(globalCss).toMatch(
      /@starting-style\s*{[\s\S]*\.vault-hierarchy__content\.is-open,[\s\S]*opacity:\s*0;[\s\S]*transform:\s*translateY\(-4px\);/,
    );
    expect(globalCss).toMatch(
      /\.vault-hierarchy__content\s*>\s*\*\s*{[^}]*overflow:\s*visible;/s,
    );
    expect(globalCss).toMatch(
      /bw-vault-hierarchy,[\s\S]*app-vault-list-items-container,[\s\S]*bw-retained-new-item-dropdown\s*{\s*display:\s*block;/,
    );
    expect(globalCss).not.toContain(".vault-progressive-loading");
    expect(headerAdd).toContain("width: 44px;");
    expect(headerAdd).toContain("height: 44px;");
    expect(headerAdd).toContain("border-radius: 999px;");
    expect(headerAdd).toContain("place-items: center;");
    expect(headerAdd).toContain("font-size: 0;");
    expect(headerAddContent).toContain("gap: 0 !important;");
    expect(headerAddLabel).toContain("display: none;");
    expect(headerAddIcon).toContain("transform: translateY(1px);");

    vault.remove();
    cleanup();
  });

  it("keeps retained fade content visible after native route transitions", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const fadeHost = cssDeclarations(globalCss, "vault-fade-in-out");

    expect(fadeHost).toContain("display: block;");
    expect(fadeHost).toContain("opacity: 1 !important;");
  });

  it("keeps Vault row selection and context menus visually coherent", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const menu = cssDeclarations(globalCss, '.bit-menu-panel [role="menu"]');
    const item = cssDeclarations(
      globalCss,
      ".macos-list app-retained-vault-list-item > bit-item.is-menu-open",
    );
    const content = cssDeclarations(
      globalCss,
      '.macos-list app-retained-vault-list-item [data-testid="vault-item-content"]',
    );
    const danger = cssDeclarations(
      globalCss,
      '.bit-menu-panel [role="menu"] [role="menuitem"].tw-text-fg-danger',
    );
    const hierarchySelection = cssDeclarations(
      globalCss,
      ".vault-hierarchy__items .vault-list-row:focus-within",
    );
    const menuTriggerSource = readFileSync(
      join(
        process.cwd(),
        "apps/menubar-tauri/official-components-overlay/menu/menu-trigger-for.directive.ts",
      ),
      "utf8",
    );

    expect(menu).toContain("min-width: 156px;");
    expect(menu).toContain("border-radius: 12px;");
    expect(menu).toContain("box-shadow:");
    expect(menu).toContain("animation-name: macos-menu-appear;");
    expect(menu).toContain("animation-duration: var(--mac-motion-fast);");
    expect(menu).toContain("animation-timing-function: ease-out;");
    expect(globalCss).toMatch(
      /\.bit-menu-panel--closing \[role="menu"\][\s\S]*?animation-name:\s*macos-menu-disappear;[\s\S]*?animation-duration:\s*var\(--mac-motion-fast\);[\s\S]*?animation-fill-mode:\s*forwards;/,
    );
    expect(globalCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.bit-menu-panel \[role="menu"\][\s\S]*?animation:\s*none/,
    );
    expect(danger).toContain("border-top: 1px solid var(--mac-border-subtle);");
    expect(item).toContain("border-color: color-mix(");
    expect(content).toContain("background: transparent !important;");
    expect(hierarchySelection).toContain("background: var(--mac-selected);");
    expect(globalCss).not.toContain(
      ".vault-hierarchy__items .vault-list-row:focus-within::after",
    );
    expect(menu).not.toContain("transform-origin: top right;");
    expect(menuTriggerSource).toContain('.withTransformOriginOn(\'[role="menu"]\')');
    expect(menuTriggerSource).toContain("const MENU_CLOSE_MOTION_MS = 160;");
    expect(menuTriggerSource).toContain("setTimeout(() => this.finishClose(), MENU_CLOSE_MOTION_MS)");
  });

  it("keeps the continuous Vault list's final-row separator removal scoped to item groups", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const nestedGroup = cssDeclarations(
      globalCss,
      ".vault-hierarchy__children .vault-hierarchy__child-content .vault-hierarchy__items bit-item-group",
    );
    const directLastRow = cssDeclarations(
      globalCss,
      ".vault-hierarchy__items bit-item-group > .vault-list-row:last-child",
    );
    const wrappedLastRow = cssDeclarations(
      globalCss,
      ".vault-hierarchy__items bit-item-group app-retained-vault-list-item:last-child > .vault-list-row",
    );

    expect(globalCss).not.toContain(
      ".vault-hierarchy__node:has(> .vault-hierarchy__content) > .vault-hierarchy__trigger",
    );
    expect(nestedGroup).toContain("border-radius: 0;");
    expect(nestedGroup).toContain("border: 0;");
    expect(directLastRow).toContain("border-bottom: 0;");
    expect(wrappedLastRow).toContain("border-bottom: 0;");
    expect(globalCss).not.toContain(".vault-hierarchy__items .vault-list-row:last-child {");
  });

  it("uses one continuous responsive form-field surface and compact auth errors", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const field = cssDeclarations(globalCss, ".macos-field [bitfieldcontainer]");
    const input = cssDeclarations(globalCss, ".macos-field [bitfieldcontainer] input");
    const callout = cssDeclarations(
      globalCss,
      ".macos-auth-validation bit-callout .macos-alert-strip",
    );

    expect(field).toContain("overflow: hidden;");
    expect(field).toContain("background: var(--mac-surface-solid) !important;");
    expect(input).toContain("background: transparent !important;");
    expect(callout).toContain("padding: 10px 12px !important;");
    expect(callout).toContain("border-radius: 10px;");
  });

  it("anchors startup recovery inside the rounded application window", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const root = cssDeclarations(globalCss, "barwarden-root");
    const host = cssDeclarations(globalCss, ".app-startup-alert");
    const toast = cssDeclarations(
      globalCss,
      '.app-startup-alert .macos-alert-strip[data-presentation="toast"]',
    );

    expect(root).toContain("position: relative;");
    expect(host).toContain("position: absolute;");
    expect(host).toContain("right: 16px;");
    expect(host).toContain("bottom: 16px;");
    expect(host).toContain("max-height: calc(100% - 32px);");
    expect(toast).toContain("position: static;");
    expect(toast).toContain("width: 100%;");
  });

  it("presents app updates as a compact native card and anchored global notice", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const card = cssDeclarations(globalCss, ".app-update-card");
    const header = cssDeclarations(globalCss, ".app-update-card__header");
    const actions = cssDeclarations(globalCss, ".app-update-card__actions");
    const notice = cssDeclarations(globalCss, ".app-update-notice");

    expect(card).toContain("border: 1px solid var(--mac-border-subtle);");
    expect(card).toContain("border-radius: var(--mac-row-radius);");
    expect(card).toContain("background: var(--mac-surface-solid);");
    expect(header).toContain("display: flex;");
    expect(actions).toContain("justify-content: flex-end;");
    expect(notice).toContain("position: absolute;");
    expect(notice).toContain("pointer-events: auto;");
    expect(globalCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-update-card progress/u,
    );
    expect(globalCss).toMatch(
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.app-update-notice/u,
    );
    expect(globalCss).toMatch(
      /@media \(prefers-contrast: more\)[\s\S]*?\.app-update-card/u,
    );
  });

  it("anchors global feedback in the application window and keeps its close control clickable", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const feedback = cssDeclarations(globalCss, ".app-feedback");
    const dismiss = cssDeclarations(globalCss, ".app-feedback__dismiss");

    expect(feedback).toContain("position: absolute;");
    expect(dismiss).toContain("pointer-events: auto;");
  });

  it("keeps the Send empty state compact and attached to its action", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const empty = cssDeclarations(
      globalCss,
      '.macos-page--send [data-testid="popup-layout-scroll-region"] > .tw-h-full',
    );

    expect(empty).toContain("height: auto !important;");
    expect(empty).toContain("justify-content: flex-start !important;");
    expect(empty).toContain("padding-block: var(--mac-space-5);");
  });

  it("styles OTP codes as a grouped native list with readable countdown controls", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const list = cssDeclarations(globalCss, ".otp-page__list");
    const row = cssDeclarations(globalCss, ".otp-code-row");
    const code = cssDeclarations(globalCss, ".otp-code-row__code");
    const countdown = cssDeclarations(globalCss, ".otp-code-row__countdown");
    const compactRow = cssDeclarations(globalCss, "body.tw-bit-compact .otp-code-row");
    const tokens = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"),
      "utf8",
    );

    expect(list).toContain("border-radius: 0;");
    expect(list).toContain("background: var(--mac-surface-solid);");
    expect(list).toContain("box-shadow: none;");
    expect(row).toContain("min-height: var(--mac-row-height);");
    expect(row).toContain("border-radius: 0;");
    expect(row).toContain("box-shadow: none;");
    expect(row).toContain("grid-template-columns: 28px minmax(0, 1fr) auto auto;");
    expect(compactRow).toContain("min-height: var(--mac-compact-row-height);");
    expect(tokens).toContain("--mac-row-height: 52px;");
    expect(tokens).toContain("--mac-compact-row-height: 44px;");
    expect(code).toContain("font-family: ui-monospace");
    expect(code).toContain("font-size: 18px;");
    expect(countdown).toContain("width: 32px;");
    expect(countdown).toContain("height: 32px;");
  });

  it("slides application sheets fully from the bottom and removes the redundant close glyph", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const sheet = cssDeclarations(globalCss, ".app-bottom-sheet");
    const moving = [...globalCss.matchAll(
      /\.app-bottom-sheet\[data-state="opening"\],\s*\.app-bottom-sheet\[data-state="closing"\]\s*{([^}]*)}/gs,
    )].map((match) => match[1]);

    expect(sheet).toContain("transform: translateY(100%);");
    expect(sheet).toContain("transition:");
    expect(moving.some((declarations) => declarations.includes("transform: translateY(100%);")))
      .toBe(true);
    expect(globalCss).toMatch(
      /\.app-bottom-sheet button:has\(\.bwi-close\)\s*{[^}]*display:\s*none;/s,
    );
  });

  it("uses only the explicit Bitwarden search reset control", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toMatch(
      /\.search-row input\[type="search"\]::\-webkit-search-cancel-button\s*{[^}]*appearance:\s*none;/s,
    );
  });

  it("styles collection assignment as an official popup card and compact option list", () => {
    const globalCss = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(globalCss).toMatch(
      /\.assign-collections-card\s*{[^}]*border:\s*1px solid var\(--bw-border-subtle\);[^}]*border-radius:\s*8px;/s,
    );
    expect(globalCss).toMatch(
      /\.assign-collection-option\s*{[^}]*display:\s*grid;[^}]*min-height:\s*44px;/s,
    );
    expect(globalCss).toMatch(
      /\.assign-collections-read-only\s*{[^}]*border-top:\s*1px solid var\(--bw-border\);/s,
    );
  });

  it("maps every Bitwarden icon used by production templates to a bundled glyph", () => {
    const sourceRoot = join(process.cwd(), "apps/menubar-tauri/src");
    const iconStyles = officialIconStyles();
    const usedIcons = new Set(
      frontendTemplateSources(sourceRoot).flatMap(
        (source) => source.match(/\bbwi-[a-z0-9-]+\b/g) ?? [],
      ),
    );
    usedIcons.delete("bwi-spin");
    usedIcons.delete("bwi-lg");
    usedIcons.delete("bwi-fw");
    usedIcons.delete("bwi-sm");
    usedIcons.delete("bwi-3x");
    const mappedIcons = new Set(
      [...iconStyles.matchAll(/\.(bwi-[a-z0-9-]+):before/g)].map((match) => match[1]),
    );

    expect([...usedIcons].filter((icon) => !mappedIcons.has(icon)).sort()).toEqual([]);
  });

  it("renders vault visual landmarks", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        VaultFacade,
        {
          provide: VaultActionsService,
          useValue: {
            copyField: async () => "Copied",
            fillField: async () => "Filled",
            launchItem: async () => "Open",
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-page > popup-header > .macos-page-heading")).not.toBeNull();
    expect(host.querySelector('[aria-label="搜索密码库"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-vault-node]")).toHaveLength(6);
    expect(host.querySelector("bit-item-group")).not.toBeNull();
    expect(host.querySelector("bit-item")).not.toBeNull();
  });

  it("renders phase 2 route surfaces for vault and account settings", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setServerUrl("https://vault.bitwarden.test");

    await TestBed.configureTestingModule({
      imports: [
        VaultListPageComponent,
        AccountSecurityPageComponent,
        VaultSettingsPageComponent,
        OfficialAccountSwitcherComponent,
      ],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        {
          provide: VaultSessionService,
          useValue: {
            syncNow: async () => undefined,
          },
        },
        {
          provide: AuthFacade,
          useValue: {
            accounts: async () => [{
              id: "visual-account",
              email: "user@example.com",
              serverUrl: "https://vault.bitwarden.test",
              status: "unlocked",
              isActive: true,
            }],
            lock: () => undefined,
            logout: async () => undefined,
          },
        },
        { provide: DialogService, useValue: { openSimpleDialog: async () => false } },
        VaultFacade,
        {
          provide: VaultActionsService,
          useValue: {
            copyField: async () => "Copied",
            fillField: async () => "Filled",
            launchItem: async () => "Open",
          },
        },
      ],
    }).compileComponents();

    store.setItems(demoVaultItems);

    const vault = TestBed.createComponent(VaultListPageComponent);
    vault.detectChanges();
    const accountSecurity = TestBed.createComponent(AccountSecurityPageComponent);
    accountSecurity.detectChanges();
    const vaultSettings = TestBed.createComponent(VaultSettingsPageComponent);
    vaultSettings.detectChanges();
    const accountActions = TestBed.createComponent(OfficialAccountSwitcherComponent);
    accountActions.detectChanges();

    expect(vault.nativeElement.textContent).not.toContain("自动填充建议");
    expect(vault.nativeElement.textContent).toContain("收藏夹");
    expect(vault.nativeElement.textContent).toContain("所有项目");
    expect(accountSecurity.nativeElement.textContent).toContain("账户安全");
    expect(vaultSettings.nativeElement.textContent).toContain("立即同步");
    expect(accountActions.nativeElement.textContent).toMatch(/账户操作|Account actions/);
  });

  it("renders generator, send, and settings visual landmarks", async () => {
    await TestBed.configureTestingModule({
      imports: [GeneratorPageComponent, SendPageComponent, SettingsPageComponent],
      providers: [
        provideRouter([]),
        PopupStateStore,
        SettingsService,
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        {
          provide: GeneratorService,
          useValue: {
            activeSettings: async () => ({
              accountId: "account-a",
              settings: {
                password: { length: 14, ambiguous: true, uppercase: true, minUppercase: 1, lowercase: true, minLowercase: 1, number: true, minNumber: 1, special: false, minSpecial: 0 },
                passphrase: { numWords: 6, wordSeparator: "-", capitalize: false, includeNumber: false },
                username: { type: "word", wordCapitalize: false, wordIncludeNumber: false, subaddressEmail: "", catchallDomain: "" },
              },
            }),
            generate: async () => ({ credential: "visual-password", category: "password", generationDate: new Date(), algorithm: "password" }),
          },
        },
        { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
      ],
    }).compileComponents();

    const generator = TestBed.createComponent(GeneratorPageComponent);
    generator.detectChanges(false);
    const send = TestBed.createComponent(SendPageComponent);
    send.detectChanges();
    const settings = TestBed.createComponent(SettingsPageComponent);
    settings.detectChanges();

    await new Promise((resolve) => setTimeout(resolve));
    await generator.whenStable();
    generator.changeDetectorRef.detectChanges();
    const generatorHost = generator.nativeElement as HTMLElement;
    expect(generatorHost.querySelector("popup-page > main")).not.toBeNull();
    const generatorToggle = generatorHost.querySelector("bit-toggle-group");
    expect(Array.from(generatorToggle?.querySelectorAll("bit-toggle") ?? [], (toggle) => toggle.textContent?.trim())).toSatisfy(
      (labels) =>
        JSON.stringify(labels) === JSON.stringify(["密码", "密码短语", "用户名"])
        || JSON.stringify(labels) === JSON.stringify(["Password", "Passphrase", "Username"]),
    );
    expect(generatorHost.querySelector(".generator-algorithm-toggle")).toBeNull();
    const generatorResult = generatorHost.querySelector<HTMLElement>(".macos-generator__result");
    const generatorMode = generatorHost.querySelector<HTMLElement>(".macos-generator__mode");
    expect(generatorResult).not.toBeNull();
    expect(generatorResult?.querySelector(".bwi-generate")).not.toBeNull();
    expect(generatorResult?.querySelector(".bwi-clone")).not.toBeNull();
    expect(
      generatorResult && generatorMode
        ? Boolean(generatorResult.compareDocumentPosition(generatorMode) & Node.DOCUMENT_POSITION_FOLLOWING)
        : false,
    ).toBe(true);
    expect(generatorHost.querySelector('bit-item a[routerlink="/generator-history"] .bwi-angle-right')).not.toBeNull();
    expect((send.nativeElement as HTMLElement).querySelector("popup-page > main")).not.toBeNull();
    expect((send.nativeElement as HTMLElement).querySelector("bit-no-items")).not.toBeNull();
    expect((send.nativeElement as HTMLElement).textContent).toContain("安全地发送敏感信息");
    expect((settings.nativeElement as HTMLElement).querySelector("popup-page > main")).not.toBeNull();
    expect((settings.nativeElement as HTMLElement).querySelector("bit-item-group")).not.toBeNull();
    expect((settings.nativeElement as HTMLElement).textContent).toContain("账户安全");
  });

  it("renders non-empty Send list landmarks", async () => {
    const store = new PopupStateStore();
    store.setSends([
      {
        id: "send-1",
        accessId: "access-1",
        type: "text",
        name: "Payroll token",
        notes: "finance",
        revisionDate: "2026-07-09T10:00:00.000Z",
        deletionDate: "2026-07-16T10:00:00.000Z",
        disabled: false,
        accessCount: 1,
        maxAccessCount: 3,
      },
    ]);
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const send = TestBed.createComponent(SendPageComponent);
    send.detectChanges();
    const host = send.nativeElement as HTMLElement;

    expect(host.querySelector(".send-empty")).toBeNull();
    expect(host.querySelector("bit-search")).not.toBeNull();
    expect(host.querySelector("bw-official-send-list-items-container")).not.toBeNull();
    expect(host.querySelector("bit-section")).not.toBeNull();
    expect(host.querySelector("bit-item")).not.toBeNull();
    expect(host.textContent).toContain("Payroll token");
  });
});
