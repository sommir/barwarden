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
import { SendPageComponent } from "../send/send-page.component";
import type {
  RetainedTextSendErrors,
  RetainedTextSendField,
} from "../send/retained-text-send-form.service";
import { OfficialSendAddEditComponent } from "../upstream-overlays/send/official-send-add-edit.component";
import { OfficialSendCreatedComponent } from "../upstream-overlays/send/official-send-created.component";
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
  .tw-mb-4 { margin-bottom: 16px; }
  :root[data-bw-compact-mode="true"] .bit-compact\\:tw-mb-3 { margin-bottom: 12px; }
  .tw-h-6 { height: 24px; }
  .tw-leading-5 { line-height: 20px; }
  .tw-py-1\\.5 { padding-top: 6px; padding-bottom: 6px; }
  .tw-mb-1\\.5 { margin-bottom: 6px; }
  .tw-border-y { border-top-width: 1px; border-bottom-width: 1px; }
`;

const hostileGeneratorDefaultsCss = `
  .macos-generator__result {
    height: 68px;
    overflow: hidden;
  }
  .macos-generator__value {
    max-height: 32px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .macos-generator__result-actions button .bwi,
  .macos-generator__mode bit-toggle > label > span:first-child,
  .macos-generator__settings [bitfieldcontainer],
  .macos-generator__settings bit-form-control > label {
    animation: generator-hostile-motion 1s infinite;
    transition: background-color 1s linear;
    transform: scale(1.1);
  }
  .macos-generator__result-actions button:focus:not(:focus-visible),
  .macos-generator__result-actions button:focus:not(:focus-visible) .bwi,
  .macos-generator__mode bit-toggle > input[type="radio"]:focus:not(:focus-visible) + label,
  .macos-generator__mode bit-toggle > input[type="radio"]:focus:not(:focus-visible) + label > span:first-child,
  .macos-generator__settings [bitfieldcontainer]:has(:focus:not(:focus-visible)),
  .macos-generator__settings :is(input, select, [role="combobox"]):focus:not(:focus-visible),
  .macos-generator__settings bit-form-control > label:has(:focus:not(:focus-visible)) {
    outline-color: red !important;
    outline-style: solid !important;
    outline-width: 3px !important;
  }
  @keyframes generator-hostile-motion {
    from { opacity: 0.99; }
    to { opacity: 1; }
  }
`;

beforeAll(() => {
  style = document.createElement("style");
  style.textContent = hostileGeneratorDefaultsCss + ["macos-tokens.css", "global.css"]
    .map((filename) => readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles", filename),
      "utf8",
    ))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  style.textContent += officialUtilityHitTargetCss;
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || value,
  );
  style.textContent += projectGeneratorInteractionAndMediaRules(style.sheet!);
});

afterAll(() => {
  style.remove();
  document.documentElement.removeAttribute("data-bw-compact-mode");
  document.documentElement.removeAttribute("data-generator-test-media");
  document.documentElement.style.removeProperty("font-size");
  document.body.replaceChildren();
});

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

describe("iOS 27 Generator visual contract", () => {
  it("keeps Send form groups flat with touch-safe controls and an explicit focus ring", () => {
    const css = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    expect(css).toMatch(/\.macos-send-form__group\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.macos-send-form__field\s*\{[^}]*padding-block:\s*10px[^}]*border-bottom-width:\s*1px[^}]*border-bottom-style:\s*solid/s);
    expect(css).toMatch(/\.macos-send-form__field\s+:is\(input,\s*textarea,\s*select\)\s*\{[^}]*min-height:\s*44px[^}]*border-radius:\s*10px/s);
    expect(css).toMatch(/\.macos-send-form__field\s+:is\(input,\s*textarea,\s*select\):focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--mac-focus\)/s);
    expect(css).toMatch(/\.macos-page--send-form\s+:is\(button,\s*a\)\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.macos-page--send-form\s+bit-form-control\s*>\s*label\s*\{[^}]*min-height:\s*44px/s);
  });

  it("renders real Send form rows with continuous dividers and zero default or compact gaps", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OfficialSendAddEditComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialSendAddEditComponent);
    fixture.componentRef.setInput("mode", "add");
    fixture.componentRef.setInput("editing", true);
    fixture.componentRef.setInput("value", sendFormValue());
    fixture.componentRef.setInput("errors", {} satisfies RetainedTextSendErrors);
    fixture.componentRef.setInput("touched", new Set<RetainedTextSendField>());
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll<HTMLElement>(
      ".macos-send-form__group .macos-send-form__field",
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(Array.from(rows, (row) => cssPixels(getComputedStyle(row).marginBottom)))
      .toEqual(Array.from(rows, () => 0));
    expect(Array.from(rows, (row) => getComputedStyle(row).borderBottomWidth))
      .toEqual(Array.from(rows, () => "1px"));
    expect(Array.from(rows, (row) => getComputedStyle(row).borderBottomStyle))
      .toEqual(Array.from(rows, () => "solid"));

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(Array.from(rows, (row) => cssPixels(getComputedStyle(row).marginBottom)))
      .toEqual(Array.from(rows, () => 0));

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });

  it("renders the real Generator page with flat ordinary surfaces and touch-safe controls", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
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
    const scrollRegion = official.querySelector<HTMLElement>(
      '[data-testid="popup-layout-scroll-region"]',
    )!;
    const result = official.querySelector<HTMLElement>(".macos-generator__result")!;
    const value = official.querySelector<HTMLElement>(".macos-generator__value")!;
    const mode = official.querySelector<HTMLElement>(".macos-generator__mode")!;
    const modeGroup = mode.querySelector<HTMLElement>("bit-toggle-group")!;
    const modeToggles = mode.querySelectorAll<HTMLElement>("bit-toggle");
    const settings = official.querySelector<HTMLElement>(".macos-generator__settings")!;
    const settingSurfaces = settings.querySelectorAll<HTMLElement>("bit-card, bit-section");
    const copy = official.querySelector<HTMLButtonElement>('[data-testid="generator-copy"]')!;
    const regenerate = official.querySelector<HTMLButtonElement>('[data-testid="generator-regenerate"]')!;
    const copyGlyph = copy.querySelector<HTMLElement>(".bwi")!;
    const regenerateGlyph = regenerate.querySelector<HTMLElement>(".bwi")!;
    const historyRow = official.querySelector<HTMLElement>(".macos-generator__history-row")!;
    const history = official.querySelector<HTMLAnchorElement>(".macos-generator__history-link")!;
    const interactiveTargets = official.querySelectorAll<HTMLElement>("button, a");
    const modeRadios = official.querySelectorAll<HTMLInputElement>(
      '.macos-generator__mode bit-toggle input[type="radio"]',
    );
    const modeLabels = official.querySelectorAll<HTMLLabelElement>(
      ".macos-generator__mode bit-toggle label",
    );
    const modePaintLayers = Array.from(modeLabels, (label) =>
      label.querySelector<HTMLElement>(":scope > span:first-child")!,
    );
    const fieldShells = official.querySelectorAll<HTMLElement>(
      ".macos-generator__settings [bitfieldcontainer]",
    );
    const fieldOwners = official.querySelectorAll<HTMLElement>(
      ".macos-generator__settings bit-form-field",
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
    expect(scrollRegion).not.toBeNull();
    expect(result.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mode.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(settingSurfaces.length).toBeGreaterThan(0);
    expect(getComputedStyle(result).borderRadius).toBe("0px");
    expect(getComputedStyle(result).boxShadow).toBe("none");
    expect.soft(cssPixels(getComputedStyle(result).minHeight)).toBeGreaterThanOrEqual(68);
    expect.soft(cssPixels(getComputedStyle(result).minHeight)).toBeLessThanOrEqual(72);
    expect.soft(getComputedStyle(result).height).toBe("auto");
    expect.soft(getComputedStyle(result).overflow).toBe("visible");
    expect.soft(getComputedStyle(result).paddingTop).toBe("8px");
    expect.soft(getComputedStyle(result).paddingBottom).toBe("12px");
    expect.soft(getComputedStyle(value).maxHeight).toBe("none");
    expect.soft(getComputedStyle(value).overflow).toBe("visible");
    expect.soft(getComputedStyle(value).whiteSpace).toBe("normal");
    expect.soft(getComputedStyle(value).textOverflow).toBe("clip");
    expect.soft(getComputedStyle(scrollRegion).paddingInline).toBe("16px");
    expect.soft(getComputedStyle(result).marginLeft).toBe("0px");
    expect.soft(getComputedStyle(result).marginRight).toBe("0px");
    expect.soft(getComputedStyle(mode).marginLeft).toBe("0px");
    expect.soft(getComputedStyle(mode).marginRight).toBe("0px");
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
    expect.soft(getComputedStyle(copy).minHeight).toBe("44px");
    expect.soft(getComputedStyle(regenerate).minHeight).toBe("44px");
    expect.soft(getComputedStyle(copy).minWidth).toBe("44px");
    expect.soft(getComputedStyle(regenerate).minWidth).toBe("44px");
    expect.soft(copy.classList).toContain("macos-hit-target");
    expect.soft(regenerate.classList).toContain("macos-hit-target");
    expect.soft(copyGlyph.closest("button")).toBe(copy);
    expect.soft(regenerateGlyph.closest("button")).toBe(regenerate);
    expect.soft(getComputedStyle(copyGlyph).width).toBe("32px");
    expect.soft(getComputedStyle(copyGlyph).height).toBe("32px");
    expect.soft(getComputedStyle(regenerateGlyph).width).toBe("32px");
    expect.soft(getComputedStyle(regenerateGlyph).height).toBe("32px");
    expect.soft(getComputedStyle(copy).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect.soft(getComputedStyle(copyGlyph).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect.soft(getComputedStyle(regenerate).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect.soft(getComputedStyle(regenerateGlyph).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect.soft(copy.getAttribute("buttontype")).toBe("primary");
    expect.soft(regenerate.getAttribute("buttontype")).toBe("primaryGhost");
    expect.soft(official.querySelectorAll('button[buttontype="primary"]')).toHaveLength(1);
    expect.soft(getComputedStyle(modeGroup).minHeight).toBe("44px");
    expect.soft(Array.from(modeToggles, (toggle) => getComputedStyle(toggle).height))
      .toEqual(Array.from(modeToggles, () => "44px"));
    expect(modeRadios).toHaveLength(3);
    expect(modeLabels).toHaveLength(3);
    expect(Array.from(modeRadios, (radio, index) => modeLabels[index]?.htmlFor === radio.id))
      .toEqual([true, true, true]);
    expect(fieldShells.length).toBeGreaterThan(0);
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(Array.from(checkboxes, computedHitHeight).every((height) => height <= 24)).toBe(true);
    expect.soft({
      modeRadios: Array.from(modeRadios, computedHitHeight),
      modeLabels: Array.from(modeLabels, computedHitHeight),
      fieldOwners: Array.from(fieldOwners, computedHitHeight),
      fieldShells: Array.from(fieldShells, computedHitHeight),
      checkboxLabels: Array.from(checkboxLabels, computedHitHeight),
    }).toEqual({
      modeRadios: Array.from(modeRadios, () => 44),
      modeLabels: Array.from(modeLabels, () => 44),
      fieldOwners: Array.from(fieldOwners, () => 44),
      fieldShells: Array.from(fieldShells, () => 40),
      checkboxLabels: Array.from(checkboxLabels, () => 44),
    });
    expect(computedHitHeight(outsideField)).toBe(40);
    expect(getComputedStyle(history).minHeight).toBe("52px");

    expect.soft(Array.from(modeRadios, computedHitHeight))
      .toEqual(Array.from(modeRadios, () => 44));
    expect.soft(Array.from(modePaintLayers, computedHitHeight))
      .toEqual(Array.from(modePaintLayers, () => 40));
    expect.soft(modeGroup.getAttribute("role")).toBe("radiogroup");
    expect.soft(new Set(Array.from(modeRadios, (radio) => radio.name)).size).toBe(1);
    expect.soft(Array.from(modeRadios, (radio) => radio.checked)).toEqual([true, false, false]);
    expect.soft(Array.from(modeRadios, (radio) => radio.tabIndex)).toEqual([0, 0, 0]);

    const longValue = "very-long-generated-value-".repeat(24);
    value.textContent = longValue;
    document.documentElement.style.fontSize = "200%";
    expect.soft(value.textContent).toContain(longValue);
    expect.soft(getComputedStyle(result).height).toBe("auto");
    expect.soft(getComputedStyle(result).overflow).toBe("visible");
    expect.soft(getComputedStyle(value).maxHeight).toBe("none");
    expect.soft(getComputedStyle(value).overflow).toBe("visible");
    expect.soft(getComputedStyle(value).whiteSpace).toBe("normal");
    expect.soft(getComputedStyle(value).overflowWrap).toBe("anywhere");
    document.documentElement.style.removeProperty("font-size");

    const transparent = "rgba(0, 0, 0, 0)";
    const copyDefault = getComputedStyle(copyGlyph).backgroundColor;
    setGeneratorInteraction(copy, "hover");
    const copyHover = getComputedStyle(copyGlyph).backgroundColor;
    expect.soft(copyHover).not.toBe(copyDefault);
    expect.soft(getComputedStyle(copy).backgroundColor).toBe(transparent);
    setGeneratorInteraction(copy, "active");
    const copyPressed = getComputedStyle(copyGlyph).backgroundColor;
    expect.soft(copyPressed).not.toBe(copyHover);
    expect.soft(copyPressed).not.toBe(copyDefault);
    expect.soft(getComputedStyle(copy).backgroundColor).toBe(transparent);
    setGeneratorInteraction(copy, null);
    expect.soft(copy.disabled).toBe(false);
    copy.setAttribute("aria-disabled", "true");
    const copyAriaDisabled = getComputedStyle(copyGlyph).backgroundColor;
    expect.soft(copyAriaDisabled).not.toBe(copyDefault);
    expect.soft(copyAriaDisabled).not.toBe(copyHover);
    expect.soft(copyAriaDisabled).not.toBe(copyPressed);
    expect.soft(getComputedStyle(copy).backgroundColor).toBe(transparent);
    copy.removeAttribute("aria-disabled");
    copy.disabled = true;
    expect.soft(getComputedStyle(copyGlyph).backgroundColor).toBe(copyAriaDisabled);
    expect.soft(getComputedStyle(copy).backgroundColor).toBe(transparent);
    copy.disabled = false;

    setGeneratorInteraction(regenerate, "hover");
    const regenerateHover = getComputedStyle(regenerateGlyph).backgroundColor;
    expect.soft(regenerateHover).not.toBe(transparent);
    expect.soft(getComputedStyle(regenerate).backgroundColor).toBe(transparent);
    setGeneratorInteraction(regenerate, "active");
    const regeneratePressed = getComputedStyle(regenerateGlyph).backgroundColor;
    expect.soft(regeneratePressed).not.toBe(regenerateHover);
    expect.soft(regeneratePressed).not.toBe(transparent);
    expect.soft(getComputedStyle(regenerate).backgroundColor).toBe(transparent);
    setGeneratorInteraction(regenerate, null);

    copy.focus();
    expect.soft(document.activeElement).toBe(copy);
    copy.blur();
    setGeneratorInteraction(copy, "focus");
    expect.soft(cssPixels(getComputedStyle(copy).outlineWidth)).toBe(0);
    expect.soft(cssPixels(getComputedStyle(copyGlyph).outlineWidth)).toBe(0);
    setGeneratorInteraction(copy, "focus focus-visible");
    expect.soft(cssPixels(getComputedStyle(copy).outlineWidth)).toBe(0);
    expect.soft(getComputedStyle(copyGlyph).outlineStyle).toBe("solid");
    expect.soft(getComputedStyle(copyGlyph).outlineWidth).toBe("2px");
    const normalCopyFocusColor = getComputedStyle(copyGlyph).outlineColor;
    setGeneratorInteraction(copy, null);

    modeRadios[0]!.focus();
    expect.soft(document.activeElement).toBe(modeRadios[0]);
    expect.soft(modeRadios[0]!.nextElementSibling).toBe(modeLabels[0]);
    modeRadios[0]!.blur();
    setGeneratorInteraction(modeRadios[0]!, "focus");
    expect.soft(cssPixels(getComputedStyle(modeRadios[0]!).outlineWidth)).toBe(0);
    expect.soft(cssPixels(getComputedStyle(modeLabels[0]!).outlineWidth)).toBe(0);
    expect.soft(cssPixels(getComputedStyle(modePaintLayers[0]!).outlineWidth)).toBe(0);
    setGeneratorInteraction(modeRadios[0]!, "focus focus-visible");
    expect.soft(cssPixels(getComputedStyle(modeRadios[0]!).outlineWidth)).toBe(0);
    expect.soft(cssPixels(getComputedStyle(modeLabels[0]!).outlineWidth)).toBe(0);
    expect.soft(getComputedStyle(modePaintLayers[0]!).outlineWidth).toBe("2px");
    setGeneratorInteraction(modeRadios[0]!, null);

    modeLabels[1]!.click();
    fixture.changeDetectorRef.detectChanges();
    expect.soft(Array.from(modeRadios, (radio) => radio.checked)).toEqual([false, true, false]);
    expect.soft(modeRadios[1]!.type).toBe("radio");

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect.soft(getComputedStyle(copy).minWidth).toBe("44px");
    expect.soft(getComputedStyle(regenerate).minWidth).toBe("44px");
    expect.soft(getComputedStyle(copyGlyph).width).toBe("28px");
    expect.soft(getComputedStyle(copyGlyph).height).toBe("28px");
    expect.soft(getComputedStyle(regenerateGlyph).width).toBe("28px");
    expect.soft(getComputedStyle(regenerateGlyph).height).toBe("28px");
    expect.soft(getComputedStyle(modeGroup).minHeight).toBe("44px");
    expect.soft(Array.from(modeToggles, (toggle) => getComputedStyle(toggle).height))
      .toEqual(Array.from(modeToggles, () => "44px"));
    expect.soft(Array.from(modeRadios, computedHitHeight))
      .toEqual(Array.from(modeRadios, () => 44));
    expect.soft(Array.from(modeLabels, computedHitHeight))
      .toEqual(Array.from(modeLabels, () => 44));
    expect.soft(Array.from(modePaintLayers, computedHitHeight))
      .toEqual(Array.from(modePaintLayers, () => 36));
    expect(getComputedStyle(history).minHeight).toBe("44px");

    const normalResultBorderColor = getComputedStyle(result).borderBottomColor;
    document.documentElement.setAttribute("data-generator-test-media", "reduced-motion");
    expect.soft(getComputedStyle(copyGlyph).animationName).toBe("none");
    expect.soft(getComputedStyle(copyGlyph).transitionDuration).toBe("0s");
    expect.soft(getComputedStyle(copyGlyph).transform).toBe("none");
    expect.soft(getComputedStyle(modePaintLayers[0]!).animationName).toBe("none");
    expect.soft(getComputedStyle(modePaintLayers[0]!).transitionDuration).toBe("0s");
    expect.soft(getComputedStyle(modePaintLayers[0]!).transform).toBe("none");

    document.documentElement.setAttribute("data-generator-test-media", "forced-colors");
    const forcedCopy = forcedColorSignature(copyGlyph);
    const forcedRegenerate = forcedColorSignature(regenerateGlyph);
    expect.soft(getComputedStyle(result).borderBottomColor).not.toBe(normalResultBorderColor);
    expect.soft(forcedCopy.forcedColorAdjust).toBe("none");
    expect.soft(forcedRegenerate.forcedColorAdjust).toBe("none");
    expect.soft(forcedCopy.borderWidth).toBe("1px");
    expect.soft(forcedRegenerate.borderWidth).toBe("1px");
    expect.soft(forcedCopy).not.toEqual(forcedRegenerate);
    copy.setAttribute("aria-disabled", "true");
    const forcedAriaDisabled = forcedColorSignature(copyGlyph);
    expect.soft(copy.disabled).toBe(false);
    expect.soft(forcedAriaDisabled.forcedColorAdjust).toBe("none");
    expect.soft(forcedAriaDisabled).not.toEqual(forcedCopy);
    expect.soft(forcedAriaDisabled).not.toEqual(forcedRegenerate);
    expect.soft(getComputedStyle(copy).backgroundColor).toBe(transparent);
    copy.removeAttribute("aria-disabled");
    setGeneratorInteraction(copy, "focus focus-visible");
    expect.soft(getComputedStyle(copy).outlineWidth).not.toBe("2px");
    expect.soft(getComputedStyle(copyGlyph).outlineWidth).toBe("2px");
    expect.soft(getComputedStyle(copyGlyph).outlineColor).not.toBe(normalCopyFocusColor);
    expect.soft(getComputedStyle(copyGlyph).outlineColor).not.toBe("rgba(0, 0, 0, 0)");
    setGeneratorInteraction(copy, null);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.removeAttribute("data-generator-test-media");
  });

  it("renders real Generator option fields with separate hit and painted geometry", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
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
    const settings = official.querySelector<HTMLElement>(".macos-generator__settings")!;
    const modeLabels = official.querySelectorAll<HTMLLabelElement>(
      ".macos-generator__mode bit-toggle label",
    );
    const outsideField = host.querySelector<HTMLElement>(
      '[data-testid="outside-generator-controls"] [bitfieldcontainer]',
    )!;
    const characterControlNames = ["uppercase", "lowercase", "number", "special"];
    const characterChoices = characterControlNames.map((name) =>
      settings.querySelector<HTMLInputElement>(
        `tools-password-settings input[type="checkbox"][formcontrolname="${name}"]`,
      )!,
    );
    const characterOwners = characterChoices.map((checkbox) =>
      checkbox.closest<HTMLElement>("bit-form-control")!,
    );
    const characterLabels = characterOwners.map((owner) =>
      owner.querySelector<HTMLLabelElement>("label")!,
    );
    const passwordFieldOwners = settings.querySelectorAll<HTMLElement>(
      "tools-password-settings bit-form-field",
    );
    const passwordPaintedControls = settings.querySelectorAll<HTMLElement>(
      "tools-password-settings [bitfieldcontainer]",
    );
    const passwordInputs = Array.from(passwordPaintedControls, (control) =>
      control.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!,
    );
    const passwordFieldLabels = Array.from(passwordFieldOwners, (owner) =>
      owner.querySelector<HTMLLabelElement>(":scope > div > label")!,
    );

    expect.soft(getComputedStyle(settings).display).toBe("grid");
    expect.soft(getComputedStyle(settings).gap).toBe("12px");
    expect.soft(getComputedStyle(settings).marginLeft).toBe("0px");
    expect.soft(getComputedStyle(settings).marginRight).toBe("0px");
    expect.soft(computedHitHeight(outsideField)).toBe(40);
    expect(passwordFieldOwners.length).toBeGreaterThanOrEqual(3);
    expect(passwordPaintedControls).toHaveLength(passwordFieldOwners.length);
    expect(passwordInputs).toHaveLength(passwordFieldOwners.length);
    expect.soft(Array.from(passwordFieldOwners, computedHitHeight).every((height) => height >= 44))
      .toBe(true);
    expect.soft(Array.from(passwordPaintedControls, (control) => getComputedStyle(control).height))
      .toEqual(Array.from(passwordPaintedControls, () => "40px"));
    expect.soft(passwordInputs.map((input) => getComputedStyle(input).height))
      .toEqual(passwordInputs.map(() => "40px"));

    expect(characterChoices).not.toContain(null);
    expect(characterOwners).not.toContain(null);
    expect(characterLabels).not.toContain(null);
    expect.soft(characterChoices.map((choice) => choice.getAttribute("formcontrolname")))
      .toEqual(characterControlNames);
    expect.soft(new Set(characterChoices).size).toBe(4);
    expect.soft(characterChoices.map((choice) => choice.checked))
      .toEqual([true, true, true, false]);
    expect.soft(characterChoices.every((choice, index) => characterLabels[index]!.contains(choice)))
      .toBe(true);
    expect.soft(characterChoices.map(computedHitHeight).every((height) => height <= 24)).toBe(true);
    expect.soft(characterLabels.map(computedHitHeight)).toEqual([44, 44, 44, 44]);
    characterLabels[3]!.click();
    fixture.changeDetectorRef.detectChanges();
    expect.soft(characterChoices.map((choice) => choice.checked)).toEqual([true, true, true, true]);
    characterLabels[0]!.click();
    fixture.changeDetectorRef.detectChanges();
    expect.soft(characterChoices.map((choice) => choice.checked)).toEqual([false, true, true, true]);

    const lengthControl = passwordPaintedControls[0]!;
    const lengthInput = passwordInputs[0]!;
    setGeneratorInteraction(lengthInput, "focus");
    expect.soft(cssPixels(getComputedStyle(lengthControl).outlineWidth)).toBe(0);
    expect.soft(cssPixels(getComputedStyle(lengthInput).outlineWidth)).toBe(0);
    setGeneratorInteraction(lengthInput, "focus focus-visible");
    expect.soft(getComputedStyle(lengthControl).outlineWidth).toBe("2px");
    expect.soft(cssPixels(getComputedStyle(lengthInput).outlineWidth)).toBe(0);
    setGeneratorInteraction(lengthInput, null);

    const uppercase = characterChoices[0]!;
    const uppercaseLabel = characterLabels[0]!;
    setGeneratorInteraction(uppercase, "focus");
    expect.soft(cssPixels(getComputedStyle(uppercaseLabel).outlineWidth)).toBe(0);
    expect.soft(cssPixels(getComputedStyle(uppercase).outlineWidth)).toBe(0);
    setGeneratorInteraction(uppercase, "focus focus-visible");
    expect.soft(getComputedStyle(uppercaseLabel).outlineWidth).toBe("2px");
    expect.soft(cssPixels(getComputedStyle(uppercase).outlineWidth)).toBe(0);
    setGeneratorInteraction(uppercase, null);

    document.documentElement.style.fontSize = "200%";
    expect.soft(getComputedStyle(settings).overflow).toBe("visible");
    expect.soft(characterLabels.map((label) => getComputedStyle(label).whiteSpace))
      .toEqual(characterLabels.map(() => "normal"));
    expect.soft(characterLabels.map((label) => getComputedStyle(label).overflow))
      .toEqual(characterLabels.map(() => "visible"));
    expect.soft(passwordFieldLabels.map((label) => getComputedStyle(label).whiteSpace))
      .toEqual(passwordFieldLabels.map(() => "normal"));
    expect.soft(passwordFieldLabels.map((label) => getComputedStyle(label).overflow))
      .toEqual(passwordFieldLabels.map(() => "visible"));
    expect.soft(Array.from(passwordFieldOwners, computedHitHeight).every((height) => height >= 44))
      .toBe(true);
    document.documentElement.style.removeProperty("font-size");

    const normalFieldBorder = getComputedStyle(lengthControl).borderColor;
    document.documentElement.setAttribute("data-generator-test-media", "reduced-motion");
    expect.soft(getComputedStyle(lengthControl).animationName).toBe("none");
    expect.soft(getComputedStyle(lengthControl).transitionDuration).toBe("0s");
    expect.soft(getComputedStyle(lengthControl).transform).toBe("none");
    expect.soft(getComputedStyle(uppercaseLabel).animationName).toBe("none");
    expect.soft(getComputedStyle(uppercaseLabel).transitionDuration).toBe("0s");
    expect.soft(getComputedStyle(uppercaseLabel).transform).toBe("none");

    document.documentElement.setAttribute("data-generator-test-media", "forced-colors");
    expect.soft(getComputedStyle(lengthControl).forcedColorAdjust).toBe("none");
    expect.soft(getComputedStyle(lengthControl).borderColor).not.toBe(normalFieldBorder);
    setGeneratorInteraction(lengthInput, "focus focus-visible");
    expect.soft(getComputedStyle(lengthControl).outlineWidth).toBe("2px");
    expect.soft(cssPixels(getComputedStyle(lengthInput).outlineWidth)).toBe(0);
    setGeneratorInteraction(lengthInput, null);
    document.documentElement.removeAttribute("data-generator-test-media");

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect.soft(Array.from(passwordFieldOwners, computedHitHeight).every((height) => height >= 44))
      .toBe(true);
    expect.soft(Array.from(passwordPaintedControls, (control) => getComputedStyle(control).height))
      .toEqual(Array.from(passwordPaintedControls, () => "36px"));
    expect.soft(passwordInputs.map((input) => getComputedStyle(input).height))
      .toEqual(passwordInputs.map(() => "36px"));
    expect.soft(characterLabels.map(computedHitHeight)).toEqual([44, 44, 44, 44]);

    modeLabels[1]!.click();
    fixture.changeDetectorRef.detectChanges();
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();
    const passphraseFieldOwners = settings.querySelectorAll<HTMLElement>(
      "tools-passphrase-settings bit-form-field",
    );
    const passphrasePaintedControls = settings.querySelectorAll<HTMLElement>(
      "tools-passphrase-settings [bitfieldcontainer]",
    );
    const passphraseInputs = Array.from(passphrasePaintedControls, (control) =>
      control.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!,
    );
    const passphraseCheckboxLabels = Array.from(
      settings.querySelectorAll<HTMLElement>("tools-passphrase-settings bit-form-control > label"),
    );
    expect(passphraseFieldOwners.length).toBeGreaterThanOrEqual(2);
    expect.soft(Array.from(passphraseFieldOwners, computedHitHeight).every((height) => height >= 44))
      .toBe(true);
    expect.soft(Array.from(passphrasePaintedControls, (control) => getComputedStyle(control).height))
      .toEqual(Array.from(passphrasePaintedControls, () => "36px"));
    expect.soft(passphraseInputs.map((input) => getComputedStyle(input).height))
      .toEqual(passphraseInputs.map(() => "36px"));
    expect.soft(passphraseCheckboxLabels.map(computedHitHeight).every((height) => height >= 44))
      .toBe(true);

    modeLabels[2]!.click();
    fixture.changeDetectorRef.detectChanges();
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();
    const usernameFieldOwner = settings.querySelector<HTMLElement>(
      "bit-form-field.macos-field-owner",
    )!;
    const usernamePaintedControl = usernameFieldOwner?.querySelector<HTMLElement>(
      "[bitfieldcontainer]",
    );
    const usernameSelect = usernameFieldOwner?.querySelector<HTMLElement>(
      "bit-select.macos-control-visible",
    );
    const usernameNgSelect = usernameSelect?.querySelector<HTMLElement>("ng-select");
    const usernameSelectContainer = usernameNgSelect?.querySelector<HTMLElement>(
      ".ng-select-container",
    );
    expect(usernameFieldOwner).not.toBeNull();
    expect(usernamePaintedControl).not.toBeNull();
    expect(usernameSelect).not.toBeNull();
    expect.soft(computedHitHeight(usernameFieldOwner)).toBeGreaterThanOrEqual(44);
    expect.soft([
      usernamePaintedControl,
      usernameSelect,
      usernameNgSelect,
      usernameSelectContainer,
    ].map((control) => getComputedStyle(control!).height)).toEqual(["36px", "36px", "36px", "36px"]);
    const usernameCheckboxLabels = settings.querySelectorAll<HTMLElement>(
      "tools-username-settings bit-form-control > label",
    );
    expect.soft(Array.from(usernameCheckboxLabels, computedHitHeight).every((height) => height >= 44))
      .toBe(true);

    document.documentElement.removeAttribute("data-bw-compact-mode");
    expect.soft([
      usernamePaintedControl,
      usernameSelect,
      usernameNgSelect,
      usernameSelectContainer,
    ].map((control) => getComputedStyle(control!).height)).toEqual(["40px", "40px", "40px", "40px"]);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.removeAttribute("data-generator-test-media");
    document.documentElement.style.removeProperty("font-size");
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
    const clear = host.querySelector<HTMLButtonElement>(
      '[data-testid="generator-history-clear"]',
    );

    expect(content).not.toBeNull();
    expect(row).not.toBeNull();
    expect(clear).not.toBeNull();
    expect(content!.hasAttribute("aria-live")).toBe(false);
    for (const liveRegion of host.querySelectorAll('[aria-live], [role="status"], [role="alert"]')) {
      expect(liveRegion.textContent).not.toContain("history-password");
    }
    const copy = row!.querySelector<HTMLButtonElement>("button")!;
    expect(getComputedStyle(content!).boxShadow).toBe("none");
    expect(getComputedStyle(row!).minHeight).toBe("52px");
    expect(getComputedStyle(row!).borderRadius).toBe("0px");
    expect(getComputedStyle(row!).boxShadow).toBe("none");
    expect(getComputedStyle(copy).minHeight).toBe("44px");
    expect(computedHitWidth(clear!)).toBeGreaterThanOrEqual(44);
    expect(computedHitHeight(clear!)).toBeGreaterThanOrEqual(44);

    clear!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const sheet = host.querySelector<HTMLDialogElement>(
      '[data-testid="generator-history-dialog"]',
    )!;
    const cancel = sheet.querySelector<HTMLButtonElement>(
      '[data-testid="generator-history-clear-cancel"]',
    );
    const danger = sheet.querySelector<HTMLButtonElement>(
      '[data-testid="generator-history-clear-confirm"]',
    );
    expect(sheet.hasAttribute("open")).toBe(true);
    expect(cancel).not.toBeNull();
    expect(danger).not.toBeNull();
    expect([cancel, danger].map((action) => computedHitWidth(action!)))
      .toEqual([44, 44]);
    expect([cancel, danger].map((action) => computedHitHeight(action!)))
      .toEqual([44, 44]);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(row!).minHeight).toBe("44px");
    expect([clear, cancel, danger].map((action) => computedHitWidth(action!)))
      .toEqual([44, 44, 44]);
    expect([clear, cancel, danger].map((action) => computedHitHeight(action!)))
      .toEqual([44, 44, 44]);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });

  it("renders Send as a flat shadowless list with compact-safe rows and actions", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setSends([{
      id: "send-1",
      accessId: "access-token",
      type: "text",
      name: "Payroll token",
      notes: "",
      revisionDate: "2026-08-17T00:00:00.000Z",
      deletionDate: "2030-08-17T00:00:00.000Z",
      disabled: false,
      accessCount: 0,
    }]);
    TestBed.overrideComponent(PopupPageComponent, { set: { template: "<ng-content />" } });
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const list = host.querySelector<HTMLElement>(".macos-send-list")!;
    const row = host.querySelector<HTMLElement>(".macos-send-row")!;
    const actions = row.querySelectorAll<HTMLElement>(".macos-send-row__actions button");
    const newAction = host.querySelector<HTMLButtonElement>('[data-testid="send-new-action"]');
    const filterAction = host.querySelector<HTMLButtonElement>('[data-testid="send-filter-action"]');

    expect(getComputedStyle(list).display).toBe("block");
    expect(getComputedStyle(list).boxShadow).toBe("none");
    expect(getComputedStyle(row).minHeight).toBe("52px");
    expect(getComputedStyle(row).marginBottom).toBe("0px");
    expect(getComputedStyle(row).borderRadius).toBe("0px");
    expect(actions).toHaveLength(2);
    expect(Array.from(actions, (action) => getComputedStyle(action).minWidth)).toEqual([
      "44px",
      "44px",
    ]);
    expect(Array.from(actions, (action) => getComputedStyle(action).minHeight)).toEqual([
      "44px",
      "44px",
    ]);
    expect(newAction).not.toBeNull();
    expect(filterAction).not.toBeNull();
    expect([newAction, filterAction].map((action) => computedHitWidth(action!)))
      .toEqual([44, 44]);
    expect([newAction, filterAction].map((action) => computedHitHeight(action!)))
      .toEqual([44, 44]);

    const more = row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    more.click();
    await fixture.whenStable();
    const deleteAction = document.querySelector<HTMLButtonElement>(
      '[data-testid="send-delete-action"]',
    );
    expect(deleteAction).not.toBeNull();
    expect(computedHitWidth(deleteAction!)).toBeGreaterThanOrEqual(44);
    expect(computedHitHeight(deleteAction!)).toBeGreaterThanOrEqual(44);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(row).minHeight).toBe("44px");
    expect([newAction, filterAction, deleteAction].map((action) => computedHitWidth(action!)))
      .toEqual([44, 44, 44]);
    expect([newAction, filterAction, deleteAction].map((action) => computedHitHeight(action!)))
      .toEqual([44, 44, 44]);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });

  it("renders the real empty Send Create action as a compact-safe 44px target", async () => {
    TestBed.resetTestingModule();
    TestBed.overrideComponent(PopupPageComponent, { set: { template: "<ng-content />" } });
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        PopupStateStore,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const create = host.querySelector<HTMLButtonElement>(
      '[data-testid="send-empty-create-action"]',
    );

    expect(host.querySelector("bw-official-send-list")).not.toBeNull();
    expect(create).not.toBeNull();
    expect(computedHitWidth(create!)).toBe(44);
    expect(computedHitHeight(create!)).toBe(44);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(computedHitWidth(create!)).toBe(44);
    expect(computedHitHeight(create!)).toBe(44);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });

  it("renders the real Send created summary flat with touch-safe link and actions", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OfficialSendCreatedComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialSendCreatedComponent);
    fixture.componentRef.setInput("send", {
      id: "send-created",
      name: "One time secret",
      deletionDate: "2026-08-19T00:00:00.000Z",
      hasPassword: false,
    });
    fixture.componentRef.setInput("formattedExpiration", "1 天");
    fixture.componentRef.setInput("link", "https://vault.example.test/#/send/access/key");
    (fixture.nativeElement as HTMLElement).classList.add("macos-page--send-created");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const summary = host.querySelector<HTMLElement>(".macos-send-created__summary")!;
    const icon = host.querySelector<HTMLElement>(".macos-send-created__icon")!;
    const link = host.querySelector<HTMLInputElement>('[data-testid="created-link"]')!;
    const actions = host.querySelectorAll<HTMLElement>("popup-footer button");

    expect(getComputedStyle(summary).borderRadius).toBe("0px");
    expect(getComputedStyle(summary).boxShadow).toBe("none");
    expect(getComputedStyle(icon).width).toBe("44px");
    expect(getComputedStyle(icon).height).toBe("44px");
    expect(getComputedStyle(link).minHeight).toBe("44px");
    expect(getComputedStyle(link).borderRadius).toBe("10px");
    expect(actions).toHaveLength(2);
    expect(Array.from(actions, computedHitHeight).every((height) => height >= 44)).toBe(true);

    fixture.destroy();
  });

  it("keeps compact rows touch-safe and removes nonessential motion", () => {
    const css = style.textContent ?? "";
    expect(css).toMatch(/:root\[data-bw-compact-mode="true"\][\s\S]*?\.macos-generator__history-link\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/:root\[data-bw-compact-mode="true"\][\s\S]*?\.macos-generator-history__row\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/:root\[data-bw-compact-mode="true"\][\s\S]*?\.macos-send-row\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.bit-menu-panel \[role="menu"\][\s\S]*?animation:\s*none/s);
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

function computedHitWidth(target: Element): number {
  const style = getComputedStyle(target);
  const explicit = Math.max(cssPixels(style.minWidth), cssPixels(style.width));
  const contentBox = cssPixels(style.paddingLeft)
    + cssPixels(style.paddingRight)
    + cssPixels(style.borderLeftWidth)
    + cssPixels(style.borderRightWidth);
  const descendantWidth = Math.max(
    0,
    ...Array.from(target.children, computedHitWidth),
  );
  return Math.max(explicit, contentBox, descendantWidth);
}

function cssPixels(value: string): number {
  return value.endsWith("px") ? Number.parseFloat(value) : 0;
}

function forcedColorSignature(target: HTMLElement) {
  const computed = getComputedStyle(target);
  return {
    backgroundColor: computed.backgroundColor,
    borderColor: computed.borderColor,
    borderWidth: computed.borderWidth,
    color: computed.color,
    forcedColorAdjust: computed.forcedColorAdjust,
  };
}

function setGeneratorInteraction(target: HTMLElement, interaction: string | null) {
  if (interaction) {
    target.setAttribute("data-generator-test-interaction", interaction);
  } else {
    target.removeAttribute("data-generator-test-interaction");
  }
}

function projectGeneratorInteractionAndMediaRules(sheet: CSSStyleSheet): string {
  const projected: string[] = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type === CSSRule.STYLE_RULE) {
      const styleRule = rule as CSSStyleRule;
      if (
        styleRule.selectorText.includes(".macos-generator")
        && /:(?:hover|active|focus)/.test(styleRule.selectorText)
      ) {
        projected.push(`${projectGeneratorInteractionSelector(styleRule.selectorText)} { ${styleRule.style.cssText} }`);
      }
      continue;
    }
    if (rule.type !== CSSRule.MEDIA_RULE) continue;
    const mediaRule = rule as CSSMediaRule;
    const media = mediaRule.conditionText.includes("prefers-reduced-motion")
      ? "reduced-motion"
      : mediaRule.conditionText.includes("forced-colors")
        ? "forced-colors"
        : null;
    if (!media) continue;
    for (const nestedRule of Array.from(mediaRule.cssRules)) {
      if (nestedRule.type !== CSSRule.STYLE_RULE) continue;
      const styleRule = nestedRule as CSSStyleRule;
      if (!styleRule.selectorText.includes(".macos-generator")) continue;
      projected.push(
        `:root[data-generator-test-media="${media}"] :is(${projectGeneratorInteractionSelector(styleRule.selectorText)}) { ${styleRule.style.cssText} }`,
      );
    }
  }
  return projected.join("\n");
}

function projectGeneratorInteractionSelector(selector: string): string {
  return selector
    .replaceAll(":focus-visible", '[data-generator-test-interaction~="focus-visible"]')
    .replaceAll(":focus", '[data-generator-test-interaction~="focus"]')
    .replaceAll(":hover", '[data-generator-test-interaction~="hover"]')
    .replaceAll(":active", '[data-generator-test-interaction~="active"]');
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

function sendFormValue() {
  return {
    name: "Text Send",
    text: "message",
    hidden: false,
    deletionPresetHours: 24 as const,
    authType: "none" as const,
    password: "",
    maxAccessCount: "",
    hideEmail: false,
    notes: "",
  };
}
