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
      const scrollRegion = host.querySelector<HTMLElement>(
        '[data-testid="popup-layout-scroll-region"]',
      );
      expect(scrollRegion).not.toBeNull();
      expect(getComputedStyle(scrollRegion!).paddingInline).toBe("16px");
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
      const paint = paintedPseudoGeometry(action!);
      expect(paint.ownerHeight).toBe(44);
      expect(paint.insetBlock).toBe(compact ? 4 : 2);
      expect(paint.visibleHeight).toBe(Number.parseFloat(visibleHeight));
      expect(getComputedStyle(action!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(paint.normalFill).not.toBe("rgba(0, 0, 0, 0)");
      action!.dataset["testHover"] = "true";
      expect(getComputedStyle(action!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      const hoverPaint = paintedPseudoGeometry(action!);
      expect(hoverPaint.hoverFill).not.toBe("rgba(0, 0, 0, 0)");
      expect(hoverPaint.hoverFill).not.toBe(hoverPaint.normalFill);
      delete action!.dataset["testHover"];
      expect(getComputedStyle(group!).marginLeft).toBe("0px");
      expect(getComputedStyle(group!).marginRight).toBe("0px");
      expect(resolvedMatchedProperty(group!, "margin-top")).toBe("16px");
      expect(resolvedMatchedProperty(group!, "margin-bottom")).toBe("16px");
      expect(Number.parseFloat(getComputedStyle(group!).paddingLeft) || 0).toBe(0);
      expect(Number.parseFloat(getComputedStyle(group!).paddingRight) || 0).toBe(0);
      expect(getComputedStyle(group!).paddingTop).toBe("12px");
      expect(getComputedStyle(group!).paddingBottom).toBe("12px");
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
  ).replace(/:hover/g, '[data-test-hover="true"]');
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

function paintedPseudoGeometry(owner: HTMLElement): {
  ownerHeight: number;
  insetBlock: number;
  visibleHeight: number;
  normalFill: string;
  hoverFill: string;
} {
  const ownerHeight = Number.parseFloat(getComputedStyle(owner).minHeight);
  let activeInsetBlock: string | null = null;
  let normalFill = "";
  let hoverFill = "";
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const insetBlock = rule.style.getPropertyValue("inset-block").trim();
      const fill = rule.style.backgroundColor || rule.style.background;
      const matchingSelectors = rule.selectorText.split(",").filter((selector) => {
        const ownerSelector = selector.trim().replace(/::before$/, "");
        if (ownerSelector === selector.trim()) return false;
        try {
          return owner.matches(ownerSelector);
        } catch {
          return false;
        }
      });
      if (matchingSelectors.length === 0) continue;
      if (insetBlock) activeInsetBlock = insetBlock;
      if (fill) {
        const hoverRule = matchingSelectors.some((selector) =>
          selector.includes('[data-test-hover="true"]')
        );
        if (hoverRule) hoverFill = fill;
        else normalFill = fill;
      }
    }
  }
  expect(activeInsetBlock, "the real painted ::before layer must own an inset").not.toBeNull();
  expect(normalFill, "the real painted ::before layer must own the normal fill").not.toBe("");
  const insetBlock = Number.parseFloat(activeInsetBlock!);
  return {
    ownerHeight,
    insetBlock,
    visibleHeight: ownerHeight - (insetBlock * 2),
    normalFill,
    hoverFill,
  };
}
