import "zone.js";
import "@angular/compiler";

import { Component } from "@angular/core";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { AppUpdateNoticeComponent } from "./app-update-notice.component";
import { AppUpdateService } from "./app-update.service";

@Component({ standalone: true, template: "" })
class EmptyRouteComponent {}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("AppUpdateNoticeComponent", () => {
  it("stays quiet until a background check discovers a release", async () => {
    const { fixture } = await render(new AppUpdateService({ check: vi.fn(async () => null) }));

    expect(fixture.nativeElement.querySelector(".app-update-notice")).toBeNull();
  });

  it("announces an available release and opens its About details", async () => {
    const update = {
      version: "0.2.0",
      notes: "Fixes",
      downloadAndInstall: vi.fn(async () => undefined),
    };
    const service = new AppUpdateService({ check: vi.fn(async () => update) });
    const { fixture, router } = await render(service);

    await service.checkInBackground();
    await fixture.whenStable();
    const notice = fixture.nativeElement.querySelector<HTMLElement>(
      ".app-update-notice .macos-alert-strip",
    )!;

    expect(notice).not.toBeNull();
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain("Version 0.2.0 is available");
    notice.querySelector<HTMLButtonElement>("[data-testid='view-update']")!.click();
    await fixture.whenStable();
    expect(router.url).toBe("/about");
  });

  it("dismisses the prompt without discarding the update candidate", async () => {
    const update = {
      version: "0.2.0",
      notes: null,
      downloadAndInstall: vi.fn(async () => undefined),
    };
    const service = new AppUpdateService({ check: vi.fn(async () => update) });
    const { fixture } = await render(service);
    await service.checkInBackground();
    await fixture.whenStable();

    fixture.nativeElement.querySelector<HTMLButtonElement>(
      ".app-update-notice .macos-alert-strip__dismiss",
    )!.click();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector(".app-update-notice")).toBeNull();
    expect(service.snapshot()).toMatchObject({
      status: "available",
      version: "0.2.0",
      notificationVisible: false,
    });
  });
});

async function render(service: AppUpdateService) {
  await TestBed.configureTestingModule({
    imports: [AppUpdateNoticeComponent],
    providers: [
      provideRouter([{ path: "about", component: EmptyRouteComponent }]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: AppUpdateService, useValue: service },
    ],
  }).compileComponents();
  await TestBed.inject(OfficialI18nService).setLocale("en-US");
  const fixture = TestBed.createComponent(AppUpdateNoticeComponent);
  fixture.detectChanges();
  return { fixture, router: TestBed.inject(Router) };
}
