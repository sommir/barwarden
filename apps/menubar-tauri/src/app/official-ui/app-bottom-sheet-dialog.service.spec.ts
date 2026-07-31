import "zone.js";
import "@angular/compiler";

import { DialogModule as CdkDialogModule, DIALOG_DATA } from "@angular/cdk/dialog";
import { Component, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogModule, DialogService } from "@bitwarden/components";
import { DialogRef } from "@bitwarden/components/dialog/dialog-ref";

import {
  AppBottomSheetDialogHostComponent,
  AppBottomSheetDialogService,
} from "./app-bottom-sheet-dialog.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  standalone: true,
  template: `<button type="button" (click)="finish()">完成</button>`,
})
class DynamicDialogComponent {
  readonly data = inject<{ value: string }>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<string>>(DialogRef);

  finish(): void {
    void this.ref.close(this.data.value);
  }
}

@Component({
  standalone: true,
  imports: [AppBottomSheetDialogHostComponent],
  template: `
    <button type="button" data-testid="trigger" (click)="open()">打开</button>
    <bw-app-bottom-sheet-dialog-host />
  `,
})
class HostComponent {
  readonly dialog = inject(DialogService);
  result: Promise<string | undefined> | null = null;

  open(): void {
    const ref = this.dialog.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "saved" },
    });
    this.result = ref.closed.toPromise();
  }
}

describe("AppBottomSheetDialogService", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("renders dynamic Bitwarden dialogs inside the shared application sheet", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;

    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    const sheet = host.querySelector<HTMLDialogElement>(
      "bw-app-bottom-sheet-dialog-host .app-bottom-sheet",
    );
    expect(sheet?.open).toBe(true);
    expect(sheet?.querySelector("button")?.textContent).toContain("完成");

    sheet?.querySelector<HTMLButtonElement>("button")?.click();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    await expect(fixture.componentInstance.result).resolves.toBe("saved");
    expect(
      host.querySelector("bw-app-bottom-sheet-dialog-host .app-bottom-sheet[open]"),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("settles the replaced dialog and keeps only the newest dynamic sheet", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    const dialog = TestBed.inject(DialogService);
    const first = dialog.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "first" },
    });
    let firstResult: string | undefined | symbol = Symbol("unsettled");
    first.closed.subscribe((result) => {
      firstResult = result;
    });

    dialog.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "second" },
    });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(firstResult).toBeUndefined();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll(".app-bottom-sheet[open]"),
    ).toHaveLength(1);
  });

  it("allows a disable-close dialog result and forced close to settle exactly once", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppBottomSheetDialogService);
    const ref = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "saved" },
      disableClose: true,
    });
    let closeCount = 0;
    ref.closed.subscribe(() => closeCount += 1);
    fixture.detectChanges();
    await nextTask();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>("button:not([data-testid])")?.click();
    await nextTask();
    await nextTask();
    fixture.detectChanges();

    expect(service.requests()).toEqual([]);
    expect(closeCount).toBe(1);

    const forced = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "forced" },
      disableClose: true,
    });
    let forcedCount = 0;
    forced.closed.subscribe(() => forcedCount += 1);
    fixture.detectChanges();
    await nextTask();
    service.closeAll();
    await nextTask();
    await nextTask();
    fixture.detectChanges();

    expect(service.requests()).toEqual([]);
    expect(forcedCount).toBe(1);
  });

  it("settles disable-close requests during replacement and host teardown", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppBottomSheetDialogService);
    const first = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "first" },
      disableClose: true,
    });
    let firstCount = 0;
    first.closed.subscribe(() => firstCount += 1);
    fixture.detectChanges();
    await nextTask();

    const second = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "second" },
      disableClose: true,
    });
    let secondCount = 0;
    second.closed.subscribe(() => secondCount += 1);
    fixture.detectChanges();
    await nextTask();

    expect(firstCount).toBe(1);
    expect(service.requests()).toHaveLength(1);
    fixture.destroy();

    expect(secondCount).toBe(1);
    expect(service.requests()).toEqual([]);
  });

  it("settles same-task closes before the native sheet opens without flashing it", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>("[data-testid='trigger']")!;
    trigger.focus();
    const restoreFocus = vi.spyOn(trigger, "focus");
    const service = TestBed.inject(AppBottomSheetDialogService);
    const ref = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "fast" },
      disableClose: true,
    });
    let result: string | undefined | symbol = Symbol("unsettled");
    ref.closed.subscribe((value) => result = value);
    await ref.close("fast");
    fixture.detectChanges();
    await nextTask();
    await nextTask();

    expect(result).toBe("fast");
    expect(service.requests()).toEqual([]);
    expect(host.querySelector(".app-bottom-sheet[open]")).toBeNull();
    expect(restoreFocus).toHaveBeenCalledTimes(1);

    const forced = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "forced" },
      disableClose: true,
    });
    let forcedResult: string | undefined | symbol = Symbol("unsettled");
    forced.closed.subscribe((value) => forcedResult = value);
    service.closeAll();
    fixture.detectChanges();
    await nextTask();
    await nextTask();

    expect(forcedResult).toBeUndefined();
    expect(service.requests()).toEqual([]);
    expect(host.querySelector(".app-bottom-sheet[open]")).toBeNull();

    const teardown = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "teardown" },
      disableClose: true,
    });
    let teardownResult: string | undefined | symbol = Symbol("unsettled");
    teardown.closed.subscribe((value) => teardownResult = value);
    fixture.detectChanges();
    fixture.destroy();

    expect(teardownResult).toBeUndefined();
    expect(service.requests()).toEqual([]);
  });

  it("does not open or focus a sheet queued before the request closes", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppBottomSheetDialogService);
    const ref = service.open<string, { value: string }>(DynamicDialogComponent, {
      data: { value: "queued" },
    });
    fixture.detectChanges();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>(".app-bottom-sheet")!;
    const showModal = vi.fn(() => dialog.setAttribute("open", ""));
    Object.defineProperty(dialog, "showModal", { configurable: true, value: showModal });
    await ref.close("queued");
    await Promise.resolve();
    await nextTask();
    await nextTask();

    expect(showModal).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
    expect(service.requests()).toEqual([]);
  });

  it("renders shared confirmations in the same sheet host", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    const result = TestBed.inject(DialogService).openSimpleDialog({
      title: "确认操作",
      content: "确认内容",
      type: "danger",
      acceptButtonText: "确认",
      cancelButtonText: "取消",
    });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const sheet = host.querySelector<HTMLDialogElement>(".app-bottom-sheet[open]")!;

    expect(sheet.textContent).toContain("确认操作");
    expect(sheet.textContent).toContain("确认内容");
    await nextTask();
    expect(document.activeElement?.textContent).toContain("取消");
    sheet.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    await expect(result).resolves.toBe(true);
  });

  it("keeps the ordinary submit action as initial focus", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule, CdkDialogModule],
      providers: [
        provideNoopAnimations(),
        AppBottomSheetDialogService,
        { provide: DialogService, useExisting: AppBottomSheetDialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).createComponent(HostComponent);
    fixture.detectChanges();
    TestBed.inject(DialogService).openSimpleDialog({
      title: "普通确认",
      content: "普通内容",
      type: "warning",
      acceptButtonText: "继续",
      cancelButtonText: "取消",
    });
    fixture.detectChanges();
    await nextTask();

    expect(document.activeElement?.textContent).toContain("继续");
  });
});

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve));
}
