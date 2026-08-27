import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { demoVaultItems } from "../../vault-demo";
import { toRetainedPopupCipherView } from "../../vault/popup-cipher-view.adapter";
import { ItemMoreOptionsComponent } from "./item-more-options.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("ItemMoreOptionsComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ItemMoreOptionsComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    document.querySelectorAll(".bit-menu-panel").forEach((node) => node.remove());
  });

  it("assigns the vault item key only to View, Edit, and Clone navigation", () => {
    const fixture = TestBed.createComponent(ItemMoreOptionsComponent);
    fixture.componentRef.setInput("cipher", toRetainedPopupCipherView(demoVaultItems[0]!));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click();
    fixture.detectChanges();

    const menuItems = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']"));
    const keyedLabels = menuItems
      .filter((item) => item.hasAttribute("data-popup-focus-key"))
      .map((item) => item.textContent?.trim());
    expect(keyedLabels).toEqual(["查看", "编辑", "克隆"]);
    for (const item of menuItems) {
      const label = item.textContent?.trim();
      expect(item.getAttribute("data-popup-focus-key"))
        .toBe(["查看", "编辑", "克隆"].includes(label ?? "") ? "vault-item:github" : null);
    }

    fixture.destroy();
  });
});
