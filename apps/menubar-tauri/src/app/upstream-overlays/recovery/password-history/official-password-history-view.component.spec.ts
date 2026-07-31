import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { projectLoginDetail } from "../../../vault/login-cipher-view.adapter";
import type { VaultItem } from "../../../vault/vault-item.model";
import { OfficialPasswordHistoryViewComponent } from "./official-password-history-view.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialPasswordHistoryViewComponent", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("retains the official password-history row hierarchy and emits only the selected copy request", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialPasswordHistoryViewComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialPasswordHistoryViewComponent);
    const requests: unknown[] = [];
    fixture.componentInstance.copyPassword.subscribe((request) => requests.push(request));
    fixture.componentRef.setInput("cipher", projectLoginDetail(loginItem()).cipher);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bit-item bit-color-password")).not.toBeNull();
    expect(host.querySelector("[appCopyClick]")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")).not.toBeNull();

    host.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!.click();
    expect(requests).toEqual([
      {
        cipherId: "login-1",
        password: "old-secret-1",
        lastUsedDate: new Date("2026-07-11T08:09:10.000Z"),
      },
    ]);
  });

  it("keeps an empty official state and falls back for invalid history dates", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialPasswordHistoryViewComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialPasswordHistoryViewComponent);
    fixture.componentRef.setInput("cipher", projectLoginDetail({
      ...loginItem(),
      passwordHistory: [{ password: "old-secret-1", lastUsedDate: "not-a-date" }],
    }).cipher);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("[data-testid='history-date-0']")?.textContent?.trim()).toBe("日期不可用");

    fixture.componentRef.setInput("cipher", projectLoginDetail({ ...loginItem(), passwordHistory: [] }).cipher);
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(host.textContent).toContain("列表中没有密码");
  });
});

function loginItem(): VaultItem {
  return {
    id: "login-1",
    type: "login",
    name: "Example Login",
    subtitle: "",
    favorite: false,
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [],
    createdDate: "2026-07-01T00:00:00.000Z",
    revisionDate: "2026-07-01T00:00:00.000Z",
    passwordHistory: [{ password: "old-secret-1", lastUsedDate: "2026-07-11T08:09:10.000Z" }],
    notes: "",
    canLaunch: false,
    canFill: false,
    uri: "",
  };
}
