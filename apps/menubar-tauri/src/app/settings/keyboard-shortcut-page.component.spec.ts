import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  GlobalShortcutBinding,
  GlobalShortcutHost,
  GlobalShortcutMutationOutcome,
  GlobalShortcutSnapshot,
} from "../../host/global-shortcut";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { GLOBAL_SHORTCUT_SETTINGS_HOST } from "./global-shortcut-settings.service";
import { KeyboardShortcutPageComponent } from "./keyboard-shortcut-page.component";

@Component({
  imports: [KeyboardShortcutPageComponent],
  template: `<bw-keyboard-shortcut-page />`,
})
class KeyboardShortcutPageTestHostComponent {}

const optionB = binding(["option"], "KeyB");
const optionL = binding(["option"], "KeyL");

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("KeyboardShortcutPageComponent", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.classList.remove("tw-bit-compact");
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.style.removeProperty("font-size");
    document.head.querySelectorAll("style[data-keyboard-shortcut-production-css]")
      .forEach((node) => node.remove());
  });

  it("renders the official page, current shortcut, and stable accessible controls", async () => {
    const { fixture, host } = await renderPage();
    const page = host.querySelector<HTMLElement>("bw-keyboard-shortcut-page");
    const recorder = shortcutRecorder(host);
    const surface = shortcutRecorderSurface(host);
    const clear = clearButton(host);

    expect(page).not.toBeNull();
    expect(page!.matches(".macos-page--settings-detail")).toBe(true);
    expect(host.querySelector("popup-page")).not.toBeNull();
    expect(host.querySelector("popup-header")?.textContent).toContain("快捷键");
    expect(host.querySelector("bit-card")).toBeNull();
    expect(host.querySelector("section.settings-detail-group.macos-preference-group"))
      .not.toBeNull();
    const row = host.querySelector<HTMLElement>("bit-form-field.macos-preference-row");
    expect(row).not.toBeNull();
    expect(host.textContent).toContain("唤出 Barwarden");
    expect(recorder.textContent).toContain("⌥ B");
    expect(recorder.getAttribute("aria-label")).toBe("录制唤出 Barwarden 快捷键");
    expect(clear.getAttribute("aria-label")).toBe("清除快捷键");
    expect(recorder.classList).toContain("macos-form-field__control");
    expect(recorder.classList).toContain("shortcut-recorder-owner");
    expect(surface.classList).toContain("macos-control-visible");
    expect(clear.classList).toContain("macos-form-field__suffix");
    expect(clear.classList).toContain("macos-hit-target");
    expect(clear.hasAttribute("bitSuffix")).toBe(true);
    expect(clear.getAttribute("slot")).toBeNull();
    expect(recorder.getAttribute("style")).toBeNull();
    expect(clear.getAttribute("style")).toBeNull();

    fixture.destroy();
  });

  it.each([
    ["normal", false],
    ["compact", true],
  ] as const)(
    "computes 44px recording and clear targets without collapsing the field in %s mode",
    async (_mode, compact) => {
      installProductionCss();
      document.documentElement.dataset["bwCompactMode"] = String(compact);
      document.body.classList.toggle("tw-bit-compact", compact);
      const { host } = await renderPage();
      const recorder = shortcutRecorder(host);
      const surface = shortcutRecorderSurface(host);
      const clear = clearButton(host);
      const fieldContainer = recorder.closest<HTMLElement>("[bitfieldcontainer]");
      const scrollRegion = host.querySelector<HTMLElement>(
        '[data-testid="popup-layout-scroll-region"]',
      );
      const group = host.querySelector<HTMLElement>(
        "section.settings-detail-group.macos-preference-group",
      );

      expect(fieldContainer).not.toBeNull();
      expect(scrollRegion).not.toBeNull();
      expect(group).not.toBeNull();
      expect(getComputedStyle(scrollRegion!).paddingInline).toBe("16px");
      expect(getComputedStyle(group!).marginLeft).toBe("0px");
      expect(getComputedStyle(group!).marginRight).toBe("0px");
      expect(resolvedMatchedProperty(group!, "margin-top")).toBe("16px");
      expect(resolvedMatchedProperty(group!, "margin-bottom")).toBe("16px");
      const recorderStyle = getComputedStyle(recorder);
      const surfaceStyle = getComputedStyle(surface);
      const clearStyle = getComputedStyle(clear);
      const row = host.querySelector<HTMLElement>("bit-form-field.macos-preference-row");

      expect(row).not.toBeNull();
      expect(Number.parseFloat(getComputedStyle(row!).minHeight)).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(row!).boxShadow).toBe("none");
      expect(Number.parseFloat(recorderStyle.minWidth)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(recorderStyle.minHeight)).toBeGreaterThanOrEqual(44);
      expect(recorderStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(surfaceStyle.height).toBe(compact ? "36px" : "40px");
      expect(surfaceStyle.minHeight).toBe(compact ? "36px" : "40px");
      expect(surfaceStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(Number.parseFloat(clearStyle.minWidth)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(clearStyle.minHeight)).toBeGreaterThanOrEqual(44);
      expect(recorderStyle.width).toBe("100%");
      expect(clearStyle.flexBasis).toBe("44px");
      expect(clearStyle.flexShrink).toBe("0");
      expect(clear.closest("[bitfieldcontainer]")).toBe(fieldContainer);
      expect(host.querySelectorAll('[aria-busy="true"] [role="progressbar"]').length)
        .toBeLessThanOrEqual(1);

      document.documentElement.style.fontSize = "200%";
      const label = host.querySelector<HTMLElement>("bit-label")!;
      const originalLabel = label.textContent;
      label.textContent = `${originalLabel} ${originalLabel} ${originalLabel}`;
      expect(getComputedStyle(row!).height).toBe("auto");
      expect(getComputedStyle(row!).overflow).toBe("visible");
      label.textContent = originalLabel;
      document.documentElement.style.removeProperty("font-size");

      recorder.dataset["testFocusVisible"] = "true";
      clear.dataset["testFocusVisible"] = "true";
      const focusedFieldContainerStyle = getComputedStyle(fieldContainer!);
      expect(getComputedStyle(recorder).outlineWidth).toBe("0px");
      expect(focusedFieldContainerStyle.outlineWidth).toBe("0px");
      expect(focusedFieldContainerStyle.outlineStyle).toBe("none");
      expect(focusedFieldContainerStyle.boxShadow).toBe("none");
      expect(getComputedStyle(surface).outlineWidth).toBe("2px");
      expect(getComputedStyle(surface).outlineStyle).toBe("solid");
      expect(getComputedStyle(clear).outlineWidth).toBe("2px");
      expect(getComputedStyle(clear).outlineStyle).toBe("solid");
    },
  );

  it("enters recording mode and waits on modifier-only keydown", async () => {
    const { fixture, host, shortcutHost } = await renderPage();
    const recorder = shortcutRecorder(host);

    recorder.click();
    fixture.detectChanges();
    expect(recorder.textContent).toContain("请按快捷键");
    expect(recorder.getAttribute("aria-label")).toContain("请按快捷键");
    expect(document.activeElement).toBe(recorder);

    document.activeElement?.dispatchEvent(keydown("AltLeft", { altKey: true }));
    fixture.detectChanges();

    expect(recorder.textContent).toContain("请按快捷键");
    expect(shortcutHost.setGlobalShortcut).not.toHaveBeenCalled();
  });

  it("submits and renders one different structured shortcut", async () => {
    const shortcutHost = new ShortcutHostFake();
    shortcutHost.setOutcome = outcome("updated", active(optionL));
    const { fixture, host } = await renderPage(shortcutHost);
    const recorder = shortcutRecorder(host);

    recorder.click();
    document.activeElement?.dispatchEvent(keydown("KeyL", { altKey: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shortcutHost.setGlobalShortcut).toHaveBeenCalledTimes(1);
    expect(shortcutHost.setGlobalShortcut).toHaveBeenCalledWith({
      modifiers: ["option"],
      code: "KeyL",
    });
    expect(recorder.textContent).toContain("⌥ L");
  });

  it("cancels recording with Escape without calling the host", async () => {
    const { fixture, host, shortcutHost } = await renderPage();
    const recorder = shortcutRecorder(host);

    recorder.click();
    fixture.detectChanges();
    recorder.dispatchEvent(keydown("Escape"));
    fixture.detectChanges();

    expect(shortcutHost.setGlobalShortcut).not.toHaveBeenCalled();
    expect(recorder.textContent).toContain("⌥ B");
  });

  it("shows inline validation for Shift-only input without calling the host", async () => {
    const { fixture, host, shortcutHost } = await renderPage();
    const recorder = shortcutRecorder(host);

    recorder.click();
    recorder.dispatchEvent(keydown("KeyL", { shiftKey: true }));
    fixture.detectChanges();

    expect(host.textContent).toContain("请输入有效的快捷键");
    expect(recorder.textContent).toContain("请按快捷键");
    expect(shortcutHost.setGlobalShortcut).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="shortcut-operation-alert"]')).toBeNull();
    expect(host.querySelector("bit-hint")).not.toBeNull();
  });

  it("clears once and renders the empty value", async () => {
    const shortcutHost = new ShortcutHostFake();
    shortcutHost.clearOutcome = outcome("updated", cleared());
    const { fixture, host } = await renderPage(shortcutHost);

    const clear = clearButton(host);
    expect(clear.getAttribute("aria-disabled")).toBeNull();
    clear.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shortcutHost.clearGlobalShortcut).toHaveBeenCalledTimes(1);
    expect(shortcutRecorder(host).textContent).toContain("未设置");
    expect(clear.getAttribute("aria-disabled")).toBe("true");
  });

  it("preserves the old display and shows a conflict after unavailable replacement", async () => {
    const shortcutHost = new ShortcutHostFake();
    shortcutHost.setOutcome = outcome("unavailable", active(optionB));
    const { fixture, host } = await renderPage(shortcutHost);
    const recorder = shortcutRecorder(host);

    recorder.click();
    recorder.dispatchEvent(keydown("KeyL", { metaKey: true, shiftKey: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shortcutHost.setGlobalShortcut).toHaveBeenCalledTimes(1);
    expect(recorder.textContent).toContain("⌥ B");
    expect(host.textContent).toContain("快捷键已被占用");
    expect(operationAlert(host)?.getAttribute("data-kind")).toBe("warning");
    expect(liveRegions(host)).toHaveLength(1);
  });

  it("shows an unavailable startup snapshot without discarding its binding", async () => {
    const shortcutHost = new ShortcutHostFake();
    shortcutHost.snapshotValue = unavailable(optionB);
    const { host } = await renderPage(shortcutHost);

    expect(shortcutRecorder(host).textContent).toContain("⌥ B");
    expect(host.textContent).toContain("快捷键已被占用");
    expect(operationAlert(host)?.getAttribute("role")).toBe("status");
    expect(liveRegions(host)).toHaveLength(1);
  });

  it("preserves the old display and shows a generic failure message", async () => {
    const shortcutHost = new ShortcutHostFake();
    shortcutHost.setOutcome = outcome("failed", active(optionB));
    const { fixture, host } = await renderPage(shortcutHost);
    const recorder = shortcutRecorder(host);

    recorder.click();
    document.activeElement?.dispatchEvent(keydown("KeyL", { altKey: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shortcutHost.setGlobalShortcut).toHaveBeenCalledWith(optionL);
    expect(recorder.textContent).toContain("⌥ B");
    expect(host.textContent).toContain("无法更新快捷键，请重试。");
    expect(operationAlert(host)?.getAttribute("role")).toBe("alert");
    expect(host.querySelector("bit-hint")).toBeNull();
    expect(liveRegions(host)).toHaveLength(1);

    shortcutHost.setOutcome = outcome("updated", active(optionL));
    retryButton(host).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shortcutHost.setGlobalShortcut).toHaveBeenCalledTimes(2);
    expect(shortcutHost.setGlobalShortcut).toHaveBeenLastCalledWith(optionL);
    expect(operationAlert(host)).toBeNull();
    expect(recorder.textContent).toContain("⌥ L");
  });

  it("renders a native load failure through one shared alert and retries it", async () => {
    const shortcutHost = new ShortcutHostFake();
    shortcutHost.getGlobalShortcut
      .mockRejectedValueOnce(new Error("private native detail"))
      .mockResolvedValueOnce(active(optionB));
    const { fixture, host } = await renderPage(shortcutHost);

    expect(host.textContent).toContain("无法更新快捷键，请重试。");
    expect(operationAlert(host)?.getAttribute("role")).toBe("alert");
    expect(liveRegions(host)).toHaveLength(1);

    retryButton(host).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shortcutHost.getGlobalShortcut).toHaveBeenCalledTimes(2);
    expect(operationAlert(host)).toBeNull();
  });

  it("disables recorder and clear controls while a replacement is pending", async () => {
    const shortcutHost = new ShortcutHostFake();
    const pending = deferred<GlobalShortcutMutationOutcome>();
    shortcutHost.setGlobalShortcut.mockImplementationOnce(async () => pending.promise);
    const { fixture, host } = await renderPage(shortcutHost);
    const recorder = shortcutRecorder(host);
    const clear = clearButton(host);

    recorder.click();
    document.activeElement?.dispatchEvent(keydown("KeyL", { altKey: true }));
    await Promise.resolve();
    fixture.detectChanges();

    expect(recorder.getAttribute("aria-disabled")).toBe("true");
    expect(clear.getAttribute("aria-disabled")).toBe("true");

    pending.resolve(outcome("updated", active(optionL)));
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(recorder.getAttribute("aria-disabled")).toBeNull();
    expect(clear.getAttribute("aria-disabled")).toBeNull();
    expect(recorder.textContent).toContain("⌥ L");
  });
});

async function renderPage(shortcutHost = new ShortcutHostFake()) {
  await TestBed.configureTestingModule({
    imports: [KeyboardShortcutPageTestHostComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: GLOBAL_SHORTCUT_SETTINGS_HOST, useValue: shortcutHost },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(KeyboardShortcutPageTestHostComponent);
  document.body.append(fixture.nativeElement as HTMLElement);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    shortcutHost,
  };
}

function shortcutRecorder(host: HTMLElement): HTMLButtonElement {
  const recorder = host.querySelector<HTMLButtonElement>(
    '[data-testid="shortcut-recorder"]',
  );
  expect(recorder).not.toBeNull();
  return recorder!;
}

function shortcutRecorderSurface(host: HTMLElement): HTMLElement {
  const surface = host.querySelector<HTMLElement>(
    '[data-testid="shortcut-recorder-surface"]',
  );
  expect(surface).not.toBeNull();
  return surface!;
}

function clearButton(host: HTMLElement): HTMLButtonElement {
  const clear = host.querySelector<HTMLButtonElement>('[data-testid="shortcut-clear"]');
  expect(clear).not.toBeNull();
  return clear!;
}

function operationAlert(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-testid="shortcut-operation-alert"]');
}

function retryButton(host: HTMLElement): HTMLButtonElement {
  const retry = host.querySelector<HTMLButtonElement>('[data-testid="shortcut-retry"]');
  expect(retry).not.toBeNull();
  return retry!;
}

function liveRegions(host: HTMLElement): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>("[role='alert'], [role='status'], [aria-live]"),
  );
}

function keydown(
  code: string,
  modifiers: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> = {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  },
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code,
    ...modifiers,
  });
}

class ShortcutHostFake implements GlobalShortcutHost {
  snapshotValue: GlobalShortcutSnapshot = active(optionB);
  setOutcome: GlobalShortcutMutationOutcome = outcome("updated", active(optionB));
  clearOutcome: GlobalShortcutMutationOutcome = outcome("updated", cleared());

  readonly getGlobalShortcut = vi.fn(async () => this.snapshotValue);
  readonly setGlobalShortcut = vi.fn(async (_shortcut: GlobalShortcutBinding) => this.setOutcome);
  readonly clearGlobalShortcut = vi.fn(async () => this.clearOutcome);
}

function binding(
  modifiers: GlobalShortcutBinding["modifiers"],
  code: string,
): GlobalShortcutBinding {
  return { modifiers, code };
}

function active(shortcut: GlobalShortcutBinding): GlobalShortcutSnapshot {
  return { shortcut, availability: "active" };
}

function cleared(): GlobalShortcutSnapshot {
  return { shortcut: null, availability: "cleared" };
}

function unavailable(shortcut: GlobalShortcutBinding): GlobalShortcutSnapshot {
  return { shortcut, availability: "unavailable" };
}

function outcome(
  status: GlobalShortcutMutationOutcome["status"],
  snapshot: GlobalShortcutSnapshot,
): GlobalShortcutMutationOutcome {
  return { status, snapshot };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function installProductionCss(): void {
  const source = [
    "macos-tokens.css",
    "macos-motion.css",
    "macos-materials.css",
    "global.css",
  ]
    .map((filename) =>
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/styles", filename),
        "utf8",
      ),
    )
    .join("\n");
  const root = postcss.parse(source);
  root.walkAtRules("import", (rule) => rule.remove());
  root.walkAtRules("media", (rule) => rule.remove());
  root.walkAtRules("starting-style", (rule) => rule.remove());

  const style = document.createElement("style");
  style.dataset["keyboardShortcutProductionCss"] = "true";
  style.textContent = `
.shortcut-recorder__surface {
  height: 18px;
  min-height: 18px;
  background: transparent;
}
${root.toString()}`
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (reference, name) =>
    resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || reference,
  );
}

function resolveCustomProperty(
  value: string,
  rootStyle: CSSStyleDeclaration,
  seen: Set<string>,
): string {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, name) => {
    if (seen.has(name)) {
      return reference;
    }
    const next = rootStyle.getPropertyValue(name).trim();
    return next
      ? resolveCustomProperty(next, rootStyle, new Set([...seen, name]))
      : reference;
  });
}

function resolvedMatchedProperty(element: Element, property: string): string {
  let resolved = "";
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const value = rule.style.getPropertyValue(property).trim();
      if (!value) continue;
      const matches = rule.selectorText.split(",").some((selector) => {
        try {
          return element.matches(selector.trim());
        } catch {
          return false;
        }
      });
      if (matches) resolved = value;
    }
  }
  return resolved;
}
