import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { PopupStateStore } from "../popup-state";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";
import { VaultRepromptError, VaultRepromptService } from "./vault-reprompt.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

async function setup(verify = vi.fn().mockResolvedValue(true)) {
  const store = new PopupStateStore();
  await TestBed.configureTestingModule({
    imports: [VaultRepromptDialogComponent],
    providers: [
      { provide: PopupStateStore, useValue: store },
      { provide: VaultRepromptService, useValue: { verify } },
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(VaultRepromptDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, store, verify };
}

describe("VaultRepromptDialogComponent", () => {
  it("runs the continuation only after verification and clears the password", async () => {
    const { fixture, verify } = await setup();
    const continuation = vi.fn().mockResolvedValue(undefined);
    fixture.componentInstance.openFor("cipher-a", continuation);
    await fixture.whenStable();
    fixture.detectChanges();
    enterPassword(fixture.nativeElement as HTMLElement, "never-persist");

    expect((fixture.nativeElement as HTMLElement).querySelector("form[bit-dialog]")).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector("[bitdialogtitle]")).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector("form[bit-dialog] > section")).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector("form[bit-dialog] footer")).not.toBeNull();

    await fixture.componentInstance.submit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(verify).toHaveBeenCalledWith("never-persist", expect.any(Number));
    expect(continuation).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.masterPassword).toBe("");
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("input")?.value).toBe("");
  });

  it("keeps the dialog open with a fixed error and clears failed input", async () => {
    const { fixture } = await setup(vi.fn().mockRejectedValue(new VaultRepromptError("主密码不正确。")));
    const continuation = vi.fn();
    fixture.componentInstance.openFor("cipher-a", continuation);
    await fixture.whenStable();
    fixture.detectChanges();
    enterPassword(fixture.nativeElement as HTMLElement, "wrong");

    await fixture.componentInstance.submit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(continuation).not.toHaveBeenCalled();
    expect(fixture.componentInstance.errorMessage).toBe("主密码不正确。");
    expect(fixture.componentInstance.masterPassword).toBe("");
    expect((fixture.nativeElement as HTMLElement).querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("closes and clears the dialog before a verified continuation fails", async () => {
    const { fixture } = await setup();
    const actionError = new Error("protected action failed");
    fixture.componentInstance.openFor("cipher-a", vi.fn().mockRejectedValue(actionError));
    await fixture.whenStable();
    fixture.detectChanges();
    enterPassword(fixture.nativeElement as HTMLElement, "never-persist");

    await expect(fixture.componentInstance.submit()).rejects.toBe(actionError);
    fixture.detectChanges();

    expect(fixture.componentInstance.errorMessage).toBe("");
    expect(fixture.componentInstance.masterPassword).toBe("");
    expect((fixture.nativeElement as HTMLElement).querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("reports continuation failures from form submission without reopening the password error", async () => {
    const { fixture, store } = await setup();
    fixture.componentInstance.openFor(
      "cipher-a",
      vi.fn().mockRejectedValue(new Error("private action detail")),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    enterPassword(fixture.nativeElement as HTMLElement, "never-persist");

    fixture.componentInstance.onSubmit(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => expect(store.snapshot().statusMessage).toBe("无法完成操作，请重试。"));
    expect(fixture.componentInstance.errorMessage).toBe("");
    expect((fixture.nativeElement as HTMLElement).querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("runs contextual cancellation exactly once when verification becomes invalid", async () => {
    const { fixture } = await setup(vi.fn().mockResolvedValue(false));
    const continuation = vi.fn();
    const cancellation = vi.fn().mockResolvedValue(undefined);
    fixture.componentInstance.openFor(
      "cipher-a",
      continuation,
      undefined,
      "protected-receipt",
      cancellation,
    );
    enterPassword(fixture.nativeElement as HTMLElement, "never-persist");

    await fixture.componentInstance.submit();
    fixture.componentInstance.cancel();
    fixture.destroy();

    expect(continuation).not.toHaveBeenCalled();
    expect(cancellation).toHaveBeenCalledOnce();
  });

  it("preserves the legacy close semantics when verification returns false", async () => {
    const { fixture, store } = await setup(vi.fn().mockResolvedValue(false));
    const continuation = vi.fn();
    fixture.componentInstance.openFor("cipher-a", continuation);
    const epoch = fixture.componentInstance.operationEpoch;
    enterPassword(fixture.nativeElement as HTMLElement, "never-persist");

    await fixture.componentInstance.submit();

    expect(continuation).not.toHaveBeenCalled();
    expect(store.isCurrentProtectedOperation(epoch)).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("clears transient state on cancel and destroy", async () => {
    const { fixture, store } = await setup();
    fixture.componentInstance.openFor("cipher-a", vi.fn());
    const epoch = fixture.componentInstance.operationEpoch;
    fixture.componentInstance.masterPassword = "cancel-secret";

    fixture.componentInstance.cancel();
    expect(fixture.componentInstance.masterPassword).toBe("");
    expect(store.isCurrentProtectedOperation(epoch)).toBe(false);

    fixture.componentInstance.openFor("cipher-b", vi.fn());
    const destroyEpoch = fixture.componentInstance.operationEpoch;
    fixture.componentInstance.masterPassword = "destroy-secret";
    fixture.destroy();
    expect(fixture.componentInstance.masterPassword).toBe("");
    expect(store.isCurrentProtectedOperation(destroyEpoch)).toBe(false);
  });
});

function enterPassword(host: HTMLElement, value: string): void {
  const input = host.querySelector<HTMLInputElement>("input");
  if (!input) {
    throw new Error("Missing reprompt password input");
  }
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
