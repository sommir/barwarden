import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { OfficialColorPasswordComponent } from "./official-color-password.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialColorPasswordComponent", () => {
  it("retains official color and count DOM without owning clipboard writes", () => {
    TestBed.configureTestingModule({ imports: [OfficialColorPasswordComponent] });
    const fixture = TestBed.createComponent(OfficialColorPasswordComponent);
    fixture.componentRef.setInput("password", "a1!");
    fixture.componentRef.setInput("showCount", true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect([...host.querySelectorAll("[data-password-character]")].map((node) => node.textContent?.trim()))
      .toEqual(["a1", "12", "!3"]);

    const copy = new Event("copy", { bubbles: true, cancelable: true });
    host.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
  });
});
