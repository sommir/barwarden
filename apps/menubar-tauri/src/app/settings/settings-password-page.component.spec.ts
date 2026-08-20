import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { EnvironmentHandoffService } from "./environment-handoff.service";
import { SettingsPasswordPageComponent } from "./settings-password-page.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("SettingsPasswordPageComponent", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-bw-compact-mode");
    document.documentElement.style.removeProperty("font-size");
    document.head.querySelectorAll('style[data-test-owner="settings-password-preferences"]')
      .forEach((node) => node.remove());
  });

  it.each([
    ["normal", false, "40px"],
    ["compact", true, "36px"],
  ] as const)(
    "renders the real password handoff as a 44px owner with a %s visible fill",
    async (_mode, compact, visibleHeight) => {
      const openWebVault = vi.fn(async () => undefined);
      await TestBed.configureTestingModule({
        imports: [SettingsPasswordPageComponent],
        providers: [
          provideRouter([]),
          OfficialI18nService,
          { provide: I18nService, useExisting: OfficialI18nService },
          { provide: EnvironmentHandoffService, useValue: { openWebVault } },
        ],
      }).compileComponents();

      document.documentElement.dataset["bwCompactMode"] = String(compact);
      const fixture = TestBed.createComponent(SettingsPasswordPageComponent);
      fixture.detectChanges();
      installPreferenceCss();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.matches(".macos-page--settings-detail")).toBe(true);
      const group = host.querySelector<HTMLElement>(
        "section.settings-password-handoff.macos-preference-group",
      );
      expect(group).not.toBeNull();
      const row = group!.querySelector<HTMLElement>(":scope > .macos-preference-row");
      expect(row).not.toBeNull();
      expect(Number.parseFloat(getComputedStyle(row!).minHeight)).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(row!).boxShadow).toBe("none");
      const action = row!.querySelector<HTMLButtonElement>(
        "button.web-vault-action.macos-button-owner",
      );
      expect(action).not.toBeNull();
      expect(Number.parseFloat(getComputedStyle(action!).minHeight)).toBeGreaterThanOrEqual(44);
      const activeVisibleToken = compact
        ? "--mac-control-visible-compact"
        : "--mac-control-visible";
      expect(getComputedStyle(action!).getPropertyValue(activeVisibleToken).trim())
        .toBe(visibleHeight);
      expect(host.querySelectorAll('[aria-busy="true"] [role="progressbar"]').length)
        .toBeLessThanOrEqual(1);

      document.documentElement.style.fontSize = "200%";
      const copy = row!.querySelector<HTMLElement>(".empty-inline")!;
      const originalCopy = copy.textContent;
      copy.textContent = `${originalCopy} ${originalCopy} ${originalCopy}`;
      expect(getComputedStyle(row!).height).toBe("auto");
      expect(getComputedStyle(copy).whiteSpace).not.toBe("nowrap");
      copy.textContent = originalCopy;

      action!.click();
      await fixture.whenStable();
      expect(openWebVault).toHaveBeenCalledWith("/#/settings/security/password");
    },
  );
});

function installPreferenceCss(): void {
  const style = document.createElement("style");
  style.dataset["testOwner"] = "settings-password-preferences";
  style.textContent = ["macos-tokens.css", "macos-motion.css", "global.css"]
    .map((file) => readFileSync(resolve(
      process.cwd(),
      "apps/menubar-tauri/src/styles",
      file,
    ), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
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
    if (seen.has(name)) return reference;
    const next = rootStyle.getPropertyValue(name).trim();
    return next
      ? resolveCustomProperty(next, rootStyle, new Set([...seen, name]))
      : reference;
  });
}
