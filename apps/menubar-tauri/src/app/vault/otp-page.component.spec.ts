import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Component } from "@angular/core";
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
import {
  OfficialI18nService,
  translateOfficialMessage,
} from "../official-ui/official-i18n.service";
import { AppFeedbackComponent } from "../official-ui/app-feedback.component";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { AppStatusFeedbackBridgeService } from "../official-ui/app-status-feedback-bridge.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  imports: [OtpPageComponent, AppFeedbackComponent],
  template: `
    <bw-otp-page />
    <bw-app-feedback [hasMainSwitcher]="true" />
  `,
})
class OtpAppFeedbackIntegrationHostComponent {}

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
  it("publishes one generic app-level accessible receipt after a real OTP copy", async () => {
    TestBed.resetTestingModule();
    const seed = "JBSWY3DPEHPK3PXP";
    const item = {
      ...demoVaultItems[0]!,
      id: "private-otp-item-id",
      name: "Private Enterprise OTP Account",
      subtitle: "private-otp-account@example.test",
      fields: demoVaultItems[0]!.fields.map((field) =>
        field.id === "otp" ? { ...field, value: seed } : field
      ),
    };
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([item]);
    const copyFieldWithOutcome = vi.fn(async () => ({
      committed: true as const,
      status: "Copied OTP",
    }));

    TestBed.overrideComponent(PopupHeaderActionsComponent, {
      set: { imports: [], template: '<div class="header-actions"></div>' },
    });
    await TestBed.configureTestingModule({
      imports: [OtpAppFeedbackIntegrationHostComponent],
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
    const bridge = TestBed.inject(AppStatusFeedbackBridgeService);
    bridge.start();
    const fixture = TestBed.createComponent(OtpAppFeedbackIntegrationHostComponent);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>("[data-testid='otp-code']")!.click();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    const accessibleAnnouncementOwners = Array.from(
      host.querySelectorAll<HTMLElement>('[aria-live], [role="status"], [role="alert"]'),
    ).filter((node) =>
      node.getAttribute("aria-hidden") !== "true" && Boolean(node.textContent?.trim())
    );
    expect(accessibleAnnouncementOwners).toHaveLength(1);
    expect(accessibleAnnouncementOwners[0]?.classList).toContain("app-feedback__announcer");
    const announcementMarkup = accessibleAnnouncementOwners.map((node) => node.outerHTML).join("\n");
    expect(announcementMarkup).toContain("已复制验证码");
    for (const sensitiveValue of [
      item.id,
      item.name,
      item.subtitle,
      seed,
      "123456",
      "123 456",
    ]) {
      expect(announcementMarkup).not.toContain(sensitiveValue);
    }
    expect(TestBed.inject(AppFeedbackService).snapshot()).toMatchObject({
      kind: "success",
      message: "Copied OTP",
    });
    expect(host.querySelector(".otp-code-row__copy-icon.bwi-check")).not.toBeNull();
    expect(host.querySelector("[data-testid='otp-copy-status']")?.getAttribute("aria-live"))
      .toBeNull();

    bridge.destroy();
    fixture.destroy();
  });

  it("uses the immediate OTP count after external churn and keeps countdown seconds silent", async () => {
    vi.useFakeTimers();
    try {
      const validTotp = "JBSWY3DPEHPK3PXP";
      const github = {
        ...demoVaultItems[0]!,
        name: "Account Alpha",
        fields: demoVaultItems[0]!.fields.map((field) =>
          field.id === "otp" ? { ...field, value: validTotp } : field
        ),
      };
      const calendar = {
        ...github,
        id: "calendar",
        name: "Account Beta",
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
      const resultText = () =>
        host.querySelector<HTMLElement>('[data-testid="result-announcement"]')?.textContent
          ?.trim() ?? "";
      expect(resultStatus).toHaveLength(1);
      expect(resultStatus[0]!.getAttribute("aria-live")).toBe("polite");
      expect(resultStatus[0]!.getAttribute("aria-atomic")).toBe("true");
      expect(resultText()).toBe("");

      fixture.componentInstance["setSearch"]("Account Alpha");
      fixture.detectChanges();
      const announcedOne = translateOfficialMessage("i18nItemsCount", 1);
      expect(resultText()).toBe(announcedOne);

      store.setItems([
        github,
        { ...github, id: "alpha-two", name: "Account Alpha Two" },
        calendar,
      ]);
      fixture.detectChanges(false);
      expect(resultText()).toBe(announcedOne);

      fixture.componentInstance["setSearch"]("Alpha");
      fixture.detectChanges(false);
      expect(resultText()).toBe(announcedOne);

      fixture.componentInstance["setSearch"]("Account");
      fixture.detectChanges(false);
      expect(resultText()).toBe(translateOfficialMessage("i18nItemsCount", 3));

      const before = resultText();
      epochSeconds += 1;
      await vi.advanceTimersByTimeAsync(1_000);
      fixture.detectChanges();
      expect(resultText()).toBe(before);
      expect(host.querySelectorAll('[data-testid="result-announcement"]')).toHaveLength(1);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces same-count OTP identity changes once without exposing item data", async () => {
    const validTotp = "JBSWY3DPEHPK3PXP";
    const alpha = {
      ...demoVaultItems[0]!,
      id: "otp-alpha-private-id",
      name: "Alpha OTP Private Name",
      uri: "https://alpha-otp-private.example/login",
      fields: demoVaultItems[0]!.fields.map((field) =>
        field.id === "otp" ? { ...field, value: validTotp } : field
      ),
    };
    const beta = {
      ...alpha,
      id: "otp-beta-private-id",
      name: "Beta OTP Private Name",
      uri: "https://beta-otp-private.example/login",
      fields: alpha.fields.map((field) =>
        field.id === "otp" ? { ...field, value: "OTP-SECRET-MUST-NOT-LEAK" } : field
      ),
    };
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([alpha, beta]);
    TestBed.overrideComponent(PopupHeaderActionsComponent, {
      set: { imports: [], template: '<div class="header-actions"></div>' },
    });
    await TestBed.configureTestingModule({
      imports: [OtpPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
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
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector<HTMLElement>('[data-testid="result-announcement"]')!;
    const publication = () =>
      region.querySelector<HTMLElement>("[data-result-announcement-revision]");

    fixture.componentInstance["setSearch"]("Alpha OTP Private Name");
    fixture.detectChanges();
    const first = publication();
    expect(first?.textContent?.trim()).toBe(translateOfficialMessage("i18nItemsCount", 1));

    fixture.componentInstance["setSearch"]("Beta OTP Private Name");
    fixture.detectChanges();
    const second = publication();
    expect(second).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(second?.textContent?.trim()).toBe(translateOfficialMessage("i18nItemsCount", 1));
    expect(second?.getAttribute("data-result-announcement-revision")).not.toBe(
      first?.getAttribute("data-result-announcement-revision"),
    );
    expect(region.getAttribute("aria-label")).toBeNull();
    expect(region.textContent?.trim()).toBe(translateOfficialMessage("i18nItemsCount", 1));
    expect(region.textContent).not.toContain(
      second?.getAttribute("data-result-announcement-revision") ?? "revision-missing",
    );
    expect(region.outerHTML).not.toContain("Alpha OTP Private Name");
    expect(region.outerHTML).not.toContain("Beta OTP Private Name");
    expect(region.outerHTML).not.toContain("OTP-SECRET-MUST-NOT-LEAK");
    expect(region.outerHTML).not.toContain("alpha-otp-private.example");
    expect(region.outerHTML).not.toContain("beta-otp-private.example");
    expect(region.outerHTML).not.toContain("otp-alpha-private-id");
    expect(region.outerHTML).not.toContain("otp-beta-private-id");

    fixture.componentInstance["setSearch"]("Beta OTP Private Name");
    fixture.detectChanges();
    expect(publication()).toBe(second);
    expect(host.querySelectorAll('[data-testid="result-announcement"]')).toHaveLength(1);
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
    expect(getComputedStyle(otpRows[0]!).minHeight).toBe("48px");
    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(otpRows[0]!).minHeight).toBe("44px");
    document.documentElement.removeAttribute("data-bw-compact-mode");
    const copyTarget = host.querySelector<HTMLElement>("[data-testid='otp-code']")!;
    const copyPlate = copyTarget.querySelector<HTMLElement>(".otp-code-row__copy-icon")!;
    const countdownPlate = host.querySelector<HTMLElement>(".otp-code-row__countdown")!;
    expect(copyTarget.closest("[data-popup-focus-key]")).toBe(otpRows[0]);
    expect(parseFloat(getComputedStyle(copyTarget).minWidth)).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(copyTarget).minHeight).toBe("44px");
    expect(getComputedStyle(copyPlate).width).toBe("32px");
    expect(getComputedStyle(copyPlate).height).toBe("32px");
    expect(getComputedStyle(countdownPlate).width).toBe("32px");
    expect(getComputedStyle(countdownPlate).height).toBe("32px");
    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(copyPlate).width).toBe("28px");
    expect(getComputedStyle(copyPlate).height).toBe("28px");
    expect(getComputedStyle(countdownPlate).width).toBe("28px");
    expect(getComputedStyle(countdownPlate).height).toBe("28px");
    document.documentElement.removeAttribute("data-bw-compact-mode");
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
    document.documentElement.removeAttribute("data-bw-compact-mode");
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
