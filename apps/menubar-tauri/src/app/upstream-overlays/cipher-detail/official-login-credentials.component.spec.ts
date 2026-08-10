import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { demoVaultItems } from "../../vault-demo";
import { projectLoginDetail } from "../../vault/login-cipher-view.adapter";
import { OFFICIAL_TOTP_CLOCK } from "../../vault/official-totp.service.adapter";
import { OfficialLoginCredentialsComponent } from "./official-login-credentials.component";

beforeAll(() => {
  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch {}
});
describe("OfficialLoginCredentialsComponent contextual fill controls", () => {
  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OfficialLoginCredentialsComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: OFFICIAL_TOTP_CLOCK, useValue: () => 1_700_000_000 },
      ],
    });
    await TestBed.inject(OfficialI18nService).setLocale("zh-CN");
  });

  it("uses person, lock, and clock glyphs with fixed field labels", () => {
    const fixture = TestBed.createComponent(OfficialLoginCredentialsComponent);
    fixture.componentRef.setInput("projection", projectLoginDetail(demoVaultItems[0]));
    fixture.componentRef.setInput("canFill", true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("[data-testid='fill-username']")?.getAttribute("biticonbutton"))
      .toBe("bwi-user");
    expect(host.querySelector("[data-testid='fill-password']")?.getAttribute("biticonbutton"))
      .toBe("bwi-lock");
    expect(host.querySelector("[data-testid='fill-totp']")?.getAttribute("biticonbutton"))
      .toBe("bwi-clock");
    expect(host.querySelector("[data-testid='fill-username']")?.getAttribute("aria-label"))
      .toBe("填入用户名");
    expect(host.querySelector("[data-testid='fill-password']")?.getAttribute("aria-label"))
      .toBe("填入密码");
    expect(host.querySelector("[data-testid='fill-totp']")?.getAttribute("aria-label"))
      .toBe("填入验证码");
  });
});
