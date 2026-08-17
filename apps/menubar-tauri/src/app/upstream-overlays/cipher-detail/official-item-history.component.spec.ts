import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { demoVaultItems } from "../../vault-demo";
import { projectLoginDetail } from "../../vault/login-cipher-view.adapter";
import { OfficialItemHistoryComponent } from "./official-item-history.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialItemHistoryComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialItemHistoryComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
  });

  it("uses the exact detail history focus-return key on real history navigation", () => {
    const fixture = TestBed.createComponent(OfficialItemHistoryComponent);
    const cipher = projectLoginDetail({
      ...demoVaultItems[0]!,
      passwordHistory: [{ password: "old-secret", lastUsedDate: "2026-06-01T00:00:00.000Z" }],
    }).cipher;
    fixture.componentRef.setInput("cipher", cipher);
    fixture.detectChanges();

    const historyButton = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("button")!;
    expect(historyButton).not.toBeNull();
    expect(historyButton.getAttribute("data-popup-focus-key")).toBe(`detail-history:${cipher.id}`);
  });
});
