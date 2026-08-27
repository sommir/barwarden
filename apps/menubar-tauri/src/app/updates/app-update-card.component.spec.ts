import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { AppUpdateCardComponent } from "./app-update-card.component";
import type { AppUpdateView } from "./app-update.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("AppUpdateCardComponent", () => {
  it("keeps the current version and manual check action visible at rest", async () => {
    const fixture = await render(view("idle"), "zh-CN");
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain("应用更新");
    expect(host.textContent).toContain("版本 0.1.0");
    expect(host.querySelector("[data-testid='check-for-updates']")).not.toBeNull();
  });

  it("presents one primary install action for a discovered update", async () => {
    const fixture = await render(
      {
        ...view("available"),
        version: "0.2.0",
        notes: "Security and reliability fixes",
        notificationVisible: true,
      },
      "en-US",
    );
    const host = fixture.nativeElement as HTMLElement;
    const install = vi.fn();
    fixture.componentInstance.downloadAndRestart.subscribe(install);

    expect(host.textContent).toContain("Version 0.2.0 is available");
    expect(host.textContent).toContain("Security and reliability fixes");
    host.querySelector<HTMLButtonElement>("[data-testid='install-update']")!.click();
    expect(install).toHaveBeenCalledOnce();
  });

  it("shows determinate download progress with polite status semantics", async () => {
    const fixture = await render(
      {
        ...view("downloading"),
        version: "0.2.0",
        progress: 0.5,
      },
      "en-US",
    );
    const host = fixture.nativeElement as HTMLElement;
    const progress = host.querySelector<HTMLProgressElement>("progress")!;

    expect(progress.value).toBe(0.5);
    expect(progress.max).toBe(1);
    expect(host.querySelector("[role='status']")?.textContent).toContain("50%");
    expect(host.querySelectorAll("button:not([disabled])")).toHaveLength(0);
  });

  it("offers retry after an install failure without exposing native details", async () => {
    const fixture = await render(
      {
        ...view("error"),
        version: "0.2.0",
        message: "Unable to download or install the update. Try again.",
      },
      "en-US",
    );
    const host = fixture.nativeElement as HTMLElement;
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);

    expect(host.textContent).toContain("Unable to download or install the update.");
    host.querySelector<HTMLButtonElement>("[data-testid='retry-update']")!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});

async function render(updateView: AppUpdateView, locale: "zh-CN" | "en-US") {
  await TestBed.configureTestingModule({
    imports: [AppUpdateCardComponent],
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  await TestBed.inject(OfficialI18nService).setLocale(locale);
  const fixture = TestBed.createComponent(AppUpdateCardComponent);
  fixture.componentRef.setInput("currentVersion", "0.1.0");
  fixture.componentRef.setInput("view", updateView);
  fixture.detectChanges();
  return fixture;
}

function view(status: AppUpdateView["status"]): AppUpdateView {
  return {
    status,
    version: null,
    notes: null,
    progress: null,
    message: "",
    notificationVisible: false,
  };
}
