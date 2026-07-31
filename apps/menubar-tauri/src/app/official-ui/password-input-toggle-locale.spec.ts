import "zone.js";
import "@angular/compiler";

import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { By } from "@angular/platform-browser";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { BitPasswordInputToggleDirective } from "@bitwarden/components/form-field/password-input-toggle.directive";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";

import { OfficialI18nService } from "./official-i18n.service";

@Component({
  template: `
    <bit-form-field>
      <bit-label>Password</bit-label>
      <input bitInput type="password" />
      <button type="button" bitIconButton bitSuffix bitPasswordInputToggle></button>
    </bit-form-field>
  `,
  imports: [FormFieldModule, IconButtonModule],
})
class PasswordToggleLocaleHostComponent {}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("BitPasswordInputToggleDirective locale refresh", () => {
  let fixture: ComponentFixture<PasswordToggleLocaleHostComponent>;
  let i18n: OfficialI18nService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordToggleLocaleHostComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    i18n = TestBed.inject(OfficialI18nService);
    await i18n.setLocale("zh-CN");
    fixture = TestBed.createComponent(PasswordToggleLocaleHostComponent);
    fixture.detectChanges();
  });

  afterEach(async () => {
    await i18n?.setLocale("zh-CN");
  });

  it("updates an existing toggle label immediately when the locale changes", async () => {
    const button = fixture.debugElement.query(
      By.directive(BitPasswordInputToggleDirective),
    ).nativeElement as HTMLButtonElement;

    expect(button.getAttribute("title")).toBe("显示密码");
    expect(button.getAttribute("aria-label")).toBe("显示密码");

    await i18n.setLocale("en-US");
    await fixture.whenStable();

    expect(button.getAttribute("title")).toBe("Show password");
    expect(button.getAttribute("aria-label")).toBe("Show password");
  });
});
