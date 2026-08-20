import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { VaultFilterChipComponent } from "./vault-filter-chip.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultFilterChipComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    });
  });

  it("adapts filter data through the direct official chip-filter primitive", async () => {
    await TestBed.configureTestingModule({ imports: [VaultFilterChipComponent] }).compileComponents();
    const fixture = TestBed.createComponent(VaultFilterChipComponent);
    fixture.componentRef.setInput("label", "类型");
    fixture.componentRef.setInput("icon", "bwi-list");
    fixture.componentRef.setInput("options", [{ id: "login", label: "登录", icon: "bwi-globe" }]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bit-chip-filter")).not.toBeNull();
    expect(host.querySelector("div.bit-chip-filter")).toBeNull();
  });

  it("closes its menu on Escape and returns focus to the trigger", async () => {
    await TestBed.configureTestingModule({ imports: [VaultFilterChipComponent] }).compileComponents();
    const fixture = TestBed.createComponent(VaultFilterChipComponent);
    fixture.componentRef.setInput("label", "类型");
    fixture.componentRef.setInput("icon", "bwi-list");
    fixture.componentRef.setInput("options", [{ id: "login", label: "登录" }]);
    fixture.detectChanges();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('bit-chip-filter button[title="类型"]')!;
    trigger.click();
    fixture.detectChanges();

    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 170));
    fixture.detectChanges();

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
