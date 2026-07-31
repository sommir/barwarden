import { CUSTOM_ELEMENTS_SCHEMA, Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PopupHeaderComponent } from "../../layout/popup-header.component";
import { PopupPageComponent } from "../../layout/popup-page.component";
import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { officialSourceMappings } from "../../upstream-source-map";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent, PopupPageComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <popup-page>
      <popup-header
        slot="header"
        pageTitle="Official title"
        [showBackButton]="true"
        [backAction]="backAction"
        background="alt"
      >
        <button slot="start" class="start-action" type="button">Create</button>
        <span class="title-adjacent">Archived</span>
        <button slot="end" class="end-action" type="button">More</button>
      </popup-header>
      <p>Body</p>
    </popup-page>
  `,
})
class PopupHeaderHostComponent {
  backAction = vi.fn(async () => undefined);
}

describe("official popup header overlay", () => {
  it("records the guarded overlay as an approved adapter rather than direct runtime", () => {
    expect(officialSourceMappings).toContainEqual({
      localModule:
        "apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-header.component.ts",
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-header.component.html",
        "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-header.component.ts",
      ],
      mode: "adapter",
      excludedDependencies: [
        "browser PopupRouterCacheService replaced by popup-router-cache.adapter.ts",
        "deprecated full JslibModule replaced by an I18nPipe and retained OfficialI18nService adapter",
      ],
    });

    expect(readFileSync(resolve(process.cwd(), "apps/menubar-tauri/src/app/layout/popup-header.component.ts"), "utf8")).toBe(
      'export { PopupHeaderComponent } from "@bitwarden/browser-popup/layout/popup-header.component";\n',
    );
  });

  it("renders an in-flow heading with independent trailing actions and compatible inputs", async () => {
    await TestBed.configureTestingModule({
      imports: [PopupHeaderHostComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PopupHeaderHostComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const header = host.querySelector("popup-header > header");
    expect(header?.classList).toContain("macos-page-heading");
    expect(header?.querySelector("h1")?.textContent).toContain("Official title");
    expect(header?.querySelector(".macos-page-heading__leading button")).not.toBeNull();
    expect(header?.querySelector(".macos-page-heading__leading .start-action")).not.toBeNull();
    expect(header?.querySelector(".macos-page-heading__titles .title-adjacent")).not.toBeNull();
    expect(header?.querySelector(".macos-page-heading__actions .end-action")).not.toBeNull();
    expect(header?.querySelector(".end-action")?.getAttribute("slot")).toBe("end");
    expect(header?.className).not.toContain("tw-bg-");
    expect(header?.className).not.toContain("tw-border-");

    const classesBeforeScroll = header?.className;
    (host.querySelector('[data-testid="popup-layout-scroll-region"]') as HTMLElement).scrollTop = 1;
    host.querySelector('[data-testid="popup-layout-scroll-region"]')?.dispatchEvent(new Event("scroll"));
    fixture.detectChanges();
    expect(header?.className).toBe(classesBeforeScroll);

    (header?.querySelector("button[biticonbutton]") as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.backAction).toHaveBeenCalledOnce();
  });
});
