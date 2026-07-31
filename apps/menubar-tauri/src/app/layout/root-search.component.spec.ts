import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { RootSearchComponent } from "./root-search.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("RootSearchComponent", () => {
  it("emits the shared native search value", async () => {
    await TestBed.configureTestingModule({
      imports: [RootSearchComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(RootSearchComponent);
    fixture.componentRef.setInput("searchAriaLabel", "搜索密码库");
    fixture.componentRef.setInput("query", "");
    const queryChange = vi.fn();
    fixture.componentInstance.queryChange.subscribe(queryChange);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;

    expect(input.getAttribute("aria-label")).toBe("搜索密码库");
    input.value = "github";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(queryChange).toHaveBeenCalledWith("github");
  });
});
