import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Component, importProvidersFrom, provideZoneChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
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
  imports: [OfficialPersonalCipherFormComponent],
  template: `
    <main class="macos-page--vault-form">
      <div class="cipher-form-scroll">
        <bw-official-personal-cipher-form
          formId="visual-personal-form"
          [config]="config"
          [beforeSubmit]="beforeSubmit"
        ></bw-official-personal-cipher-form>
      </div>
    </main>
  `,
})
class VaultFormVisualHostComponent {
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
  style.textContent = ["macos-tokens.css", "global.css"]
    .map((file) => readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles", file), "utf8"))
    .join("\n");
  document.head.append(style);
});
afterAll(() => { style.remove(); document.body.className = ""; document.body.replaceChildren(); });

describe("iOS 27 Vault workflows", () => {
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
    expect(card).not.toBeNull();
    expect(input).not.toBeNull();
    expect(getComputedStyle(card).borderRadius).toBe("0px");
    expect(getComputedStyle(card).boxShadow).toBe("none");
    expect(getComputedStyle(input).borderRadius).toBe("10px");
    expect(getComputedStyle(input).minHeight).toBe("44px");

    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".cipher-form-scroll section")!)
      .marginBottom).toBe("16px");
    document.body.classList.remove("tw-bit-compact");
    fixture.destroy();
  });
});
