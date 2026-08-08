import "@angular/compiler";
import "zone.js";

import { TestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { provideRouter, Router } from "@angular/router";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { AuthFacade } from "../auth/auth.facade";
import { PopupStateStore } from "../popup-state";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { demoVaultItems } from "../vault-demo";
import { VaultRepromptService } from "../vault/vault-reprompt.service";
import {
  AUTOFILL_CANDIDATE_HOST,
  type AutoFillCandidateHost,
} from "./autofill-candidate.service";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillNativeHost,
} from "./autofill-native.host";
import { AutoFillPickerComponent } from "./autofill-picker.component";

beforeAll(() => {
  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch {}
});

describe("AutoFillPickerComponent", () => {
  let store: PopupStateStore;
  let candidateHost: AutoFillCandidateHost & { queryCandidates: ReturnType<typeof vi.fn> };
  let nativeHost: AutoFillNativeHost & {
    releaseSecret: ReturnType<typeof vi.fn>;
    pasteText: ReturnType<typeof vi.fn>;
    copyText: ReturnType<typeof vi.fn>;
  };
  let switchAccount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    store = new PopupStateStore();
    store.setActiveSession({
      environment: { apiUrl: "https://api.example", identityUrl: "https://identity.example" },
      token: { accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", expiresIn: 3600 },
    });
    store.setUnlocked("person@example.test");
    store.setItems([demoVaultItems[0]], [], new Date(), "account-a");
    candidateHost = {
      queryCandidates: vi.fn(async () => ({
        contextToken: crypto.randomUUID(),
        candidates: [{
          cipherId: demoVaultItems[0].id,
          displayName: "Example Login",
          username: "person@example.test",
          group: "exact",
          reason: "service_identifier",
          requiresMismatchConfirmation: false,
        }],
      })),
    };
    nativeHost = {
      entryContext: vi.fn(async () => ({ status: "available", bundleId: "com.example.App", appName: "Example" })),
      agentSession: vi.fn(async () => ({ status: "success", generation: "00000000-0000-4000-8000-000000000004", accountId: "account-a", vaultRevision: 1 })),
      beginReprompt: vi.fn(async () => ({ status: "pending", receipt: "receipt-a" })),
      biometricReprompt: vi.fn(async () => "success"),
      releaseSecret: vi.fn(async (request) => ({ status: "success", field: request.scope.field, value: "one-secret" })),
      pasteText: vi.fn(async () => undefined),
      copyText: vi.fn(async () => undefined),
    };
    switchAccount = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [AutoFillPickerComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: AUTOFILL_CANDIDATE_HOST, useValue: candidateHost },
        { provide: AUTOFILL_NATIVE_HOST, useValue: nativeHost },
        { provide: AuthFacade, useValue: { switchAccount } },
        { provide: VaultRepromptService, useValue: { verify: vi.fn(async () => true) } },
      ],
    });
  });

  it("queries metadata for every Login field and renders fixed exact/relevant/other groups", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.changeDetectorRef.detectChanges();

    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();

    expect(candidateHost.queryCandidates).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "account-a",
      lockGeneration: "00000000-0000-4000-8000-000000000004",
      context: expect.objectContaining({ bundleId: "com.example.App" }),
    }));
    expect(fixture.nativeElement.querySelector('[data-testid="autofill-group-exact"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain("Exact matches");
    expect(JSON.stringify(candidateHost.queryCandidates.mock.calls)).not.toMatch(/one-secret/);
  });

  it("selects with the keyboard without releasing or pasting a secret", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.changeDetectorRef.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();

    fixture.componentInstance.onListKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    fixture.changeDetectorRef.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="fill-password"]')).not.toBeNull();
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
  });

  it("releases and guarded-pastes exactly one field only after its explicit Fill action", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(candidateHost.queryCandidates).toHaveBeenCalledTimes(3));
    fixture.componentInstance.selectIndex(0);

    await fixture.componentInstance.perform("fill", "password");

    expect(nativeHost.releaseSecret).toHaveBeenCalledOnce();
    expect(nativeHost.releaseSecret).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ field: "password" }),
    }));
    expect(nativeHost.pasteText).toHaveBeenCalledOnce();
    expect(nativeHost.pasteText).toHaveBeenCalledWith("one-secret", 30);
    expect(nativeHost.copyText).not.toHaveBeenCalled();
  });

  it("keeps locked, repair, empty, and account override as explicit fail-closed states", async () => {
    store.setLocked();
    let fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="autofill-locked"]')).not.toBeNull();
    fixture.destroy();

    store.setUnlocked("person@example.test");
    store.setItems([demoVaultItems[0]], [], new Date(), "account-a");
    (nativeHost.agentSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "error", code: "locked" });
    fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));
    fixture.destroy();

    (candidateHost.queryCandidates as ReturnType<typeof vi.fn>).mockResolvedValue({ contextToken: "empty", candidates: [] });
    fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("empty"));
    fixture.destroy();

    (nativeHost.agentSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "success",
      generation: "00000000-0000-4000-8000-000000000004",
      accountId: "account-b",
      vaultRevision: 2,
    });
    fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("account-override"));
    expect(candidateHost.queryCandidates).toHaveBeenCalledTimes(3);
    await fixture.componentInstance.useProjectedAccount();
    expect(switchAccount).toHaveBeenCalledOnce();
    expect(switchAccount).toHaveBeenCalledWith("account-b");
  });
});
