import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { MacosAlertStripComponent } from "./macos-alert-strip.component";
import { CalloutCompatibilityComponent } from "./callout-compatibility.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("MacosAlertStripComponent", () => {
  it("keeps contextual failures inline while preserving assertive announcement", async () => {
    await TestBed.configureTestingModule({
      imports: [MacosAlertStripComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MacosAlertStripComponent);
    fixture.componentRef.setInput("kind", "danger");
    fixture.componentRef.setInput("title", "无法同步");
    fixture.componentRef.setInput("message", "请检查网络连接后重试。");
    fixture.componentRef.setInput("actionLabel", "重试");
    const action = vi.fn();
    fixture.componentInstance.action.subscribe(action);
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;

    expect(strip.getAttribute("role")).toBe("alert");
    expect(strip.getAttribute("aria-live")).toBeNull();
    expect(strip.dataset["kind"]).toBe("danger");
    expect(strip.dataset["presentation"]).toBe("inline");
    expect(strip.querySelector(".bwi-error")).not.toBeNull();
    expect(strip.querySelector(".macos-alert-strip__title")?.textContent).toContain("无法同步");
    expect(strip.querySelector(".macos-alert-strip__message")?.textContent)
      .toContain("请检查网络连接后重试。");

    strip.querySelector<HTMLButtonElement>("button")!.click();
    expect(action).toHaveBeenCalledOnce();
  });

  it("renders an explicitly requested global message as a toast", async () => {
    await TestBed.configureTestingModule({
      imports: [MacosAlertStripComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MacosAlertStripComponent);
    fixture.componentRef.setInput("kind", "info");
    fixture.componentRef.setInput("presentation", "toast");
    fixture.componentRef.setInput("message", "已恢复连接。");
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;

    expect(strip.dataset["presentation"]).toBe("toast");
    expect(strip.getAttribute("role")).toBe("status");
    expect(strip.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps real inline and toast action and dismiss targets at least 44px", async () => {
    const cleanupCss = installInteractionCss();
    await TestBed.configureTestingModule({
      imports: [MacosAlertStripComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MacosAlertStripComponent);
    fixture.componentRef.setInput("kind", "info");
    fixture.componentRef.setInput("actionLabel", "Retry");
    fixture.componentRef.setInput("dismissible", true);

    try {
      for (const presentation of ["inline", "toast"] as const) {
        fixture.componentRef.setInput("presentation", presentation);
        fixture.detectChanges();
        const action = fixture.nativeElement.querySelector<HTMLElement>(
          ".macos-alert-strip__action",
        )!;
        const dismiss = fixture.nativeElement.querySelector<HTMLElement>(
          ".macos-alert-strip__dismiss",
        )!;
        expect([
          getComputedStyle(action).minWidth,
          getComputedStyle(action).minHeight,
          getComputedStyle(dismiss).minWidth,
          getComputedStyle(dismiss).minHeight,
        ], presentation).toEqual(["44px", "44px", "44px", "44px"]);
      }
    } finally {
      fixture.destroy();
      cleanupCss();
    }
  });

  it("uses polite status semantics for informational strips", async () => {
    await TestBed.configureTestingModule({
      imports: [MacosAlertStripComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MacosAlertStripComponent);
    fixture.componentRef.setInput("kind", "info");
    fixture.componentRef.setInput("title", "Send 已禁用");
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;

    expect(strip.getAttribute("role")).toBe("status");
    expect(strip.getAttribute("aria-live")).toBe("polite");
    expect(strip.dataset["presentation"]).toBe("inline");
    expect(strip.querySelector("button")).toBeNull();
  });

  it.each([
    ["danger", "alert", null],
    ["warning", "status", "polite"],
    ["info", "status", "polite"],
    ["success", "status", "polite"],
    ["subtle", "status", "polite"],
  ] as const)("maps visual %s to the default %s announcement", async (kind, role, live) => {
    await TestBed.configureTestingModule({
      imports: [MacosAlertStripComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MacosAlertStripComponent);
    fixture.componentRef.setInput("kind", kind);
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;

    expect(strip.dataset["kind"]).toBe(kind);
    expect(strip.getAttribute("role")).toBe(role);
    expect(strip.getAttribute("aria-live")).toBe(live);
  });

  it("allows an immediate recovery warning to explicitly elevate its announcement", async () => {
    await TestBed.configureTestingModule({
      imports: [MacosAlertStripComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MacosAlertStripComponent);
    fixture.componentRef.setInput("kind", "warning");
    fixture.componentRef.setInput("urgency", "assertive");
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;

    expect(strip.getAttribute("role")).toBe("alert");
    expect(strip.getAttribute("aria-live")).toBeNull();
  });

  it("exposes exactly one live region even when projected upstream content owns status semantics", async () => {
    @Component({
      standalone: true,
      imports: [MacosAlertStripComponent],
      template: `
        <bw-macos-alert-strip kind="danger">
          <p role="alert" aria-live="assertive">首个错误</p>
          <p role="status" aria-live="polite" aria-atomic="true">恢复状态</p>
        </bw-macos-alert-strip>
      `,
    })
    class NestedLiveRegionsHost {}

    await TestBed.configureTestingModule({ imports: [NestedLiveRegionsHost] }).compileComponents();
    const fixture = TestBed.createComponent(NestedLiveRegionsHost);
    fixture.detectChanges();
    const liveRegions = fixture.nativeElement.querySelectorAll(
      "[role='alert'], [role='status'], [aria-live]",
    );

    expect(liveRegions).toHaveLength(1);
    expect(liveRegions[0].classList).toContain("macos-alert-strip");
  });

  it("keeps the retained callout defaults, subtle type, icon opt-out, and dismiss contract", async () => {
    await TestBed.configureTestingModule({
      imports: [CalloutCompatibilityComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(CalloutCompatibilityComponent);
    fixture.componentRef.setInput("type", "subtle");
    fixture.componentRef.setInput("icon", null);
    const dismissed = vi.fn();
    fixture.componentInstance.dismiss.subscribe(dismissed);
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;

    expect(strip.dataset["kind"]).toBe("subtle");
    expect(strip.getAttribute("role")).toBeNull();
    expect(strip.getAttribute("aria-label")).toMatch(/通知 \d+[,，] subtle/);
    expect(strip.querySelector(".macos-alert-strip__icon")).toBeNull();
    strip.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click();
    expect(dismissed).toHaveBeenCalledOnce();
  });

  it("does not offer a dead close control when a retained callout has no dismiss owner", async () => {
    await TestBed.configureTestingModule({
      imports: [CalloutCompatibilityComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(CalloutCompatibilityComponent);
    fixture.componentRef.setInput("type", "danger");
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="关闭"]')).toBeNull();
  });

  it("normalizes projected app-error copy to the shared compact typography", async () => {
    @Component({
      standalone: true,
      imports: [CalloutCompatibilityComponent],
      template: `
        <bit-callout type="danger">
          <p class="upstream-error-copy">无法解锁。请重试。</p>
        </bit-callout>
      `,
    })
    class ProjectedErrorCopyHost {}

    const styles = document.createElement("style");
    styles.textContent = `
      .upstream-error-copy { font-size: 18px; font-weight: 700; line-height: 1.8; }
      .\\!tw-text-base { font-size: 16px !important; font-weight: 700 !important; line-height: 1.5 !important; }
      ${readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
        "utf8",
      )}
    `;
    document.head.append(styles);
    try {
      await TestBed.configureTestingModule({ imports: [ProjectedErrorCopyHost] })
        .compileComponents();
      const fixture = TestBed.createComponent(ProjectedErrorCopyHost);
      fixture.detectChanges();
      const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;
      const title = strip.querySelector<HTMLElement>(".macos-alert-strip__title")!;
      const copy = strip.querySelector<HTMLElement>(".upstream-error-copy")!;

      copy.classList.add("!tw-text-base");
      expect(getComputedStyle(title).fontSize).toBe("14px");
      expect(getComputedStyle(copy).fontSize).toBe("13px");
      expect(getComputedStyle(copy).fontWeight).toBe("450");
      expect(getComputedStyle(copy).lineHeight).toBe("1.45");
    } finally {
      styles.remove();
    }
  });

  it("preserves title-first typography for projected toast content", async () => {
    @Component({
      standalone: true,
      imports: [MacosAlertStripComponent],
      template: `
        <bw-macos-alert-strip kind="danger" presentation="toast" title="同步失败">
          <p class="upstream-toast-copy" bitTypography="body1">请检查网络连接后重试。</p>
        </bw-macos-alert-strip>
      `,
    })
    class ProjectedToastHost {}

    const styles = document.createElement("style");
    styles.textContent = `
      .upstream-toast-copy { font-size: 18px; font-weight: 700; line-height: 1.8; }
      .\\!tw-text-base { font-size: 16px !important; font-weight: 700 !important; line-height: 1.5 !important; }
      ${readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
        "utf8",
      )}
    `;
    document.head.append(styles);
    try {
      await TestBed.configureTestingModule({ imports: [ProjectedToastHost] }).compileComponents();
      const fixture = TestBed.createComponent(ProjectedToastHost);
      fixture.detectChanges();
      const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;
      const title = strip.querySelector<HTMLElement>(".macos-alert-strip__title")!;
      const copy = strip.querySelector<HTMLElement>(".upstream-toast-copy")!;

      copy.classList.add("!tw-text-base");
      expect(getComputedStyle(title).fontSize).toBe("14px");
      expect(getComputedStyle(copy).fontSize).toBe("13px");
      expect(getComputedStyle(copy).fontWeight).toBe("450");
      expect(getComputedStyle(copy).lineHeight).toBe("1.45");
    } finally {
      styles.remove();
    }
  });

  it("preserves retained title and end slots without inventing a live region", async () => {
    @Component({
      standalone: true,
      imports: [CalloutCompatibilityComponent],
      template: `
        <bit-callout type="info">
          <span slot="title">投影标题</span>
          <p>正文</p>
          <button slot="end" type="button">操作</button>
        </bit-callout>
      `,
    })
    class SlottedCalloutHost {}

    await TestBed.configureTestingModule({ imports: [SlottedCalloutHost] }).compileComponents();
    const fixture = TestBed.createComponent(SlottedCalloutHost);
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector<HTMLElement>(".macos-alert-strip")!;

    expect(strip.querySelector(".macos-alert-strip__title")?.textContent).toContain("投影标题");
    expect(strip.querySelector(".macos-alert-strip__message")?.textContent).toContain("正文");
    expect(strip.querySelector(".macos-alert-strip__end button")?.textContent).toContain("操作");
    expect(strip.querySelectorAll("[role='alert'], [role='status'], [aria-live]")).toHaveLength(0);
  });

  it("keeps every reachable app-level failure surface on the shared alert pattern", () => {
    const sources = [
      "upstream-overlays/auth/login/official-password-login.component.html",
      "upstream-overlays/auth/two-factor/official-two-factor.component.html",
      "upstream-overlays/auth/new-device/official-new-device-verification.component.html",
      "upstream-overlays/auth/lock/official-lock.component.html",
      "upstream-overlays/auth/lock/official-master-password-lock.component.html",
      "upstream-overlays/auth/account-switching/official-account-switcher.component.html",
      "upstream-overlays/settings/official-vault-settings.component.html",
      "upstream-overlays/settings/official-account-security.component.html",
      "settings/settings-password-page.component.ts",
      "upstream-overlays/generator/official-generator-history.component.html",
      "upstream-overlays/send/official-send-add-edit.component.html",
      "upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.html",
      "vault/vault-list-page.component.ts",
      "upstream-overlays/settings/official-about.component.html",
      "upstream-overlays/settings/official-about-dialog.component.html",
    ];

    for (const source of sources) {
      const contents = readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/app", source),
        "utf8",
      );
      expect(contents, source).toMatch(/<(?:bw-macos-alert-strip|bit-callout)\b/);
    }
    const officialComponents = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/official-ui/official-components.ts"),
      "utf8",
    );
    expect(officialComponents).toContain(
      'export { CalloutCompatibilityComponent as CalloutComponent } from "./callout-compatibility.component";',
    );
  });
});

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
