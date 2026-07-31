import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { OfficialEnvironmentSelectorComponent } from "../upstream-overlays/auth/environment/official-environment-selector.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

function menuItems(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".bit-menu-panel [role=menuitem]"));
}

function menuTrigger(host: HTMLElement): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
}

function afterDialogLifecycle(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve));
}

function dialogFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hidden && element.tabIndex >= 0 && !element.classList.contains("cdk-focus-trap-anchor"),
  );
}

async function openSelfHostedDialog(
  fixture: ReturnType<typeof TestBed.createComponent<OfficialEnvironmentSelectorComponent>>,
): Promise<HTMLDialogElement> {
  const host = fixture.nativeElement as HTMLElement;
  menuTrigger(host).click();
  fixture.detectChanges();
  menuItems()[2].click();
  fixture.detectChanges();
  await fixture.whenStable();
  await afterDialogLifecycle();
  return host.querySelector<HTMLDialogElement>("dialog")!;
}

describe("OfficialEnvironmentSelectorComponent", () => {
  it("selects a hosted region from the official menu overlay", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    const emitted: string[] = [];
    fixture.componentInstance.serverUrlChange.subscribe((serverUrl) => emitted.push(serverUrl));
    fixture.detectChanges();

    const trigger = menuTrigger(fixture.nativeElement as HTMLElement);
    trigger.click();
    fixture.detectChanges();

    const items = menuItems();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute("aria-pressed")).toBe("false");
    items[1].click();

    expect(emitted).toEqual(["https://vault.bitwarden.eu"]);
  });

  it("emits only a normalized self-hosted HTTPS URL", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    const emitted: string[] = [];
    const valid: boolean[] = [];
    fixture.componentInstance.serverUrlChange.subscribe((serverUrl) => emitted.push(serverUrl));
    fixture.componentInstance.environmentValidChange.subscribe((value) => valid.push(value));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    menuTrigger(host).click();
    fixture.detectChanges();
    menuItems()[2].click();
    fixture.detectChanges();
    await fixture.whenStable();
    await afterDialogLifecycle();

    const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
    const input = dialog.querySelector<HTMLInputElement>('[data-testid="self-hosted-server-url"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelectorAll("input")).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    expect(dialog.textContent).not.toContain("API URL");
    expect(dialog.textContent).not.toContain("Identity URL");
    expect(dialog.textContent).not.toContain("Web Vault URL");

    input.value = "http://self.example.com";
    input.dispatchEvent(new Event("input"));
    dialog.querySelector<HTMLButtonElement>('[data-testid="self-hosted-save"]')!.click();
    fixture.detectChanges();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("HTTPS");
    expect(emitted).toEqual([]);

    input.value = " self.example.com/ ";
    input.dispatchEvent(new Event("input"));
    dialog.querySelector<HTMLButtonElement>('[data-testid="self-hosted-save"]')!.click();

    expect(emitted).toEqual(["https://self.example.com"]);
    expect(valid).toEqual([true]);
  });

  it("returns keyboard focus to the official menu trigger when the dialog is cancelled", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const trigger = menuTrigger(host);
    trigger.click();
    fixture.detectChanges();
    menuItems()[2].click();
    fixture.detectChanges();
    await fixture.whenStable();
    await afterDialogLifecycle();

    host.querySelector<HTMLButtonElement>('[data-testid="self-hosted-cancel"]')!.click();
    fixture.detectChanges();
    await afterDialogLifecycle();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps validity unchanged while cancelling a self-hosted dialog from US", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    const valid: boolean[] = [];
    const serverUrls: string[] = [];
    fixture.componentInstance.environmentValidChange.subscribe((value) => valid.push(value));
    fixture.componentInstance.serverUrlChange.subscribe((value) => serverUrls.push(value));
    fixture.detectChanges();

    const dialog = await openSelfHostedDialog(fixture);
    dialog.querySelector<HTMLButtonElement>('[data-testid="self-hosted-cancel"]')!.click();
    fixture.detectChanges();
    await afterDialogLifecycle();

    expect(valid).toEqual([true]);
    expect(serverUrls).toEqual([]);
  });

  it("keeps validity unchanged after native cancel from EU", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    menuTrigger(host).click();
    fixture.detectChanges();
    menuItems()[1].click();
    fixture.detectChanges();
    const valid: boolean[] = [];
    const serverUrls: string[] = [];
    fixture.componentInstance.environmentValidChange.subscribe((value) => valid.push(value));
    fixture.componentInstance.serverUrlChange.subscribe((value) => serverUrls.push(value));

    const dialog = await openSelfHostedDialog(fixture);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    fixture.detectChanges();
    await afterDialogLifecycle();

    expect(valid).toEqual([true]);
    expect(serverUrls).toEqual([]);
  });

  it("keeps validity unchanged after cancelling an unchanged self-hosted selection", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    fixture.detectChanges();

    let dialog = await openSelfHostedDialog(fixture);
    const input = dialog.querySelector<HTMLInputElement>('[data-testid="self-hosted-server-url"]')!;
    input.value = "https://vault.example.test";
    input.dispatchEvent(new Event("input"));
    dialog.querySelector<HTMLButtonElement>('[data-testid="self-hosted-save"]')!.click();
    fixture.detectChanges();

    const valid: boolean[] = [];
    const serverUrls: string[] = [];
    fixture.componentInstance.environmentValidChange.subscribe((value) => valid.push(value));
    fixture.componentInstance.serverUrlChange.subscribe((value) => serverUrls.push(value));
    dialog = await openSelfHostedDialog(fixture);
    dialog.querySelector<HTMLButtonElement>('[data-testid="self-hosted-cancel"]')!.click();
    fixture.detectChanges();
    await afterDialogLifecycle();

    expect(valid).toEqual([true]);
    expect(serverUrls).toEqual([]);
  });

  it("closes on Escape and keeps Tab within the native dialog", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const trigger = menuTrigger(host);
    trigger.click();
    fixture.detectChanges();
    menuItems()[2].click();
    fixture.detectChanges();
    await fixture.whenStable();
    await afterDialogLifecycle();

    const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
    const input = dialog.querySelector<HTMLInputElement>('[data-testid="self-hosted-server-url"]')!;
    const focusable = dialogFocusableElements(dialog);
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(input);

    focusable.at(-1)!.focus();
    focusable.at(-1)!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(focusable[0]);
    focusable[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(focusable.at(-1));

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    fixture.detectChanges();
    await afterDialogLifecycle();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("normalizes DNS, localhost, IPv4, and IPv6 hosts with custom ports", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialEnvironmentSelectorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialEnvironmentSelectorComponent);
    const emitted: string[] = [];
    fixture.componentInstance.serverUrlChange.subscribe((serverUrl) => emitted.push(serverUrl));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    for (const serverUrl of [
      "self.example.com:8443",
      "localhost:8443",
      "127.0.0.1:8443",
      "[::1]:8443",
    ]) {
      menuTrigger(host).click();
      fixture.detectChanges();
      menuItems()[2].click();
      fixture.detectChanges();
      await fixture.whenStable();
      await afterDialogLifecycle();
      const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
      const input = dialog.querySelector<HTMLInputElement>('[data-testid="self-hosted-server-url"]')!;
      input.value = serverUrl;
      input.dispatchEvent(new Event("input"));
      dialog.querySelector<HTMLButtonElement>('[data-testid="self-hosted-save"]')!.click();
      fixture.detectChanges();
    }

    expect(emitted).toEqual([
      "https://self.example.com:8443",
      "https://localhost:8443",
      "https://127.0.0.1:8443",
      "https://[::1]:8443",
    ]);
  });
});
