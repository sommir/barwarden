import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { demoVaultItems } from "../vault-demo";
import { VaultActionsService } from "./vault-actions.service";
import { OtpPageComponent } from "./otp-page.component";
import { TOTP_CODE_SOURCE } from "./vault-totp-code.component";
import { PopupHeaderActionsComponent } from "../popup-header-actions.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OtpPageComponent", () => {
  it("keeps the OTP projection stable across unrelated popup state updates", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems);
    const component = new OtpPageComponent(store, {} as VaultActionsService);
    const initialEntries = component["entries"];

    store.setStatus("Copied");

    expect(component["entries"]).toBe(initialEntries);
    component["setSearch"]("git");
    expect(component["entries"]).not.toBe(initialEntries);
  });

  it("renders searchable OTP entries and copies through the vault action boundary", async () => {
    const validTotp = "JBSWY3DPEHPK3PXP";
    const github = {
      ...demoVaultItems[0]!,
      fields: demoVaultItems[0]!.fields.map((field) =>
        field.id === "otp" ? { ...field, value: validTotp } : field
      ),
    };
    const calendar = {
      ...github,
      id: "calendar",
      name: "Calendar",
      subtitle: "calendar@example.com",
    };
    const copyFieldWithOutcome = vi.fn(async () => ({
      committed: true as const,
      status: "Copied OTP",
    }));
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([github, demoVaultItems[1]!, calendar]);

    TestBed.overrideComponent(PopupHeaderActionsComponent, {
      set: {
        imports: [],
        template: '<div class="header-actions" aria-label="标准窗口操作"></div>',
      },
    });
    await TestBed.configureTestingModule({
      imports: [OtpPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: { copyFieldWithOutcome } },
        {
          provide: TOTP_CODE_SOURCE,
          useValue: {
            generate: async () => ({
              code: "123456",
              formattedCode: "123 456",
              period: 30,
              secondsRemaining: 18,
              isExpiring: false,
            }),
          },
        },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpPageComponent);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page > popup-header h1")?.textContent).toContain("验证码");
    expect(host.querySelector("popup-page > popup-header bw-popup-header-actions")).not.toBeNull();
    expect(host.querySelectorAll("bw-otp-code-row")).toHaveLength(2);
    expect(host.textContent).toContain("项目 (2)");
    const search = host.querySelector<HTMLInputElement>('[aria-label="搜索验证码"]')!;
    search.value = "calendar";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelectorAll("bw-otp-code-row")).toHaveLength(1);
    expect(host.textContent).toContain("Calendar");
    expect(host.textContent).not.toContain("GitHub");

    host.querySelector<HTMLButtonElement>('[aria-label="复制 Calendar 的验证码"]')!.click();
    await fixture.whenStable();
    expect(copyFieldWithOutcome).toHaveBeenCalledWith(
      calendar.fields.find((field) => field.id === "otp"),
      expect.any(Function),
    );
    expect(store.snapshot().statusMessage).toBe("Copied OTP");
    fixture.detectChanges();
    const copiedButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="已复制 Calendar 的验证码"]',
    );
    expect(copiedButton).not.toBeNull();
    expect(copiedButton?.querySelector(".bwi-check")).not.toBeNull();
  });
});
