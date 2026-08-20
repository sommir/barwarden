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
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FormFieldModule } from "@bitwarden/components";

import { RootSearchComponent } from "../layout/root-search.component";
import {
  ButtonComponent,
  CheckboxComponent,
  FormControlComponent,
  SearchComponent,
} from "./official-components";
import { MacosAlertStripComponent } from "./macos-alert-strip.component";
import { OfficialI18nService } from "./official-i18n.service";

const stylePaths = [
  "apps/menubar-tauri/src/styles/macos-tokens.css",
  "apps/menubar-tauri/src/styles/macos-motion.css",
  "apps/menubar-tauri/src/styles/macos-materials.css",
  "apps/menubar-tauri/src/styles/global.css",
] as const;

@Component({
  imports: [
    ButtonComponent,
    CheckboxComponent,
    FormControlComponent,
    FormFieldModule,
    MacosAlertStripComponent,
    RootSearchComponent,
    SearchComponent,
  ],
  template: `
    <main class="macos-page">
      <bit-form-field class="macos-field" data-testid="form-field">
        <bit-label>Email</bit-label>
        <input bitInput data-testid="form-input" aria-invalid="true" />
      </bit-form-field>

      <bit-form-control data-testid="form-control">
        <input bitCheckbox id="visual-checkbox" data-testid="checkbox" type="checkbox" />
        <bit-label>Remember</bit-label>
      </bit-form-control>

      <bit-search data-testid="official-search" />
      <bw-root-search data-testid="root-search" searchAriaLabel="Search Vault" />

      <button bitButton buttonType="danger" data-testid="danger" type="button">Delete</button>
      <bw-macos-alert-strip
        kind="danger"
        title="Sync failed"
        message="Try again"
        testId="production-alert"
      />
      <span class="vault-skeleton-line" aria-hidden="true"></span>
    </main>
  `,
})
class ProductionAccessibilityHostComponent {}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-ios27-production-accessibility]")
    .forEach((node) => node.remove());
});

describe("iOS 27 production accessibility contract", () => {
  it("renders one 2px owner ring only for focus-visible on real form and search controls", async () => {
    installProductionCss();
    const fixture = await mountHost();
    const host = fixture.nativeElement as HTMLElement;
    const controls = productionFocusPairs(host);

    expect(controls.map(({ input, owner }) => [input.tagName, owner.tagName])).toEqual([
      ["INPUT", "DIV"],
      ["INPUT", "LABEL"],
      ["INPUT", "FORM"],
      ["INPUT", "LABEL"],
    ]);

    for (const { input, owner } of controls) {
      input.focus();
      expect(visibleOutlineCount(getComputedStyle(input), getComputedStyle(owner))).toBe(0);
      input.blur();

      exposeFocusVisible(input);
      const inputStyle = getComputedStyle(input);
      const ownerStyle = getComputedStyle(owner);
      expect(visibleOutlineCount(inputStyle, ownerStyle)).toBe(1);
      expect(ownerStyle.outlineWidth).toBe("2px");
      expect(ownerStyle.outlineStyle).toBe("solid");
      expect(ownerStyle.outlineOffset).toBe("2px");
      expect(ownerStyle.boxShadow).toBe("none");
      expect(inputStyle.outlineStyle).toBe("none");
      clearFocusVisible(input);
    }
  });

  it("keeps real focus, invalid, and danger semantics visible through forced system colors", async () => {
    installProductionCss({ forcedColors: true });
    const fixture = await mountHost();
    const host = fixture.nativeElement as HTMLElement;
    const controls = productionFocusPairs(host);

    for (const { input, owner } of controls) {
      exposeFocusVisible(input);
      expect(getComputedStyle(owner).outlineColor)
        .toBe(resolvedSystemColor("outline-color", "Highlight"));
    }

    const invalid = host.querySelector<HTMLInputElement>('[data-testid="form-input"]')!;
    const danger = host.querySelector<HTMLElement>('[data-testid="danger"]')!;
    invalid.setAttribute("aria-invalid", "true");
    expect(getComputedStyle(invalid).borderColor)
      .toBe(resolvedSystemColor("border-color", "Mark"));
    expect(getComputedStyle(danger).backgroundColor)
      .toBe(resolvedSystemColor("background", "Mark"));
    expect(getComputedStyle(danger).color)
      .toBe(resolvedSystemColor("color", "MarkText"));
  });

  it("uses the standard motion token for a real alert and preserves continuous skeleton timing", async () => {
    const style = installProductionCss();
    const productionSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const fixture = await mountHost();
    const host = fixture.nativeElement as HTMLElement;
    const alert = host.querySelector<HTMLElement>(
      'bw-macos-alert-strip [data-testid="production-alert"].macos-alert-strip',
    )!;
    const skeletonRule = findStyleRule(style.sheet?.cssRules, ".vault-skeleton-line::after");

    expect(getComputedStyle(alert).animationDuration).toBe("180ms");
    expect(productionSource).toMatch(
      /\.macos-alert-strip\s*{[^}]*animation-duration:\s*var\(--mac-motion-standard\);/s,
    );
    expect(productionSource).not.toMatch(
      /animation(?:-duration)?:\s*[^;]*(?:100ms|140ms|220ms)/,
    );
    expect(skeletonRule).not.toBeNull();
    expect(skeletonRule!.style.animationDuration).toBe("1.4s");
    expect(skeletonRule!.style.animationIterationCount).toBe("infinite");
  });
});

async function mountHost() {
  await TestBed.configureTestingModule({
    imports: [ProductionAccessibilityHostComponent],
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ProductionAccessibilityHostComponent);
  fixture.detectChanges();
  return fixture;
}

function productionFocusPairs(host: HTMLElement): Array<{
  readonly input: HTMLInputElement;
  readonly owner: HTMLElement;
}> {
  const formInput = host.querySelector<HTMLInputElement>('[data-testid="form-input"]')!;
  const checkbox = host.querySelector<HTMLInputElement>('[data-testid="checkbox"]')!;
  const officialSearch = host.querySelector<HTMLInputElement>(
    '[data-testid="official-search"] input',
  )!;
  const rootSearch = host.querySelector<HTMLInputElement>('[data-testid="root-search"] input')!;
  return [
    { input: formInput, owner: formInput.closest<HTMLElement>("[bitfieldcontainer]")! },
    { input: checkbox, owner: checkbox.closest<HTMLElement>("bit-form-control")!.querySelector("label")! },
    { input: officialSearch, owner: officialSearch.closest<HTMLElement>("[bitfieldcontainer]")! },
    { input: rootSearch, owner: rootSearch.closest<HTMLElement>(".vault-root-header__search")! },
  ];
}

function exposeFocusVisible(input: HTMLInputElement): void {
  input.focus();
  input.dataset["testFocusVisible"] = "true";
}

function clearFocusVisible(input: HTMLInputElement): void {
  input.blur();
  input.removeAttribute("data-test-focus-visible");
}

function visibleOutlineCount(...styles: CSSStyleDeclaration[]): number {
  return styles.filter((style) => style.outlineWidth === "2px" && style.outlineStyle === "solid")
    .length;
}

function installProductionCss(media: { readonly forcedColors?: boolean } = {}): HTMLStyleElement {
  const source = stylePaths
    .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
    .join("\n");
  const root = postcss.parse(source);
  root.walkAtRules("import", (rule) => rule.remove());
  root.walkAtRules("media", (rule) => {
    const active = rule.params === "(forced-colors: active)" && media.forcedColors === true;
    if (active) {
      rule.replaceWith(...(rule.nodes ?? []).map((node) => node.clone()));
    } else {
      rule.remove();
    }
  });
  root.walkAtRules("starting-style", (rule) => rule.remove());

  const style = document.createElement("style");
  style.dataset["ios27ProductionAccessibility"] = "true";
  style.textContent = root.toString()
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || value,
  );
  return style;
}

function resolveCustomProperty(
  value: string,
  rootStyle: CSSStyleDeclaration,
  seen: Set<string>,
): string {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, name) => {
    if (seen.has(name)) return reference;
    const next = rootStyle.getPropertyValue(name).trim();
    if (!next) return reference;
    return resolveCustomProperty(next, rootStyle, new Set([...seen, name]));
  });
}

function findStyleRule(rules: CSSRuleList | undefined, selector: string): CSSStyleRule | null {
  if (!rules) return null;
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule && rule.selectorText.split(",").map((value) => value.trim())
      .includes(selector)) {
      return rule;
    }
    if ("cssRules" in rule) {
      const nested = findStyleRule((rule as CSSGroupingRule).cssRules, selector);
      if (nested) return nested;
    }
  }
  return null;
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
