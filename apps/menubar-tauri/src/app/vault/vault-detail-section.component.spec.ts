import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { VaultDetailSectionComponent } from "./vault-detail-section.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultDetailSectionComponent", () => {
  it("renders the official section header followed by a read-only cipher card", async () => {
    await TestBed.configureTestingModule({ imports: [VaultDetailSectionComponent] }).compileComponents();
    const fixture = TestBed.createComponent(VaultDetailSectionComponent);
    fixture.componentRef.setInput("title", "登录凭据");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const section = host.querySelector(".official-detail-section");
    const header = section?.querySelector(":scope > .bit-section-header");
    const card = section?.querySelector(":scope > .read-only-cipher-card");

    expect(header?.textContent).toContain("登录凭据");
    expect(header?.nextElementSibling).toBe(card);
  });
});
