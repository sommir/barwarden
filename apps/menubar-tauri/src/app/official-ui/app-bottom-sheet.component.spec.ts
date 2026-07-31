import "zone.js";
import "@angular/compiler";

import { Component, ViewChild } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppBottomSheetComponent } from "./app-bottom-sheet.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  standalone: true,
  imports: [AppBottomSheetComponent],
  template: `
    <button #firstTrigger type="button">打开第一个</button>
    <button #secondTrigger type="button">打开第二个</button>

    <bw-app-bottom-sheet
      #firstSheet
      labelledBy="first-title"
      describedBy="first-description"
      testId="first-sheet"
      [disableClose]="firstDisableClose"
      (dismissed)="dismissed()"
    >
      <form class="app-bottom-sheet-panel">
        <h2 id="first-title">第一个抽屉</h2>
        <p id="first-description">说明</p>
        <input #firstInput />
      </form>
    </bw-app-bottom-sheet>

    <bw-app-bottom-sheet
      #secondSheet
      labelledBy="second-title"
      testId="second-sheet"
      [dismissOnBackdrop]="true"
    >
      <h2 id="second-title">第二个抽屉</h2>
      <button #secondAction type="button">操作</button>
    </bw-app-bottom-sheet>
  `,
})
class HostComponent {
  @ViewChild("firstSheet") firstSheet!: AppBottomSheetComponent;
  @ViewChild("secondSheet") secondSheet!: AppBottomSheetComponent;
  @ViewChild("firstTrigger") firstTrigger!: { nativeElement: HTMLButtonElement };
  @ViewChild("secondTrigger") secondTrigger!: { nativeElement: HTMLButtonElement };
  @ViewChild("firstInput") firstInput!: { nativeElement: HTMLInputElement };
  @ViewChild("secondAction") secondAction!: { nativeElement: HTMLButtonElement };

  firstDisableClose = false;
  readonly dismissed = vi.fn();
}

describe("AppBottomSheetComponent", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it("renders the shared drawer contract and focuses the requested control", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    component.firstTrigger.nativeElement.focus();
    component.firstSheet.open(
      component.firstTrigger.nativeElement,
      component.firstInput.nativeElement,
    );
    await Promise.resolve();

    const dialog = host.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]');
    expect(dialog?.classList).toContain("app-bottom-sheet");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("first-title");
    expect(dialog?.getAttribute("aria-describedby")).toBe("first-description");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.getAttribute("data-state")).toBe("opening");
    await nextTask();
    expect(dialog?.getAttribute("data-state")).toBe("open");
    const panels = dialog?.querySelectorAll(".app-bottom-sheet-panel");
    expect(panels).toHaveLength(1);
    const panel = dialog?.querySelector(":scope > form.app-bottom-sheet-panel");
    expect(panel).not.toBeNull();
    expect(panel?.contains(component.firstInput.nativeElement)).toBe(true);
    expect(document.activeElement).toBe(component.firstInput.nativeElement);
  });

  it("allows only one application drawer and restores focus when it closes", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    component.firstSheet.open(
      component.firstTrigger.nativeElement,
      component.firstInput.nativeElement,
    );
    component.secondSheet.open(
      component.secondTrigger.nativeElement,
      component.secondAction.nativeElement,
    );
    await Promise.resolve();

    expect(host.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')?.open).toBe(false);
    expect(host.querySelector<HTMLDialogElement>('[data-testid="second-sheet"]')?.open).toBe(true);
    expect(document.activeElement).toBe(component.secondAction.nativeElement);

    component.secondSheet.close();
    dispatchTransformTransitionEnd(
      host.querySelector<HTMLDialogElement>('[data-testid="second-sheet"]')!,
    );
    await new Promise((resolve) => window.setTimeout(resolve));
    expect(document.activeElement).toBe(component.secondTrigger.nativeElement);
  });

  it("can defer initial focus until a menu click has finished bubbling", async () => {
    vi.useFakeTimers();
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.firstTrigger.nativeElement.focus();
    component.firstSheet.open(
      component.firstTrigger.nativeElement,
      component.firstInput.nativeElement,
      true,
    );
    await Promise.resolve();
    expect(document.activeElement).toBe(component.firstTrigger.nativeElement);

    vi.runAllTimers();
    expect(document.activeElement).toBe(component.firstInput.nativeElement);
  });

  it("dismisses on Escape and on the backdrop by default", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;
    const firstDialog = host.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;
    const secondDialog = host.querySelector<HTMLDialogElement>('[data-testid="second-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    firstDialog.click();
    dispatchTransformTransitionEnd(firstDialog);
    await Promise.resolve();
    expect(firstDialog.open).toBe(false);
    expect(component.dismissed).toHaveBeenCalledTimes(1);

    component.firstSheet.open(component.firstTrigger.nativeElement);
    firstDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    dispatchTransformTransitionEnd(firstDialog);
    await Promise.resolve();
    expect(firstDialog.open).toBe(false);
    expect(component.dismissed).toHaveBeenCalledTimes(2);

    component.secondSheet.open(component.secondTrigger.nativeElement);
    secondDialog.click();
    dispatchTransformTransitionEnd(secondDialog);
    await Promise.resolve();
    expect(secondDialog.open).toBe(false);
  });

  it("keeps a required-decision sheet open when Escape is disabled", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.componentInstance.firstDisableClose = true;
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;
    const dialog = host.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await Promise.resolve();

    expect(dialog.open).toBe(true);
    expect(component.dismissed).not.toHaveBeenCalled();
  });

  it("allows programmatic closure of a disable-close sheet", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.componentInstance.firstDisableClose = true;
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    dialog.click();
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog.open).toBe(true);

    component.firstSheet.close();
    expect(dialog.open).toBe(false);
    expect(component.dismissed).not.toHaveBeenCalled();
  });

  it("restores focus once after closing", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstTrigger.nativeElement.focus();
    component.firstSheet.open(component.firstTrigger.nativeElement);
    const restoreFocus = vi.spyOn(component.firstTrigger.nativeElement, "focus");
    component.firstSheet.close();
    await nextTask();

    expect(dialog.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("emits one terminal close through repeated close, transition fallback, and destruction", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;
    const closed = vi.fn();
    component.firstSheet.closed.subscribe(closed);

    component.firstSheet.open(component.firstTrigger.nativeElement);
    setTransformTransition(dialog, "50ms");
    component.firstSheet.close();
    dispatchTransformTransitionEnd(dialog);
    component.firstSheet.close();
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    fixture.destroy();

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("starts a new terminal cycle when a sheet is reopened", () => {
    const fixture = TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const closed = vi.fn();
    component.firstSheet.closed.subscribe(closed);

    component.firstSheet.open(component.firstTrigger.nativeElement);
    component.firstSheet.close();
    component.firstSheet.open(component.firstTrigger.nativeElement);
    component.firstSheet.close();

    expect(closed).toHaveBeenCalledTimes(2);
  });

  it("waits for this sheet's transform transition before closing its native dialog", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await nextTask();
    setTransformTransition(dialog, "200ms");
    component.firstSheet.close();

    expect(dialog.getAttribute("data-state")).toBe("closing");
    expect(dialog.open).toBe(true);

    dialog.dispatchEvent(new TransitionEvent("transitionend", {
      bubbles: true,
      propertyName: "opacity",
    }));
    expect(dialog.open).toBe(true);

    const nested = document.createElement("div");
    dialog.append(nested);
    nested.dispatchEvent(new TransitionEvent("transitionend", {
      bubbles: true,
      propertyName: "transform",
    }));
    expect(dialog.open).toBe(true);

    dispatchTransformTransitionEnd(dialog);
    expect(dialog.open).toBe(false);
  });

  it("retargets a closing sheet without allowing its stale close to settle", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await Promise.resolve();
    setTransformTransition(dialog, "200ms");
    component.firstSheet.close();
    component.firstSheet.open(component.firstTrigger.nativeElement);
    await nextTask();

    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("data-state")).toBe("open");
    dispatchTransformTransitionEnd(dialog);
    expect(dialog.open).toBe(true);
  });

  it("closes immediately when reduced motion is preferred", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await Promise.resolve();
    component.firstSheet.close();

    expect(dialog.open).toBe(false);
  });

  it("uses its fallback timer when the transform transition event is unavailable", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await nextTask();
    setTransformTransition(dialog, "200ms");
    component.firstSheet.close();
    await new Promise((resolve) => window.setTimeout(resolve, 350));

    expect(dialog.open).toBe(false);
  });

  it("uses the relevant transition slot with list repetition and does not wait for zero-duration transforms", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await nextTask();
    const computedStyles = vi.spyOn(window, "getComputedStyle");
    computedStyles.mockReturnValue({
      transitionProperty: "opacity, all",
      transitionDuration: "300ms",
      transitionDelay: "200ms, 100ms",
    } as CSSStyleDeclaration);
    component.firstSheet.close();
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    expect(dialog.open).toBe(true);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(dialog.open).toBe(false);

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await nextTask();
    computedStyles.mockReturnValue({
      transitionProperty: "transform",
      transitionDuration: "0s",
      transitionDelay: "1s",
    } as CSSStyleDeclaration);
    component.firstSheet.close();
    expect(dialog.open).toBe(false);
  });

  it("uses the transition-property list as the timing master", async () => {
    const fixture = await TestBed.configureTestingModule({ imports: [HostComponent] })
      .createComponent(HostComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector<HTMLDialogElement>('[data-testid="first-sheet"]')!;
    const computedStyles = vi.spyOn(window, "getComputedStyle");

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await nextTask();
    computedStyles.mockReturnValue({
      transitionProperty: "all",
      transitionDuration: "0s, 5s",
      transitionDelay: "0s",
    } as CSSStyleDeclaration);
    component.firstSheet.close();
    expect(dialog.open).toBe(false);

    component.firstSheet.open(component.firstTrigger.nativeElement);
    await nextTask();
    computedStyles.mockReturnValue({
      transitionProperty: "opacity, transform",
      transitionDuration: "0s, 120ms, 5s",
      transitionDelay: "0s, 40ms, 5s",
    } as CSSStyleDeclaration);
    component.firstSheet.close();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(dialog.open).toBe(true);
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    expect(dialog.open).toBe(false);
  });

});

function dispatchTransformTransitionEnd(dialog: HTMLDialogElement): void {
  dialog.dispatchEvent(new TransitionEvent("transitionend", {
    propertyName: "transform",
  }));
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve));
}

function setTransformTransition(dialog: HTMLDialogElement, duration: string): void {
  void dialog;
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    transitionProperty: "transform",
    transitionDuration: duration,
    transitionDelay: "0s",
  } as CSSStyleDeclaration);
}
