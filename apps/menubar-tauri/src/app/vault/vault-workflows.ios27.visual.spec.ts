import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Component, importProvidersFrom, provideZoneChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { NgSelectModule } from "@ng-select/ng-select";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogModule } from "@bitwarden/components/dialog/dialog.module";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { OfficialPersonalCipherFormComponent } from "../upstream-overlays/cipher-form/official-personal-cipher-form.component";
import { RetainedVaultListItemComponent } from "../upstream-overlays/vault-main/retained-vault-list-item.component";
import { demoVaultItems } from "../vault-demo";
import { RETAINED_LOGIN_FORM_STATUS_STORE } from "./retained-login-form.adapter";
import { NewItemPageComponent } from "./new-item-page.component";
import { FoldersPageComponent } from "./folders-page.component";
import { OtpCodeRowComponent } from "./otp-code-row.component";
import { toRetainedPopupCipherView } from "./popup-cipher-view.adapter";
import {
  buildOfficialPersonalCipherFormConfig,
  type RetainedOfficialPersonalCipherFormConfig,
} from "./retained-personal-cipher-form.adapter";
import { TOTP_CLOCK, TOTP_CODE_SOURCE } from "./vault-totp-code.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  imports: [NgSelectModule, OfficialPersonalCipherFormComponent],
  template: `
    <main class="macos-page--vault-form">
      <div class="cipher-form-scroll">
        <bw-official-personal-cipher-form
          formId="visual-personal-form"
          [config]="config"
          [beforeSubmit]="beforeSubmit"
        ></bw-official-personal-cipher-form>
        <ng-select
          class="visual-multi-select"
          [items]="multiSelectItems"
          bindLabel="listName"
          [multiple]="true"
        ></ng-select>
      </div>
    </main>
    <aside data-testid="outside-sheet">
      <ng-select
        [items]="multiSelectItems"
        bindLabel="listName"
        [multiple]="true"
      ></ng-select>
    </aside>
  `,
})
class VaultFormVisualHostComponent {
  readonly multiSelectItems = [
    { id: "collection-1", listName: "Personal", labelName: "Personal" },
  ];
  readonly config: RetainedOfficialPersonalCipherFormConfig =
    buildOfficialPersonalCipherFormConfig({
      mode: "add",
      cipherType: CipherType.Card,
      initial: CipherView.fromJSON({ type: CipherType.Card, name: "Visual Card", card: {} })!,
      folders: [],
      canViewSecrets: true,
    });
  readonly beforeSubmit = async () => false;
}

@Component({
  imports: [RetainedVaultListItemComponent],
  template: `
    <main class="macos-page macos-page--vault-list">
      <section class="macos-list">
        <app-retained-vault-list-item [cipher]="cipher" sectionId="favorites" />
      </section>
    </main>
  `,
})
class VaultRowVisualHostComponent {
  readonly cipher = toRetainedPopupCipherView(demoVaultItems[0]!);
}

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = [
    join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"),
    join(process.cwd(), "apps/menubar-tauri/src/styles/macos-motion.css"),
    join(
      process.cwd(),
      "vendor/bitwarden-clients/libs/components/src/multi-select/scss/bw.theme.css",
    ),
    join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "")
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]')
    .replace(/:focus-within/g, ':has([data-test-focus-visible="true"])');
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || value,
  );
});
afterAll(() => { style.remove(); document.body.className = ""; document.body.replaceChildren(); });
afterEach(() => {
  document.body.classList.remove("tw-bit-compact");
  document.documentElement.removeAttribute("data-bw-compact-mode");
  document.documentElement.style.removeProperty("font-size");
  document.body.replaceChildren();
  vi.restoreAllMocks();
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

describe("iOS 27 Vault workflows", () => {
  it("computes real New Item rows at 52 pixels normally and 44 pixels in compact mode", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const group = getComputedStyle(host.querySelector<HTMLElement>(".new-item-grid")!);
    const row = getComputedStyle(host.querySelector<HTMLElement>(".new-item-option")!);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderRadius).toBe("0px");
    expect(row.minHeight).toBe("52px");
    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".new-item-option")!).minHeight)
      .toBe("44px");
    fixture.destroy();
    document.body.className = "";
  });

  it("computes real Vault Recovery folder rows at 52 pixels normally and 44 pixels in compact mode", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setItems([], [{ id: "work", name: "Work" }]);
    await TestBed.configureTestingModule({
      imports: [FoldersPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(FoldersPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const group = getComputedStyle(host.querySelector<HTMLElement>("bit-item-group")!);
    const row = getComputedStyle(host.querySelector<HTMLElement>("bit-item")!);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderRadius).toBe("0px");
    expect(row.marginBottom).toBe("0px");
    expect(row.minHeight).toBe("52px");
    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(host.querySelector<HTMLElement>("bit-item")!).minHeight).toBe("44px");
    host.querySelector<HTMLButtonElement>("[data-testid='new-folder-button']")!.click();
    fixture.detectChanges();
    const sheet = getComputedStyle(host.querySelector<HTMLElement>(".app-bottom-sheet[open]")!);
    expect(sheet.borderRadius).toBe("16px 16px 0 0");
    fixture.destroy();
    document.body.className = "";
  });

  it("computes the real OTP row at 52/44 pixels with a slow-token copy confirmation", async () => {
    TestBed.resetTestingModule();
    const item = demoVaultItems[0]!;
    const field = item.fields.find((candidate) => candidate.id === "otp")!;
    await TestBed.configureTestingModule({
      imports: [OtpCodeRowComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        PopupStateStore,
        SettingsService,
        {
          provide: TOTP_CODE_SOURCE,
          useValue: {
            generate: vi.fn(async () => ({
              code: "123456",
              formattedCode: "123 456",
              period: 30,
              secondsRemaining: 18,
              isExpiring: false,
            })),
          },
        },
        { provide: TOTP_CLOCK, useValue: () => 1_700_000_012 },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpCodeRowComponent);
    fixture.componentRef.setInput("item", item);
    fixture.componentRef.setInput("field", field);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.componentRef.setInput("copied", true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>(".otp-code-row")!;
    const copy = host.querySelector<HTMLElement>(".otp-code-row__copy")!;
    const copyIcon = host.querySelector<HTMLElement>(".otp-code-row__copy-icon")!;
    expect(getComputedStyle(row).minHeight).toBe("52px");
    expect(getComputedStyle(copy).minHeight).toBe("44px");
    expect(getComputedStyle(copyIcon).animationDuration).toBe("200ms");
    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(row).minHeight).toBe("44px");
    fixture.destroy();
  });

  it("computes a real retained Vault row and its actions at 52/44 pixels", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [VaultRowVisualHostComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultRowVisualHostComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>("bit-item.vault-list-row")!;
    const content = host.querySelector<HTMLElement>('[data-testid="vault-item-content"]')!;
    const name = host.querySelector<HTMLElement>('[data-testid="item-name"]')!;
    const actions = host.querySelectorAll<HTMLElement>('button[aria-label]');
    expect(getComputedStyle(row).minHeight).toBe("52px");
    expect(getComputedStyle(content).minHeight).toBe("52px");
    expect(getComputedStyle(content).height).toBe("52px");
    expect(actions.length).toBeGreaterThan(0);
    expect(Array.from(actions, (action) => [
      getComputedStyle(action).minWidth,
      getComputedStyle(action).minHeight,
    ])).toEqual(Array.from(actions, () => ["44px", "44px"]));

    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(row).minHeight).toBe("44px");
    expect(getComputedStyle(content).minHeight).toBe("44px");
    expect(getComputedStyle(content).height).toBe("44px");

    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(document.documentElement).fontSize).toBe("200%");
    expect(getComputedStyle(row).minWidth).toBe("0px");
    expect(getComputedStyle(content).minWidth).toBe("0px");
    expect(getComputedStyle(name).minWidth).toBe("0px");
    expect(getComputedStyle(name).overflowWrap).toBe("anywhere");
    fixture.destroy();
  });

  it("renders real retained form groups flat with 44px rounded controls and compact spacing", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    await TestBed.configureTestingModule({
      imports: [VaultFormVisualHostComponent],
      providers: [
        importProvidersFrom(DialogModule),
        provideZoneChangeDetection(),
        provideNoopAnimations(),
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: RETAINED_LOGIN_FORM_STATUS_STORE, useValue: store },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultFormVisualHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges(false);

    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>(".cipher-form-scroll bit-card")!;
    const input = host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    const fieldShell = input.closest<HTMLElement>("[bitfieldcontainer]")!;
    const ngSelectShell = host.querySelector<HTMLElement>(
      ".cipher-form-scroll .visual-multi-select .ng-select-container",
    )!;
    const outsideNgSelectShell = host.querySelector<HTMLElement>(
      '[data-testid="outside-sheet"] .ng-select-container',
    )!;
    expect(card).not.toBeNull();
    expect(input).not.toBeNull();
    expect(fieldShell).not.toBeNull();
    expect(ngSelectShell).not.toBeNull();
    expect(getComputedStyle(card).borderRadius).toBe("0px");
    expect(getComputedStyle(card).boxShadow).toBe("none");
    expect(getComputedStyle(fieldShell).borderRadius).toBe("10px");
    expect(getComputedStyle(fieldShell).minHeight).toBe("44px");
    expect(getComputedStyle(ngSelectShell).borderRadius).toBe("10px");
    expect(getComputedStyle(ngSelectShell).minHeight).toBe("44px");
    expect(getComputedStyle(outsideNgSelectShell).borderRadius).toBe("11px");

    input.focus();
    input.dataset["testFocusVisible"] = "true";
    const fieldFocus = getComputedStyle(fieldShell);
    expect(fieldFocus.outlineWidth).toBe("2px");
    expect(fieldFocus.outlineStyle).toBe("solid");
    expect(fieldFocus.outlineOffset).toBe("2px");
    expect(fieldFocus.boxShadow).toBe("none");
    expect(getComputedStyle(input).outlineStyle).toBe("none");

    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".cipher-form-scroll section")!)
      .marginBottom).toBe("16px");
    document.body.classList.remove("tw-bit-compact");
    fixture.destroy();
  });
});
