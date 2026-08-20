import "zone.js";
import "@angular/compiler";

import { LiveAnnouncer } from "@angular/cdk/a11y";
import { Component } from "@angular/core";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router, RouterOutlet } from "@angular/router";
import { describe, expect, it, vi } from "vitest";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupRouteAnnouncerService } from "./popup-route-announcer.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({ standalone: true, imports: [RouterOutlet], template: "<router-outlet />" })
class AnnouncerHostComponent {}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent],
  template: '<popup-header pageTitle="归档" />',
})
class ArchiveHeadingComponent {}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent],
  template: '<popup-header pageTitle="登录" />',
})
class LoginHeadingComponent {}

async function renderAnnouncer(live: Pick<LiveAnnouncer, "announce" | "clear">) {
  await TestBed.configureTestingModule({
    imports: [AnnouncerHostComponent],
    providers: [
      provideRouter([
        { path: "login", component: LoginHeadingComponent },
        { path: "archive", component: ArchiveHeadingComponent },
      ]),
      { provide: LiveAnnouncer, useValue: live },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AnnouncerHostComponent);
  const router = TestBed.inject(Router);
  const service = TestBed.inject(PopupRouteAnnouncerService);
  fixture.detectChanges();
  return { router, fixture, service };
}

async function settleNavigation(
  fixture: ReturnType<typeof TestBed.createComponent<AnnouncerHostComponent>>,
): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe("PopupRouteAnnouncerService", () => {
  it("announces the rendered heading without leaking URL data", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();

    await router.navigateByUrl("/login");
    await settleNavigation(fixture);
    expect(live.announce).not.toHaveBeenCalled();

    await router.navigateByUrl("/archive?cipherId=secret-server-id");
    await settleNavigation(fixture);
    expect(live.announce).toHaveBeenCalledWith("归档", "polite");
    expect(JSON.stringify(live.announce.mock.calls)).not.toContain("secret-server-id");
  });

  it("publishes only the latest rendered heading when navigations race", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);

    await router.navigateByUrl("/archive");
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);

    expect(live.announce.mock.calls).toEqual([["登录", "polite"]]);
  });

  it("clears and stops pending announcements when destroyed", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);

    await router.navigateByUrl("/archive");
    service.destroy();
    await settleNavigation(fixture);

    expect(live.clear).toHaveBeenCalledOnce();
    expect(live.announce).not.toHaveBeenCalled();
  });
});
