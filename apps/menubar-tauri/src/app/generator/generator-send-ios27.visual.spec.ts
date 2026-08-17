import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FormFieldModule } from "@bitwarden/components";

import { PopupStateStore } from "../popup-state";
import { PopupPageComponent } from "../layout/popup-page.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { officialCurrentAccountTestProviders } from "../official-ui/official-current-account.test-support";
import { ClipboardPolicyService } from "../settings/clipboard-policy.service";
import {
  GENERATOR_HISTORY_CLIPBOARD_HOST,
  GeneratorHistoryPageComponent,
} from "./generator-history-page.component";
import { GeneratorPageComponent } from "./generator-page.component";
import { GeneratorService, type GeneratorSettingsSnapshot } from "./generator.service";

@Component({
  imports: [FormFieldModule, GeneratorPageComponent],
  template: `
    <bw-generator-page />
    <aside data-testid="outside-generator-controls">
      <bit-form-field>
        <bit-label>Outside field</bit-label>
        <input bitInput type="text" />
      </bit-form-field>
    </aside>
  `,
})
class GeneratorVisualHostComponent {}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

let style: HTMLStyleElement;

const officialUtilityHitTargetCss = `
  .tw-min-h-10 { min-height: 40px; }
  .tw-h-6 { height: 24px; }
  .tw-leading-5 { line-height: 20px; }
  .tw-py-1\\.5 { padding-top: 6px; padding-bottom: 6px; }
  .tw-border-y { border-top-width: 1px; border-bottom-width: 1px; }
`;

beforeAll(() => {
  style = document.createElement("style");
  style.textContent = ["macos-tokens.css", "global.css"]
    .map((filename) => readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles", filename),
      "utf8",
    ))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  style.textContent += officialUtilityHitTargetCss;
  document.head.append(style);
});

afterAll(() => {
  style.remove();
  document.documentElement.removeAttribute("data-bw-compact-mode");
  document.body.replaceChildren();
});

describe("iOS 27 Generator visual contract", () => {
  it("renders the real Generator page with flat ordinary surfaces and touch-safe controls", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    TestBed.overrideComponent(PopupPageComponent, { set: { template: "<ng-content />" } });
    await TestBed.configureTestingModule({
      imports: [GeneratorVisualHostComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
        { provide: PopupStateStore, useValue: store },
        { provide: GeneratorService, useValue: generatorService() },
        { provide: ClipboardPolicyService, useValue: { copy: vi.fn(async () => undefined) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(GeneratorVisualHostComponent);
    fixture.detectChanges(false);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const official = host.querySelector<HTMLElement>("bw-official-credential-generator")!;
    const result = official.querySelector<HTMLElement>(".macos-generator__result")!;
    const mode = official.querySelector<HTMLElement>(".macos-generator__mode")!;
    const settings = official.querySelector<HTMLElement>(".macos-generator__settings")!;
    const settingSurfaces = settings.querySelectorAll<HTMLElement>("bit-card, bit-section");
    const copy = official.querySelector<HTMLButtonElement>('[data-testid="generator-copy"]')!;
    const regenerate = official.querySelector<HTMLButtonElement>('[data-testid="generator-regenerate"]')!;
    const historyRow = official.querySelector<HTMLElement>(".macos-generator__history-row")!;
    const history = official.querySelector<HTMLAnchorElement>(".macos-generator__history-link")!;
    const interactiveTargets = official.querySelectorAll<HTMLElement>("button, a");
    const modeRadios = official.querySelectorAll<HTMLInputElement>(
      '.macos-generator__mode bit-toggle input[type="radio"]',
    );
    const modeLabels = official.querySelectorAll<HTMLLabelElement>(
      ".macos-generator__mode bit-toggle label",
    );
    const fieldShells = official.querySelectorAll<HTMLElement>(
      ".macos-generator__settings [bitfieldcontainer]",
    );
    const checkboxes = official.querySelectorAll<HTMLInputElement>(
      '.macos-generator__settings input[type="checkbox"][bitcheckbox]',
    );
    const checkboxLabels = Array.from(checkboxes, (checkbox) =>
      checkbox.closest("bit-form-control")!.querySelector<HTMLLabelElement>("label")!,
    );
    const outsideField = host.querySelector<HTMLElement>(
      '[data-testid="outside-generator-controls"] [bitfieldcontainer]',
    )!;

    expect(official.querySelector("popup-page.macos-generator")).not.toBeNull();
    expect(result.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mode.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(settingSurfaces.length).toBeGreaterThan(0);
    expect(getComputedStyle(result).borderRadius).toBe("0px");
    expect(getComputedStyle(result).boxShadow).toBe("none");
    expect(getComputedStyle(historyRow).borderRadius).toBe("0px");
    expect(getComputedStyle(historyRow).boxShadow).toBe("none");
    expect(Array.from(settingSurfaces, (surface) => getComputedStyle(surface).borderRadius))
      .toEqual(Array.from(settingSurfaces, () => "0px"));
    expect(Array.from(settingSurfaces, (surface) => getComputedStyle(surface).boxShadow))
      .toEqual(Array.from(settingSurfaces, () => "none"));
    expect(Array.from(interactiveTargets, (target) => getComputedStyle(target).minWidth))
      .toEqual(Array.from(interactiveTargets, () => "44px"));
    expect(Array.from(interactiveTargets, (target) => getComputedStyle(target).minHeight))
      .toEqual(Array.from(interactiveTargets, (target) => target === history ? "52px" : "44px"));
    expect(getComputedStyle(copy).minHeight).toBe("44px");
    expect(getComputedStyle(regenerate).minHeight).toBe("44px");
    expect(modeRadios).toHaveLength(3);
    expect(modeLabels).toHaveLength(3);
    expect(Array.from(modeRadios, (radio, index) => modeLabels[index]?.htmlFor === radio.id))
      .toEqual([true, true, true]);
    expect(fieldShells.length).toBeGreaterThan(0);
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(Array.from(checkboxes, computedHitHeight).every((height) => height <= 24)).toBe(true);
    expect({
      modeRadios: Array.from(modeRadios, computedHitHeight),
      modeLabels: Array.from(modeLabels, computedHitHeight),
      fieldShells: Array.from(fieldShells, computedHitHeight),
      checkboxLabels: Array.from(checkboxLabels, computedHitHeight),
    }).toEqual({
      modeRadios: Array.from(modeRadios, () => 44),
      modeLabels: Array.from(modeLabels, () => 44),
      fieldShells: Array.from(fieldShells, () => 44),
      checkboxLabels: Array.from(checkboxLabels, () => 44),
    });
    expect(computedHitHeight(outsideField)).toBe(40);
    expect(getComputedStyle(history).minHeight).toBe("52px");

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(history).minHeight).toBe("44px");

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });

  it("renders real history as a continuous shadowless list with compact-safe rows", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    TestBed.overrideComponent(PopupPageComponent, { set: { template: "<ng-content />" } });
    await TestBed.configureTestingModule({
      imports: [GeneratorHistoryPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: store },
        { provide: GeneratorService, useValue: generatorService() },
        {
          provide: GENERATOR_HISTORY_CLIPBOARD_HOST,
          useValue: { copyText: vi.fn(async () => undefined) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(GeneratorHistoryPageComponent);
    fixture.detectChanges(false);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const content = host.querySelector<HTMLElement>(".macos-generator-history__content");
    const row = host.querySelector<HTMLElement>(".macos-generator-history__row");

    expect(content).not.toBeNull();
    expect(row).not.toBeNull();
    expect(host.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    const copy = row!.querySelector<HTMLButtonElement>("button")!;
    expect(getComputedStyle(content!).boxShadow).toBe("none");
    expect(getComputedStyle(row!).minHeight).toBe("52px");
    expect(getComputedStyle(row!).borderRadius).toBe("0px");
    expect(getComputedStyle(row!).boxShadow).toBe("none");
    expect(getComputedStyle(copy).minHeight).toBe("44px");

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(row!).minHeight).toBe("44px");

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });
});

function computedHitHeight(target: Element): number {
  const style = getComputedStyle(target);
  const explicit = Math.max(cssPixels(style.minHeight), cssPixels(style.height));
  const contentBox = cssPixels(style.lineHeight)
    + cssPixels(style.paddingTop)
    + cssPixels(style.paddingBottom)
    + cssPixels(style.borderTopWidth)
    + cssPixels(style.borderBottomWidth);
  const descendantHeight = Math.max(
    0,
    ...Array.from(target.children, computedHitHeight),
  );
  return Math.max(explicit, contentBox, descendantHeight);
}

function cssPixels(value: string): number {
  return value.endsWith("px") ? Number.parseFloat(value) : 0;
}

function generatorService() {
  const settings = generatorSettings();
  return {
    activeSettings: vi.fn(async () => ({ accountId: "account-a", settings })),
    generate: vi.fn(async (mode: "password" | "passphrase" | "username") => ({
      credential: mode === "password" ? "first-password" : `first-${mode}`,
      category: mode === "username" ? "username" : "password",
      generationDate: new Date("2026-08-17T00:00:00.000Z"),
      algorithm: mode,
    })),
    updatePasswordSettings: vi.fn(async () => settings),
    updatePassphraseSettings: vi.fn(async () => settings),
    updateUsernameSettings: vi.fn(async () => settings),
    history: vi.fn(async () => [{
      credential: "history-password",
      category: "password",
      generationDate: new Date("2026-08-17T00:00:00.000Z"),
      algorithm: "password",
    }]),
    clearHistory: vi.fn(async () => undefined),
  };
}

function generatorSettings(): GeneratorSettingsSnapshot {
  return {
    password: {
      length: 14,
      ambiguous: true,
      uppercase: true,
      minUppercase: 1,
      lowercase: true,
      minLowercase: 1,
      number: true,
      minNumber: 1,
      special: false,
      minSpecial: 0,
    },
    passphrase: {
      numWords: 6,
      wordSeparator: "-",
      capitalize: false,
      includeNumber: false,
    },
    username: {
      type: "word",
      wordCapitalize: false,
      wordIncludeNumber: false,
      subaddressEmail: "",
      catchallDomain: "",
    },
  };
}
