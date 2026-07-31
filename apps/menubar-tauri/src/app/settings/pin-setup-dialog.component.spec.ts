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
import { PinSetupDialogComponent } from "./pin-setup-dialog.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

async function setup() {
  await TestBed.configureTestingModule({
    imports: [PinSetupDialogComponent],
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(PinSetupDialogComponent);
  fixture.detectChanges();
  return fixture;
}

describe("PinSetupDialogComponent", () => {
  it.each(["12345", "123456789", "abcdef", "１２３４５６"])(
    "rejects invalid PIN %s and clears both controls",
    async (pin) => {
      const fixture = await setup();
      const emitted = vi.fn();
      fixture.componentInstance.pinConfirmed.subscribe(emitted);
      fixture.componentInstance.open();
      enterSecrets(fixture.nativeElement, pin, pin);

      submit(fixture.nativeElement);
      fixture.detectChanges();

      expect(emitted).not.toHaveBeenCalled();
      expect(fixture.componentInstance.errorMessage).toBe(
        "PIN 必须为 6 到 8 位数字。",
      );
      expect(secretValues(fixture.nativeElement)).toEqual(["", ""]);
    },
  );

  it("rejects a confirmation mismatch and clears both fields", async () => {
    const fixture = await setup();
    const emitted = vi.fn();
    fixture.componentInstance.pinConfirmed.subscribe(emitted);
    fixture.componentInstance.open();
    enterSecrets(fixture.nativeElement, "123456", "654321");

    submit(fixture.nativeElement);
    fixture.detectChanges();

    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.componentInstance.errorMessage).toBe("两次输入的 PIN 不一致。");
    expect(secretValues(fixture.nativeElement)).toEqual(["", ""]);
  });

  it.each(["123456", "1234567", "12345678"])(
    "emits valid PIN %s once and clears it immediately",
    async (pin) => {
      const fixture = await setup();
      const emitted = vi.fn();
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      fixture.componentInstance.pinConfirmed.subscribe(emitted);
      fixture.componentInstance.open();
      enterSecrets(fixture.nativeElement, pin, pin);

      submit(fixture.nativeElement);
      fixture.detectChanges();

      expect(emitted).toHaveBeenCalledOnce();
      expect(emitted).toHaveBeenCalledWith(pin);
      expect(secretValues(fixture.nativeElement)).toEqual(["", ""]);
      expect(fixture.componentInstance.errorMessage).toBe("");
      expect(Object.values(fixture.componentInstance)).not.toContain(pin);
      expect(setItem).not.toHaveBeenCalled();
      setItem.mockRestore();
    },
  );

  it("clears both secret controls on cancel and destroy", async () => {
    const fixture = await setup();
    fixture.componentInstance.open();
    enterSecrets(fixture.nativeElement, "123456", "123456");

    fixture.componentInstance.cancel();
    fixture.detectChanges();
    expect(secretValues(fixture.nativeElement)).toEqual(["", ""]);

    fixture.componentInstance.open();
    enterSecrets(fixture.nativeElement, "87654321", "87654321");
    fixture.destroy();

    expect(fixture.componentInstance.formGroup.controls.pin.value).toBe("");
    expect(fixture.componentInstance.formGroup.controls.confirmPin.value).toBe("");
    expect(Object.values(fixture.componentInstance)).not.toContain("87654321");
  });
});

function enterSecrets(host: HTMLElement, pin: string, confirmation: string): void {
  const inputs = [...host.querySelectorAll<HTMLInputElement>("input")];
  if (inputs.length !== 2) {
    throw new Error("Missing PIN setup inputs");
  }
  for (const [input, value] of [
    [inputs[0], pin],
    [inputs[1], confirmation],
  ] as const) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function secretValues(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLInputElement>("input")]
    .map((input) => input.value);
}

function submit(host: HTMLElement): void {
  host.querySelector("form")?.dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}
