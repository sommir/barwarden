import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { describe, expect, it, vi } from "vitest";

import { AuthFacade } from "../auth/auth.facade";
import { PopupStateStore } from "../popup-state";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { officialCurrentAccountTestProviders } from "../official-ui/official-current-account.test-support";
import type { LaunchAtLoginHost } from "../../host/launch-at-login";
import { LAUNCH_AT_LOGIN_HOST } from "./launch-at-login.port";
import { SettingsPageComponent } from "./settings-page.component";
import { SettingsService } from "./settings.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("SettingsPageComponent", () => {
  it("renders the approved four continuous Settings groups without changing navigation", async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        provideRouter([]), OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(), PopupStateStore, SettingsService,
        { provide: LAUNCH_AT_LOGIN_HOST, useValue: {
          getLaunchAtLogin: async () => false,
          setLaunchAtLogin: async (enabled: boolean) => enabled,
        } satisfies LaunchAtLoginHost },
        { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsPageComponent);
    const navigateByUrl = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const groups = Array.from(fixture.nativeElement.querySelectorAll<HTMLElement>("[data-settings-group]"));
    expect(groups.map((group) => group.dataset["settingsGroup"]))
      .toEqual(["general", "security", "application", "information"]);
    expect(groups.map((group) => group.querySelectorAll("bit-item").length)).toEqual([2, 1, 3, 1]);
    for (const group of groups) {
      const continuousGroup = group.querySelector<HTMLElement>(
        ":scope > .macos-continuous-group",
      );
      const itemHosts = Array.from(
        continuousGroup?.querySelectorAll<HTMLElement>(":scope > bit-item") ?? [],
      );
      expect(continuousGroup).not.toBeNull();
      expect(itemHosts).not.toHaveLength(0);
      for (const itemHost of itemHosts) {
        expect(
          itemHost.querySelector(":scope > bit-item-action > .macos-continuous-row"),
        ).not.toBeNull();
      }
    }
    expect(fixture.nativeElement.querySelectorAll("bit-card")).toHaveLength(0);
    Array.from(fixture.nativeElement.querySelectorAll<HTMLButtonElement>("button.settings-row"))
      .forEach((row) => row.click());
    expect(navigateByUrl.mock.calls.map(([route]) => route)).toEqual([
      "/appearance", "/account-security", "/autofill",
      "/keyboard-shortcut", "/vault-settings", "/about",
    ]);
  });

  it("loads the confirmed login-item state and keeps it stable while a change is pending", async () => {
    let resolveMutation!: (enabled: boolean) => void;
    const host: LaunchAtLoginHost = {
      getLaunchAtLogin: vi.fn(async () => true),
      setLaunchAtLogin: vi.fn(
        async () => await new Promise<boolean>((resolve) => {
          resolveMutation = resolve;
        }),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
        PopupStateStore,
        SettingsService,
        { provide: LAUNCH_AT_LOGIN_HOST, useValue: host },
        { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector<HTMLInputElement>("#launch-at-login");
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(false);
    const launchAtLoginRow = fixture.nativeElement.querySelector<HTMLElement>(
      '[data-testid="launch-at-login-row"]',
    );
    expect(launchAtLoginRow?.tagName).toBe("LABEL");
    expect(launchAtLoginRow?.closest("bit-item")).not.toBeNull();
    expect(launchAtLoginRow?.querySelector(".launch-at-login-row__title")?.textContent).toContain(
      "登录时启动",
    );
    expect(launchAtLoginRow?.querySelector(".launch-at-login-row__hint")?.textContent).toContain(
      "在菜单栏中保持可用",
    );
    expect(
      launchAtLoginRow?.querySelector(".launch-at-login-row__copy")?.classList,
    ).toContain("tw-whitespace-nowrap");
    expect(fixture.nativeElement.querySelector("bit-card")).toBeNull();

    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event("change"));
    fixture.detectChanges();

    expect(host.setLaunchAtLogin).toHaveBeenCalledWith(false);
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(true);

    resolveMutation(false);
    await vi.waitFor(() => {
      expect(fixture.componentInstance.launchAtLoginBusy).toBe(false);
    });
    fixture.detectChanges();

    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.disabled).toBe(false);
  });

  it("preserves the confirmed state and shows a dismissible localized error on failure", async () => {
    const host: LaunchAtLoginHost = {
      getLaunchAtLogin: vi.fn(async () => false),
      setLaunchAtLogin: vi.fn(async () => {
        throw new Error("private native failure");
      }),
    };
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
        PopupStateStore,
        SettingsService,
        { provide: LAUNCH_AT_LOGIN_HOST, useValue: host },
        { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector<HTMLInputElement>("#launch-at-login");
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change"));
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector<HTMLElement>(
      '[data-testid="launch-at-login-error"]',
    );
    expect(checkbox?.checked).toBe(false);
    expect(alert?.textContent).toContain("无法更新开机启动设置");
    expect(alert?.textContent).toContain("无法更改登录项，请稍后重试。");
    expect(alert?.textContent).not.toContain("private native failure");

    alert?.querySelector<HTMLButtonElement>(".macos-alert-strip__dismiss")?.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="launch-at-login-error"]'),
    ).toBeNull();
  });

  it("marks Settings rows as 52px semantic navigation rows", async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
        PopupStateStore,
        SettingsService,
        { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList).toContain("macos-page--settings");
    expect(host.querySelectorAll("button.settings-row")).not.toHaveLength(0);
    const css = readFileSync(resolve(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");
    expect(css).toMatch(/\.macos-page--settings\s+\.settings-row\s*{[^}]*min-height:\s*var\(--mac-row-height\)/s);
  });

  it("renders official-style settings rows", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
        { provide: PopupStateStore, useValue: store },
        SettingsService,
        { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll(":scope > bw-official-settings")).toHaveLength(1);
    expect(host.textContent).toContain("账户安全");
    expect(host.textContent).toContain("填充");
    expect(host.textContent).not.toContain("单字段填充");
    expect(host.textContent).toContain("快捷键");
    expect(host.textContent).not.toContain("通知");
    expect(host.textContent).toContain("密码库选项");
    expect(host.textContent).toContain("外观");
    expect(host.textContent).toContain("关于");
    expect(host.textContent).not.toContain("下载 Bitwarden");
    expect(host.textContent).not.toContain("更多 Bitwarden 产品");
    expect(host.querySelector("app-current-account button")?.textContent).toContain("user@example.com");
    expect(host.querySelector("app-current-account button svg text")?.textContent?.trim()).toBe("US");
    expect(
      host.querySelector(
        "popup-header > header .macos-page-heading__actions bw-popup-header-actions",
      ),
    ).not.toBeNull();
    expect(host.querySelector('a.primary-action[href="/new-item"]')).toBeNull();
    expect(host.textContent).not.toContain("新增");
    expect(host.textContent).not.toContain("Sync now");
    expect(host.textContent).not.toContain("Logout");
    expect(host.textContent).not.toContain("账户操作");
    expect(host.textContent).not.toContain("浏览器专属能力");
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>("button.settings-row"));
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      row.click();
    }
    expect(navigateByUrl.mock.calls.map(([route]) => route)).toEqual([
      "/appearance",
      "/account-security",
      "/autofill",
      "/keyboard-shortcut",
      "/vault-settings",
      "/about",
    ]);
  });

  it("renders settings through official bit item groups", async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
        PopupStateStore,
        SettingsService,
        { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsPageComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll(":scope > bw-official-settings")).toHaveLength(1);
    expect(host.querySelector("popup-page > main")).not.toBeNull();
    expect(host.querySelector("bit-item-group")).not.toBeNull();
    expect(host.querySelectorAll("bit-item").length).toBeGreaterThan(0);
    expect(host.textContent).toContain("账户安全");
  });
});
