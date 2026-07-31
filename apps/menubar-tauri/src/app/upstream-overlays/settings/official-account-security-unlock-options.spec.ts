import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { OfficialAccountSecurityComponent } from "./official-account-security.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (
    !(error instanceof Error)
    || !error.message.includes("Cannot set base providers")
  ) {
    throw error;
  }
}

describe("OfficialAccountSecurityComponent unlock options", () => {
  it("renders official PIN and Touch ID controls and emits requested values", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialAccountSecurityComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialAccountSecurityComponent);
    fixture.componentRef.setInput("settings", settings());
    const pinEnabledChange = vi.fn();
    const biometricEnabledChange = vi.fn();
    fixture.componentInstance.pinEnabledChange.subscribe(pinEnabledChange);
    fixture.componentInstance.biometricEnabledChange.subscribe(
      biometricEnabledChange,
    );
    fixture.componentRef.setInput("biometricAvailable", true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("解锁选项");
    expect(host.textContent).toContain("使用 Touch ID 解锁");
    expect(host.textContent).toContain("使用 PIN 码解锁");
    expect(host.textContent).toContain("PIN 会加密保存在此设备");
    expect(host.textContent).toContain("重新启动应用后，需先用主密码解锁一次");

    const biometric = host.querySelector<HTMLInputElement>(
      "input#biometricUnlock",
    )!;
    const pin = host.querySelector<HTMLInputElement>("input#pinUnlock")!;
    expect(biometric).not.toBeNull();
    expect(pin).not.toBeNull();

    biometric.checked = true;
    biometric.dispatchEvent(new Event("change"));
    pin.checked = true;
    pin.dispatchEvent(new Event("change"));

    expect(biometricEnabledChange).toHaveBeenCalledWith(true);
    expect(pinEnabledChange).toHaveBeenCalledWith(true);
  });

  it("disables setup while unavailable but leaves an enabled Touch ID control removable", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialAccountSecurityComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialAccountSecurityComponent);
    fixture.componentRef.setInput("settings", settings());
    fixture.componentRef.setInput("biometricAvailable", false);
    fixture.componentRef.setInput(
      "biometricUnavailableReason",
      "请先在系统设置中录入 Touch ID。",
    );
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const biometric = host.querySelector<HTMLInputElement>(
      "input#biometricUnlock",
    )!;
    expect(biometric.disabled).toBe(true);
    expect(host.textContent).toContain("请先在系统设置中录入 Touch ID。");

    fixture.componentRef.setInput("biometricEnabled", true);
    fixture.detectChanges();
    expect(biometric.checked).toBe(true);
    expect(biometric.disabled).toBe(false);

    fixture.componentRef.setInput("unlockMethodBusy", true);
    fixture.detectChanges();
    expect(biometric.disabled).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>("input#pinUnlock")!.disabled,
    ).toBe(true);
  });

  it.each([
    {
      label: "PIN",
      selector: "input#pinUnlock",
      input: "pinEnabled",
      subscribe: (component: OfficialAccountSecurityComponent, listener: (value: boolean) => void) =>
        component.pinEnabledChange.subscribe(listener),
    },
    {
      label: "Touch ID",
      selector: "input#biometricUnlock",
      input: "biometricEnabled",
      subscribe: (component: OfficialAccountSecurityComponent, listener: (value: boolean) => void) =>
        component.biometricEnabledChange.subscribe(listener),
    },
  ] as const)(
    "keeps the $label checkbox at its controlled input until the parent changes it",
    async ({ selector, input, subscribe }) => {
      await TestBed.configureTestingModule({
        imports: [OfficialAccountSecurityComponent],
      }).compileComponents();
      const fixture = TestBed.createComponent(OfficialAccountSecurityComponent);
      fixture.componentRef.setInput("settings", settings());
      fixture.componentRef.setInput("biometricAvailable", true);
      const emitted: boolean[] = [];
      subscribe(fixture.componentInstance, (value) => emitted.push(value));
      fixture.detectChanges();

      const checkbox = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLInputElement>(selector)!;
      checkbox.click();

      expect(emitted).toEqual([true]);
      expect(checkbox.checked).toBe(false);

      fixture.componentRef.setInput(input, true);
      fixture.detectChanges();
      expect(checkbox.checked).toBe(true);

      checkbox.click();

      expect(emitted).toEqual([true, false]);
      expect(checkbox.checked).toBe(true);

      fixture.componentRef.setInput(input, false);
      fixture.detectChanges();
      expect(checkbox.checked).toBe(false);
    },
  );

  it("renders the fixed account-security unlock error", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialAccountSecurityComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialAccountSecurityComponent);
    fixture.componentRef.setInput("settings", settings());
    fixture.componentRef.setInput("unlockMethodError", "无法设置 PIN。请重试。");
    fixture.detectChanges();

    const alert = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("无法设置 PIN。请重试。");
  });
});

function settings() {
  return {
    vaultTimeoutMinutes: 5 as const,
    vaultTimeoutAction: "lock" as const,
    biometricEnabled: false,
  };
}
