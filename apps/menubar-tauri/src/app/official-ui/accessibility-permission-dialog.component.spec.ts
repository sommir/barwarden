import "zone.js";
import "@angular/compiler";

import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessibilityPermissionDialogComponent } from "./accessibility-permission-dialog.component";
import {
  ACCESSIBILITY_SETTINGS_HOST,
  AccessibilityPermissionDialogService,
} from "./accessibility-permission-dialog.service";
import { AppOverlayStackService } from "./app-overlay-stack.service";
import { translateOfficialMessage } from "./official-i18n.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  standalone: true,
  imports: [AccessibilityPermissionDialogComponent],
  template: `
    <button class="permission-trigger permission-trigger-a" type="button">Autofill A</button>
    <button class="permission-trigger-b" type="button">Autofill B</button>
    <bw-accessibility-permission-dialog />
  `,
})
class PermissionDialogHostComponent {}

describe("AccessibilityPermissionDialogComponent", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it("uses one shared Sheet, focuses Later, traps Tab, and restores trigger", async () => {
    const { fixture, service } = renderPermissionDialog(vi.fn(async () => undefined));
    const trigger = fixture.nativeElement.querySelector<HTMLButtonElement>(".permission-trigger")!;
    trigger.focus();

    service.present(trigger);
    fixture.detectChanges();
    await fixture.whenStable();

    const sheets = fixture.nativeElement.querySelectorAll<HTMLDialogElement>(
      '.app-bottom-sheet[data-testid="accessibility-permission-sheet"]',
    );
    const sheet = fixture.nativeElement.querySelector<HTMLDialogElement>(
      '.app-bottom-sheet[open][data-testid="accessibility-permission-sheet"]',
    )!;
    const later = sheet.querySelector<HTMLButtonElement>('[data-testid="accessibility-later"]')!;
    const settings = sheet.querySelector<HTMLButtonElement>('[data-testid="accessibility-settings"]')!;

    expect(sheets).toHaveLength(1);
    expect(document.activeElement).toBe(later);
    settings.focus();
    settings.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(later);

    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    expect(TestBed.inject(AppOverlayStackService).consumeEscape(escape)).toBe(true);
    expect(escape.defaultPrevented).toBe(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(trigger);
    expect(fixture.nativeElement.querySelectorAll(".accessibility-permission-backdrop"))
      .toHaveLength(0);
  });

  it("keeps one trigger through closing, then accepts and restores the next trigger", async () => {
    const { fixture, service } = renderPermissionDialog(vi.fn(async () => undefined));
    const firstTrigger = fixture.nativeElement.querySelector<HTMLButtonElement>(
      ".permission-trigger-a",
    )!;
    const secondTrigger = fixture.nativeElement.querySelector<HTMLButtonElement>(
      ".permission-trigger-b",
    )!;
    const sheet = fixture.nativeElement.querySelector<HTMLDialogElement>(
      '[data-testid="accessibility-permission-sheet"]',
    )!;

    firstTrigger.focus();
    service.present(firstTrigger);
    fixture.detectChanges();
    await fixture.whenStable();
    sheet.style.transitionProperty = "transform";
    sheet.style.transitionDuration = "200ms";

    service.dismiss();
    fixture.detectChanges();
    expect(sheet.dataset["state"]).toBe("closing");
    service.present(secondTrigger);
    expect(service.isOpen()).toBe(false);
    expect(service.trigger()).toBe(firstTrigger);

    sheet.dispatchEvent(new TransitionEvent("transitionend", {
      bubbles: true,
      propertyName: "transform",
    }));
    await fixture.whenStable();
    expect(service.trigger()).toBeNull();

    secondTrigger.focus();
    service.present(secondTrigger);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(service.trigger()).toBe(secondTrigger);

    expect(TestBed.inject(AppOverlayStackService).consumeEscape(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    )).toBe(true);
    fixture.detectChanges();
    sheet.dispatchEvent(new TransitionEvent("transitionend", {
      bubbles: true,
      propertyName: "transform",
    }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(secondTrigger);
  });

  it("releases an active presentation when its component is destroyed", async () => {
    const { fixture, service } = renderPermissionDialog(vi.fn(async () => undefined));
    const firstTrigger = fixture.nativeElement.querySelector<HTMLButtonElement>(
      ".permission-trigger-a",
    )!;
    const secondTrigger = fixture.nativeElement.querySelector<HTMLButtonElement>(
      ".permission-trigger-b",
    )!;

    service.present(firstTrigger);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.destroy();

    service.present(secondTrigger);
    expect(service.isOpen()).toBe(true);
    expect(service.trigger()).toBe(secondTrigger);
  });

  it("rejects dismissal while Settings opens and exposes busy state", async () => {
    let finishOpening!: () => void;
    const openUrl = vi.fn(() => new Promise<void>((resolve) => {
      finishOpening = resolve;
    }));
    const { fixture, service } = renderPermissionDialog(openUrl);

    service.present();
    fixture.detectChanges();
    await fixture.whenStable();
    const sheet = fixture.nativeElement.querySelector<HTMLDialogElement>(
      '[data-testid="accessibility-permission-sheet"]',
    )!;
    const settings = sheet.querySelector<HTMLButtonElement>('[data-testid="accessibility-settings"]')!;

    settings.click();
    fixture.detectChanges();
    expect(sheet.querySelector("footer")?.getAttribute("aria-busy")).toBe("true");
    expect(settings.disabled).toBe(true);

    sheet.dispatchEvent(new Event("cancel", { cancelable: true }));
    fixture.detectChanges();
    expect(sheet.open).toBe(true);
    expect(service.isOpen()).toBe(true);

    finishOpening();
    await fixture.whenStable();
  });

  it("shows one sanitized assertive failure and clears busy state when Settings cannot open", async () => {
    const openUrl = vi.fn(async () => {
      throw new Error("secret native launch details");
    });
    const { fixture, service } = renderPermissionDialog(openUrl);

    service.present();
    fixture.detectChanges();
    await fixture.whenStable();
    const sheet = fixture.nativeElement.querySelector<HTMLDialogElement>(
      '[data-testid="accessibility-permission-sheet"]',
    )!;

    sheet.querySelector<HTMLButtonElement>('[data-testid="accessibility-settings"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const alerts = sheet.querySelectorAll<HTMLElement>("[role=alert]");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent?.trim()).toContain(
      translateOfficialMessage("i18nOpenSystemSettingsFailed"),
    );
    expect(alerts[0].textContent).not.toContain("secret native launch details");
    expect(sheet.querySelector("footer")?.getAttribute("aria-busy")).toBe("false");
    expect(service.isOpen()).toBe(true);
  });
});

function renderPermissionDialog(openUrl: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    imports: [PermissionDialogHostComponent],
    providers: [{ provide: ACCESSIBILITY_SETTINGS_HOST, useValue: { openUrl } }],
  });
  const fixture = TestBed.createComponent(PermissionDialogHostComponent);
  fixture.detectChanges();
  return {
    fixture,
    service: TestBed.inject(AccessibilityPermissionDialogService),
  };
}
