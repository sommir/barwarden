import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoItemsComponent } from "./no-items.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { BitIconButtonComponent } from "../official-ui/official-components";
import { PopupFooterComponent } from "./popup-footer.component";
import { PopupHeaderComponent } from "./popup-header.component";
import { PopupPageComponent } from "./popup-page.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  standalone: true,
  imports: [PopupPageComponent, PopupHeaderComponent, PopupFooterComponent, NoItemsComponent],
  host: { class: "popup-shell" },
  template: `
    <popup-page>
      <popup-header slot="header" pageTitle="密码库" showBackButton [backAction]="backAction" />
      <div slot="above-scroll-area" class="test-above">Search</div>
      <bw-no-items icon="bwi-vault" title="没有项目" description="添加一个登录项目" />
      <popup-footer slot="footer">
        <button type="button">保存</button>
        <span slot="end">结束操作</span>
      </popup-footer>
    </popup-page>
  `,
})
class HostComponent {
  backAction = () => this.onBack();
  onBack = vi.fn();
}

describe("official popup layout primitives", () => {
  afterEach(() => {
    document.head.querySelectorAll("style[data-ios27-accessibility]").forEach((node) => node.remove());
  });

  it("renders the official header with one page scroll owner", async () => {
    installAccessibilityCss();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bit-header")).toBeNull();
    expect(host.querySelector("popup-header > header")).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="popup-layout-scroll-region"]')).toHaveLength(1);

    const heading = host.querySelector("popup-header > header.macos-page-heading");
    expect(heading?.querySelector(".macos-page-heading__main > h1")).toBeNull();
    expect(heading?.querySelector(".macos-page-heading__titles > h1")?.textContent).toContain(
      "密码库",
    );

    const backDebug = fixture.debugElement.query(By.directive(BitIconButtonComponent));
    expect(backDebug).not.toBeNull();
    const back = backDebug.nativeElement as HTMLButtonElement;
    expect(back.getAttribute("biticonbutton")).toBe("bwi-angle-left");
    expect(back.getAttribute("aria-label")).toBe("返回");
    expect(back.tabIndex).toBe(0);
    back.focus();
    back.dataset["testFocusVisible"] = "true";
    expect(document.activeElement).toBe(back);
    expect(getComputedStyle(back).outlineWidth).toBe("2px");
    expect(getComputedStyle(back).outlineOffset).toBe("2px");
    back.click();
    expect(fixture.componentInstance.onBack).toHaveBeenCalledOnce();
    expect(host.querySelector("button.popup-back-button")).toBeNull();
  });

  it("renders the pinned popup page scroll host, loading icon, and projected slots", async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const page = host.querySelector("popup-page");
    const main = page?.querySelector("main");
    const scrollRegion = page?.querySelector<HTMLElement>(
      '[data-testid="popup-layout-scroll-region"]',
    );

    expect(page).not.toBeNull();
    expect(main).not.toBeNull();
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.hasAttribute("bitScrollLayoutHost")).toBe(true);
    expect(scrollRegion?.tabIndex).toBe(0);
    expect(main?.querySelector("bit-icon.bwi-lg.bwi-spin")).not.toBeNull();
    expect(page?.querySelector("popup-header > header")?.textContent).toContain("密码库");
    expect(page?.querySelector(".test-above")?.textContent).toContain("Search");
    expect(scrollRegion?.querySelector("bw-no-items")).not.toBeNull();
    expect(page?.querySelector("popup-footer")?.textContent).toContain("保存");
    expect(page?.querySelector(".popup-page-frame")).toBeNull();
    expect(page?.querySelector(".popup-page-scroll")).toBeNull();
    expect(host.querySelector(".bit-no-items .bwi-vault")).not.toBeNull();

    const officialFooter = host.querySelector("popup-footer > footer");
    const defaultContent = officialFooter?.querySelector("button");
    const endContent = officialFooter?.querySelector('[slot="end"]');
    expect(officialFooter).not.toBeNull();
    expect(defaultContent?.textContent).toContain("保存");
    expect(endContent?.textContent).toContain("结束操作");
    expect(defaultContent?.parentElement).not.toBe(endContent?.parentElement);
  });

  it("gives header one 52px slot and keeps the scroll owner above navigation", async () => {
    installAccessibilityCss();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const header = getComputedStyle(host.querySelector<HTMLElement>("popup-header > header")!);
    const scroller = getComputedStyle(
      host.querySelector<HTMLElement>('[data-testid="popup-layout-scroll-region"]')!,
    );
    expect(header.height).toBe("52px");
    expect(scroller.paddingInlineStart).toBe("16px");
    expect(scroller.paddingInlineEnd).toBe("16px");
    expect(scroller.paddingBottom).toBe("64px");
  });

  it("sizes route pages from the shell instead of creating another 600px owner", () => {
    const css = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");

    expect(css).toMatch(/popup-page\s*{[^}]*height:\s*100%;/s);
    expect(css).toMatch(/\.popup-window-size-source\s*{[^}]*height:\s*max\(var\(--bw-popup-height\),\s*100vh\);/s);
    expect(css).toMatch(/\.popup-window-size-source\s*>\s*bw-popup-shell\s*{[^}]*height:\s*100%;/s);
    expect(css).toMatch(/\.popup-window-size-source\s*>\s*bw-popup-shell\s*>\s*\.popup-shell\s*{[^}]*height:\s*100%;/s);
    expect(css).not.toContain(".popup-page-frame");
    expect(css).not.toContain(".popup-page-scroll");
  });

  it("gives every routed page one resilient native-style scroll owner", () => {
    const css = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");

    // PopupPage ships as a flex column.  The route-level macOS class must not
    // flatten that contract to block layout, otherwise a tall hierarchy grows
    // behind the floating navigation instead of scrolling in this region.
    expect(css).toMatch(/popup-page\.macos-page\s*{[^}]*display:\s*flex;/s);
    expect(css).toMatch(/popup-page\.macos-page\s*{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
    expect(css).toMatch(/popup-page\.macos-page\s*{[^}]*flex-direction:\s*column;/s);
    expect(css).toMatch(
      /popup-page,\s*popup-page\s*>\s*main,\s*popup-page\s*\[data-testid="popup-layout-scroll-region"\]\s*{[^}]*min-height:\s*0;/s,
    );
    expect(css).toMatch(
      /popup-page\s*\[data-testid="popup-layout-scroll-region"\]\s*{[^}]*flex:\s*1 1 auto;[^}]*overflow-x:\s*hidden;[^}]*overscroll-behavior:\s*contain;/s,
    );
    expect(css).toMatch(/popup-page\s*{[^}]*--mac-page-bottom-safe:\s*16px;/s);
    expect(css).toMatch(
      /\.popup-shell\s+popup-page\s*{[^}]*--mac-page-bottom-safe:\s*calc\(var\(--mac-tabbar-height\)\s*\+\s*12px\);/s,
    );
    expect(css).toMatch(
      /popup-page\s+\[data-testid="popup-layout-scroll-region"\]\s*{[^}]*padding-inline:\s*var\(--mac-page-inset\);[^}]*padding-bottom:\s*var\(--mac-page-bottom-safe\);/s,
    );
    expect(css).toMatch(
      /\[data-testid="popup-layout-scroll-region"\][\s\S]*?::-webkit-scrollbar\s*{[^}]*width:\s*2px;[^}]*height:\s*2px;/s,
    );
    expect(css).toMatch(
      /::-webkit-scrollbar-thumb\s*{[^}]*border-radius:\s*999px;[^}]*background:\s*linear-gradient\(/s,
    );
  });
});

function installAccessibilityCss(): HTMLStyleElement {
  const source = ["macos-tokens.css", "macos-motion.css", "global.css"]
    .map((file) => readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles", file), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const tokens = new Map(
    [...rootDeclarations.matchAll(/(--(?:mac|bw)-[\w-]+):\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]),
  );
  const style = document.createElement("style");
  style.dataset["ios27Accessibility"] = "true";
  style.textContent = source
    .replace(/var\((--(?:mac|bw)-[\w-]+)\)/g, (value, name) => tokens.get(name) ?? value)
    // JSDOM does not resolve logical padding shorthands or inherited custom
    // properties in computed styles. Keep the mounted shell assertion tied to
    // the production values while normalizing those two engine gaps.
    .replace(
      "padding-inline: 16px;",
      "padding-inline-start: 16px; padding-inline-end: 16px;",
    )
    .replace("padding-bottom: var(--mac-page-bottom-safe);", "padding-bottom: 64px;")
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
  document.head.append(style);
  return style;
}
