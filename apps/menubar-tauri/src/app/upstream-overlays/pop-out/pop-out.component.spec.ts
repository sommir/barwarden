import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { PopOutComponent } from "./pop-out.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("official PopOutComponent native location integration", () => {
  it("hides the official pop-out action for a marked native popout without changing main routes", async () => {
    window.history.replaceState({}, "", "/?uilocation=popout#/tabs/settings");
    await TestBed.configureTestingModule({ imports: [PopOutComponent] }).compileComponents();
    const popoutFixture = TestBed.createComponent(PopOutComponent);
    popoutFixture.detectChanges();
    await popoutFixture.whenStable();
    popoutFixture.detectChanges();
    expect((popoutFixture.nativeElement as HTMLElement).querySelector("button")).toBeNull();

    window.history.replaceState({}, "", "/?vaultEvidence=populated#/tabs/settings");
    const mainFixture = TestBed.createComponent(PopOutComponent);
    mainFixture.detectChanges();
    await mainFixture.whenStable();
    mainFixture.detectChanges();
    expect((mainFixture.nativeElement as HTMLElement).querySelector("button")).not.toBeNull();
    expect(window.location.hash).toBe("#/tabs/settings");
  });
});
