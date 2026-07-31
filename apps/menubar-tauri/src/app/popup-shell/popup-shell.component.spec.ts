import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { BARWARDEN_BRAND } from "../brand";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { PopupShellComponent } from "./popup-shell.component";

@Component({ standalone: true, template: `<p>Route content</p>` })
class RouteContentComponent {}

const testRoutes = [
  { path: "tabs/vault", component: RouteContentComponent },
  { path: "tabs/otp", component: RouteContentComponent },
  { path: "tabs/generator", component: RouteContentComponent },
  { path: "tabs/send", component: RouteContentComponent },
  { path: "tabs/settings", component: RouteContentComponent },
];

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("PopupShellComponent", () => {
  afterEach(async () => {
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it("omits Send navigation when policy disables Send", async () => {
    const store = new PopupStateStore();
    store.setSendDisabled(true);

    await TestBed.configureTestingModule({
      imports: [PopupShellComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupShellComponent);
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll("nav button")].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual(["密码库", "OTP", "生成器", "设置"]);
  });

  it("renders the icon-label floating navigation landmark without official bottom navigation", async () => {
    await TestBed.configureTestingModule({
      imports: [PopupShellComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupShellComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const navigation = host.querySelector('nav[aria-label="主要导航"]');

    expect(navigation).not.toBeNull();
    expect([...navigation!.querySelectorAll("button")].map((button) => button.textContent?.trim())).toEqual([
      "密码库",
      "OTP",
      "生成器",
      "Send",
      "设置",
    ]);
    expect(navigation!.querySelectorAll("svg")).toHaveLength(0);
    expect(
      [...navigation!.querySelectorAll(".floating-tab-switcher__icon")].map((icon) =>
        [...icon.classList].find((className) => className.startsWith("bwi-")),
      ),
    ).toEqual(["bwi-vault", "bwi-clock", "bwi-generate", "bwi-send", "bwi-settings"]);
    expect(navigation!.querySelectorAll(".floating-tab-switcher__label")).toHaveLength(5);
    expect(navigation!.querySelectorAll(".floating-tab-switcher__indicator")).toHaveLength(1);
    expect(host.querySelector("bit-bottom-navigation")).toBeNull();
  });

  it("keeps shell navigation on the same official i18n provider as routed content", async () => {
    const officialI18n = new OfficialI18nService();
    await officialI18n.setLocale("zh-CN");

    await TestBed.configureTestingModule({
      imports: [PopupShellComponent],
      providers: [
        provideRouter([]),
        { provide: OfficialI18nService, useValue: officialI18n },
        { provide: I18nService, useValue: officialI18n },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupShellComponent);
    fixture.detectChanges();

    const navigation = fixture.nativeElement.querySelector("nav") as HTMLElement;
    expect(navigation.getAttribute("aria-label")).toBe("主要导航");
    expect([...navigation.querySelectorAll("button")].map((button) => button.textContent?.trim()))
      .toEqual(["密码库", "OTP", "生成器", "Send", "设置"]);
  });

  it("renders every navigation label from the active official locale", async () => {
    const officialI18n = new OfficialI18nService();
    await officialI18n.setLocale("zh-CN");

    await TestBed.configureTestingModule({
      imports: [PopupShellComponent],
      providers: [
        provideRouter([]),
        { provide: OfficialI18nService, useValue: officialI18n },
        { provide: I18nService, useValue: officialI18n },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupShellComponent);
    fixture.detectChanges();

    await officialI18n.setLocale("en-US");
    fixture.detectChanges();

    const navigation = fixture.nativeElement.querySelector("nav") as HTMLElement;
    expect(navigation.getAttribute("aria-label")).toBe("Primary navigation");
    expect([...navigation.querySelectorAll("button")].map((button) => button.textContent?.trim()))
      .toEqual(["Vault", "OTP", "Generator", "Send", "Settings"]);
  });

  it("keeps one routed scroll region on the continuous popup canvas", async () => {
    await TestBed.configureTestingModule({
      imports: [PopupShellComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupShellComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const shell = host.querySelector("section.popup-shell");
    const scrollHost = host.querySelector(
      '.popup-tab-scroll-host[data-testid="popup-shell-scroll-region"]',
    );
    const navigation = host.querySelector('nav[aria-label="主要导航"]');

    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("aria-label")).toBe("Barwarden");
    expect(fixture.componentInstance.productName).toBe(BARWARDEN_BRAND.productName);
    expect(shell?.classList.contains("popup-shell")).toBe(true);
    expect(shell?.classList.contains("popup-page")).toBe(false);
    expect(host.querySelector('[data-testid="popup-layout-scroll-region"]')).toBeNull();
    expect(scrollHost?.parentElement).toBe(shell);
    const switcherHost = navigation?.parentElement;
    expect(switcherHost?.parentElement).toBe(shell);
    expect(scrollHost?.nextElementSibling).toBe(switcherHost);
  });

  it("keeps overflow ownership in the routed popup page", () => {
    const css = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");

    expect(css).toMatch(/\.popup-shell\s*{[^}]*height:\s*var\(--bw-popup-height\);/s);
    expect(css).toMatch(/body\s*{[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.popup-tab-scroll-host\s*{[^}]*overflow-y:\s*hidden;/s);
    expect(css).toMatch(/popup-page\s*{[^}]*height:\s*100%;/s);
    expect(css).not.toContain(".popup-page-scroll");
  });

  it("routes click and keyboard tab activations with one current text segment and restored focus", async () => {
    await TestBed.configureTestingModule({
      imports: [PopupShellComponent],
      providers: [
        provideRouter(testRoutes),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(PopupShellComponent);
    await router.navigateByUrl("/tabs/vault");
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="主要导航"] button')];
    expect(buttons().filter((button) => button.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(buttons()[0]?.getAttribute("aria-current")).toBe("page");

    buttons()[1]!.focus();
    buttons()[1]!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(router.url).toBe("/tabs/otp");
    });
    expect(buttons().filter((button) => button.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(document.activeElement).toBe(buttons()[1]);

    buttons()[4]!.focus();
    expect(buttons()[4]?.getAttribute("role")).toBeNull();
    buttons()[4]!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(router.url).toBe("/tabs/settings");
    });
    expect(document.activeElement).toBe(buttons()[4]);
  });

  it("does not change current state or restore focus to a target whose navigation fails", async () => {
    await TestBed.configureTestingModule({
      imports: [PopupShellComponent],
      providers: [
        provideRouter(testRoutes),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(PopupShellComponent);
    await router.navigateByUrl("/tabs/vault");
    fixture.detectChanges();
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(false);

    const buttons = () =>
      [...fixture.nativeElement.querySelectorAll<HTMLButtonElement>('nav[aria-label="主要导航"] button')];
    const target = buttons()[1]!;
    target.focus();
    target.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenLastCalledWith("/tabs/otp");
    expect(buttons()[0]?.getAttribute("aria-current")).toBe("page");
    expect(buttons()[1]?.getAttribute("aria-current")).toBeNull();
    expect(document.activeElement).toBe(target);
  });
});
