import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
import { OtpFacade } from "./otp.facade";
import { OtpPageComponent } from "./otp-page.component";
import { TOTP_CLOCK, TOTP_CODE_SOURCE } from "./vault-totp-code.component";
import { PopupHeaderActionsComponent } from "../popup-header-actions.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

function installVaultVisualCss(): () => void {
  const style = document.createElement("style");
  const source = ["macos-tokens.css", "global.css"]
    .map((filename) => readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles", filename), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const macTokens = new Map(
    [...rootDeclarations.matchAll(/(--mac-[\w-]+):\s*([^;]+);/g)].map(([, token, value]) => [
      token,
      value.trim(),
    ]),
  );
  style.textContent = source.replace(/var\((--mac-[\w-]+)\)/g, (reference, token) =>
    macTokens.get(token) ?? reference,
  );
  document.head.append(style);
  return () => style.remove();
}

async function renderOtp(facade: OtpFacade) {
  TestBed.resetTestingModule();
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
  const store = new PopupStateStore();
  store.setUnlocked("user@example.com");
  store.setItems([github, demoVaultItems[1]!, calendar]);

  TestBed.overrideComponent(PopupHeaderActionsComponent, {
    set: { imports: [], template: '<div class="header-actions"></div>' },
  });
  await TestBed.configureTestingModule({
    imports: [OtpPageComponent],
    providers: [
      provideRouter([]),
      { provide: PopupStateStore, useValue: store },
      { provide: OtpFacade, useValue: facade },
      { provide: VaultActionsService, useValue: { copyFieldWithOutcome: vi.fn() } },
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
  return fixture;
}

describe("OtpPageComponent", () => {
  it("announces result-count changes without announcing countdown seconds", async () => {
    vi.useFakeTimers();
    try {
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
      const store = new PopupStateStore();
      store.setUnlocked("user@example.com");
      store.setItems([github, calendar]);
      let epochSeconds = 12;

      TestBed.overrideComponent(PopupHeaderActionsComponent, {
        set: { imports: [], template: '<div class="header-actions"></div>' },
      });
      await TestBed.configureTestingModule({
        imports: [OtpPageComponent],
        providers: [
          provideRouter([]),
          { provide: PopupStateStore, useValue: store },
          { provide: VaultActionsService, useValue: { copyFieldWithOutcome: vi.fn() } },
          { provide: TOTP_CLOCK, useValue: () => epochSeconds },
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
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const resultStatus = host.querySelectorAll(
        '[data-testid="result-announcement"][role="status"]',
      );
      expect(resultStatus).toHaveLength(1);
      expect(resultStatus[0]!.getAttribute("aria-live")).toBe("polite");
      expect(resultStatus[0]!.getAttribute("aria-atomic")).toBe("true");
      expect(resultStatus[0]!.textContent?.trim()).toBe("");

      fixture.componentInstance["setSearch"]("Calendar");
      fixture.detectChanges();
      expect(resultStatus[0]!.textContent).toContain("1");

      const before = resultStatus[0]!.textContent;
      epochSeconds += 1;
      await vi.advanceTimersByTimeAsync(1_000);
      fixture.detectChanges();
      expect(resultStatus[0]!.textContent).toBe(before);
      expect(host.querySelectorAll('[data-testid="result-announcement"]')).toHaveLength(1);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the OTP projection stable across unrelated popup state updates", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems);
    const component = new OtpPageComponent(store, {} as VaultActionsService, new OtpFacade());
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
    const cleanupVisualCss = installVaultVisualCss();
    const fixture = TestBed.createComponent(OtpPageComponent);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page > popup-header h1")?.textContent).toContain("验证码");
    expect(host.querySelector("popup-page > popup-header bw-popup-header-actions")).not.toBeNull();
    expect(host.querySelectorAll("bw-otp-code-row")).toHaveLength(2);
    const otpRows = host.querySelectorAll<HTMLElement>(".otp-code-row");
    expect(Array.from(otpRows).map((row) => row.getAttribute("data-popup-focus-key")))
      .toEqual(["otp-item:github", "otp-item:calendar"]);
    expect(getComputedStyle(otpRows[0]!).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(otpRows[1]!).borderBottomWidth).toBe("0px");
    expect(getComputedStyle(otpRows[0]!).minHeight).toBe("56px");
    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(otpRows[0]!).minHeight).toBe("52px");
    document.body.classList.remove("tw-bit-compact");
    const copyTarget = host.querySelector<HTMLElement>("[data-testid='otp-code']")!;
    expect(copyTarget.closest("[data-popup-focus-key]")).toBe(otpRows[0]);
    expect(getComputedStyle(copyTarget).minWidth).toBe("116px");
    expect(getComputedStyle(copyTarget).minHeight).toBe("44px");
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
    cleanupVisualCss();
    fixture.destroy();
  });

  it("renders unavailable OTP retry controls as 44px targets in the real page wrapper", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([demoVaultItems[0]!]);

    TestBed.overrideComponent(PopupHeaderActionsComponent, {
      set: { imports: [], template: '<div class="header-actions"></div>' },
    });
    await TestBed.configureTestingModule({
      imports: [OtpPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: {} },
        { provide: TOTP_CODE_SOURCE, useValue: { generate: async () => Promise.reject(new Error("invalid")) } },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const cleanupVisualCss = installVaultVisualCss();
    const fixture = TestBed.createComponent(OtpPageComponent);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const retryTarget = host.querySelector<HTMLElement>("[data-testid='otp-retry']")!;
    const owner = host.querySelector<HTMLElement>("article.otp-code-row")!;
    expect(owner.getAttribute("data-popup-focus-key")).toBe("otp-item:github");
    expect(retryTarget.closest("[data-popup-focus-key]")).toBe(owner);
    expect(getComputedStyle(retryTarget).minWidth).toBe("44px");
    expect(getComputedStyle(retryTarget).minHeight).toBe("44px");

    cleanupVisualCss();
    fixture.destroy();
  });

  it("restores query and filtered count after the real page is destroyed", async () => {
    const facade = new OtpFacade();
    const first = await renderOtp(facade);
    const search = first.nativeElement.querySelector<HTMLInputElement>(
      '[aria-label="搜索验证码"]',
    )!;
    search.value = "Calendar";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    first.detectChanges();
    expect(first.nativeElement.querySelectorAll("bw-otp-code-row")).toHaveLength(1);
    first.destroy();

    const second = await renderOtp(facade);
    second.detectChanges();
    expect(second.nativeElement.querySelector<HTMLInputElement>(
      '[aria-label="搜索验证码"]',
    )!.value).toBe("Calendar");
    expect(second.nativeElement.querySelectorAll("bw-otp-code-row")).toHaveLength(1);
    second.destroy();
  });
});
