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
import { ActivatedRoute, provideRouter } from "@angular/router";
import { of } from "rxjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogService, FormFieldModule } from "@bitwarden/components";

import { PopupStateStore } from "../popup-state";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import { PopupPageComponent } from "../layout/popup-page.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { officialCurrentAccountTestProviders } from "../official-ui/official-current-account.test-support";
import { ClipboardPolicyService } from "../settings/clipboard-policy.service";
import { SendAddEditPageComponent } from "../send/send-add-edit-page.component";
import { SEND_CREATED_HOST, SendCreatedPageComponent } from "../send/send-created-page.component";
import { SendPageComponent } from "../send/send-page.component";
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
  .tw-flex { display: flex; }
  .tw-w-full { width: 100%; }
  .tw-basis-1\\/2 { flex-basis: 50%; }
  .tw-mr-4 { margin-right: 16px; }
  .tw-min-h-10 { min-height: 40px; }
  .tw-mb-4 { margin-bottom: 16px; }
  :root[data-bw-compact-mode="true"] .bit-compact\\:tw-mb-3 { margin-bottom: 12px; }
  .tw-h-6 { height: 24px; }
  .tw-leading-5 { line-height: 1.25rem; }
  .tw-py-2 { padding-top: 8px; padding-bottom: 8px; }
  .tw-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  [bitTypography="body2"] { font-size: 14px; line-height: 20px; }
  [bitTypography="helper"] { font-size: 12px; line-height: 16px; }
  .tw-py-1\\.5 { padding-top: 6px; padding-bottom: 6px; }
  .tw-mb-1\\.5 { margin-bottom: 6px; }
  .tw-border-y { border-top-width: 1px; border-bottom-width: 1px; }
  :root[data-bw-compact-mode="true"] [class~="bit-compact:tw-py-1.5"] {
    padding-top: 6px;
    padding-bottom: 6px;
  }
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
  .macos-generator__mode bit-toggle,
  .macos-generator__mode bit-toggle > :is(input[type="radio"], label),
  .macos-generator__mode bit-toggle > label > span:first-child {
    max-height: 40px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    -webkit-line-clamp: 1;
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
  .macos-generator__settings [data-generator-test-text-scale="control"] {
    height: 40px;
    overflow: hidden;
    line-height: 40px;
  }
  .macos-generator__settings [data-generator-test-text-scale="row"] {
    overflow: hidden;
    flex-wrap: nowrap;
  }
  .macos-generator-history__row {
    height: 52px;
    overflow: hidden;
    border-radius: 12px;
    box-shadow: 0 8px 20px rgb(0 0 0 / 20%);
  }
  .macos-generator-history__row bit-color-password {
    max-height: 20px;
    overflow: hidden;
    white-space: nowrap;
  }
  .macos-generator-history__row button,
  .macos-generator-history__row button .bwi {
    animation: generator-hostile-motion 1s infinite;
    transition: background-color 1s linear;
    transform: scale(1.1);
  }
  .macos-generator-history__row button:focus:not(:focus-visible),
  .macos-generator-history__row button:focus:not(:focus-visible) .bwi {
    outline-color: red !important;
    outline-style: solid !important;
    outline-width: 3px !important;
  }
  @keyframes generator-hostile-motion {
    from { opacity: 0.99; }
    to { opacity: 1; }
  }
  .macos-page--send .macos-send-row {
    background: rgb(255 0 0);
    box-shadow: 0 8px 20px rgb(0 0 0 / 20%);
  }
  .macos-page--send .macos-send-row button[bit-item-content].macos-hit-target {
    max-height: 44px;
    padding-inline: 16px;
    padding-left: 16px !important;
    padding-right: 16px !important;
    overflow: hidden;
  }
  .macos-page--send .macos-send-row button[bit-item-content].macos-hit-target :is(
    .tw-truncate,
    [bitTypography="body2"] > div,
    [bitTypography="helper"]
  ) {
    max-height: 20px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .macos-page--send :is(
    [data-testid="send-filter-action"],
    .macos-send-row__actions button
  ) {
    background: rgb(255 0 0);
    box-shadow: 0 0 0 3px red;
  }
  .macos-page--send :is(
    [data-testid="send-filter-action"],
    .macos-send-row__actions button
  ) > span {
    animation: generator-hostile-motion 1s infinite;
    transition: background-color 1s linear;
  }
  .macos-page--send-form .macos-send-form__group {
    gap: 0;
    padding-inline: 16px;
    background: rgb(255 0 0);
    box-shadow: 0 8px 20px rgb(0 0 0 / 20%);
  }
  .macos-page--send-form .macos-send-form__field {
    min-height: 32px;
    max-height: 44px;
    padding: 10px 16px;
    overflow: hidden;
  }
  .macos-page--send-form :is(input, bit-select, [role="combobox"]) {
    height: 44px;
    min-height: 44px;
    max-height: 44px;
    overflow: hidden;
  }
  .macos-page--send-form textarea {
    min-height: 44px;
  }
  .macos-page--send-form .macos-send-form__icon-action {
    min-width: 32px;
    min-height: 32px;
    background: rgb(255 0 0);
    box-shadow: 0 0 0 3px red;
  }
  .macos-page--send-form .macos-send-form__icon-action > span {
    animation: generator-hostile-motion 1s infinite;
    transition: background-color 1s linear;
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
  style.textContent += projectSendFormPseudoRules(style.sheet!);
  normalizeImportantMotionShorthandsForJSDOM(style.sheet!);
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
  it("renders the real Send add form with compact painted controls and touch-safe owners", async () => {
    const fixture = await createRealSendFormFixture();
    fixture.componentInstance.form.patch({
      authType: "password",
      password: "generated password",
      hideEmail: true,
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const groups = host.querySelectorAll<HTMLElement>(".macos-send-form__group");
    const fields = host.querySelectorAll<HTMLElement>(
      "bit-form-field.macos-field-owner, .macos-preference-row",
    );
    const fieldContainers = host.querySelectorAll<HTMLElement>("[bitfieldcontainer]");
    const controls = host.querySelectorAll<HTMLElement>(
      "input.macos-control-visible, bit-select.macos-control-visible, [role=combobox]",
    );
    const textareas = host.querySelectorAll<HTMLTextAreaElement>("textarea");
    const switches = host.querySelectorAll<HTMLButtonElement>(
      'button.macos-switch-owner[role="switch"]',
    );
    const save = host.querySelector<HTMLButtonElement>('[data-testid="save-send"]')!;
    const iconOwners = host.querySelectorAll<HTMLButtonElement>(
      ".macos-send-form__icon-action",
    );

    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(fields.length).toBeGreaterThanOrEqual(8);
    expect(fieldContainers.length).toBeGreaterThanOrEqual(6);
    expect(controls.length).toBeGreaterThanOrEqual(5);
    expect(textareas).toHaveLength(2);
    expect(switches).toHaveLength(2);
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector("bit-card")).toBeNull();
    for (const group of groups) {
      expect(getComputedStyle(group).gap).toBe("12px");
      expect(getComputedStyle(group).paddingLeft).toBe("0px");
      expect(getComputedStyle(group).paddingRight).toBe("0px");
      expect(getComputedStyle(group).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(group).boxShadow).toBe("none");
    }
    for (const field of fields) {
      expect(cssPixels(getComputedStyle(field).minHeight)).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(field).maxHeight).toBe("none");
      expect(getComputedStyle(field).paddingLeft).toBe("0px");
      expect(getComputedStyle(field).paddingRight).toBe("0px");
      expect(getComputedStyle(field).overflow).toBe("visible");
    }
    for (const fieldContainer of fieldContainers) {
      expect(cssPixels(getComputedStyle(fieldContainer).minHeight)).toBeGreaterThanOrEqual(44);
    }
    for (const control of controls) {
      expect(getComputedStyle(control).minHeight).toBe("40px");
      expect(modeledSingleLineControlPaintHeight(control)).toBe(40);
      expect(getComputedStyle(control).maxHeight).toBe("none");
    }
    for (const textarea of textareas) {
      expect(cssPixels(getComputedStyle(textarea).minHeight)).toBeGreaterThanOrEqual(72);
    }
    expect(host.querySelectorAll(".macos-primary-action")).toHaveLength(1);
    expect(save.classList).toContain("macos-button-owner");
    expect(getComputedStyle(save).minHeight).toBe("44px");
    expect(getComputedStyle(save).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const savePaint = document.createElement("span");
    savePaint.setAttribute("data-send-form-test-paint", "");
    savePaint.setAttribute("aria-hidden", "true");
    save.prepend(savePaint);
    expect(modeledSendPrimaryPaintHeight(save, savePaint)).toBe(40);
    const saveInitial = getComputedStyle(savePaint).backgroundColor;
    setGeneratorInteraction(save, "hover");
    const saveHover = getComputedStyle(savePaint).backgroundColor;
    setGeneratorInteraction(save, "active");
    const savePressed = getComputedStyle(savePaint).backgroundColor;
    expect(new Set([saveInitial, saveHover, savePressed]).size).toBe(3);
    setGeneratorInteraction(save, "focus");
    expect(cssPixels(getComputedStyle(save).outlineWidth)).toBe(0);
    expect(cssPixels(getComputedStyle(savePaint).outlineWidth)).toBe(0);
    setGeneratorInteraction(save, "focus focus-visible");
    expect(cssPixels(getComputedStyle(save).outlineWidth)).toBe(0);
    expect(getComputedStyle(savePaint).outlineWidth).toBe("2px");
    setGeneratorInteraction(save, null);
    save.disabled = true;
    expect(getComputedStyle(savePaint).backgroundColor).not.toBe(saveInitial);
    expect(Number.parseFloat(getComputedStyle(savePaint).opacity)).toBeLessThan(1);
    save.disabled = false;
    save.setAttribute("aria-disabled", "true");
    expect(getComputedStyle(savePaint).backgroundColor).not.toBe(saveInitial);
    expect(Number.parseFloat(getComputedStyle(savePaint).opacity)).toBeLessThan(1);
    save.removeAttribute("aria-disabled");
    expect(switches[0]!.getAttribute("aria-checked")).toBe("false");
    expect(switches[1]!.getAttribute("aria-checked")).toBe("true");
    expect(Array.from(switches, computedHitHeight)).toEqual([44, 44]);
    expect(iconOwners.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(iconOwners, computedHitHeight).every((height) => height >= 44)).toBe(true);
    const iconPlates = Array.from(iconOwners, (owner) =>
      owner.querySelector<HTMLElement>(":scope > span")!,
    );
    expect(iconPlates.map((plate) => getComputedStyle(plate).width))
      .toEqual(iconPlates.map(() => "32px"));
    expect(iconPlates.map((plate) => getComputedStyle(plate).height))
      .toEqual(iconPlates.map(() => "32px"));
    const nestedTextSection = host.querySelector<HTMLElement>(
      "bw-official-send-text-details > bit-section > section",
    )!;
    expect(getComputedStyle(nestedTextSection).display).toBe("grid");
    expect(getComputedStyle(nestedTextSection).gap).toBe("12px");

    const iconOwner = iconOwners[0]!;
    const iconPlate = iconPlates[0]!;
    const normalPlateBackground = getComputedStyle(iconPlate).backgroundColor;
    setGeneratorInteraction(iconOwner, "hover");
    expect(getComputedStyle(iconOwner).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(iconPlate).backgroundColor).not.toBe(normalPlateBackground);
    setGeneratorInteraction(iconOwner, "active");
    expect(getComputedStyle(iconOwner).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    setGeneratorInteraction(iconOwner, "focus");
    expect(cssPixels(getComputedStyle(iconOwner).outlineWidth)).toBe(0);
    expect(cssPixels(getComputedStyle(iconPlate).outlineWidth)).toBe(0);
    setGeneratorInteraction(iconOwner, "focus focus-visible");
    expect(cssPixels(getComputedStyle(iconOwner).outlineWidth)).toBe(0);
    expect(getComputedStyle(iconPlate).outlineWidth).toBe("2px");
    setGeneratorInteraction(iconOwner, null);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    for (const control of controls) {
      expect(modeledSingleLineControlPaintHeight(control)).toBe(36);
    }
    for (const group of groups) expect(getComputedStyle(group).gap).toBe("10px");
    for (const control of controls) {
      expect(getComputedStyle(control).minHeight).toBe("36px");
    }
    expect(iconPlates.map((plate) => getComputedStyle(plate).width))
      .toEqual(iconPlates.map(() => "28px"));
    expect(iconPlates.map((plate) => getComputedStyle(plate).height))
      .toEqual(iconPlates.map(() => "28px"));
    expect(modeledSendPrimaryPaintHeight(save, savePaint)).toBe(36);
    expect(getComputedStyle(nestedTextSection).gap).toBe("10px");

    document.documentElement.style.fontSize = "200%";
    for (const field of fields) {
      expect(getComputedStyle(field).height).toBe("auto");
      expect(getComputedStyle(field).maxHeight).toBe("none");
      expect(getComputedStyle(field).overflow).toBe("visible");
    }
    for (const label of host.querySelectorAll<HTMLElement>("bit-label, bit-hint")) {
      expect(getComputedStyle(label).whiteSpace).toBe("normal");
      expect(getComputedStyle(label).overflow).toBe("visible");
    }

    document.documentElement.setAttribute("data-generator-test-media", "reduced-motion");
    expect(getComputedStyle(iconOwner).transitionDuration).toBe("0s");
    expect(getComputedStyle(iconPlate).transitionDuration).toBe("0s");
    document.documentElement.setAttribute("data-generator-test-media", "forced-colors");
    expect(getComputedStyle(iconPlate).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(iconPlate).borderWidth).toBe("1px");
    expect(getComputedStyle(savePaint).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(savePaint).backgroundColor).not.toBe(saveInitial);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.removeAttribute("data-generator-test-media");
    document.documentElement.style.removeProperty("font-size");
  });

  it("renders the real Send read-only form as growing controls without a filled primary", async () => {
    const fixture = await createRealSendFormFixture(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList).toContain("macos-page--send-form");
    expect(host.querySelector("bw-official-send-add-edit > popup-page")).not.toBeNull();
    const readonlyInputs = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input[bitinput][readonly],textarea[bitinput][readonly]",
    );
    const values = host.querySelectorAll<HTMLElement>(
      '.macos-send-readonly-value[role="textbox"][aria-readonly="true"]',
    );
    expect(readonlyInputs).toHaveLength(values.length);
    for (const source of readonlyInputs) {
      expect(source.classList).toContain("macos-send-readonly-source");
      expect(source.getAttribute("aria-hidden")).toBe("true");
      expect(source.tabIndex).toBe(-1);
      expect(source.value).toBe("");
    }
    expect(host.querySelector<HTMLInputElement>('.macos-send-readonly-source[type="password"]')?.value)
      .toBe("");
    expect(values.length).toBeGreaterThanOrEqual(5);
    for (const value of values) {
      const labelledBy = value.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      const label = host.querySelector<HTMLElement>(`#${labelledBy}`);
      expect(label?.textContent?.trim().length).toBeGreaterThan(0);
    }
    const passwordValue = host.querySelector<HTMLElement>(
      '.macos-send-readonly-value[data-field="password"]',
    )!;
    const passwordLabel = host.querySelector<HTMLElement>(
      `#${passwordValue.getAttribute("aria-labelledby")}`,
    )!;
    expect(passwordLabel.textContent?.trim()).toBe(TestBed.inject(I18nService).t("password"));
    expect(host.querySelectorAll(".macos-primary-action")).toHaveLength(0);
    expect(host.querySelector('[data-testid="edit-send"]')).not.toBeNull();
    const switches = host.querySelectorAll<HTMLButtonElement>('button[role="switch"]');
    expect(switches).toHaveLength(2);
    expect(Array.from(switches).every((owner) => owner.disabled)).toBe(true);
    expect(host.querySelector("bit-card")).toBeNull();
    const page = host.querySelector<HTMLElement>("popup-page")!;
    expect(page.classList).toContain("macos-send-form--readonly");
    const groups = host.querySelectorAll<HTMLElement>(".macos-send-form__group");
    expect(Array.from(groups, (group) => getComputedStyle(group).gap))
      .toEqual(Array.from(groups, () => "0px"));
    const rows = host.querySelectorAll<HTMLElement>(
      "bit-form-field.macos-field-owner:has(.macos-send-readonly-value) > div",
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(getComputedStyle(row).display).toBe("grid");
      expect(getComputedStyle(row).gridTemplateColumns).not.toBe("none");
      expect(cssPixels(getComputedStyle(row).minHeight)).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(row).overflow).toBe("visible");
    }

    const nameValue = host.querySelector<HTMLElement>(
      '.macos-send-readonly-value[data-field="name"]',
    )!;
    nameValue.style.width = "180px";
    const normalFontSize = cssLengthPixels(getComputedStyle(nameValue).fontSize, 16);
    const normalLineHeight = cssLengthPixels(getComputedStyle(nameValue).lineHeight, 16);
    const normalModeledHeight = modeledNaturalReadonlyHeight(nameValue, 180, 16);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(Array.from(groups, (group) => getComputedStyle(group).gap))
      .toEqual(Array.from(groups, () => "0px"));
    for (const row of rows) {
      expect(cssPixels(getComputedStyle(row).minHeight)).toBeGreaterThanOrEqual(44);
    }

    document.documentElement.style.fontSize = "200%";
    for (const value of values) {
      expect(getComputedStyle(value).height).toBe("auto");
      expect(getComputedStyle(value).maxHeight).toBe("none");
      expect(getComputedStyle(value).overflow).toBe("visible");
      expect(["normal", "pre-wrap"]).toContain(getComputedStyle(value).whiteSpace);
    }
    expect(Array.from(values, (value) => value.textContent)).toContain(
      "Mounted multi-line secret value",
    );
    expect(nameValue.querySelector("br")).toBeNull();
    const scaledFontSize = cssLengthPixels(getComputedStyle(nameValue).fontSize, 32);
    const scaledLineHeight = cssLengthPixels(getComputedStyle(nameValue).lineHeight, 32);
    const scaledModeledHeight = modeledNaturalReadonlyHeight(nameValue, 180, 32);
    expect(scaledFontSize).toBeGreaterThan(normalFontSize);
    expect(scaledLineHeight).toBeGreaterThan(normalLineHeight);
    expect(scaledModeledHeight).toBeGreaterThan(normalModeledHeight);
    expect(scaledModeledHeight).toBeGreaterThan(44);
    for (const region of host.querySelectorAll<HTMLElement>('[role="status"],[role="alert"],[aria-live]')) {
      expect(region.textContent).not.toContain("Mounted multi-line secret value");
      expect(region.textContent).not.toContain("Mounted private note");
    }

    host.querySelector<HTMLButtonElement>('[data-testid="edit-send"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges(false);
    const dangerOwners = [
      host.querySelector<HTMLButtonElement>('button[biticonbutton="bwi-trash"]'),
      host.querySelector<HTMLButtonElement>('button[biticonbutton="bwi-minus-circle"]'),
    ];
    expect(dangerOwners.every((owner) => owner?.classList.contains("macos-send-form__danger-action")))
      .toBe(true);
    document.documentElement.setAttribute("data-generator-test-media", "forced-colors");
    const dangerColor = resolvedTestSystemColor("Mark");
    for (const owner of dangerOwners) {
      expect(owner).not.toBeNull();
      const plate = owner!.querySelector<HTMLElement>(":scope > span")!;
      expect(getComputedStyle(plate).forcedColorAdjust).toBe("none");
      expect(getComputedStyle(plate).color).toBe(dangerColor);
      expect(getComputedStyle(plate).borderColor).toBe(dangerColor);
    }

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.removeAttribute("data-generator-test-media");
    document.documentElement.style.removeProperty("font-size");
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
    expect.soft(Array.from(modeToggles, computedHitHeight))
      .toEqual(Array.from(modeToggles, () => 44));
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

    regenerate.setAttribute("aria-disabled", "true");
    const regenerateAriaDisabled = forcedColorSignature(regenerateGlyph);
    setGeneratorInteraction(regenerate, "hover");
    expect.soft(forcedColorSignature(regenerateGlyph)).toEqual(regenerateAriaDisabled);
    setGeneratorInteraction(regenerate, "active");
    expect.soft(forcedColorSignature(regenerateGlyph)).toEqual(regenerateAriaDisabled);
    expect.soft(getComputedStyle(regenerate).backgroundColor).toBe(transparent);
    setGeneratorInteraction(regenerate, null);
    regenerate.removeAttribute("aria-disabled");
    regenerate.disabled = true;
    expect.soft(forcedColorSignature(regenerateGlyph)).toEqual(regenerateAriaDisabled);
    setGeneratorInteraction(regenerate, "hover active");
    expect.soft(forcedColorSignature(regenerateGlyph)).toEqual(regenerateAriaDisabled);
    expect.soft(getComputedStyle(regenerate).backgroundColor).toBe(transparent);
    setGeneratorInteraction(regenerate, null);
    regenerate.disabled = false;

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

    const modeDefault = getComputedStyle(modePaintLayers[2]!).backgroundColor;
    setGeneratorInteraction(modeLabels[2]!, "active");
    expect.soft(getComputedStyle(modePaintLayers[2]!).backgroundColor).not.toBe(modeDefault);
    setGeneratorInteraction(modeLabels[2]!, null);

    modePaintLayers[0]!.textContent = "Password";
    modePaintLayers[1]!.replaceChildren(
      document.createTextNode("Long localized"),
      document.createElement("br"),
      document.createTextNode("passphrase mode"),
      document.createElement("br"),
      document.createTextNode("description"),
    );
    modePaintLayers[2]!.textContent = "Username";
    document.documentElement.style.fontSize = "200%";
    expect.soft(Array.from(modeToggles, (toggle) => ({
      height: getComputedStyle(toggle).height,
      minHeight: getComputedStyle(toggle).minHeight,
      maxHeight: getComputedStyle(toggle).maxHeight,
      overflow: getComputedStyle(toggle).overflow,
    }))).toEqual(Array.from(modeToggles, () => ({
      height: "auto",
      minHeight: "44px",
      maxHeight: "none",
      overflow: "visible",
    })));
    expect.soft(Array.from(modeLabels, (label) => ({
      height: getComputedStyle(label).height,
      minHeight: getComputedStyle(label).minHeight,
      maxHeight: getComputedStyle(label).maxHeight,
      overflow: getComputedStyle(label).overflow,
      whiteSpace: getComputedStyle(label).whiteSpace,
    }))).toEqual(Array.from(modeLabels, () => ({
      height: "auto",
      minHeight: "44px",
      maxHeight: "none",
      overflow: "visible",
      whiteSpace: "normal",
    })));
    expect.soft(Array.from(modePaintLayers, (layer) => ({
      height: getComputedStyle(layer).height,
      minHeight: getComputedStyle(layer).minHeight,
      maxHeight: getComputedStyle(layer).maxHeight,
      overflow: getComputedStyle(layer).overflow,
      whiteSpace: getComputedStyle(layer).whiteSpace,
      textOverflow: getComputedStyle(layer).textOverflow,
      lineClamp: getComputedStyle(layer).getPropertyValue("-webkit-line-clamp"),
    }))).toEqual(Array.from(modePaintLayers, () => ({
      height: "auto",
      minHeight: "40px",
      maxHeight: "none",
      overflow: "visible",
      whiteSpace: "normal",
      textOverflow: "clip",
      lineClamp: "none",
    })));
    expect.soft(getComputedStyle(modeGroup).alignItems).toBe("stretch");
    expect.soft(Array.from(modeToggles, (toggle) => getComputedStyle(toggle).alignItems))
      .toEqual(Array.from(modeToggles, () => "stretch"));
    expect.soft(Array.from(modeRadios, (radio) => getComputedStyle(radio).alignSelf))
      .toEqual(Array.from(modeRadios, () => "stretch"));
    expect.soft(Array.from(modeLabels, (label) => getComputedStyle(label).alignSelf))
      .toEqual(Array.from(modeLabels, () => "stretch"));
    expect.soft(Array.from(modeLabels, (label) => getComputedStyle(label).alignItems))
      .toEqual(Array.from(modeLabels, () => "stretch"));
    expect.soft(Array.from(modePaintLayers, (layer) => getComputedStyle(layer).alignSelf))
      .toEqual(Array.from(modePaintLayers, () => "stretch"));
    expect.soft(modeledStretchedModeHeights(
      modeGroup,
      modeToggles,
      modeRadios,
      modeLabels,
      modePaintLayers,
    ))
      .toEqual({
        intrinsic: [44, 124, 44],
        toggleOwners: [124, 124, 124],
        radioOwners: [124, 124, 124],
        labelOwners: [124, 124, 124],
        paintedLayers: [120, 120, 120],
      });
    document.documentElement.style.removeProperty("font-size");

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    modePaintLayers[0]!.textContent = "Password";
    modePaintLayers[1]!.textContent = "Passphrase";
    modePaintLayers[2]!.textContent = "Username";
    expect.soft(Array.from(modeLabels, (label) => ({
      paddingTop: getComputedStyle(label).paddingTop,
      paddingBottom: getComputedStyle(label).paddingBottom,
    }))).toEqual(Array.from(modeLabels, () => ({ paddingTop: "4px", paddingBottom: "4px" })));
    expect.soft(modeledStretchedModeHeights(
      modeGroup,
      modeToggles,
      modeRadios,
      modeLabels,
      modePaintLayers,
    )).toEqual({
      intrinsic: [44, 44, 44],
      toggleOwners: [44, 44, 44],
      radioOwners: [44, 44, 44],
      labelOwners: [44, 44, 44],
      paintedLayers: [36, 36, 36],
    });

    modePaintLayers[1]!.replaceChildren(
      document.createTextNode("Long localized"),
      document.createElement("br"),
      document.createTextNode("passphrase mode"),
      document.createElement("br"),
      document.createTextNode("description"),
    );
    document.documentElement.style.fontSize = "200%";
    const compactScaledMode = modeledStretchedModeHeights(
      modeGroup,
      modeToggles,
      modeRadios,
      modeLabels,
      modePaintLayers,
    );
    expect.soft(compactScaledMode).toEqual({
      intrinsic: [48, 128, 48],
      toggleOwners: [128, 128, 128],
      radioOwners: [128, 128, 128],
      labelOwners: [128, 128, 128],
      paintedLayers: [120, 120, 120],
    });
    expect.soft(compactScaledMode.labelOwners.map((owner, index) =>
      owner - compactScaledMode.paintedLayers[index]!
    )).toEqual([8, 8, 8]);
    expect.soft(Array.from(modePaintLayers, (layer) => ({
      overflow: getComputedStyle(layer).overflow,
      whiteSpace: getComputedStyle(layer).whiteSpace,
      textOverflow: getComputedStyle(layer).textOverflow,
      maxHeight: getComputedStyle(layer).maxHeight,
    }))).toEqual(Array.from(modePaintLayers, () => ({
      overflow: "visible",
      whiteSpace: "normal",
      textOverflow: "clip",
      maxHeight: "none",
    })));
    document.documentElement.style.removeProperty("font-size");
    modePaintLayers[1]!.textContent = "Passphrase";
    expect.soft(getComputedStyle(copy).minWidth).toBe("44px");
    expect.soft(getComputedStyle(regenerate).minWidth).toBe("44px");
    expect.soft(getComputedStyle(copyGlyph).width).toBe("28px");
    expect.soft(getComputedStyle(copyGlyph).height).toBe("28px");
    expect.soft(getComputedStyle(regenerateGlyph).width).toBe("28px");
    expect.soft(getComputedStyle(regenerateGlyph).height).toBe("28px");
    expect.soft(getComputedStyle(modeGroup).minHeight).toBe("44px");
    expect.soft(Array.from(modeToggles, computedHitHeight))
      .toEqual(Array.from(modeToggles, () => 44));
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
    regenerate.setAttribute("aria-disabled", "true");
    const forcedRegenerateDisabled = forcedColorSignature(regenerateGlyph);
    expect.soft(forcedRegenerateDisabled).not.toEqual(forcedRegenerate);
    setGeneratorInteraction(regenerate, "hover active");
    expect.soft(forcedColorSignature(regenerateGlyph)).toEqual(forcedRegenerateDisabled);
    setGeneratorInteraction(regenerate, null);
    regenerate.removeAttribute("aria-disabled");
    regenerate.disabled = true;
    expect.soft(forcedColorSignature(regenerateGlyph)).toEqual(forcedRegenerateDisabled);
    regenerate.disabled = false;
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
    const characterRow = characterOwners[0]!.parentElement!;
    const dualFieldRow = passwordFieldOwners[1]!.parentElement!;

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
    expect.soft(Array.from(passwordPaintedControls, (control) => ({
      height: getComputedStyle(control).height,
      minHeight: getComputedStyle(control).minHeight,
    }))).toEqual(Array.from(passwordPaintedControls, () => ({ height: "auto", minHeight: "40px" })));
    expect.soft(passwordInputs.map((input) => ({
      height: getComputedStyle(input).height,
      minHeight: getComputedStyle(input).minHeight,
    }))).toEqual(passwordInputs.map(() => ({ height: "auto", minHeight: "40px" })));

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
    expect.soft(characterRow.querySelectorAll(":scope > bit-form-control")).toHaveLength(4);
    expect.soft(dualFieldRow.querySelectorAll(":scope > bit-form-field")).toHaveLength(2);
    const dualFields = Array.from(
      dualFieldRow.querySelectorAll<HTMLElement>(":scope > bit-form-field"),
    );
    document.documentElement.style.fontSize = "100%";
    const rootFontSizeAt100 = effectiveRootFontSize(16);
    expect.soft(document.documentElement.style.fontSize).toBe("100%");
    expect.soft(rootFontSizeAt100).toBe(16);
    dualFieldRow.style.width = "480px";
    expect.soft(dualFields.map((field) =>
      field.querySelector<HTMLInputElement>('input[type="number"]')?.getAttribute("formcontrolname")
    )).toEqual(["minNumber", "minSpecial"]);
    expect.soft({
      display: getComputedStyle(dualFieldRow).display,
      flexWrap: getComputedStyle(dualFieldRow).flexWrap,
      columnGap: getComputedStyle(dualFieldRow).columnGap,
      rowGap: getComputedStyle(dualFieldRow).rowGap,
    }).toEqual({ display: "flex", flexWrap: "wrap", columnGap: "12px", rowGap: "12px" });
    expect.soft(dualFields.map((field) => ({
      flexBasis: getComputedStyle(field).flexBasis,
      flexGrow: getComputedStyle(field).flexGrow,
      flexShrink: getComputedStyle(field).flexShrink,
      minWidth: getComputedStyle(field).minWidth,
      width: getComputedStyle(field).width,
      marginRight: getComputedStyle(field).marginRight,
    }))).toEqual(Array.from({ length: 2 }, () => ({
      flexBasis: "13rem",
      flexGrow: "1",
      flexShrink: "1",
      minWidth: "0px",
      width: "auto",
      marginRight: "0px",
    })));
    expect.soft(modeledWrappedFlexLayout(dualFieldRow, dualFields, rootFontSizeAt100))
      .toEqual({ rowCount: 1, itemWidths: [234, 234] });

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect.soft(dualFields.map((field) => ({
      flexBasis: getComputedStyle(field).flexBasis,
      flexGrow: getComputedStyle(field).flexGrow,
      width: getComputedStyle(field).width,
      marginRight: getComputedStyle(field).marginRight,
    }))).toEqual(Array.from({ length: 2 }, () => ({
      flexBasis: "13rem",
      flexGrow: "1",
      width: "auto",
      marginRight: "0px",
    })));
    expect.soft(modeledWrappedFlexLayout(dualFieldRow, dualFields, rootFontSizeAt100))
      .toEqual({ rowCount: 1, itemWidths: [234, 234] });
    document.documentElement.removeAttribute("data-bw-compact-mode");
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

    for (const target of [...passwordPaintedControls, ...passwordInputs]) {
      target.setAttribute("data-generator-test-text-scale", "control");
    }
    characterRow.setAttribute("data-generator-test-text-scale", "row");
    dualFieldRow.setAttribute("data-generator-test-text-scale", "row");
    document.documentElement.style.fontSize = "200%";
    expect.soft(modeledWrappedFlexLayout(dualFieldRow, dualFields, rootFontSizeAt100))
      .toEqual({ rowCount: 2, itemWidths: [480, 480] });
    document.documentElement.style.removeProperty("font-size");
    expect.soft(modeledWrappedFlexLayout(dualFieldRow, dualFields, rootFontSizeAt100))
      .toEqual({ rowCount: 1, itemWidths: [234, 234] });
    dualFieldRow.style.width = "360px";
    expect.soft(modeledWrappedFlexLayout(dualFieldRow, dualFields, rootFontSizeAt100))
      .toEqual({ rowCount: 2, itemWidths: [360, 360] });
    dualFieldRow.style.width = "480px";
    document.documentElement.style.fontSize = "200%";
    expect.soft(getComputedStyle(settings).overflow).toBe("visible");
    expect.soft(Array.from(passwordPaintedControls, (control) => ({
      height: getComputedStyle(control).height,
      minHeight: getComputedStyle(control).minHeight,
      lineHeight: getComputedStyle(control).lineHeight,
      overflow: getComputedStyle(control).overflow,
    }))).toEqual(Array.from(passwordPaintedControls, () => ({
      height: "auto",
      minHeight: "40px",
      lineHeight: "40px",
      overflow: "visible",
    })));
    expect.soft(passwordInputs.map((input) => ({
      height: getComputedStyle(input).height,
      minHeight: getComputedStyle(input).minHeight,
      lineHeight: getComputedStyle(input).lineHeight,
      minWidth: getComputedStyle(input).minWidth,
      maxWidth: getComputedStyle(input).maxWidth,
      width: getComputedStyle(input).width,
    }))).toEqual(passwordInputs.map(() => ({
      height: "auto",
      minHeight: "40px",
      lineHeight: "40px",
      minWidth: "0px",
      maxWidth: "100%",
      width: "100%",
    })));
    expect.soft(Array.from(passwordFieldOwners, (owner) => ({
      minWidth: getComputedStyle(owner).minWidth,
      maxWidth: getComputedStyle(owner).maxWidth,
      overflow: getComputedStyle(owner).overflow,
    }))).toEqual(Array.from(passwordFieldOwners, () => ({
      minWidth: "0px",
      maxWidth: "100%",
      overflow: "visible",
    })));
    expect.soft([characterRow, dualFieldRow].map((row) => ({
      flexWrap: getComputedStyle(row).flexWrap,
      overflow: getComputedStyle(row).overflow,
    }))).toEqual([
      { flexWrap: "wrap", overflow: "visible" },
      { flexWrap: "wrap", overflow: "visible" },
    ]);
    expect.soft({
      columnGap: getComputedStyle(dualFieldRow).columnGap,
      rowGap: getComputedStyle(dualFieldRow).rowGap,
    }).toEqual({ columnGap: "12px", rowGap: "12px" });
    expect.soft(dualFields.map((field) => ({
      flexBasis: getComputedStyle(field).flexBasis,
      flexGrow: getComputedStyle(field).flexGrow,
      flexShrink: getComputedStyle(field).flexShrink,
      minWidth: getComputedStyle(field).minWidth,
      width: getComputedStyle(field).width,
      marginRight: getComputedStyle(field).marginRight,
    }))).toEqual(Array.from({ length: 2 }, () => ({
      flexBasis: "13rem",
      flexGrow: "1",
      flexShrink: "1",
      minWidth: "0px",
      width: "auto",
      marginRight: "0px",
    })));
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
    expect.soft(Array.from(passwordPaintedControls, (control) => ({
      height: getComputedStyle(control).height,
      minHeight: getComputedStyle(control).minHeight,
      overflow: getComputedStyle(control).overflow,
    }))).toEqual(Array.from(passwordPaintedControls, () => ({
      height: "auto",
      minHeight: "36px",
      overflow: "visible",
    })));
    expect.soft(passwordInputs.map((input) => ({
      height: getComputedStyle(input).height,
      minHeight: getComputedStyle(input).minHeight,
      minWidth: getComputedStyle(input).minWidth,
      maxWidth: getComputedStyle(input).maxWidth,
      width: getComputedStyle(input).width,
    }))).toEqual(passwordInputs.map(() => ({
      height: "auto",
      minHeight: "36px",
      minWidth: "0px",
      maxWidth: "100%",
      width: "100%",
    })));
    expect.soft(characterLabels.map(computedHitHeight)).toEqual([44, 44, 44, 44]);
    expect.soft([characterRow, dualFieldRow].map((row) => getComputedStyle(row).flexWrap))
      .toEqual(["wrap", "wrap"]);

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
    for (const target of [...passphrasePaintedControls, ...passphraseInputs]) {
      target.setAttribute("data-generator-test-text-scale", "control");
    }
    const passphraseCheckboxLabels = Array.from(
      settings.querySelectorAll<HTMLElement>("tools-passphrase-settings bit-form-control > label"),
    );
    expect(passphraseFieldOwners.length).toBeGreaterThanOrEqual(2);
    expect.soft(Array.from(passphraseFieldOwners, computedHitHeight).every((height) => height >= 44))
      .toBe(true);
    expect.soft(Array.from(passphrasePaintedControls, (control) => ({
      height: getComputedStyle(control).height,
      minHeight: getComputedStyle(control).minHeight,
      overflow: getComputedStyle(control).overflow,
    }))).toEqual(Array.from(passphrasePaintedControls, () => ({
      height: "auto",
      minHeight: "36px",
      overflow: "visible",
    })));
    expect.soft(passphraseInputs.map((input) => ({
      height: getComputedStyle(input).height,
      minHeight: getComputedStyle(input).minHeight,
      minWidth: getComputedStyle(input).minWidth,
      maxWidth: getComputedStyle(input).maxWidth,
      width: getComputedStyle(input).width,
    }))).toEqual(passphraseInputs.map(() => ({
      height: "auto",
      minHeight: "36px",
      minWidth: "0px",
      maxWidth: "100%",
      width: "100%",
    })));
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
    for (const target of [
      usernamePaintedControl,
      usernameSelect,
      usernameNgSelect,
      usernameSelectContainer,
    ]) {
      target!.setAttribute("data-generator-test-text-scale", "control");
    }
    expect.soft(computedHitHeight(usernameFieldOwner)).toBeGreaterThanOrEqual(44);
    expect.soft([
      usernamePaintedControl,
      usernameSelect,
      usernameNgSelect,
      usernameSelectContainer,
    ].map((control) => ({
      height: getComputedStyle(control!).height,
      minHeight: getComputedStyle(control!).minHeight,
      overflow: getComputedStyle(control!).overflow,
    }))).toEqual(Array.from({ length: 4 }, () => ({
      height: "auto",
      minHeight: "36px",
      overflow: "visible",
    })));
    const usernameCheckboxLabels = settings.querySelectorAll<HTMLElement>(
      "tools-username-settings bit-form-control > label",
    );
    expect.soft(Array.from(usernameCheckboxLabels, computedHitHeight).every((height) => height >= 44))
      .toBe(true);

    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.style.removeProperty("font-size");
    expect.soft([
      usernamePaintedControl,
      usernameSelect,
      usernameNgSelect,
      usernameSelectContainer,
    ].map((control) => ({
      height: getComputedStyle(control!).height,
      minHeight: getComputedStyle(control!).minHeight,
    }))).toEqual(Array.from({ length: 4 }, () => ({ height: "auto", minHeight: "40px" })));

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.removeAttribute("data-generator-test-media");
    document.documentElement.style.removeProperty("font-size");
  });

  it("renders real history as a continuous shadowless list with compact-safe rows", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
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
    const content = host.querySelector<HTMLElement>(
      '[data-testid="generator-history-content"]',
    );
    const scrollRegion = host.querySelector<HTMLElement>(
      '[data-testid="popup-layout-scroll-region"]',
    );
    const row = host.querySelector<HTMLElement>("[role=listitem].macos-generator-history__row");
    const clear = host.querySelector<HTMLButtonElement>(
      '[data-testid="generator-history-clear"]',
    );

    expect(content).not.toBeNull();
    expect(scrollRegion).not.toBeNull();
    expect(content!.parentElement).toBe(scrollRegion);
    expect(getComputedStyle(scrollRegion!).paddingInline).toBe("16px");
    expect.soft(getComputedStyle(content!).marginLeft).toBe("0px");
    expect.soft(getComputedStyle(content!).marginRight).toBe("0px");
    expect(row).not.toBeNull();
    expect(clear).not.toBeNull();
    expect(content!.hasAttribute("aria-live")).toBe(false);
    for (const liveRegion of host.querySelectorAll('[aria-live], [role="status"], [role="alert"]')) {
      expect(liveRegion.textContent).not.toContain("history-password");
    }
    const copy = row!.querySelector<HTMLButtonElement>("button")!;
    const copyGlyph = copy.querySelector<HTMLElement>(".bwi")!;
    const credentialValue = row!.querySelector<HTMLElement>("bit-color-password")!;
    const itemContent = row!.querySelector<HTMLElement>("bit-item-content")!;
    const bodyLine = itemContent.querySelector<HTMLElement>('[bitTypography="body2"]')!;
    const helperLine = itemContent.querySelector<HTMLElement>('[bitTypography="helper"]')!;
    expect(getComputedStyle(content!).boxShadow).toBe("none");
    expect(row!.classList).toContain("macos-row");
    expect(row!.classList).toContain("macos-row--double");
    expect(getComputedStyle(row!).height).toBe("auto");
    expect(getComputedStyle(row!).minHeight).toBe("48px");
    expect(getComputedStyle(row!).overflow).toBe("visible");
    expect.soft(getComputedStyle(row!).paddingTop).toBe("2px");
    expect(getComputedStyle(row!).paddingRight).toBe("0px");
    expect.soft(getComputedStyle(row!).paddingBottom).toBe("2px");
    expect(getComputedStyle(row!).paddingLeft).toBe("12px");
    expect(getComputedStyle(row!).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(row!).borderRadius).toBe("0px");
    expect(getComputedStyle(row!).boxShadow).toBe("none");
    expect.soft(getComputedStyle(itemContent).paddingTop).toBe("0px");
    expect.soft(getComputedStyle(itemContent).paddingBottom).toBe("0px");
    expect.soft(getComputedStyle(bodyLine).lineHeight).toBe("20px");
    expect.soft(getComputedStyle(helperLine).lineHeight).toBe("16px");
    expect(credentialValue.hasAttribute("aria-hidden")).toBe(false);
    expect(credentialValue.textContent).toContain("history-password");
    expect(copy.getAttribute("aria-label") ?? copy.getAttribute("label") ?? copy.textContent)
      .not.toContain("history-password");
    expect(getComputedStyle(copy).minWidth).toBe("44px");
    expect(getComputedStyle(copy).minHeight).toBe("44px");
    expect(getComputedStyle(copyGlyph).width).toBe("32px");
    expect(getComputedStyle(copyGlyph).height).toBe("32px");
    expect.soft(modeledHistoryRowHeight(row!, itemContent, bodyLine, helperLine)).toBe(48);
    expect(computedHitWidth(clear!)).toBeGreaterThanOrEqual(44);
    expect(computedHitHeight(clear!)).toBeGreaterThanOrEqual(44);

    const transparent = "rgba(0, 0, 0, 0)";
    const copyDefault = getComputedStyle(copyGlyph).backgroundColor;
    setGeneratorInteraction(copy, "hover");
    const copyHover = getComputedStyle(copyGlyph).backgroundColor;
    expect(copyHover).not.toBe(copyDefault);
    expect(getComputedStyle(copy).backgroundColor).toBe(transparent);
    setGeneratorInteraction(copy, "active");
    const copyPressed = getComputedStyle(copyGlyph).backgroundColor;
    expect(copyPressed).not.toBe(copyHover);
    expect(copyPressed).not.toBe(copyDefault);
    expect(getComputedStyle(copy).backgroundColor).toBe(transparent);
    setGeneratorInteraction(copy, "focus");
    expect(cssPixels(getComputedStyle(copy).outlineWidth)).toBe(0);
    expect(cssPixels(getComputedStyle(copyGlyph).outlineWidth)).toBe(0);
    setGeneratorInteraction(copy, "focus focus-visible");
    expect(cssPixels(getComputedStyle(copy).outlineWidth)).toBe(0);
    expect(getComputedStyle(copyGlyph).outlineWidth).toBe("2px");
    const normalCopyFocusColor = getComputedStyle(copyGlyph).outlineColor;
    setGeneratorInteraction(copy, null);

    const longCredential = "correct-horse-battery-staple-".repeat(12);
    credentialValue.textContent = longCredential;
    row!.style.width = "240px";
    document.documentElement.style.fontSize = "200%";
    expect(credentialValue.textContent).toContain(longCredential);
    expect(getComputedStyle(row!).height).toBe("auto");
    expect(getComputedStyle(row!).overflow).toBe("visible");
    expect(getComputedStyle(credentialValue).maxHeight).toBe("none");
    expect(getComputedStyle(credentialValue).overflow).toBe("visible");
    expect(getComputedStyle(credentialValue).whiteSpace).toBe("normal");
    expect(getComputedStyle(credentialValue).overflowWrap).toBe("anywhere");
    const truncatingAncestors: HTMLElement[] = [];
    for (let node = credentialValue.parentElement; node && node !== itemContent; node = node.parentElement) {
      if (node.classList.contains("tw-truncate")) truncatingAncestors.push(node);
    }
    expect(truncatingAncestors.length).toBeGreaterThanOrEqual(3);
    expect.soft(truncatingAncestors.map((ancestor) => ({
      overflow: getComputedStyle(ancestor).overflow,
      whiteSpace: getComputedStyle(ancestor).whiteSpace,
      textOverflow: getComputedStyle(ancestor).textOverflow,
      maxHeight: getComputedStyle(ancestor).maxHeight,
    }))).toEqual(Array.from(truncatingAncestors, () => ({
      overflow: "visible",
      whiteSpace: "normal",
      textOverflow: "clip",
      maxHeight: "none",
    })));
    document.documentElement.style.removeProperty("font-size");

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
    expect.soft(getComputedStyle(row!).paddingTop).toBe("0px");
    expect.soft(getComputedStyle(row!).paddingBottom).toBe("0px");
    expect.soft(getComputedStyle(itemContent).paddingTop).toBe("0px");
    expect.soft(getComputedStyle(itemContent).paddingBottom).toBe("0px");
    expect.soft(modeledHistoryRowHeight(row!, itemContent, bodyLine, helperLine)).toBe(44);
    expect(getComputedStyle(copyGlyph).width).toBe("28px");
    expect(getComputedStyle(copyGlyph).height).toBe("28px");
    expect([clear, cancel, danger].map((action) => computedHitWidth(action!)))
      .toEqual([44, 44, 44]);

    document.documentElement.setAttribute("data-generator-test-media", "reduced-motion");
    expect(getComputedStyle(copy).animationName).toBe("none");
    expect(getComputedStyle(copy).transitionDuration).toBe("0s");
    expect(getComputedStyle(copy).transform).toBe("none");
    expect(getComputedStyle(copyGlyph).animationName).toBe("none");
    expect(getComputedStyle(copyGlyph).transitionDuration).toBe("0s");
    expect(getComputedStyle(copyGlyph).transform).toBe("none");

    document.documentElement.setAttribute("data-generator-test-media", "forced-colors");
    const forcedCopy = forcedColorSignature(copyGlyph);
    expect(forcedCopy.forcedColorAdjust).toBe("none");
    expect(forcedCopy.borderWidth).toBe("1px");
    setGeneratorInteraction(copy, "focus focus-visible");
    expect(cssPixels(getComputedStyle(copy).outlineWidth)).toBe(0);
    expect(getComputedStyle(copyGlyph).outlineWidth).toBe("2px");
    expect(getComputedStyle(copyGlyph).outlineColor).not.toBe(normalCopyFocusColor);
    setGeneratorInteraction(copy, null);
    expect([clear, cancel, danger].map((action) => computedHitHeight(action!)))
      .toEqual([44, 44, 44]);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.removeAttribute("data-generator-test-media");
    document.documentElement.style.removeProperty("font-size");
  });

  it("renders the mounted Send header and flat list with 48px rows and 44px action owners", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setSends([{
      id: "send-1",
      accessId: "access-token",
      type: "text",
      name: "Payroll token with an intentionally long mounted title that must grow at two hundred percent",
      notes: "",
      revisionDate: "2026-08-17T00:00:00.000Z",
      deletionDate: "2030-08-17T00:00:00.000Z",
      disabled: false,
      accessCount: 0,
    }]);
    store.setSendFilterVisible(true);
    store.setSendTypeFilter("text");
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
    const view = row.querySelector<HTMLElement>("[bit-item-content]")!;
    const viewPlate = view.querySelector<HTMLElement>("bit-icon.macos-icon-plate")!;
    const actions = row.querySelectorAll<HTMLElement>(".macos-send-row__actions button");
    const newAction = host.querySelector<HTMLButtonElement>('[data-testid="send-new-action"]');
    const filterAction = host.querySelector<HTMLButtonElement>('[data-testid="send-filter-action"]');
    const filterOwner = host.querySelector<HTMLElement>(".send-filter-disclosure.macos-field-owner")!;
    const filterSelect = filterOwner?.querySelector<HTMLSelectElement>('select[aria-label="类型"]')!;

    expect(getComputedStyle(list).display).toBe("block");
    expect(getComputedStyle(list).boxShadow).toBe("none");
    expect(row.classList).toContain("macos-row");
    expect(row.classList).toContain("macos-row--double");
    expect(getComputedStyle(row).minHeight).toBe("48px");
    expect(getComputedStyle(row).height).toBe("auto");
    expect(getComputedStyle(row).paddingTop).toBe("2px");
    expect(getComputedStyle(row).paddingRight).toBe("0px");
    expect(getComputedStyle(row).paddingBottom).toBe("2px");
    expect(getComputedStyle(row).paddingLeft).toBe("12px");
    expect(getComputedStyle(row).marginBottom).toBe("0px");
    expect(getComputedStyle(row).borderRadius).toBe("0px");
    expect(getComputedStyle(row).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(row).boxShadow).toBe("none");
    expect(getComputedStyle(view).paddingLeft).toBe("0px");
    expect(getComputedStyle(view).paddingRight).toBe("0px");
    expect(
      cssPixels(getComputedStyle(row).paddingLeft)
        + cssPixels(getComputedStyle(view).paddingLeft),
    ).toBe(12);
    expect(actions).toHaveLength(2);
    expect(view.classList).toContain("macos-hit-target");
    expect(Array.from(actions, (action) => action.classList.contains("macos-hit-target")))
      .toEqual([true, true]);
    expect(computedHitWidth(view)).toBeGreaterThanOrEqual(44);
    expect(computedHitHeight(view)).toBeGreaterThanOrEqual(44);
    expect(viewPlate).not.toBeNull();
    expect(getComputedStyle(viewPlate).width).toBe("32px");
    expect(getComputedStyle(viewPlate).height).toBe("32px");
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
    expect(newAction?.classList).toContain("macos-hit-target");
    expect(filterAction?.classList).toContain("macos-hit-target");
    expect(filterOwner).not.toBeNull();
    expect(filterSelect.value).toBe("text");
    expect(filterSelect.getAttribute("aria-label")?.trim().length).toBeGreaterThan(0);
    expect(getComputedStyle(filterOwner).minHeight).toBe("44px");
    expect(getComputedStyle(filterSelect).height).toBe("40px");
    expect(row.querySelectorAll('[role="menuitem"]')).toHaveLength(0);

    const iconPlates = row.querySelectorAll<HTMLElement>(".macos-send-row__actions button > span");
    expect(iconPlates.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(iconPlates, (plate) => getComputedStyle(plate).width))
      .toEqual(Array.from(iconPlates, () => "32px"));
    expect(Array.from(iconPlates, (plate) => getComputedStyle(plate).height))
      .toEqual(Array.from(iconPlates, () => "32px"));

    const more = row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    const filterPlate = filterAction!.querySelector<HTMLElement>(":scope > span")!;
    const morePlate = more.querySelector<HTMLElement>(":scope > span")!;
    const removeHostileOwnerMotion = installPostProductionHostileOwnerMotion([
      filterAction!,
      more,
    ]);
    for (const [owner, plate] of [[filterAction!, filterPlate], [more, morePlate]] as const) {
      const normalOwner = getComputedStyle(owner);
      expect(normalOwner.getPropertyValue("--send-owner-motion-probe")).toBe("1");
      const normalPlateBackground = getComputedStyle(plate).backgroundColor;
      expect(normalOwner.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(normalOwner.boxShadow).toBe("none");
      expect(normalOwner.animationName).toBe("none");
      expect(normalOwner.transitionDuration).toBe("0s");
      expect(getComputedStyle(plate).animationName).toBe("none");

      setGeneratorInteraction(owner, "hover");
      expect(getComputedStyle(owner).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(owner).boxShadow).toBe("none");
      expect(getComputedStyle(plate).backgroundColor).not.toBe(normalPlateBackground);
      const hoverPlateBackground = getComputedStyle(plate).backgroundColor;

      setGeneratorInteraction(owner, "active");
      expect(getComputedStyle(owner).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(owner).boxShadow).toBe("none");
      expect(getComputedStyle(plate).backgroundColor).not.toBe(hoverPlateBackground);

      setGeneratorInteraction(owner, "focus");
      expect(cssPixels(getComputedStyle(owner).outlineWidth)).toBe(0);
      expect(cssPixels(getComputedStyle(plate).outlineWidth)).toBe(0);
      setGeneratorInteraction(owner, "focus focus-visible");
      expect(cssPixels(getComputedStyle(owner).outlineWidth)).toBe(0);
      expect(getComputedStyle(plate).outlineWidth).toBe("2px");
      setGeneratorInteraction(owner, null);
    }

    filterAction!.disabled = true;
    setGeneratorInteraction(filterAction!, "hover active");
    expect(getComputedStyle(filterAction!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(filterAction!).boxShadow).toBe("none");
    expect(getComputedStyle(filterPlate).opacity).toBe("0.38");
    expect(getComputedStyle(filterPlate).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    setGeneratorInteraction(filterAction!, null);
    filterAction!.disabled = false;

    more.setAttribute("aria-disabled", "true");
    setGeneratorInteraction(more, "hover active");
    expect(getComputedStyle(more).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(more).boxShadow).toBe("none");
    expect(getComputedStyle(morePlate).opacity).toBe("0.38");
    expect(getComputedStyle(morePlate).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    setGeneratorInteraction(more, null);
    more.removeAttribute("aria-disabled");

    more.click();
    await fixture.whenStable();
    const deleteAction = document.querySelector<HTMLButtonElement>(
      '[data-testid="send-delete-action"]',
    );
    expect(deleteAction).not.toBeNull();
    expect(row.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
    expect(deleteAction?.classList).toContain("macos-hit-target");
    expect(computedHitWidth(deleteAction!)).toBeGreaterThanOrEqual(44);
    expect(computedHitHeight(deleteAction!)).toBeGreaterThanOrEqual(44);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(filterOwner).minHeight).toBe("44px");
    expect(getComputedStyle(filterSelect).height).toBe("36px");
    expect(getComputedStyle(row).minHeight).toBe("44px");
    expect(Array.from(iconPlates, (plate) => getComputedStyle(plate).width))
      .toEqual(Array.from(iconPlates, () => "28px"));
    expect(Array.from(iconPlates, (plate) => getComputedStyle(plate).height))
      .toEqual(Array.from(iconPlates, () => "28px"));
    expect(getComputedStyle(viewPlate).width).toBe("28px");
    expect(getComputedStyle(viewPlate).height).toBe("28px");
    expect([newAction, filterAction, deleteAction].map((action) => computedHitWidth(action!)))
      .toEqual([44, 44, 44]);
    expect([newAction, filterAction, deleteAction].map((action) => computedHitHeight(action!)))
      .toEqual([44, 44, 44]);

    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(filterOwner).overflow).toBe("visible");
    expect(getComputedStyle(filterSelect).overflow).toBe("visible");
    const title = view.querySelector<HTMLElement>('[bitTypography="body2"] > div')!;
    const subtitle = view.querySelector<HTMLElement>('[bitTypography="helper"]')!;
    title.append(document.createElement("br"), "second mounted title line");
    subtitle.append(document.createElement("br"), "second mounted subtitle line");
    expect(getComputedStyle(row).height).toBe("auto");
    expect(getComputedStyle(view).height).toBe("auto");
    expect(getComputedStyle(view).maxHeight).toBe("none");
    expect(getComputedStyle(view).overflowX).toBe("visible");
    expect(getComputedStyle(view).overflowY).toBe("visible");
    for (const textLayer of [title, subtitle]) {
      expect(getComputedStyle(textLayer).maxHeight).toBe("none");
      expect(getComputedStyle(textLayer).whiteSpace).toBe("normal");
      expect(getComputedStyle(textLayer).overflowX).toBe("visible");
      expect(getComputedStyle(textLayer).overflowY).toBe("visible");
      expect(getComputedStyle(textLayer).textOverflow).toBe("clip");
    }
    expect(modeledSendRowHeight(row, view, title, subtitle)).toBeGreaterThan(48);

    document.documentElement.setAttribute("data-generator-test-media", "reduced-motion");
    for (const [owner, plate] of [[filterAction!, filterPlate], [more, morePlate]] as const) {
      expect(getComputedStyle(owner).transitionDuration).toBe("0s");
      expect(getComputedStyle(plate).animationName).toBe("none");
      expect(getComputedStyle(plate).transitionDuration).toBe("0s");
    }

    document.documentElement.setAttribute("data-generator-test-media", "forced-colors");
    for (const [owner, plate] of [[filterAction!, filterPlate], [more, morePlate]] as const) {
      expect(getComputedStyle(owner).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(plate).forcedColorAdjust).toBe("none");
      expect(getComputedStyle(plate).borderWidth).toBe("1px");
      setGeneratorInteraction(owner, "focus focus-visible");
      expect(cssPixels(getComputedStyle(owner).outlineWidth)).toBe(0);
      expect(getComputedStyle(plate).outlineWidth).toBe("2px");
      setGeneratorInteraction(owner, null);
    }
    removeHostileOwnerMotion();

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.removeAttribute("data-generator-test-media");
    document.documentElement.style.removeProperty("font-size");
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
    expect(create?.classList).toContain("macos-hit-target");
    expect(computedHitWidth(create!)).toBe(44);
    expect(computedHitHeight(create!)).toBe(44);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(computedHitWidth(create!)).toBe(44);
    expect(computedHitHeight(create!)).toBe(44);

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });

  it("renders real loading Send skeletons with flat 48px and compact 44px rows", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setSyncing(true);
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
    const rows = host.querySelectorAll<HTMLElement>(".macos-send-skeleton-row");

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(getComputedStyle(row).height).toBe("48px");
      expect(getComputedStyle(row).borderRadius).toBe("0px");
      expect(getComputedStyle(row).boxShadow).toBe("none");
    }
    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    for (const row of rows) expect(getComputedStyle(row).height).toBe("44px");

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
  });

  it("renders the real Send created summary flat with touch-safe link and actions", async () => {
    const fixture = await createRealSendCreatedFixture();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const summary = host.querySelector<HTMLElement>(".macos-send-created__summary")!;
    const icon = host.querySelector<HTMLElement>(".macos-send-created__icon")!;
    const link = host.querySelector<HTMLInputElement>('[data-testid="created-link"]')!;
    const linkOwner = link.closest<HTMLElement>(".macos-field-owner")!;
    const actions = host.querySelectorAll<HTMLElement>("popup-footer button");

    expect(host.classList).toContain("macos-page--send-created");
    expect(getComputedStyle(summary).padding).toBe("12px");
    expect(getComputedStyle(summary).borderRadius).toBe("0px");
    expect(getComputedStyle(summary).boxShadow).toBe("none");
    expect(getComputedStyle(icon).width).toBe("44px");
    expect(getComputedStyle(icon).height).toBe("44px");
    expect(getComputedStyle(linkOwner).minHeight).toBe("44px");
    expect(getComputedStyle(link).height).toBe("auto");
    expect(getComputedStyle(link).minHeight).toBe("40px");
    expect(getComputedStyle(link).textOverflow).toBe("ellipsis");
    expect(link.getAttribute("aria-label")?.trim().length).toBeGreaterThan(0);
    expect(link.value.length).toBeGreaterThan(100);
    expect(getComputedStyle(link).borderRadius).toBe("9px");
    expect(actions).toHaveLength(2);
    expect(host.querySelectorAll(".macos-primary-action")).toHaveLength(1);
    expect(actions[0]!.classList).toContain("macos-button-owner");
    expect(actions[1]!.classList).toContain("macos-secondary-action");
    expect(host.querySelector("popup-footer[slot='footer']")).not.toBeNull();
    expect(Array.from(actions, computedHitHeight).every((height) => height >= 44)).toBe(true);
    const copy = actions[0]!;
    const copyPaint = document.createElement("span");
    copyPaint.setAttribute("data-send-form-test-paint", "");
    copy.prepend(copyPaint);
    const initial = getComputedStyle(copyPaint).backgroundColor;
    setGeneratorInteraction(copy, "hover");
    const hover = getComputedStyle(copyPaint).backgroundColor;
    setGeneratorInteraction(copy, "active");
    const pressed = getComputedStyle(copyPaint).backgroundColor;
    expect(new Set([initial, hover, pressed]).size).toBe(3);
    copy.setAttribute("aria-disabled", "true");
    setGeneratorInteraction(copy, "hover active");
    expect(getComputedStyle(copyPaint).backgroundColor).not.toBe(hover);
    expect(getComputedStyle(copyPaint).transform).toBe("none");
    copy.removeAttribute("aria-disabled");
    setGeneratorInteraction(copy, null);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(link).height).toBe("auto");
    expect(getComputedStyle(link).minHeight).toBe("36px");
    const normalFont = cssLengthPixels(getComputedStyle(link).fontSize, 16);
    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(linkOwner).height).toBe("auto");
    expect(getComputedStyle(linkOwner).overflow).toBe("visible");
    expect(cssLengthPixels(getComputedStyle(link).fontSize, 32)).toBeGreaterThan(normalFont);
    document.documentElement.setAttribute("data-generator-test-media", "reduced-motion");
    expect(getComputedStyle(copyPaint).transitionDuration).toBe("0s");
    document.documentElement.setAttribute("data-generator-test-media", "forced-colors");
    expect(getComputedStyle(copyPaint).forcedColorAdjust).toBe("none");

    fixture.destroy();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.style.removeProperty("font-size");
    document.documentElement.removeAttribute("data-generator-test-media");
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

function modeledHistoryRowHeight(
  row: HTMLElement,
  itemContent: HTMLElement,
  bodyLine: HTMLElement,
  helperLine: HTMLElement,
): number {
  const rowStyle = getComputedStyle(row);
  const itemStyle = getComputedStyle(itemContent);
  const textHeight = cssPixels(getComputedStyle(bodyLine).lineHeight)
    + cssPixels(getComputedStyle(helperLine).lineHeight);
  const itemHeight = cssPixels(itemStyle.paddingTop) + textHeight + cssPixels(itemStyle.paddingBottom);
  const copyOwnerHeight = Math.max(
    0,
    ...Array.from(row.querySelectorAll("button"), computedHitHeight),
  );
  return Math.max(
    cssPixels(rowStyle.minHeight),
    cssPixels(rowStyle.paddingTop)
      + Math.max(itemHeight, copyOwnerHeight)
      + cssPixels(rowStyle.paddingBottom),
  );
}

function modeledSendRowHeight(
  row: HTMLElement,
  view: HTMLElement,
  title: HTMLElement,
  subtitle: HTMLElement,
): number {
  const rowStyle = getComputedStyle(row);
  const viewStyle = getComputedStyle(view);
  const textHeight = (1 + title.querySelectorAll("br").length)
      * cssPixels(getComputedStyle(title).lineHeight)
    + (1 + subtitle.querySelectorAll("br").length)
      * cssPixels(getComputedStyle(subtitle).lineHeight);
  const viewHeight = cssPixels(viewStyle.paddingTop)
    + textHeight
    + cssPixels(viewStyle.paddingBottom);
  const actionHeight = Math.max(
    0,
    ...Array.from(row.querySelectorAll("button"), computedHitHeight),
  );
  return cssPixels(rowStyle.paddingTop)
    + Math.max(viewHeight, actionHeight)
    + cssPixels(rowStyle.paddingBottom);
}

function modeledSendPrimaryPaintHeight(owner: HTMLElement, paint: HTMLElement): number {
  const ownerHeight = cssPixels(getComputedStyle(owner).minHeight);
  const paintStyle = getComputedStyle(paint);
  const inset = cssPixels(
    paintStyle.insetBlock && paintStyle.insetBlock !== "auto"
      ? paintStyle.insetBlock
      : paintStyle.inset.split(" ")[0] ?? "0px",
  );
  return ownerHeight - 2 * inset;
}

function modeledSingleLineControlPaintHeight(control: HTMLElement): number {
  const style = getComputedStyle(control);
  return cssPixels(style.height);
}

function modeledNaturalReadonlyHeight(
  value: HTMLElement,
  width: number,
  rootFontSize: number,
): number {
  const computed = getComputedStyle(value);
  const fontSize = cssLengthPixels(computed.fontSize, rootFontSize);
  const lineHeight = cssLengthPixels(computed.lineHeight, rootFontSize);
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  const lineCount = Math.max(1, Math.ceil((value.textContent?.length ?? 0) / charactersPerLine));
  return cssLengthPixels(computed.paddingTop, rootFontSize)
    + lineCount * lineHeight
    + cssLengthPixels(computed.paddingBottom, rootFontSize);
}

function modeledStretchedModeHeights(
  group: HTMLElement,
  toggles: NodeListOf<HTMLElement>,
  radios: NodeListOf<HTMLInputElement>,
  labels: NodeListOf<HTMLLabelElement>,
  plates: HTMLElement[],
) {
  const rootFontSize = effectiveRootFontSize(16);
  const intrinsic = plates.map((plate, index) => {
    const lineCount = 1 + plate.querySelectorAll("br").length;
    const labelStyle = getComputedStyle(labels[index]!);
    const lineHeight = cssLengthPixels(labelStyle.lineHeight, rootFontSize);
    return Math.max(
      cssPixels(getComputedStyle(toggles[index]!).minHeight),
      cssPixels(labelStyle.paddingTop) + lineCount * lineHeight + cssPixels(labelStyle.paddingBottom),
    );
  });
  const tallest = Math.max(...intrinsic);
  const toggleOwners = intrinsic.map((height) =>
    getComputedStyle(group).alignItems === "stretch" ? tallest : height
  );
  const radioOwners = Array.from(radios, (radio, index) =>
    getComputedStyle(radio).alignSelf === "stretch" ? toggleOwners[index]! : intrinsic[index]!
  );
  const labelOwners = Array.from(labels, (label, index) =>
    getComputedStyle(label).alignSelf === "stretch" ? toggleOwners[index]! : intrinsic[index]!
  );
  const paintedLayers = plates.map((plate, index) => {
    const labelStyle = getComputedStyle(labels[index]!);
    if (getComputedStyle(plate).alignSelf === "stretch") {
      return labelOwners[index]!
        - cssPixels(labelStyle.paddingTop)
        - cssPixels(labelStyle.paddingBottom);
    }
    return Math.max(
      cssPixels(getComputedStyle(plate).minHeight),
      (1 + plate.querySelectorAll("br").length)
        * cssLengthPixels(labelStyle.lineHeight, rootFontSize),
    );
  });
  return { intrinsic, toggleOwners, radioOwners, labelOwners, paintedLayers };
}

function cssPixels(value: string): number {
  return value.endsWith("px") ? Number.parseFloat(value) : 0;
}

function modeledWrappedFlexLayout(
  row: HTMLElement,
  fields: HTMLElement[],
  rootFontSizeAt100: number,
) {
  const rowStyle = getComputedStyle(row);
  const rootFontSize = effectiveRootFontSize(rootFontSizeAt100);
  const containerWidth = cssLengthPixels(rowStyle.width, rootFontSize);
  const gap = cssLengthPixels(rowStyle.columnGap, rootFontSize);
  const bases = fields.map((field) =>
    cssLengthPixels(getComputedStyle(field).flexBasis, rootFontSize)
  );
  const fitsOneRow = bases.reduce((sum, basis) => sum + basis, 0)
    + gap * (fields.length - 1) <= containerWidth;
  return fitsOneRow
    ? {
        rowCount: 1,
        itemWidths: fields.map(() => (containerWidth - gap * (fields.length - 1)) / fields.length),
      }
    : { rowCount: fields.length, itemWidths: fields.map(() => containerWidth) };
}

function effectiveRootFontSize(rootFontSizeAt100: number): number {
  const value = getComputedStyle(document.documentElement).fontSize;
  if (value.endsWith("%")) {
    return rootFontSizeAt100 * Number.parseFloat(value) / 100;
  }
  return cssLengthPixels(value, rootFontSizeAt100) || rootFontSizeAt100;
}

function cssLengthPixels(value: string, rootFontSize: number): number {
  if (value.endsWith("rem")) return Number.parseFloat(value) * rootFontSize;
  if (value.endsWith("px")) return Number.parseFloat(value);
  return 0;
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

function resolvedTestSystemColor(color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

function setGeneratorInteraction(target: HTMLElement, interaction: string | null) {
  if (interaction) {
    target.setAttribute("data-generator-test-interaction", interaction);
  } else {
    target.removeAttribute("data-generator-test-interaction");
  }
}

function installPostProductionHostileOwnerMotion(
  owners: readonly HTMLElement[],
): () => void {
  const marker = "data-send-owner-hostile-motion";
  for (const owner of owners) owner.setAttribute(marker, "");
  const probeSelector = `[${marker}][${marker}][${marker}][${marker}]`;
  const probe = document.createElement("style");
  probe.textContent = `${probeSelector} { --send-owner-motion-probe: 1; animation-name: generator-hostile-motion; animation-duration: 1s; animation-iteration-count: infinite; transition-property: transform; transition-duration: 1s; transition-timing-function: linear; }`;
  document.head.append(probe);
  return () => {
    probe.remove();
    for (const owner of owners) owner.removeAttribute(marker);
  };
}

function normalizeImportantMotionShorthandsForJSDOM(sheet: CSSStyleSheet): void {
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type !== CSSRule.STYLE_RULE) continue;
    const declaration = (rule as CSSStyleRule).style;
    if (declaration.getPropertyPriority("animation") === "important") {
      const value = declaration.getPropertyValue("animation").trim();
      if (value === "none") {
        declaration.setProperty("animation-name", "none", "important");
        declaration.setProperty("animation-duration", "0s", "important");
        declaration.setProperty("animation-iteration-count", "1", "important");
      }
    }
    if (declaration.getPropertyPriority("transition") === "important") {
      const value = declaration.getPropertyValue("transition").trim();
      if (value === "none") {
        declaration.setProperty("transition-property", "none", "important");
        declaration.setProperty("transition-duration", "0s", "important");
        declaration.setProperty("transition-timing-function", "ease", "important");
      }
    }
  }
}

function projectSendFormPseudoRules(sheet: CSSStyleSheet): string {
  const projected: string[] = [];
  const project = (rule: CSSStyleRule, media?: "reduced-motion" | "forced-colors") => {
    if (!rule.selectorText.includes(".macos-button-owner") || !rule.selectorText.includes("::before")) {
      return;
    }
    const selector = projectGeneratorInteractionSelector(
      rule.selectorText.replaceAll("::before", ' > [data-send-form-test-paint]'),
    );
    projected.push(media
      ? `:root[data-generator-test-media="${media}"] :is(${selector}) { ${rule.style.cssText} }`
      : `${selector} { ${rule.style.cssText} }`);
  };
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type === CSSRule.STYLE_RULE) {
      project(rule as CSSStyleRule);
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
    for (const nested of Array.from(mediaRule.cssRules)) {
      if (nested.type === CSSRule.STYLE_RULE) project(nested as CSSStyleRule, media);
    }
  }
  return projected.join("\n");
}

function projectGeneratorInteractionAndMediaRules(sheet: CSSStyleSheet): string {
  const projected: string[] = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type === CSSRule.STYLE_RULE) {
      const styleRule = rule as CSSStyleRule;
      if (
        (styleRule.selectorText.includes(".macos-generator")
          || styleRule.selectorText.includes(".macos-page--send"))
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
      if (
        !styleRule.selectorText.includes(".macos-generator")
        && !styleRule.selectorText.includes(".macos-page--send")
      ) continue;
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

async function createRealSendFormFixture(readOnly = false) {
  TestBed.resetTestingModule();
  const store = new PopupStateStore();
  const send = {
    id: "send-form-1",
    accessId: "send-form-access",
    type: "text" as const,
    name: "Mounted Send value with a long readable name that must wrap without clipping",
    text: "Mounted multi-line secret value",
    notes: "Mounted private note",
    revisionDate: "2026-08-20T00:00:00.000Z",
    deletionDate: "2030-08-20T00:00:00.000Z",
    disabled: false,
    accessCount: 0,
    maxAccessCount: 3,
    hidden: true,
    hideEmail: true,
    hasPassword: true,
  };
  if (readOnly) store.setSends([send]);
  await TestBed.configureTestingModule({
    imports: [SendAddEditPageComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: PopupStateStore, useValue: store },
      { provide: GeneratorService, useValue: { generate: vi.fn() } },
      { provide: ClipboardPolicyService, useValue: { copy: vi.fn(async () => undefined) } },
      { provide: DialogService, useValue: { openSimpleDialog: vi.fn(async () => true) } },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of({
            get: (key: string) => key === "type"
              ? "text"
              : key === "sendId" && readOnly
                ? send.id
                : null,
          }),
        },
      },
    ],
  }).compileComponents();
  return TestBed.createComponent(SendAddEditPageComponent);
}

async function createRealSendCreatedFixture() {
  TestBed.resetTestingModule();
  const store = new PopupStateStore();
  const environment = buildSelfHostedEnvironmentFromServerUrl("https://vault.example.test");
  store.setServerUrl("https://vault.example.test");
  store.setUnlocked("person@example.test");
  store.setActiveSession({
    environment,
    token: { accessToken: "token", refreshToken: "refresh", tokenType: "Bearer", expiresIn: 3600 },
  });
  store.setSends([{
    id: "send-created",
    accessId: "access-token-with-a-very-long-readable-created-link-segment",
    urlB64Key: "url-key-with-another-very-long-readable-created-link-segment-for-selection",
    type: "text",
    name: "Created Send",
    text: "secret",
    notes: "",
    revisionDate: "2026-08-20T00:00:00.000Z",
    deletionDate: "2030-08-20T00:00:00.000Z",
    disabled: false,
    accessCount: 0,
  }]);
  await TestBed.configureTestingModule({
    imports: [SendCreatedPageComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: PopupStateStore, useValue: store },
      { provide: SEND_CREATED_HOST, useValue: { copyText: vi.fn(async () => undefined) } },
      { provide: ClipboardPolicyService, useValue: { copy: vi.fn(async () => undefined) } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: (key: string) => key === "sendId" ? "send-created" : null } } },
      },
    ],
  }).compileComponents();
  return TestBed.createComponent(SendCreatedPageComponent);
}
