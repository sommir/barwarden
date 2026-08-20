import "zone.js";
import "@angular/compiler";

import { LiveAnnouncer } from "@angular/cdk/a11y";
import { type AfterViewInit, Component, ElementRef } from "@angular/core";
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

@Component({
  standalone: true,
  imports: [PopupHeaderComponent, RouterOutlet],
  template: `
    <div data-testid="stale-route-host">
      <popup-header pageTitle="私密 secret-server-id" />
    </div>
    <router-outlet />
  `,
})
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

@Component({
  standalone: true,
  imports: [PopupHeaderComponent],
  styles: [
    ".route-display-none { display: none; }",
    ".route-visibility-hidden { visibility: hidden; }",
  ],
  template: `
    <div hidden><popup-header pageTitle="hidden attribute secret" /></div>
    <div aria-hidden="true"><popup-header pageTitle="aria hidden secret" /></div>
    <div inert><popup-header pageTitle="inert secret" /></div>
    <div class="route-display-none"><popup-header pageTitle="display secret" /></div>
    <div class="route-visibility-hidden"><popup-header pageTitle="visibility secret" /></div>
    <popup-header pageTitle="可见标题" />
  `,
})
class VisibilityHeadingComponent {}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent, RouterOutlet],
  template: `
    <popup-header pageTitle="父级归档" />
    <router-outlet />
  `,
})
class NestedArchiveComponent {}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent],
  template: '<popup-header pageTitle="嵌套详情" />',
})
class NestedDetailComponent {}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent],
  template: '<popup-header pageTitle="disconnected private heading" />',
})
class DisconnectingHeadingComponent implements AfterViewInit {
  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.host.nativeElement.remove();
  }
}

async function renderAnnouncer(live: Pick<LiveAnnouncer, "announce" | "clear">) {
  await TestBed.configureTestingModule({
    imports: [AnnouncerHostComponent],
    providers: [
      provideRouter([
        { path: "login", component: LoginHeadingComponent },
        { path: "archive", component: ArchiveHeadingComponent },
        { path: "visibility", component: VisibilityHeadingComponent },
        { path: "disconnect", component: DisconnectingHeadingComponent },
        {
          path: "nested",
          component: NestedArchiveComponent,
          children: [{ path: "detail", component: NestedDetailComponent }],
        },
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

  it("ignores hidden and inert headings inside the active route owner", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);

    await router.navigateByUrl("/visibility");
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(getComputedStyle(host.querySelector<HTMLElement>(".route-display-none")!).display)
      .toBe("none");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".route-visibility-hidden")!).visibility)
      .toBe("hidden");
    await settleNavigation(fixture);

    expect(live.announce.mock.calls).toEqual([["可见标题", "polite"]]);
  });

  it("announces the deepest active primary route heading", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);

    await router.navigateByUrl("/nested/detail");
    await settleNavigation(fixture);

    expect(live.announce.mock.calls).toEqual([["嵌套详情", "polite"]]);
  });

  it("does not fall back to stale private text when the active route disconnects", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);

    await router.navigateByUrl("/disconnect?cipherId=route-private-id");
    await settleNavigation(fixture);

    expect(live.announce).not.toHaveBeenCalled();
    expect(JSON.stringify(live.announce.mock.calls)).not.toContain("route-private-id");
    expect(JSON.stringify(live.announce.mock.calls)).not.toContain("secret-server-id");
  });

  it("subscribes only once when start is called twice", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();
    service.start();
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);

    await router.navigateByUrl("/archive");
    await settleNavigation(fixture);

    expect(live.announce.mock.calls).toEqual([["归档", "polite"]]);
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

  it("suppresses startup again after destroy and restart", async () => {
    const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
    const { router, fixture, service } = await renderAnnouncer(live);
    service.start();
    await router.navigateByUrl("/login");
    await settleNavigation(fixture);
    service.destroy();

    service.start();
    await router.navigateByUrl("/archive");
    await settleNavigation(fixture);
    expect(live.announce).not.toHaveBeenCalled();

    await router.navigateByUrl("/login");
    await settleNavigation(fixture);
    expect(live.announce.mock.calls).toEqual([["登录", "polite"]]);
    expect(live.clear).toHaveBeenCalledOnce();
  });
});
