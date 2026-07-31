import "@angular/compiler";
import "zone.js";

import { Component, inject } from "@angular/core";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import {
  RouteReuseStrategy,
  Router,
  RouterOutlet,
  provideRouter,
  withRouterConfig,
} from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService, translateOfficialMessage } from "../official-ui/official-i18n.service";
import { LocaleRouteRefreshService } from "./locale-route-refresh.service";
import { PopupRouteReuseStrategy } from "./popup-route-reuse.strategy";

@Component({ standalone: true, template: "<span>{{ label }}</span>" })
class LocaleSensitiveRouteComponent {
  static creations = 0;

  readonly label = translateOfficialMessage("settings");

  constructor() {
    LocaleSensitiveRouteComponent.creations += 1;
  }
}

@Component({ standalone: true, imports: [RouterOutlet], template: "<router-outlet />" })
class LocaleRefreshHostComponent {
  private readonly localeRouteRefresh = inject(LocaleRouteRefreshService);
}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("LocaleRouteRefreshService", () => {
  afterEach(async () => {
    TestBed.resetTestingModule();
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it("recreates the active retained route when the locale changes", async () => {
    LocaleSensitiveRouteComponent.creations = 0;
    const i18n = new OfficialI18nService();
    await i18n.setLocale("zh-CN");

    await TestBed.configureTestingModule({
      imports: [LocaleRefreshHostComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: RouteReuseStrategy, useExisting: PopupRouteReuseStrategy },
        provideRouter(
          [{ path: "settings", component: LocaleSensitiveRouteComponent }],
          withRouterConfig({ onSameUrlNavigation: "reload" }),
        ),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LocaleRefreshHostComponent);
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    await router.navigateByUrl("/settings");
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("设置");
    expect(LocaleSensitiveRouteComponent.creations).toBe(1);

    await TestBed.inject(OfficialI18nService).setLocale("en-US");

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain("Settings");
      expect(LocaleSensitiveRouteComponent.creations).toBe(2);
    });
  });
});
