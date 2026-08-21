import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { ThirdPartyLicensesPageComponent } from "./third-party-licenses-page.component";

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

describe("ThirdPartyLicensesPageComponent", () => {
  afterEach(async () => {
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it("renders complete retained legal text as selectable wrapped content", async () => {
    await TestBed.configureTestingModule({
      imports: [ThirdPartyLicensesPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ThirdPartyLicensesPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const content = host.querySelector<HTMLElement>(
      "pre[data-testid='third-party-license-text']",
    );

    expect(host.textContent).toContain("完整许可文本");
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain("PACKAGE INDEX");
    expect(content?.textContent).toContain("LEGAL DOCUMENTS");
    expect(content?.textContent).toContain("Permission is hereby granted");
    expect(getComputedStyle(content!).whiteSpace).toBe("pre-wrap");
    expect(getComputedStyle(content!).userSelect).toBe("text");
    expect(getComputedStyle(content!).borderRadius).toBe("0px");
    expect(getComputedStyle(content!).boxShadow).toBe("none");
    expect(getComputedStyle(content!).overflowX).not.toBe("auto");
    expect(content!.scrollWidth - content!.clientWidth).toBe(0);
  });

  it("searches complete legal text with safe text segments and scalable 14px/20px reading typography", async () => {
    HTMLElement.prototype.scrollIntoView = () => undefined;
    await TestBed.configureTestingModule({
      imports: [ThirdPartyLicensesPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ThirdPartyLicensesPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const content = host.querySelector<HTMLElement>("[data-testid='third-party-license-text']")!;
    expect(getComputedStyle(content).fontSize).toBe("14px");
    expect(getComputedStyle(content).lineHeight).toBe("20px");

    const search = host.querySelector<HTMLInputElement>("[data-testid='document-search-input']")!;
    search.value = "Apache";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.matches.length).toBeGreaterThan(0);
    expect(host.querySelectorAll("mark[data-document-match]").length)
      .toBe(fixture.componentInstance.matches.length);
    expect(host.querySelector("[data-testid='third-party-license-text']")?.innerHTML)
      .not.toContain("<script");

    host.querySelector<HTMLButtonElement>("[data-testid='document-search-next']")!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.activeElement).toBe(host.querySelector('[data-document-match="1"]'));

    document.documentElement.style.fontSize = "200%";
    fixture.detectChanges();
    expect(getComputedStyle(content).whiteSpace).toBe("pre-wrap");
    expect(getComputedStyle(content).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(content).overflowX).not.toBe("auto");
    document.documentElement.style.removeProperty("font-size");
  });
});
