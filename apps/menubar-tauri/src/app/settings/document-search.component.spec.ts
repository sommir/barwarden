import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { describe, expect, it, vi } from "vitest";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { DocumentSearchComponent } from "./document-search.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

describe("DocumentSearchComponent", () => {
  it("renders one search owner, live count, and 44px previous/next controls", async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentSearchComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    await TestBed.inject(OfficialI18nService).setLocale("en-US");

    const fixture = TestBed.createComponent(DocumentSearchComponent);
    fixture.componentRef.setInput("query", "mit");
    fixture.componentRef.setInput("matchCount", 3);
    fixture.componentRef.setInput("activeIndex", 1);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const search = host.querySelector<HTMLElement>(".document-search[role='search']");
    const input = host.querySelector<HTMLInputElement>("[data-testid='document-search-input']");
    const output = host.querySelector<HTMLOutputElement>("output[aria-live='polite']");
    const previous = host.querySelector<HTMLButtonElement>("[data-testid='document-search-previous']");
    const next = host.querySelector<HTMLButtonElement>("[data-testid='document-search-next']");
    expect(search).not.toBeNull();
    expect(input?.value).toBe("mit");
    expect(output?.textContent?.trim()).toBe("2/3");
    expect(previous?.getAttribute("aria-label")).toBe("Previous search result");
    expect(next?.getAttribute("aria-label")).toBe("Next search result");
    expect(previous?.classList).toContain("macos-hit-target");
    expect(next?.classList).toContain("macos-hit-target");

    const queryChange = vi.fn();
    fixture.componentInstance.queryChange.subscribe(queryChange);
    input!.value = "apache";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(queryChange).toHaveBeenCalledWith("apache");

    const previousEvent = vi.fn();
    const nextEvent = vi.fn();
    fixture.componentInstance.previous.subscribe(previousEvent);
    fixture.componentInstance.next.subscribe(nextEvent);
    previous!.click();
    next!.click();
    expect(previousEvent).toHaveBeenCalledOnce();
    expect(nextEvent).toHaveBeenCalledOnce();
  });
});
