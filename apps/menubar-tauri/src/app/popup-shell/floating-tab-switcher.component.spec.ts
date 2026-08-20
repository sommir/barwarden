import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { describe, expect, it, vi } from "vitest";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { FloatingTabSwitcherComponent, type FloatingTab } from "./floating-tab-switcher.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

const tabs: readonly FloatingTab[] = [
  { label: "密码库", path: "/tabs/vault", icon: "bwi-vault" },
  { label: "OTP", path: "/tabs/otp", icon: "bwi-clock" },
  { label: "生成器", path: "/tabs/generator", icon: "bwi-generate" },
  { label: "Send", path: "/tabs/send", icon: "bwi-send" },
  { label: "设置", path: "/tabs/settings", icon: "bwi-settings" },
];

@Component({ standalone: true, template: "" })
class TabRouteComponent {}

const routes = tabs.map((tab) => ({ path: tab.path.slice(1), component: TabRouteComponent }));
// The deterministic light fixture resolves macos-tokens.css --mac-selected to this color.
const lightSelectedTint = "rgba(10, 102, 255, 0.1)";

function installTabSwitcherVisualCss(): () => void {
  const style = document.createElement("style");
  const source = ["macos-tokens.css", "global.css"]
    .map((filename) =>
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/styles", filename),
        "utf8",
      ),
    )
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

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("FloatingTabSwitcherComponent", () => {
  it("paints a 52px tab bar with 44px segments and a quiet indicator", async () => {
    const cleanupCss = installTabSwitcherVisualCss();
    const root = document.documentElement;
    const originalCompactMode = root.dataset["bwCompactMode"];

    try {
      await TestBed.configureTestingModule({
        imports: [FloatingTabSwitcherComponent],
        providers: [
          provideRouter(routes),
          OfficialI18nService,
          { provide: I18nService, useExisting: OfficialI18nService },
        ],
      }).compileComponents();
      const router = TestBed.inject(Router);
      const fixture = TestBed.createComponent(FloatingTabSwitcherComponent);
      fixture.componentRef.setInput("tabs", tabs);
      await router.navigateByUrl("/tabs/vault");
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll(".floating-tab-switcher__indicator")).toHaveLength(1);

      for (const compactMode of [false, true]) {
        if (compactMode) {
          root.dataset["bwCompactMode"] = "true";
        } else {
          delete root.dataset["bwCompactMode"];
        }

        const nav = getComputedStyle(host.querySelector<HTMLElement>("nav")!);
        const segment = getComputedStyle(host.querySelector<HTMLButtonElement>("button")!);
        const icon = getComputedStyle(host.querySelector<HTMLElement>(".floating-tab-switcher__icon")!);
        const indicator = getComputedStyle(
          host.querySelector<HTMLElement>(".floating-tab-switcher__indicator")!,
        );

        expect(nav.height).toBe("52px");
        expect(segment.minWidth).toBe("44px");
        expect(segment.minHeight).toBe("44px");
        expect(icon.fontSize).toBe("18px");
        expect(indicator.getPropertyValue("inset-block")).toBe("4px");
        expect(indicator.borderRadius).toBe("9px");
        expect(indicator.boxShadow).toBe("none");
        expect(indicator.backgroundColor).toBe(lightSelectedTint);
      }
    } finally {
      if (originalCompactMode === undefined) {
        delete root.dataset["bwCompactMode"];
      } else {
        root.dataset["bwCompactMode"] = originalCompactMode;
      }
      cleanupCss();
    }
  });

  it("marks the actual OTP segment as the route focus trigger", async () => {
    await TestBed.configureTestingModule({
      imports: [FloatingTabSwitcherComponent],
      providers: [
        provideRouter(routes),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(FloatingTabSwitcherComponent);
    fixture.componentRef.setInput("tabs", tabs);
    fixture.detectChanges();
    const otp = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("OTP"));
    expect(otp?.dataset["popupFocusKey"]).toBe("tab:/tabs/otp");
  });

  it("renders one icon above one label per segment and exposes its selected grid state", async () => {
    await TestBed.configureTestingModule({
      imports: [FloatingTabSwitcherComponent],
      providers: [
        provideRouter(routes),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(FloatingTabSwitcherComponent);
    fixture.componentRef.setInput("tabs", tabs);
    await router.navigateByUrl("/tabs/send");
    fixture.detectChanges();

    const navigation = fixture.nativeElement.querySelector('nav[aria-label="主要导航"]') as HTMLElement;
    const buttons = [...navigation.querySelectorAll<HTMLButtonElement>("button")];

    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "密码库",
      "OTP",
      "生成器",
      "Send",
      "设置",
    ]);
    expect(buttons.map((button) => {
      const icon = button.querySelector<HTMLElement>(".floating-tab-switcher__icon");
      const label = button.querySelector<HTMLElement>(".floating-tab-switcher__label");
      return {
        icon: [...(icon?.classList ?? [])].find((className) => className.startsWith("bwi-")),
        label: label?.textContent?.trim(),
        iconPrecedesLabel: Boolean(
          icon && label && (icon.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING),
        ),
      };
    })).toEqual([
      { icon: "bwi-vault", label: "密码库", iconPrecedesLabel: true },
      { icon: "bwi-clock", label: "OTP", iconPrecedesLabel: true },
      { icon: "bwi-generate", label: "生成器", iconPrecedesLabel: true },
      { icon: "bwi-send", label: "Send", iconPrecedesLabel: true },
      { icon: "bwi-settings", label: "设置", iconPrecedesLabel: true },
    ]);
    expect(navigation.querySelectorAll("svg")).toHaveLength(0);
    expect(navigation.querySelectorAll(".floating-tab-switcher__indicator")).toHaveLength(1);
    expect(buttons.filter((button) => button.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(buttons[3]?.getAttribute("aria-current")).toBe("page");
    expect(navigation.style.getPropertyValue("--segment-count")).toBe("5");
    expect(navigation.style.getPropertyValue("--selected-index")).toBe("3");
    expect(buttons.map((button) => button.getAttribute("data-popup-focus-key")))
      .toEqual(tabs.map((tab) => `tab:${tab.path}`));
  });

  it("retains the current segment when navigation rejects", async () => {
    await TestBed.configureTestingModule({
      imports: [FloatingTabSwitcherComponent],
      providers: [
        provideRouter(routes),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(FloatingTabSwitcherComponent);
    fixture.componentRef.setInput("tabs", tabs);
    await router.navigateByUrl("/tabs/vault");
    fixture.detectChanges();
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockRejectedValue(new Error("blocked"));
    const generator = fixture.nativeElement.querySelectorAll<HTMLButtonElement>("button")[1]!;

    generator.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/otp");
    expect(fixture.nativeElement.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('button[aria-current="page"]')?.textContent?.trim()).toBe("密码库");
  });

  it("marks the requested segment immediately while navigation is still pending", async () => {
    await TestBed.configureTestingModule({
      imports: [FloatingTabSwitcherComponent],
      providers: [
        provideRouter(routes),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(FloatingTabSwitcherComponent);
    fixture.componentRef.setInput("tabs", tabs);
    await router.navigateByUrl("/tabs/otp");
    fixture.detectChanges();
    let finishNavigation!: (result: boolean) => void;
    vi.spyOn(router, "navigateByUrl").mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishNavigation = resolve;
      }),
    );
    const vault = fixture.nativeElement.querySelectorAll<HTMLButtonElement>("button")[0]!;

    vault.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button[aria-current="page"]')?.textContent?.trim())
      .toBe("密码库");

    finishNavigation(true);
    await fixture.whenStable();
  });
});
