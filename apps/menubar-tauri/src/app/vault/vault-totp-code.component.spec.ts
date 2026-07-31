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
import type { TotpCode } from "./totp.service";
import {
  TOTP_CLOCK,
  TOTP_CODE_SOURCE,
  VaultTotpCodeComponent,
} from "./vault-totp-code.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultTotpCodeComponent", () => {
  afterEach(() => vi.useRealTimers());
  it("renders the official countdown shape and emits only the generated code", async () => {
    const totp: TotpCode = {
      code: "123456",
      formattedCode: "123 456",
      period: 30,
      secondsRemaining: 18,
      isExpiring: false,
    };
    const generate = vi.fn(async () => totp);

    await TestBed.configureTestingModule({
      imports: [VaultTotpCodeComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: TOTP_CODE_SOURCE, useValue: { generate } },
        { provide: TOTP_CLOCK, useValue: () => 1_700_000_012 },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultTotpCodeComponent);
    const copied: unknown[] = [];
    const filled: unknown[] = [];
    fixture.componentInstance.copy.subscribe((field) => copied.push(field));
    fixture.componentInstance.fill.subscribe((field) => filled.push(field));
    fixture.componentRef.setInput("seed", "JBSWY3DPEHPK3PXP");
    fixture.componentRef.setInput("canFill", true);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    await Promise.resolve();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const codeInput = host.querySelector<HTMLInputElement>("#totp");
    expect(codeInput?.value).toBe("123 456");
    expect(host.querySelector(".official-totp-countdown svg circle")).not.toBeNull();
    expect(host.querySelector(".official-totp-countdown")?.textContent).toContain("18");
    expect(host.textContent).not.toContain("JBSWY3DPEHPK3PXP");

    host.querySelector<HTMLButtonElement>('[aria-label="复制验证码"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="填入验证码字段"]')!.click();

    expect(generate).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP", 1_700_000_012);
    expect(copied).toEqual([{ id: "otp", label: "验证码 (TOTP)", value: "123456", type: "text" }]);
    expect(filled).toEqual([{ id: "otp", label: "验证码 (TOTP)", value: "123456", type: "text" }]);
  });

  it("hides TOTP controls when the stored seed cannot generate a code", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultTotpCodeComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: TOTP_CODE_SOURCE, useValue: { generate: async () => Promise.reject(new Error("Unsupported TOTP seed")) } },
        { provide: TOTP_CLOCK, useValue: () => 1_700_000_012 },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultTotpCodeComponent);
    fixture.componentRef.setInput("seed", "123456");
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    await Promise.resolve();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector("#totp")).toBeNull();
  });

  it("only regenerates a code after its TOTP period changes", async () => {
    vi.useFakeTimers();
    let epochSeconds = 1_700_000_010;
    const generate = vi.fn(async () => ({
      code: "123456",
      formattedCode: "123 456",
      period: 30,
      secondsRemaining: 20,
      isExpiring: false,
    } satisfies TotpCode));
    await TestBed.configureTestingModule({
      imports: [VaultTotpCodeComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: TOTP_CODE_SOURCE, useValue: { generate } },
        { provide: TOTP_CLOCK, useValue: () => epochSeconds },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultTotpCodeComponent);
    fixture.componentRef.setInput("seed", "JBSWY3DPEHPK3PXP");
    fixture.detectChanges();

    await vi.advanceTimersByTimeAsync(0);
    epochSeconds += 1;
    await vi.advanceTimersByTimeAsync(1_000);
    fixture.detectChanges();

    expect(generate).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).querySelector(".official-totp-countdown")?.textContent)
      .toContain(String(30 - (epochSeconds % 30)));
  });
});
