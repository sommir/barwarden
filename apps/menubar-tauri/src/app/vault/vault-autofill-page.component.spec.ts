import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { AutoFillFillActionService } from "../autofill/autofill-fill-action.service";
import { immutableAuthorizationMap } from "../autofill/autofill-fill-context.model";
import { AutoFillVaultContextService } from "../autofill/autofill-vault-context.service";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { officialCurrentAccountTestProviders } from "../official-ui/official-current-account.test-support";
import { PopupStateStore } from "../popup-state";
import { demoFolders, demoVaultItems } from "../vault-demo";
import { VaultActionsService } from "./vault-actions.service";
import { VaultAutoFillPageComponent } from "./vault-autofill-page.component";
import { VaultFacade } from "./vault.facade";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

describe("VaultAutoFillPageComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
      ],
    });
  });

  it("places live AutoFill suggestions above the retained vault hierarchy", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems, demoFolders, new Date("2026-08-11T00:00:00Z"), "account-a");
    const candidate = Object.freeze({
      cipherId: "github",
      displayName: "GitHub",
      username: "ops@example.com",
      group: "exact" as const,
      reason: "service_identifier",
      availableFields: Object.freeze(["username", "password"] as const),
      authorizations: immutableAuthorizationMap([
        ["username", { contextToken: "username-token", requiresMismatchConfirmation: false }],
        ["password", { contextToken: "password-token", requiresMismatchConfirmation: false }],
      ]),
    });
    const context = {
      snapshot: () => ({
        status: "ready" as const,
        epoch: 1,
        context: {
          bundleId: "com.example.Terminal",
          appName: "Terminal",
          fillContextToken: "00000000-0000-4000-8000-000000000005",
          focusedField: { kind: "password" as const, confidence: "high" as const },
          action: { mode: "form" as const, fields: ["username", "password"] as const },
        },
        session: {
          accountId: "account-a",
          generation: "00000000-0000-4000-8000-000000000004",
          vaultRevision: 7,
        },
        candidates: [candidate],
      }),
      subscribe: () => () => undefined,
      select: () => candidate,
      selected: () => null,
      invalidate: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [VaultAutoFillPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AutoFillVaultContextService, useValue: context },
        { provide: AutoFillFillActionService, useValue: { prepare: vi.fn(), execute: vi.fn(), cancel: vi.fn() } },
        { provide: VaultActionsService, useValue: {} },
        VaultFacade,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultAutoFillPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const suggestions = host.querySelector("[data-testid='vault-autofill-suggestions']");
    const hierarchy = host.querySelector("bw-vault-hierarchy");

    expect(suggestions).not.toBeNull();
    expect(suggestions?.compareDocumentPosition(hierarchy!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(host.textContent).toContain("自动填充建议");
    expect(host.textContent).toContain("收藏夹");
    expect(host.textContent).toContain("所有项目");
  });
});
