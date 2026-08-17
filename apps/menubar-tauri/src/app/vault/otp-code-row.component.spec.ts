import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { demoVaultItems } from "../vault-demo";
import type { TotpCode } from "./totp.service";
import {
  OtpCodeRowComponent,
} from "./otp-code-row.component";
import {
  TOTP_CLOCK,
  TOTP_CODE_SOURCE,
} from "./vault-totp-code.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OtpCodeRowComponent", () => {
  afterEach(() => vi.useRealTimers());
  it("renders item identity, formatted code, countdown, and copies without exposing the seed", async () => {
    const seed = "JBSWY3DPEHPK3PXP";
    const item = {
      ...demoVaultItems[0]!,
      fields: demoVaultItems[0]!.fields.map((field) =>
        field.id === "otp" ? { ...field, value: seed } : field
      ),
    };
    const field = item.fields.find((candidate) => candidate.id === "otp")!;
    const totp: TotpCode = {
      code: "123456",
      formattedCode: "123 456",
      period: 30,
      secondsRemaining: 18,
      isExpiring: false,
    };
    const copied = vi.fn();

    await TestBed.configureTestingModule({
      imports: [OtpCodeRowComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        PopupStateStore,
        SettingsService,
        { provide: TOTP_CODE_SOURCE, useValue: { generate: vi.fn(async () => totp) } },
        { provide: TOTP_CLOCK, useValue: () => 1_700_000_012 },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpCodeRowComponent);
    fixture.componentRef.setInput("item", item);
    fixture.componentRef.setInput("field", field);
    fixture.componentInstance.copy.subscribe(copied);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentRef.setInput("copied", true);
    fixture.detectChanges();
    expect(host.querySelector("[data-testid='otp-copy-status']")?.getAttribute("aria-live")).toBe("polite");
    expect(host.querySelector("[data-testid='otp-copy-status']")?.textContent).toContain("GitHub");
    expect(host.querySelector(".otp-code-row__countdown")?.getAttribute("aria-live")).toBeNull();
    fixture.componentRef.setInput("copied", false);
    fixture.detectChanges();

    expect(host.textContent).toContain("GitHub");
    expect(host.textContent).toContain("ops@example.com");
    expect(host.textContent).toContain("123 456");
    expect(host.querySelector(".otp-code-row__countdown")?.textContent).toContain("18");
    expect(host.textContent).not.toContain(seed);
    host.querySelector<HTMLButtonElement>('[aria-label="复制 GitHub 的验证码"]')!.click();
    expect(copied).toHaveBeenCalledWith(field);
  });

  it("keeps a stable unavailable row with retry and no copy action when generation fails", async () => {
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
          useValue: { generate: async () => Promise.reject(new Error("invalid")) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpCodeRowComponent);
    fixture.componentRef.setInput("item", item);
    fixture.componentRef.setInput("field", field);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("[data-testid=otp-code]")).toBeNull();
    expect(host.textContent).toContain("验证码暂不可用");
    expect(host.querySelector<HTMLButtonElement>("[data-testid=otp-retry]")).not.toBeNull();
  });

  it("backs off after a transient failure and recovers without leaving the page", async () => {
    vi.useFakeTimers();
    const item = demoVaultItems[0]!;
    const field = item.fields.find((candidate) => candidate.id === "otp")!;
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error("clock unavailable"))
      .mockResolvedValue({
        code: "654321",
        formattedCode: "654 321",
        period: 30,
        secondsRemaining: 21,
        isExpiring: false,
      } satisfies TotpCode);
    await TestBed.configureTestingModule({
      imports: [OtpCodeRowComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        PopupStateStore,
        SettingsService,
        { provide: TOTP_CODE_SOURCE, useValue: { generate } },
        { provide: TOTP_CLOCK, useValue: () => 1_700_000_012 },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpCodeRowComponent);
    fixture.componentRef.setInput("item", item);
    fixture.componentRef.setInput("field", field);
    fixture.detectChanges();

    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("验证码暂不可用");
    expect(generate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    fixture.detectChanges();

    expect(generate).toHaveBeenCalledTimes(2);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("654 321");
    expect((fixture.nativeElement as HTMLElement).querySelector("[data-testid=otp-code]"))
      .not.toBeNull();
  });

  it("updates the countdown between TOTP periods without regenerating the cryptographic code", async () => {
    vi.useFakeTimers();
    let epochSeconds = 1_700_000_010;
    const item = demoVaultItems[0]!;
    const field = item.fields.find((candidate) => candidate.id === "otp")!;
    const generate = vi.fn(async () => ({
      code: "654321",
      formattedCode: "654 321",
      period: 30,
      secondsRemaining: 20,
      isExpiring: false,
    } satisfies TotpCode));
    await TestBed.configureTestingModule({
      imports: [OtpCodeRowComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        PopupStateStore,
        SettingsService,
        { provide: TOTP_CODE_SOURCE, useValue: { generate } },
        { provide: TOTP_CLOCK, useValue: () => epochSeconds },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpCodeRowComponent);
    fixture.componentRef.setInput("item", item);
    fixture.componentRef.setInput("field", field);
    fixture.detectChanges();

    await vi.advanceTimersByTimeAsync(0);
    epochSeconds += 1;
    await vi.advanceTimersByTimeAsync(1_000);
    fixture.detectChanges();

    expect(generate).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).querySelector(".otp-code-row__countdown")?.textContent)
      .toContain(String(30 - (epochSeconds % 30)));
  });
});
