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
  });
});
