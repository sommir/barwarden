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
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    document.head.querySelectorAll('style[data-test-owner="settings-preference-css"]')
      .forEach((node) => node.remove());
  });

  it("renders the approved preference groups with 44px rows and hit owners", async () => {
    installSettingsPreferenceCss();
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
    const host = fixture.nativeElement as HTMLElement;
    const groups = Array.from(host.querySelectorAll<HTMLElement>(".macos-preference-group"));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map((group) => group.dataset["settingsGroup"]))
      .toEqual(["general", "security", "application", "information"]);
    expect(Array.from(
      host.querySelectorAll<HTMLElement>(".settings-group__title"),
      (title) => title.dataset["settingsGroupTitle"],
    )).toEqual(["general", "security", "application", "information"]);
    expect(groups.map((group) => group.querySelectorAll("bit-item").length)).toEqual([2, 1, 3, 1]);
    const routeRows = Array.from(host.querySelectorAll<HTMLButtonElement>(
      "button.macos-preference-row",
    ));
    expect(routeRows.map((button) => button.dataset["settingsRoute"])).toEqual([
      "/appearance", "/account-security", "/autofill",
      "/keyboard-shortcut", "/vault-settings", "/about",
    ]);
    const row = groups[0]!.querySelector<HTMLElement>(".macos-preference-row")!;
    const style = getComputedStyle(row);
    expect(style.minHeight).toBe("44px");
    expect(style.borderRadius).toBe("0px");
    expect(style.boxShadow).toBe("none");
    const switchOwner = row.querySelector<HTMLButtonElement>(".macos-hit-target")!;
    expect(getComputedStyle(switchOwner).minWidth).toBe("44px");
    switchOwner.focus();
    expect(document.activeElement).toBe(switchOwner);
    expect(host.querySelectorAll("bit-card")).toHaveLength(0);
    routeRows.forEach((routeRow) => routeRow.click());
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

    const launchAtLoginSwitch = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-labelledby="launch-at-login-label"]',
    );
    expect(launchAtLoginSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(launchAtLoginSwitch?.disabled).toBe(false);
    const launchAtLoginRow = fixture.nativeElement.querySelector<HTMLElement>(
      '[data-testid="launch-at-login-row"]',
    );
    expect(launchAtLoginRow?.tagName).toBe("DIV");
    expect(launchAtLoginRow?.closest("bit-item")).not.toBeNull();
    expect(launchAtLoginRow?.querySelector(".macos-preference-row__copy")?.textContent)
      .toContain("登录时启动");
    expect(launchAtLoginRow?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(fixture.nativeElement.querySelector("bit-card")).toBeNull();

    launchAtLoginSwitch!.click();
    fixture.detectChanges();

    expect(host.setLaunchAtLogin).toHaveBeenCalledWith(false);
    expect(launchAtLoginSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(launchAtLoginSwitch?.disabled).toBe(true);

    resolveMutation(false);
    await vi.waitFor(() => {
      expect(fixture.componentInstance.launchAtLoginBusy).toBe(false);
    });
    fixture.detectChanges();

    expect(launchAtLoginSwitch?.getAttribute("aria-checked")).toBe("false");
    expect(launchAtLoginSwitch?.disabled).toBe(false);
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

    const launchAtLoginSwitch = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-labelledby="launch-at-login-label"]',
    );
    launchAtLoginSwitch!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector<HTMLElement>(
      '[data-testid="launch-at-login-error"]',
    );
    expect(launchAtLoginSwitch?.getAttribute("aria-checked")).toBe("false");
    expect(alert?.textContent).toContain("无法更新开机启动设置");
    expect(alert?.textContent).toContain("无法更改登录项，请稍后重试。");
    expect(alert?.textContent).not.toContain("private native failure");

    alert?.querySelector<HTMLButtonElement>(".macos-alert-strip__dismiss")?.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="launch-at-login-error"]'),
    ).toBeNull();
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
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>("button.macos-preference-row"));
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

function installSettingsPreferenceCss(): void {
  const source = [
    "apps/menubar-tauri/src/styles/macos-tokens.css",
    "apps/menubar-tauri/src/styles/global.css",
  ]
    .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const tokens = new Map(
    [...rootDeclarations.matchAll(/(--(?:mac|bw)-[\w-]+):\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]),
  );
  const style = document.createElement("style");
  style.dataset["testOwner"] = "settings-preference-css";
  style.textContent = source
    .replace(/var\((--(?:mac|bw)-[\w-]+)\)/g, (value, name) => tokens.get(name) ?? value)
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
  document.head.append(style);
}
