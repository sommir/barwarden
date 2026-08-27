import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppFeedbackComponent } from "./app-feedback.component";
import { AppFeedbackService } from "./app-feedback.service";
import { OfficialGeneratorToastAdapter } from "../generator/official-generator-toast.adapter";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  standalone: true,
  imports: [AppFeedbackComponent],
  template: `
    <button type="button" class="safe-control">Safe control</button>
    <bw-app-feedback [hasMainSwitcher]="hasMainSwitcher" />
  `,
})
class FeedbackHostComponent {
  hasMainSwitcher = true;
}

describe("AppFeedbackService and AppFeedbackComponent", () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it("replaces the visible message and gives repeated text a new announcement id", () => {
    const service = new AppFeedbackService();

    service.show("Copied", { kind: "success", durationMs: 1_000 });
    const first = service.snapshot();
    service.show("Copied", { kind: "success", durationMs: 1_000 });
    const second = service.snapshot();

    expect(first).toMatchObject({ kind: "success", message: "Copied", durationMs: 1_000 });
    expect(second).toMatchObject({ kind: "success", message: "Copied", durationMs: 1_000 });
    expect(second?.id).toBeGreaterThan(first?.id ?? 0);
  });

  it("uses a current-message token so an old timer cannot dismiss its replacement", () => {
    vi.useFakeTimers();
    const service = new AppFeedbackService();

    service.show("First", { durationMs: 100 });
    service.show("Second", { durationMs: 200 });
    vi.advanceTimersByTime(100);

    expect(service.snapshot()).toMatchObject({ message: "Second" });
    vi.advanceTimersByTime(100);
    expect(service.snapshot()).toBeNull();
  });

  it("renders polite status and success messages, but warnings as alerts", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);

    service.show("Copied", { kind: "success", durationMs: 1_000 });
    fixture.detectChanges();
    const success = fixture.nativeElement.querySelector<HTMLElement>(".app-feedback__announcer");
    expect(success?.getAttribute("role")).toBe("status");
    expect(success?.getAttribute("aria-live")).toBe("polite");

    service.show("Needs attention", { kind: "warning", durationMs: 1_000 });
    fixture.detectChanges();
    const warning = fixture.nativeElement.querySelector<HTMLElement>(".app-feedback__announcer");
    expect(warning?.getAttribute("role")).toBe("alert");
    expect(warning?.hasAttribute("aria-live")).toBe(false);
  });

  it("turns copied field statuses into a compact Chinese success receipt", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);

    service.show("Copied Password", { kind: "success", durationMs: 1_000 });
    fixture.detectChanges();

    const message = fixture.nativeElement.querySelector<HTMLElement>(".app-feedback__message");
    expect(message?.dataset.kind).toBe("success");
    expect(message?.dataset.presentation).toBe("toast");
    expect(message?.textContent).toContain("已复制密码");
    expect(message?.querySelector(".app-feedback__icon.bwi-check")).not.toBeNull();
    expect(fixture.nativeElement.querySelector(".app-feedback__announcer")?.textContent).toContain("已复制密码");
  });

  it("dismisses a visible toast from its close control", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);
    service.show("Copied", { durationMs: 1_000 });
    fixture.detectChanges();

    fixture.nativeElement.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click();
    fixture.detectChanges();

    expect(service.snapshot()).toBeNull();
    expect(fixture.nativeElement.querySelector(".app-feedback__message")).toBeNull();
  });

  it("keeps the real toast close target at least 44px in both axes", async () => {
    const cleanupCss = installInteractionCss();
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    TestBed.inject(AppFeedbackService).show("Copied", { durationMs: 1_000 });
    fixture.detectChanges();

    try {
      const dismiss = fixture.nativeElement.querySelector<HTMLElement>(
        ".app-feedback__dismiss",
      )!;
      expect(getComputedStyle(dismiss).minWidth).toBe("44px");
      expect(getComputedStyle(dismiss).minHeight).toBe("44px");
    } finally {
      fixture.destroy();
      cleanupCss();
    }
  });

  it("recreates both announcement and presentation nodes for repeated text", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);

    service.show("Copied", { kind: "success", durationMs: 1_000 });
    fixture.detectChanges();
    const firstAnnouncement = fixture.nativeElement.querySelector(".app-feedback__announcer");
    const firstPresentation = fixture.nativeElement.querySelector(".app-feedback__message");
    service.show("Copied", { kind: "success", durationMs: 1_000 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".app-feedback__announcer")).not.toBe(firstAnnouncement);
    expect(fixture.nativeElement.querySelector(".app-feedback__message")).not.toBe(firstPresentation);
  });

  it("uses the main-switcher inset and hides rather than obscuring an overlapping focused control", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);
    const control = fixture.nativeElement.querySelector<HTMLButtonElement>(".safe-control")!;
    control.focus();
    service.show("Copied", { durationMs: 1_000 });
    fixture.detectChanges();

    const surface = fixture.nativeElement.querySelector<HTMLElement>(".app-feedback")!;
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(0, 500, 320, 548));
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect(0, 510, 120, 540));
    document.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await Promise.resolve();
    fixture.detectChanges();

    expect(surface.dataset.hasMainSwitcher).toBe("true");
    expect(surface.dataset.focusOverlap).toBe("true");
    expect(surface.getAttribute("aria-hidden")).toBeNull();
    expect(surface.querySelector<HTMLElement>(".app-feedback__message")?.getAttribute("aria-hidden")).toBe("true");
    const announcer = fixture.nativeElement.querySelector<HTMLElement>(".app-feedback__announcer");
    expect(announcer?.getAttribute("role")).toBe("status");
    expect(announcer?.getAttribute("aria-live")).toBe("polite");
    expect(announcer?.getAttribute("aria-hidden")).toBeNull();
  });

  it("rechecks a visible message when focus or layout changes after it renders", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);
    service.show("Copied", { durationMs: 1_000 });
    fixture.detectChanges();

    const surface = fixture.nativeElement.querySelector<HTMLElement>(".app-feedback")!;
    const control = fixture.nativeElement.querySelector<HTMLButtonElement>(".safe-control")!;
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(0, 500, 320, 548));
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect(0, 420, 120, 450));
    control.focus();
    document.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await Promise.resolve();
    fixture.detectChanges();
    expect(surface.dataset.focusOverlap).toBeUndefined();

    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect(0, 510, 120, 540));
    window.dispatchEvent(new Event("resize"));
    await Promise.resolve();
    fixture.detectChanges();
    expect(surface.dataset.focusOverlap).toBe("true");
  });

  it("rechecks overlap from a non-bubbling nested scroll event", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);
    service.show("Copied", { durationMs: 1_000 });
    fixture.detectChanges();

    const surface = fixture.nativeElement.querySelector<HTMLElement>(".app-feedback")!;
    const control = fixture.nativeElement.querySelector<HTMLButtonElement>(".safe-control")!;
    const scroller = document.createElement("div");
    document.body.append(scroller);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(0, 500, 320, 548));
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect(0, 420, 120, 450));
    control.focus();
    document.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await Promise.resolve();
    fixture.detectChanges();
    expect(surface.dataset.focusOverlap).toBeUndefined();

    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect(0, 510, 120, 540));
    scroller.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
    fixture.detectChanges();

    expect(surface.dataset.focusOverlap).toBe("true");
    scroller.remove();
  });

  it("does not dismiss feedback when Escape is pressed", async () => {
    const fixture = await TestBed.configureTestingModule({
      imports: [FeedbackHostComponent],
      providers: [AppFeedbackService],
    }).createComponent(FeedbackHostComponent);
    fixture.detectChanges();
    const service = TestBed.inject(AppFeedbackService);
    service.show("Copied", { durationMs: 1_000 });
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(service.snapshot()).toMatchObject({ message: "Copied" });
  });

  it("keeps generator errors in its status store but announces successful generator copies", () => {
    const status = { setStatus: vi.fn() };
    const feedback = new AppFeedbackService();
    const adapter = new OfficialGeneratorToastAdapter(status, feedback);

    adapter.showToast({ message: "Unable to copy generated result", variant: "error" });
    expect(status.setStatus).toHaveBeenCalledWith("Unable to copy generated result");
    expect(feedback.snapshot()).toBeNull();

    adapter.showToast({ message: "Generated result copied", variant: "success" });
    expect(status.setStatus).toHaveBeenLastCalledWith("Generated result copied");
    expect(feedback.snapshot()).toMatchObject({ kind: "success", message: "Generated result copied" });
  });
});

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect;
}

function installInteractionCss(): () => void {
  const style = document.createElement("style");
  style.textContent = ["macos-tokens.css", "global.css"]
    .map((filename) => readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles", filename),
      "utf8",
    ))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    rootStyle.getPropertyValue(name).trim() || value,
  );
  return () => style.remove();
}
