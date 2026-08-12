import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter, Router } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { AccountSecurityPageComponent } from "./account-security-page.component";
import { AboutPageComponent } from "./about-page.component";
import { aboutMetadata } from "./about-metadata";
import { AppearancePageComponent } from "./appearance-page.component";
import { AutofillSettingsPageComponent } from "./autofill-settings-page.component";
import { SettingsService as SettingsStateService } from "./settings.service";
import { EnvironmentHandoffService } from "./environment-handoff.service";
import { CLIPBOARD_POLICY_HOST } from "./clipboard-policy.service";
import { PopupStateStore } from "../popup-state";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { AppUpdateService } from "../updates/app-update.service";
import { OfficialAccountSecurityComponent } from "../upstream-overlays/settings/official-account-security.component";
import { OfficialAppearanceComponent } from "../upstream-overlays/settings/official-appearance.component";
import { VaultTimeoutService } from "../auth/vault-timeout.service";
import type { VaultTimeoutMinutes } from "./settings-options";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes("Cannot set base providers")
  ) {
    throw error;
  }
}

describe("P1 settings pages", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it.each([
    ["settings-page.component.ts", "bw-official-settings"],
    ["account-security-page.component.ts", "bw-official-account-security"],
    ["vault-settings-page.component.ts", "bw-official-vault-settings"],
    ["appearance-page.component.ts", "bw-official-appearance"],
    ["about-page.component.ts", "bw-official-about"],
  ] as const)("renders %s through exactly one approved overlay root", (path, selector) => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/menubar-tauri/src/app/settings", path),
      "utf8",
    );

    expect(source.match(new RegExp(`<${selector}\\b`, "g"))).toHaveLength(1);
    expect(source).not.toMatch(/<popup-page\b|<popup-header\b/);
  });

  it("keeps appearance and About as in-flow subroutes with no main navigation", () => {
    const root = resolve(process.cwd(), "apps/menubar-tauri/src/app/settings");
    const appearance = readFileSync(resolve(root, "appearance-page.component.ts"), "utf8");
    const about = readFileSync(resolve(root, "about-page.component.ts"), "utf8");

    expect(appearance).toContain('host: { class: "macos-page macos-page--secondary macos-page--appearance" }');
    expect(about).toContain('host: { class: "macos-page macos-page--secondary macos-page--about" }');
    expect(appearance).not.toContain("bw-floating-tab-switcher");
    expect(about).not.toContain("bw-floating-tab-switcher");
  });

  it("keeps page surfaces solid while preference overrides preserve non-color feedback", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(css).toMatch(/\.macos-page--settings\s+\.settings-row\s*{[^}]*background:\s*var\(--mac-surface-solid\)[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*?\.floating-tab-switcher__segment\[aria-current="page"\][\s\S]*?text-decoration/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.floating-tab-switcher__indicator[\s\S]*?transition:\s*none/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.macos-pressable:active[\s\S]*?opacity/s);
  });

  it("keeps localized select options stable until the active locale changes", async () => {
    const i18n = new OfficialI18nService();
    await i18n.setLocale("zh-CN");
    const accountSecurity = new OfficialAccountSecurityComponent();
    const appearance = Reflect.construct(
      OfficialAppearanceComponent,
      [i18n],
    ) as OfficialAppearanceComponent;
    const autofill = Reflect.construct(AutofillSettingsPageComponent, [
      new SettingsStateService(),
      { back: vi.fn() },
    ]) as AutofillSettingsPageComponent;

    try {
      const timeoutOptions = accountSecurity.timeoutOptions;
      const timeoutActionOptions = accountSecurity.timeoutActionOptions;
      const themeOptions = appearance.themeOptions;
      const languageOptions = appearance.languageOptions;
      const clipboardClearOptions = autofill.clipboardClearOptions;
      const fillModeOptions = autofill.fillModeOptions;

      expect(accountSecurity.timeoutOptions).toBe(timeoutOptions);
      expect(accountSecurity.timeoutActionOptions).toBe(timeoutActionOptions);
      expect(appearance.themeOptions).toBe(themeOptions);
      expect(appearance.languageOptions).toBe(languageOptions);
      expect(autofill.clipboardClearOptions).toBe(clipboardClearOptions);
      expect(autofill.fillModeOptions).toBe(fillModeOptions);

      await i18n.setLocale("en-US");

      expect(accountSecurity.timeoutOptions).not.toBe(timeoutOptions);
      expect(accountSecurity.timeoutOptions[2]?.label).toBe("5 minutes");
      expect(appearance.themeOptions).not.toBe(themeOptions);
      expect(appearance.languageOptions).not.toBe(languageOptions);
      expect(autofill.clipboardClearOptions).not.toBe(clipboardClearOptions);
      expect(autofill.fillModeOptions).not.toBe(fillModeOptions);
      expect(autofill.fillModeOptions[0]?.label).toBe("Copy to clipboard only");
    } finally {
      await i18n.setLocale("zh-CN");
    }
  });

  it("renders the official account security inventory with a live vault timeout setting", async () => {
    const service = new SettingsStateService();
    const opened: string[] = [];
    await TestBed.configureTestingModule({
      imports: [AccountSecurityPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: SettingsStateService, useValue: service },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openExternal: async (url: string) => opened.push(url),
            openWebVault: async (path: string) => opened.push(path),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AccountSecurityPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("账户安全");
    expect(host.textContent).not.toContain("使用生物识别解锁");
    expect(host.textContent).toContain("解锁选项");
    expect(host.textContent).toContain("使用 Touch ID 解锁");
    expect(host.textContent).toContain("使用 PIN 码解锁");
    expect(host.querySelector("input#biometricUnlock")).not.toBeNull();
    expect(host.querySelector("input#pinUnlock")).not.toBeNull();
    expect(host.textContent).toContain("密码库超时");
    expect(host.textContent).toContain("5 分钟");
    expect(host.textContent).toContain("PIN 会加密保存在此设备");
    expect(host.textContent).toContain("重新启动应用后，需先用主密码解锁一次");
    expect(host.textContent).not.toContain("指纹短语");
    expect(host.textContent).toContain("两步登录");
    expect(host.textContent).toContain("更改主密码");
    expect(host.querySelector('a[href="/device-management"]')).toBeNull();
    expect(host.querySelector('a[href="/fingerprint-phrase"]')).toBeNull();
    expect(host.querySelector('a[href="/settings-password"]')).toBeNull();
    expect(host.querySelectorAll(".bwi-external-link")).toHaveLength(2);
    expect(
      host.querySelector('bit-select[aria-label="密码库超时"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('bit-select[aria-label="密码库超时动作"]'),
    ).not.toBeNull();
    const overlay = fixture.debugElement.query(By.directive(OfficialAccountSecurityComponent))
      .componentInstance as OfficialAccountSecurityComponent;
    expect(overlay.timeoutOptions.map(({ value }) => value)).toEqual([0, 1, 5, 15, 30, 60, 240, -1]);
    expect(overlay.timeoutActionOptions.map(({ value }) => value)).toEqual(["lock", "logout"]);
    overlay.setVaultTimeoutMinutesValue(15);
    overlay.setVaultTimeoutActionValue("logout");
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("两步登录"))!
      .click();
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("更改主密码"))!
      .click();
    await fixture.whenStable();

    expect(service.snapshot().vaultTimeoutMinutes).toBe(15);
    expect(service.snapshot().vaultTimeoutAction).toBe("logout");
    expect(opened).toEqual([
          "https://bitwarden.com/help/setup-two-step-login/",
          "/#/settings/security/password",
    ]);
    expect(host.querySelectorAll("button[disabled]")).toHaveLength(0);
  });

  it.each([
    { from: -1, to: 1, advanceMs: 60_000, unlocked: false },
    { from: 1, to: -1, advanceMs: 60_000, unlocked: true },
    { from: 1, to: 0, advanceMs: 0, unlocked: false },
  ] satisfies readonly {
    from: VaultTimeoutMinutes;
    to: VaultTimeoutMinutes;
    advanceMs: number;
    unlocked: boolean;
  }[])(
    "reschedules the active vault timer after a $from -> $to persisted timeout transition",
    ({ from, to, advanceMs, unlocked }) => {
      vi.useFakeTimers();
      const store = new PopupStateStore();
      const settings = new SettingsStateService();
      const timeout = new VaultTimeoutService(store, settings);
      const page = Reflect.construct(AccountSecurityPageComponent, [
        settings,
        { back: vi.fn() },
        { openExternal: vi.fn(), openWebVault: vi.fn() },
        timeout,
      ]) as AccountSecurityPageComponent;
      store.setUnlocked("user@example.com");
      settings.setVaultTimeoutMinutes(from);
      timeout.recordActivity();

      page.setVaultTimeoutMinutes(to);
      vi.advanceTimersByTime(advanceMs);

      expect(store.snapshot().isUnlocked).toBe(unlocked);
    },
  );

  it("keeps the active timer when actual timeout persistence fails", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsStateService();
    settings.useAccount("account-a");
    settings.setVaultTimeoutMinutes(1);
    const timeout = new VaultTimeoutService(store, settings);
    const page = Reflect.construct(AccountSecurityPageComponent, [
      settings,
      { back: vi.fn() },
      { openExternal: vi.fn(), openWebVault: vi.fn() },
      timeout,
    ]) as AccountSecurityPageComponent;
    const failedStorage = Object.create(localStorage) as Storage;
    failedStorage.setItem = () => {
      throw new Error("storage unavailable");
    };
    vi.stubGlobal("localStorage", failedStorage);

    try {
      store.setUnlocked("user@example.com");
      timeout.recordActivity();
      page.setVaultTimeoutMinutes(-1);

      expect(settings.snapshot().vaultTimeoutMinutes).toBe(1);
      vi.advanceTimersByTime(60_000);
      expect(store.snapshot().isUnlocked).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders fixed handoff failure text instead of native error details", async () => {
    await TestBed.configureTestingModule({
      imports: [AccountSecurityPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: SettingsStateService, useValue: new SettingsStateService() },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openWebVault: vi.fn(async () => {
              throw new Error("native URL failure details");
            }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AccountSecurityPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("更改主密码"))!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "无法打开链接。请重试。",
    );
    expect(host.textContent).not.toContain("native URL failure details");
  });

  it("renders retained About actions with local metadata and environment-aware handoffs", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("https://vault.example.test/");
    const opened: string[] = [];
    const copyText = vi.fn(async () => undefined);
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [
        provideRouter([
          { path: "third-party-notices", component: AboutPageComponent },
        ]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: store },
        { provide: CLIPBOARD_POLICY_HOST, useValue: { copyText } },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openExternal: async (url: string) => opened.push(url),
            openWebVault: async (path: string) => opened.push(path),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AboutPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll("bit-item-group bit-item")).toHaveLength(6);
    expect(
      Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          "bit-item-group:first-of-type bit-item button",
        ),
        (button) => button.textContent?.trim(),
      ),
    ).toEqual([
      "故障排除",
      "关于 Barwarden",
      "第三方开源许可",
      "帮助中心",
      "Web Vault",
      "上游 Bitwarden 源码",
    ]);
    expect(host.textContent).toContain("Barwarden 0.1.0");
    expect(host.textContent).toContain("应用更新");
    expect(host.textContent).toContain("检查更新");
    expect(host.textContent).toContain("故障排除");
    expect(host.textContent).toContain("关于 Barwarden");
    expect(aboutMetadata.productName).toBe("Barwarden");
    expect(host.textContent).toContain("帮助中心");
    expect(host.textContent).toContain("Web Vault");
    expect(host.textContent).toContain("上游 Bitwarden 源码");
    expect(host.textContent).not.toContain("评价扩展程序");
    expect(host.textContent).not.toContain("营销");
    expect(host.querySelectorAll(".bwi-external-link")).toHaveLength(3);

    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    );
    buttons.find((button) => button.textContent?.includes("故障排除"))!.click();
    fixture.detectChanges();
    expect(host.querySelector("dialog[open] form[bit-dialog]")).not.toBeNull();
    expect(host.textContent).toContain("当前 Web Vault");
    expect(host.textContent).toContain("https://vault.example.test/");
    fixture.componentInstance.closeMetadata();
    buttons
      .find((button) => button.textContent?.includes("关于 Barwarden"))!
      .click();
    fixture.detectChanges();
    expect(host.querySelector("dialog[open] form[bit-dialog]")).not.toBeNull();
    expect(host.textContent).toContain("GPL-3.0-only");
    expect(host.textContent).toContain("版本");
    expect(host.textContent).toContain("0.1.0");
    expect(host.textContent).toContain("上游 revision");
    expect(host.textContent).toContain("f47b6946e01aed474875789081966d311d5b8289");
    expect(host.textContent).toContain("当前 Web Vault");
    expect(host.textContent).toContain("https://vault.example.test/");
    expect(host.querySelector(".about-metadata-list")).not.toBeNull();
    expect(host.querySelector(".about-revision-value")?.textContent).toContain(
      "f47b6946e01aed474875789081966d311d5b8289",
    );
    host.querySelector<HTMLButtonElement>("[data-testid='copy-about-revision']")!.click();
    await fixture.whenStable();
    expect(copyText).toHaveBeenCalledWith(
      "f47b6946e01aed474875789081966d311d5b8289",
      30,
    );
    fixture.componentInstance.closeMetadata();
    buttons
      .find((button) => button.textContent?.includes("第三方开源许可"))!
      .click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe("/third-party-notices");
    buttons.find((button) => button.textContent?.includes("帮助中心"))!.click();
    buttons
      .find((button) => button.textContent?.includes("Web Vault"))!
      .click();
    buttons
      .find((button) => button.textContent?.includes("上游 Bitwarden 源码"))!
      .click();
    await fixture.whenStable();

    expect(opened).toEqual([
      "https://bitwarden.com/help/",
      "",
      "https://github.com/bitwarden/clients/tree/f47b6946e01aed474875789081966d311d5b8289",
    ]);
    expect(host.querySelectorAll("button[disabled]")).toHaveLength(0);
  });

  it("offers a discovered app update only after the user checks", async () => {
    const candidate = {
      version: "0.2.0",
      notes: "Fixes",
      downloadAndInstall: vi.fn(async () => undefined),
    };
    const updater = new AppUpdateService({ check: vi.fn(async () => candidate) });
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        { provide: AppUpdateService, useValue: updater },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openExternal: vi.fn(async () => undefined),
            openWebVault: vi.fn(async () => undefined),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AboutPageComponent);
    await TestBed.inject(OfficialI18nService).setLocale("en-US");
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[data-testid='check-for-updates']")!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.textContent).toContain("Version 0.2.0 is available");
    expect(host.textContent).toContain("Update and restart");
    expect(host.textContent).toContain("Fixes");
    expect(candidate.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("reacts to a background update without reopening the About page", async () => {
    const candidate = {
      version: "0.2.0",
      notes: "Fixes",
      downloadAndInstall: vi.fn(async () => undefined),
    };
    const updater = new AppUpdateService({ check: vi.fn(async () => candidate) });
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        { provide: AppUpdateService, useValue: updater },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openExternal: vi.fn(async () => undefined),
            openWebVault: vi.fn(async () => undefined),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AboutPageComponent);
    await TestBed.inject(OfficialI18nService).setLocale("en-US");
    fixture.detectChanges();

    await updater.checkInBackground();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Version 0.2.0 is available",
    );
  });

  it.each(["Enter", " "])("opens About metadata from one explicit %s activation", async (key) => {
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openExternal: vi.fn(async () => undefined),
            openWebVault: vi.fn(async () => undefined),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AboutPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const about = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("关于 Barwarden"))!;
    const keyboardEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    });

    about.dispatchEvent(keyboardEvent);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(keyboardEvent.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.metadataView).toBe("about");
    fixture.detectChanges();
    expect(host.querySelector("dialog[open] form[bit-dialog]")).not.toBeNull();
  });

  it("ignores repeated About keyboard activation", async () => {
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openExternal: vi.fn(async () => undefined),
            openWebVault: vi.fn(async () => undefined),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AboutPageComponent);
    fixture.detectChanges();
    const about = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("关于 Barwarden"))!;
    const click = vi.spyOn(about, "click");

    about.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      repeat: true,
    }));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

    expect(click).not.toHaveBeenCalled();
    expect(fixture.componentInstance.metadataView).toBeNull();
  });

  it("renders a fixed About handoff failure instead of native details", async () => {
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openExternal: vi.fn(async () => {
              throw new Error("private native opener details");
            }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AboutPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("帮助中心"))!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "无法打开链接。请重试。",
    );
    expect(host.textContent).not.toContain("private native opener details");
  });

  it("renders actionable native single-field modes with standard clipboard timeout choices", async () => {
    const service = new SettingsStateService();
    await TestBed.configureTestingModule({
      imports: [AutofillSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: SettingsStateService, useValue: service },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AutofillSettingsPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("填充");
    expect(host.textContent).not.toContain("单字段填充");
    expect(host.textContent).toContain("在输入框附近显示图标");
    expect(host.textContent).not.toContain("在表单字段上显示自动填充建议");
    expect(host.textContent).not.toContain("页面加载时自动填充");
    expect(host.textContent).toContain("清空剪贴板");
    expect(host.textContent).toContain("填充");
    expect(host.textContent).not.toContain("内容脚本");
    expect(host.querySelector('a[href="/blocked-domains"]')).toBeNull();

    expect(host.querySelector("input[type='number']")).toBeNull();
    expect(
      host.querySelector('bit-select[aria-label="清空剪贴板"]'),
    ).not.toBeNull();
    expect(
      fixture.componentInstance.clipboardClearOptions.map(
        (option) => option.value,
      ),
    ).toEqual([0, 10, 20, 30, 60, 120, 300]);
    expect(
      fixture.componentInstance.fillModeOptions.map((option) => option.value),
    ).toEqual(["clipboard-copy", "clipboard-paste"]);

    fixture.componentInstance.setClipboardClearSecondsValue(0);
    fixture.componentInstance.setFillModeValue("clipboard-copy");
    fixture.componentInstance.setFillModeValue("clipboard-paste");
    const fieldIcon = host.querySelector<HTMLInputElement>("#show-input-field-icon");
    expect(fieldIcon?.checked).toBe(true);
    fieldIcon!.checked = false;
    fieldIcon!.dispatchEvent(new Event("change"));

    expect(service.snapshot()).toMatchObject({
      clipboardClearSeconds: 0,
      fillMode: "clipboard-paste",
      showInputFieldIcon: false,
    });
    expect(host.querySelectorAll("button[disabled]")).toHaveLength(0);
  });


  it("renders appearance inventory with supported local settings active and unsupported ones deferred", async () => {
    const service = new SettingsStateService();
    await TestBed.configureTestingModule({
      imports: [AppearancePageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: SettingsStateService, useValue: service },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppearancePageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("主题");
    expect(host.textContent).toContain("紧凑模式");
    expect(host.textContent).toContain("显示动画");
    expect(host.textContent).not.toContain("显示存在风险的密码通知");
    expect(host.textContent).not.toContain(
      "在扩展图标上显示自动填充建议的登录数量",
    );
    expect(host.textContent).toContain("显示网站图标");
    expect(host.textContent).toContain("在密码库上显示快速复制操作");
    expect(host.textContent).not.toContain("点击自动填充建议中的项目以填充");
    const quickCopyCheckbox = host.querySelector<HTMLInputElement>(
      'input[aria-label="在密码库上显示快速复制操作"]',
    );
    expect(quickCopyCheckbox).not.toBeNull();
    expect(quickCopyCheckbox?.disabled).toBe(false);
    expect(quickCopyCheckbox?.checked).toBe(true);
    const faviconCheckbox = host.querySelector<HTMLInputElement>(
      'input[aria-label="显示网站图标"]',
    );
    expect(faviconCheckbox).not.toBeNull();
    expect(faviconCheckbox?.disabled).toBe(false);
    expect(faviconCheckbox?.checked).toBe(true);

    const overlay = fixture.debugElement.query(By.directive(OfficialAppearanceComponent))
      .componentInstance as OfficialAppearanceComponent;
    expect(overlay.themeOptions.map(({ value }) => value)).toEqual(["system", "light", "dark"]);
    overlay.setThemeValue("dark");
    host
      .querySelector<HTMLInputElement>('input[aria-label="紧凑模式"]')!
      .click();
    host
      .querySelector<HTMLInputElement>('input[aria-label="显示动画"]')!
      .click();
    faviconCheckbox!.click();
    quickCopyCheckbox!.click();
    fixture.detectChanges();

    expect(service.snapshot()).toMatchObject({
      theme: "dark",
      compactMode: true,
      animations: false,
      showFavicons: false,
      showQuickCopyActions: false,
    });
    expect(host.querySelectorAll("button[disabled]")).toHaveLength(0);
  });

  it("refreshes appearance select labels immediately when the locale changes", async () => {
    const service = new SettingsStateService();
    const i18n = new OfficialI18nService();
    await i18n.setLocale("zh-CN");
    await TestBed.configureTestingModule({
      imports: [AppearancePageComponent],
      providers: [
        provideRouter([]),
        { provide: OfficialI18nService, useValue: i18n },
        { provide: I18nService, useValue: i18n },
        { provide: SettingsStateService, useValue: service },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppearancePageComponent);
    fixture.detectChanges();
    const overlay = fixture.debugElement.query(By.directive(OfficialAppearanceComponent))
      .componentInstance as OfficialAppearanceComponent;
    expect(overlay.themeOptions.map(({ label }) => label)).toEqual([
      "跟随系统",
      "浅色",
      "深色",
    ]);

    await i18n.setLocale("en-US");
    fixture.detectChanges();

    expect(overlay.themeOptions.map(({ label }) => label)).toEqual([
      "Follow system",
      "Light",
      "Dark",
    ]);
    expect(overlay.languageOptions.map(({ label }) => label)).toEqual([
      "Follow system",
      "Simplified Chinese",
      "English",
    ]);
    await i18n.setLocale("zh-CN");
  });

  it("opens the official Web Vault change-master-password route from settings-password", async () => {
    const { SettingsPasswordPageComponent } = await import("./settings-password-page.component");
    const opened: string[] = [];
    await TestBed.configureTestingModule({
      imports: [SettingsPasswordPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: EnvironmentHandoffService,
          useValue: {
            openWebVault: async (path: string) => opened.push(path),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPasswordPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("更改主密码");
    expect(host.textContent).toContain("Web Vault");
    const openButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("打开 Web Vault"));
    expect(openButton).not.toBeNull();
    expect(openButton?.disabled).toBe(false);
    openButton!.click();
    await fixture.whenStable();

    expect(opened).toEqual(["/#/settings/security/password"]);
  });

  it("handles settings-password handoff failures with a sanitized alert", async () => {
    const { SettingsPasswordPageComponent } = await import("./settings-password-page.component");
    const nativeError = "Tauri open_url failed for https://vault.example.test/private";
    const openWebVault = vi.fn(async () => {
      throw new Error(nativeError);
    });
    await TestBed.configureTestingModule({
      imports: [SettingsPasswordPageComponent],
      providers: [
        provideRouter([]),
        { provide: EnvironmentHandoffService, useValue: { openWebVault } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPasswordPageComponent);
    fixture.detectChanges();

    await expect(fixture.componentInstance.openWebVaultChangePassword()).resolves.toBeUndefined();
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(openWebVault).toHaveBeenCalledWith("/#/settings/security/password");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法打开链接。请重试。");
    expect(host.textContent).not.toContain(nativeError);
  });

  it("uses the official PopOutComponent for settings-password", async () => {
    const { SettingsPasswordPageComponent } =
      await import("./settings-password-page.component");
    await TestBed.configureTestingModule({
      imports: [SettingsPasswordPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: EnvironmentHandoffService, useValue: { openWebVault: async () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPasswordPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const popOut = host.querySelector<HTMLButtonElement>("app-pop-out button");
    expect(popOut).not.toBeNull();
    expect(popOut?.disabled).toBe(false);
    expect(popOut?.getAttribute("aria-label")).toBeTruthy();
  });

});
