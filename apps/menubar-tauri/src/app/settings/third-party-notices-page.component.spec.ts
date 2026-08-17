import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { afterEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { ThirdPartyNoticesPageComponent } from "./third-party-notices-page.component";

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

describe("ThirdPartyNoticesPageComponent", () => {
  afterEach(async () => {
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it("renders a runtime license summary and navigates to complete legal text", async () => {
    await TestBed.configureTestingModule({
      imports: [ThirdPartyNoticesPageComponent],
      providers: [
        provideRouter([
          {
            path: "third-party-licenses",
            component: ThirdPartyNoticesPageComponent,
          },
        ]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ThirdPartyNoticesPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("第三方开源许可");
    expect(host.textContent).toContain("npm");
    expect(host.textContent).toContain("27");
    expect(host.textContent).toContain("Cargo");
    expect(host.textContent).toContain("218");
    expect(host.textContent).toContain("许可证类别");
    expect(host.textContent).toContain("查看完整许可文本");
    expect(host.querySelector("pre")).toBeNull();
    expect(host.textContent).not.toContain("| Ecosystem |");

    const counts = host.querySelector<HTMLElement>(".third-party-notices-counts")!;
    const groups = host.querySelector<HTMLElement>(".third-party-license-groups")!;
    const list = groups.querySelector<HTMLElement>("ul")!;
    expect(getComputedStyle(counts).boxShadow).toBe("none");
    expect(getComputedStyle(groups).borderRadius).toBe("0px");
    expect(getComputedStyle(groups).boxShadow).toBe("none");
    expect(getComputedStyle(list).overflowY).not.toBe("auto");
    expect(getComputedStyle(list).maxHeight).toBe("none");

    host
      .querySelector<HTMLButtonElement>("[data-testid='view-complete-third-party-licenses']")!
      .click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe("/third-party-licenses");
  });
});
