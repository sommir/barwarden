import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { provideRouter, Router } from "@angular/router";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import {
  FloatingTabSwitcherComponent,
  type FloatingTab,
} from "../popup-shell/floating-tab-switcher.component";
import { AppBottomSheetComponent } from "./app-bottom-sheet.component";
import { OfficialI18nService } from "./official-i18n.service";

const stylePaths = [
  "apps/menubar-tauri/src/styles/macos-tokens.css",
  "apps/menubar-tauri/src/styles/macos-motion.css",
  "apps/menubar-tauri/src/styles/macos-materials.css",
  "apps/menubar-tauri/src/styles/global.css",
] as const;

const tabs: readonly FloatingTab[] = [
  { label: "Vault", path: "/tabs/vault", icon: "bwi-vault" },
  { label: "Settings", path: "/tabs/settings", icon: "bwi-settings" },
];

@Component({ standalone: true, template: "" })
class TabRouteComponent {}

@Component({
  standalone: true,
  imports: [AppBottomSheetComponent, FloatingTabSwitcherComponent],
  template: `
    <main class="macos-page macos-page--settings" data-testid="text-scale-frame">
      <bw-floating-tab-switcher [tabs]="tabs" />

      <bw-app-bottom-sheet testId="accessibility-sheet" labelledBy="sheet-title">
        <form class="app-bottom-sheet-panel">
          <h2 id="sheet-title">Accessibility sheet</h2>
          <button type="button">Cancel</button>
        </form>
      </bw-app-bottom-sheet>
    </main>
  `,
})
class AccessibilityVisualHostComponent {
  readonly tabs = tabs;
}

interface MediaPreferences {
  readonly dark?: boolean;
  readonly contrast?: boolean;
  readonly reducedMotion?: boolean;
  readonly reducedTransparency?: boolean;
  readonly forcedColors?: boolean;
}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-bw-compact-mode");
  document.documentElement.removeAttribute("data-bw-theme");
  document.documentElement.removeAttribute("data-bw-window");
  document.documentElement.style.removeProperty("font-size");
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-ios27-accessibility]").forEach((node) => node.remove());
});

describe("iOS 27 accessibility visual contract", () => {
  it("smoke-tests exact interaction tokens on the real tab switcher and Sheet", async () => {
    const fixture = await mountHost();
    const host = fixture.nativeElement as HTMLElement;
    const root = getComputedStyle(document.documentElement);
    const currentTab = host.querySelector<HTMLButtonElement>('[aria-current="page"]')!;
    const sheet = host.querySelector<HTMLElement>('[data-testid="accessibility-sheet"]')!;

    expect(root.getPropertyValue("--mac-motion-fast").trim()).toBe("160ms");
    expect(root.getPropertyValue("--mac-motion-standard").trim()).toBe("180ms");
    expect(root.getPropertyValue("--mac-motion-slow").trim()).toBe("200ms");
    expect(root.getPropertyValue("--mac-motion-duration").trim()).toBe("160ms");
    expect(root.getPropertyValue("--mac-sheet-motion").trim()).toBe("200ms");
    expect(root.getPropertyValue("--mac-disclosure-motion").trim()).toBe("180ms");
    expect(root.getPropertyValue("--mac-focus-ring-width").trim()).toBe("2px");
    expect(root.getPropertyValue("--mac-row-height").trim()).toBe("52px");
    expect(root.getPropertyValue("--mac-compact-row-height").trim()).toBe("44px");

    currentTab.dataset["testActive"] = "true";
    const pressed = getComputedStyle(currentTab);
    expect(pressed.transform).toBe("none");
    expect(pressed.opacity).toBe("0.78");
    expect(pressed.transitionDuration.split(", ")).toEqual(["160ms", "160ms", "160ms"]);
    expect(getComputedStyle(sheet).borderRadius).toBe("16px 16px 0 0");
  });

  it("exposes the compact row and section rhythm tokens", async () => {
    document.documentElement.dataset["bwCompactMode"] = "true";
    const fixture = await mountHost();
    const root = getComputedStyle(document.documentElement);

    expect(root.getPropertyValue("--bw-row-content-height").trim()).toBe("44px");
    expect(root.getPropertyValue("--bw-row-gap").trim()).toBe("0");
    expect(root.getPropertyValue("--bw-section-gap").trim()).toBe("8px");
    fixture.destroy();
  });

  it.each([
    ["light", {}, "rgb(244 248 255/94%)", "light"],
    ["dark", {}, "#101621", "dark"],
    ["system light", {}, "rgb(244 248 255/94%)", "light"],
    ["system dark", { dark: true }, "#101621", "dark"],
  ] as const)("resolves the %s theme from mounted root tokens", async (theme, media, canvas, colorScheme) => {
    document.documentElement.dataset["bwTheme"] = theme.startsWith("system") ? "system" : theme;
    await mountHost(media);
    const root = getComputedStyle(document.documentElement);

    expect(root.getPropertyValue("--mac-canvas").trim()).toBe(canvas);
    expect(root.colorScheme).toBe(colorScheme);
  });

  it("computes opaque, filter-free surfaces for reduced transparency", async () => {
    const fixture = await mountHost({ reducedTransparency: true });
    const sheet = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('[data-testid="accessibility-sheet"]')!;
    const sheetStyle = getComputedStyle(sheet);

    expect(sheetStyle.backgroundColor).toBe("rgb(251, 253, 255)");
    expect(sheetStyle.getPropertyValue("backdrop-filter")).toBe("none");
    expect(readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/macos-materials.css"),
      "utf8",
    )).toMatch(
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?-webkit-backdrop-filter:\s*none;/,
    );
  });

  it("computes stronger borders and non-color current-tab feedback at high contrast", async () => {
    const fixture = await mountHost({ contrast: true });
    const host = fixture.nativeElement as HTMLElement;
    const root = getComputedStyle(document.documentElement);
    const currentTab = host.querySelector<HTMLElement>('[aria-current="page"]')!;

    expect(root.getPropertyValue("--mac-border").trim()).toBe("#4c4c4f");
    expect(getComputedStyle(currentTab).borderBottomWidth).toBe("2px");
    expect(getComputedStyle(currentTab).textDecoration).toContain("underline");
  });

  it("removes transitions, animations, scrolling motion, and active transforms for reduced motion", async () => {
    const fixture = await mountHost({ reducedMotion: true });
    const host = fixture.nativeElement as HTMLElement;
    const currentTab = host.querySelector<HTMLButtonElement>('[aria-current="page"]')!;
    const sheet = host.querySelector<HTMLElement>('[data-testid="accessibility-sheet"]')!;
    currentTab.dataset["testActive"] = "true";
    currentTab.dataset["testReducedMotion"] = "true";
    sheet.dataset["testReducedMotion"] = "true";

    expect(getComputedStyle(currentTab).transitionDuration).toBe("0s");
    expect(getComputedStyle(currentTab).animationName).toBe("none");
    expect(getComputedStyle(currentTab).scrollBehavior).toBe("auto");
    expect(getComputedStyle(currentTab).transform).toBe("none");
    expect(getComputedStyle(sheet).transitionDuration).toBe("0s");
    expect(getComputedStyle(sheet).transform).toBe("none");
  });

  it("uses system colors for the real current tab and retains every forced-color semantic", async () => {
    const fixture = await mountHost({ forcedColors: true });
    const host = fixture.nativeElement as HTMLElement;
    const currentTab = host.querySelector<HTMLButtonElement>('[aria-current="page"]')!;

    expect(getComputedStyle(currentTab).backgroundColor).toBe(resolvedSystemColor("background", "Highlight"));
    expect(getComputedStyle(currentTab).color).toBe(resolvedSystemColor("color", "HighlightText"));

    const forcedColors = mediaRuleSource("(forced-colors: active)");
    for (const keyword of ["Highlight", "HighlightText", "Canvas", "CanvasText", "Mark", "MarkText"]) {
      expect(forcedColors).toContain(keyword);
    }
  });
});

async function mountHost(media: MediaPreferences = {}) {
  stubMatchMedia(media);
  installVisualCss();
  await TestBed.configureTestingModule({
    imports: [AccessibilityVisualHostComponent],
    providers: [
      provideRouter(tabs.map((tab) => ({ path: tab.path.slice(1), component: TabRouteComponent }))),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  await TestBed.inject(Router).navigateByUrl("/tabs/vault");
  const fixture = TestBed.createComponent(AccessibilityVisualHostComponent);
  fixture.detectChanges();
  return fixture;
}

function stubMatchMedia(preferences: MediaPreferences): void {
  vi.stubGlobal("matchMedia", vi.fn((query: string): MediaQueryList => ({
    matches: mediaQueryMatches(query, preferences),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
}

function mediaQueryMatches(query: string, preferences: MediaPreferences): boolean {
  return query.split(",").some((alternative) => alternative.split(/\s+and\s+/).every((condition) => {
    switch (condition.trim()) {
      case "(prefers-color-scheme: dark)": return preferences.dark === true;
      case "(prefers-contrast: more)": return preferences.contrast === true;
      case "(prefers-reduced-motion: reduce)": return preferences.reducedMotion === true;
      case "(prefers-reduced-transparency: reduce)": return preferences.reducedTransparency === true;
      case "(forced-colors: active)": return preferences.forcedColors === true;
      default: return false;
    }
  }));
}

function installVisualCss(): void {
  const source = stylePaths
    .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
    .join("\n");
  const effectiveSource = effectiveCss(source)
    .replace(/\.macos-pressable:active/g, '.macos-pressable[data-test-active="true"]')
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]')
    .replace(/:root \*/g, '[data-test-reduced-motion="true"]');
  const variableStyle = document.createElement("style");
  variableStyle.dataset["ios27Accessibility"] = "true";
  variableStyle.textContent = effectiveSource;
  document.head.append(variableStyle);

  const rootStyle = getComputedStyle(document.documentElement);
  const variables = new Map(
    [...effectiveSource.matchAll(/var\((--[\w-]+)\)/g)].map(([, name]) => [
      name,
      resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name])),
    ]),
  );
  const resolvedStyle = document.createElement("style");
  resolvedStyle.dataset["ios27Accessibility"] = "true";
  resolvedStyle.textContent = effectiveSource.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    variables.get(name) || value,
  );
  document.head.append(resolvedStyle);
}

function effectiveCss(source: string): string {
  const root = postcss.parse(source);
  root.walkAtRules("import", (rule) => rule.remove());
  root.walkAtRules("media", (rule) => {
    if (window.matchMedia(rule.params).matches) {
      rule.replaceWith(...(rule.nodes ?? []).map((node) => node.clone()));
    } else {
      rule.remove();
    }
  });
  root.walkAtRules("starting-style", (rule) => rule.remove());
  return root.toString();
}

function resolveCustomProperty(value: string, rootStyle: CSSStyleDeclaration, seen: Set<string>): string {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, name) => {
    if (seen.has(name)) return reference;
    const next = rootStyle.getPropertyValue(name).trim();
    if (!next) return reference;
    return resolveCustomProperty(next, rootStyle, new Set([...seen, name]));
  });
}

function resolvedSystemColor(
  property: "background" | "border-color" | "color" | "outline-color",
  keyword: string,
): string {
  const probe = document.createElement("span");
  probe.style.setProperty(property, keyword);
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const value = {
    background: style.backgroundColor,
    "border-color": style.borderColor,
    color: style.color,
    "outline-color": style.outlineColor,
  }[property];
  probe.remove();
  return value;
}

function mediaRuleSource(condition: string): string {
  const source = stylePaths
    .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
    .join("\n");
  const rules: string[] = [];
  postcss.parse(source).walkAtRules("media", (rule) => {
    if (rule.params === condition) rules.push(rule.toString());
  });
  return rules.join("\n");
}
