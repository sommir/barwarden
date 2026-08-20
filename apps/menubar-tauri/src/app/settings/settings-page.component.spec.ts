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
    delete document.documentElement.dataset["bwCompactMode"];
    delete document.documentElement.dataset["testHiDpi"];
    delete document.documentElement.dataset["testReducedMotion"];
    document.documentElement.style.removeProperty("font-size");
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
    const itemGroup = groups[0]!.querySelector<HTMLElement>("bit-item-group")!;
    const items = Array.from(itemGroup.querySelectorAll<HTMLElement>(":scope > bit-item"));
    const itemAction = items[0]!.querySelector<HTMLElement>(":scope > bit-item-action")!;
    for (const wrapper of [itemGroup, items[0]!, itemAction]) {
      const wrapperStyle = getComputedStyle(wrapper);
      expect(wrapperStyle.margin).toBe("0px");
      expect(wrapperStyle.borderRadius).toBe("0px");
      expect(wrapperStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(wrapperStyle.boxShadow).toBe("none");
      expect(wrapperStyle.overflow).toBe("visible");
    }
    expect(getComputedStyle(items[0]!).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(items.at(-1)!).borderBottomWidth).toBe("0px");
    expect(getComputedStyle(row).borderBottomWidth).toBe("0px");

    document.documentElement.dataset["testHiDpi"] = "true";
    installSettingsPreferenceCss({ hiDpi: true });
    expect(getComputedStyle(items[0]!).borderBottomWidth).toBe("0.5px");
    expect(getComputedStyle(items.at(-1)!).borderBottomWidth).toBe("0px");

    const switchOwner = row.querySelector<HTMLButtonElement>(".macos-hit-target")!;
    expect(getComputedStyle(switchOwner).minWidth).toBe("44px");
    expect(getComputedStyle(switchOwner).minHeight).toBe("44px");
    document.documentElement.dataset["bwCompactMode"] = "true";
    expect(getComputedStyle(switchOwner).minWidth).toBe("44px");
    expect(getComputedStyle(switchOwner).minHeight).toBe("44px");
    expect(getComputedStyle(switchOwner.firstElementChild!).width).toBe("34px");
    expect(getComputedStyle(switchOwner.firstElementChild!).height).toBe("20px");

    switchOwner.dataset["testFocusVisible"] = "true";
    const switchOwnerStyle = getComputedStyle(switchOwner);
    const switchTrackStyle = getComputedStyle(switchOwner.firstElementChild!);
    expect(switchOwnerStyle.outlineWidth).toBe("0px");
    expect(switchOwnerStyle.outlineStyle).toBe("none");
    expect(resolvedMatchedProperty(switchOwner, "outline-width")).toBe("0px");
    expect(switchTrackStyle.outlineWidth).toBe("2px");
    expect(switchTrackStyle.outlineStyle).toBe("solid");
    expect(switchTrackStyle.outlineColor).not.toBe("transparent");
    expect(resolvedMatchedProperty(switchOwner.firstElementChild as HTMLElement, "outline-width"))
      .toBe("2px");

    const scrollRegion = host.querySelector<HTMLElement>(
      '[data-testid="popup-layout-scroll-region"]',
    );
    expect(scrollRegion).not.toBeNull();
    expect(getComputedStyle(scrollRegion!).paddingInline).toBe("16px");
    const contentWrapper = scrollRegion!.firstElementChild as HTMLElement | null;
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper!.classList).not.toContain("tw-px-4");
    expect(Number.parseFloat(getComputedStyle(contentWrapper!).paddingLeft) || 0).toBe(0);
    expect(Number.parseFloat(getComputedStyle(contentWrapper!).paddingRight) || 0).toBe(0);

    const values = host.querySelectorAll<HTMLElement>(".macos-preference-row__value");
    expect(values).toHaveLength(6);
    expect(getComputedStyle(values[0]!).justifySelf).toBe("end");
    expect(host.querySelectorAll("bit-card")).toHaveLength(0);

    activateNativeButton(routeRows[0]!, "Enter");
    activateNativeButton(routeRows[1]!, " ");
    routeRows.slice(2).forEach((routeRow) => routeRow.click());
    expect(navigateByUrl.mock.calls.map(([route]) => route)).toEqual([
      "/appearance", "/account-security", "/autofill",
      "/keyboard-shortcut", "/vault-settings", "/about",
    ]);

    document.documentElement.style.fontSize = "200%";
    const launchContent = host.querySelector<HTMLElement>('[data-testid="launch-at-login-row"]')!;
    for (const content of [launchContent, routeRows[0]!]) {
      expect(content.querySelector(".tw-text-wrap.tw-break-words")).not.toBeNull();
      const copy = content.querySelector<HTMLElement>(".macos-preference-row__copy")!;
      expect(getComputedStyle(copy).whiteSpace).toBe("normal");
      expect(getComputedStyle(copy).overflowWrap).toBe("anywhere");
    }

    document.documentElement.dataset["testReducedMotion"] = "true";
    const reducedMotionStyle = installSettingsPreferenceCss({ reducedMotion: true });
    expect(getComputedStyle(switchOwner.firstElementChild!).transitionDuration).toBe("0s");
    expect(lastStyleRule(
      reducedMotionStyle,
      ".macos-switch-owner > span, .macos-switch-owner > span::after",
    )
      ?.style.transitionDuration).toBe("0s");
    expect(lastStyleRule(
      reducedMotionStyle,
      '.macos-switch-owner[aria-checked="true"] > span::after',
    )?.style.transform).toBe("translateX(14px)");
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

function installSettingsPreferenceCss(
  media: { hiDpi?: boolean; reducedMotion?: boolean } = {},
): HTMLStyleElement {
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
  style.textContent = effectiveSettingsCss(source, media)
    .replace(/var\((--(?:mac|bw)-[\w-]+)\)/g, (value, name) => tokens.get(name) ?? value)
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
  document.head.append(style);
  const retainedVendorBaseline = document.createElement("style");
  retainedVendorBaseline.dataset["testOwner"] = "settings-preference-css";
  retainedVendorBaseline.textContent = `
    bit-item-group.settings-group__items { margin: 6px; overflow: hidden; border-radius: 8px; background: rgb(255, 255, 255); box-shadow: 0 1px 2px rgb(0 0 0 / 18%); }
    bit-item.tw-overflow-hidden { margin: 0 0 6px; overflow: hidden; border-radius: 8px; background: rgb(255, 255, 255); box-shadow: 0 1px 2px rgb(0 0 0 / 18%); }
    bit-item-action.tw-overflow-hidden { margin: 4px; overflow: hidden; border-radius: 6px; background: rgb(255, 255, 255); box-shadow: 0 1px 2px rgb(0 0 0 / 18%); }
  `;
  style.before(retainedVendorBaseline);
  return style;
}

function effectiveSettingsCss(
  source: string,
  media: { hiDpi?: boolean; reducedMotion?: boolean },
): string {
  return source.replace(/@media\s*\((min-resolution:2dppx|prefers-reduced-motion:\s*reduce)\)\s*\{\s*([^{}]+\{[^{}]*\})\s*\}/g,
    (_match, condition: string, rule: string) => {
      if (condition.startsWith("min-resolution")) {
        return media.hiDpi ? rule.replace(/^\s*/, ':root[data-test-hi-dpi="true"] ') : "";
      }
      return media.reducedMotion
        ? rule.replace(/^\s*/, ':root[data-test-reduced-motion="true"] ')
        : "";
    });
}

function activateNativeButton(button: HTMLButtonElement, key: "Enter" | " "): void {
  expect(button.tagName).toBe("BUTTON");
  expect(button.type).toBe("button");
  button.focus();
  const event = new KeyboardEvent(key === "Enter" ? "keydown" : "keyup", {
    bubbles: true,
    cancelable: true,
    key,
  });
  expect(button.dispatchEvent(event)).toBe(true);
  button.click();
}

function lastStyleRule(style: HTMLStyleElement, selector: string): CSSStyleRule | undefined {
  return Array.from(style.sheet?.cssRules ?? [])
    .filter((rule): rule is CSSStyleRule =>
      "selectorText" in rule &&
      (rule.selectorText === selector || rule.selectorText.endsWith(` ${selector}`)),
    )
    .at(-1);
}

function resolvedMatchedProperty(element: Element, property: string): string {
  let resolved = "";
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const value = resolvedRuleProperty(rule.style, property);
      if (!value) continue;
      const matches = splitSelectorList(rule.selectorText).some((selector) => {
        try {
          return element.matches(selector.trim());
        } catch {
          return false;
        }
      });
      if (matches) resolved = value;
    }
  }
  return resolved;
}

function resolvedRuleProperty(style: CSSStyleDeclaration, property: string): string {
  const direct = style.getPropertyValue(property).trim();
  if (direct) return direct;
  if (property === "outline-width") {
    return style.outline.match(/(?:^|\s)(\d+(?:\.\d+)?px)(?:\s|$)/)?.[1] ?? "";
  }
  return "";
}

function splitSelectorList(selectorList: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors;
}
