import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { VaultFormSectionComponent } from "./vault-form-section.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultFormSectionComponent", () => {
  it("renders an official section header followed by a cipher form card", async () => {
    await TestBed.configureTestingModule({ imports: [VaultFormSectionComponent] }).compileComponents();
    const fixture = TestBed.createComponent(VaultFormSectionComponent);
    fixture.componentRef.setInput("title", "登录凭据");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const section = host.querySelector(".official-form-section");
    const header = section?.querySelector(":scope > .official-form-section-header");
    const card = section?.querySelector(":scope > .cipher-form-card");

    expect(header?.querySelector("h2")?.textContent).toContain("登录凭据");
    expect(header?.nextElementSibling).toBe(card);
  });
});
