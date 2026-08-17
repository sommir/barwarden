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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogModule } from "@bitwarden/components/dialog/dialog.module";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { OfficialPersonalCipherFormComponent } from "../upstream-overlays/cipher-form/official-personal-cipher-form.component";
import { RETAINED_LOGIN_FORM_STATUS_STORE } from "./retained-login-form.adapter";
import { NewItemPageComponent } from "./new-item-page.component";
import { FoldersPageComponent } from "./folders-page.component";
import {
  buildOfficialPersonalCipherFormConfig,
  type RetainedOfficialPersonalCipherFormConfig,
} from "./retained-personal-cipher-form.adapter";

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

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = [
    join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"),
    join(
      process.cwd(),
      "vendor/bitwarden-clients/libs/components/src/multi-select/scss/bw.theme.css",
    ),
    join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  document.head.append(style);
});
afterAll(() => { style.remove(); document.body.className = ""; document.body.replaceChildren(); });

describe("iOS 27 Vault workflows", () => {
  it("keeps real New Item rows flat and touchable in compact mode", async () => {
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
    document.body.className = "tw-bit-compact";
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const group = getComputedStyle(host.querySelector<HTMLElement>(".new-item-grid")!);
    const row = getComputedStyle(host.querySelector<HTMLElement>(".new-item-option")!);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderRadius).toBe("0px");
    expect(row.minHeight).toBe("52px");
    fixture.destroy();
    document.body.className = "";
  });

  it("keeps real folder rows continuous and touchable in compact mode", async () => {
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
    document.body.className = "tw-bit-compact";
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const group = getComputedStyle(host.querySelector<HTMLElement>("bit-item-group")!);
    const row = getComputedStyle(host.querySelector<HTMLElement>("bit-item")!);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderRadius).toBe("0px");
    expect(row.marginBottom).toBe("0px");
    expect(row.minHeight).toBe("52px");
    host.querySelector<HTMLButtonElement>("[data-testid='new-folder-button']")!.click();
    fixture.detectChanges();
    const sheet = getComputedStyle(host.querySelector<HTMLElement>(".app-bottom-sheet[open]")!);
    expect(sheet.borderRadius).toBe("var(--mac-sheet-radius) var(--mac-sheet-radius) 0 0");
    fixture.destroy();
    document.body.className = "";
  });

  it("renders OTP as a flat continuous list with accessible actions", () => {
    document.body.innerHTML = `<main class="macos-page--otp"><div class="otp-page__list">
      <article class="otp-code-row"><button class="otp-code-row__copy"><span class="otp-code-row__code">123 456</span></button><button class="otp-code-row__retry">Retry</button></article>
    </div><div class="otp-page__empty">Empty</div></main>`;
    const group = getComputedStyle(document.querySelector<HTMLElement>(".otp-page__list")!);
    const row = getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row")!);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderBottomWidth).toBe("1px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row__copy")!).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row__retry")!).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-page__empty")!).borderRadius).toBe("0px");
    document.body.className = "tw-bit-compact";
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row")!).minHeight).toBe("52px");
  });

  it("keeps recovery rows flat and actions 44 pixels in compact mode", () => {
    document.body.className = "tw-bit-compact";
    document.body.innerHTML = `<main class="macos-page--vault-recovery"><bit-item-group>
      <bit-item><button data-testid="history-copy-0">Copy</button></bit-item>
    </bit-item-group></main>`;
    const row = getComputedStyle(document.querySelector<HTMLElement>("bit-item")!);
    const action = getComputedStyle(document.querySelector<HTMLElement>("button")!);
    expect(row.borderRadius).toBe("0px");
    expect(row.boxShadow).toBe("none");
    expect(row.minHeight).toBe("52px");
    expect(action.minHeight).toBe("44px");
    expect(action.minWidth).toBe("44px");
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

    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".cipher-form-scroll section")!)
      .marginBottom).toBe("16px");
    document.body.classList.remove("tw-bit-compact");
    fixture.destroy();
  });
});
