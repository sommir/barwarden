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
import { AutoFillSetupService } from "./autofill-setup.service";

beforeAll(() => {
  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch {}
});

describe("AutoFillPickerComponent", () => {
  let store: PopupStateStore;
  let candidateHost: AutoFillCandidateHost & { queryCandidates: ReturnType<typeof vi.fn> };
  let nativeHost: AutoFillNativeHost & {
    entryContext: ReturnType<typeof vi.fn>;
    agentSession: ReturnType<typeof vi.fn>;
    beginReprompt: ReturnType<typeof vi.fn>;
    cancelReprompt: ReturnType<typeof vi.fn>;
    biometricReprompt: ReturnType<typeof vi.fn>;
    releaseSecret: ReturnType<typeof vi.fn>;
    pasteText: ReturnType<typeof vi.fn>;
    copyText: ReturnType<typeof vi.fn>;
  };
  let switchAccount: ReturnType<typeof vi.fn>;
  let verifyReprompt: ReturnType<typeof vi.fn>;

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
      cancelReprompt: vi.fn(async () => undefined),
      biometricReprompt: vi.fn(async () => "success"),
      releaseSecret: vi.fn(async (request) => ({ status: "success", field: request.scope.field, value: "one-secret" })),
      pasteText: vi.fn(async () => undefined),
      copyText: vi.fn(async () => undefined),
    };
    switchAccount = vi.fn(async () => undefined);
    verifyReprompt = vi.fn(async () => true);
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
        { provide: VaultRepromptService, useValue: { verify: verifyReprompt } },
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

  it("shows fixed Login Items repair guidance and performs no query while approval is required", async () => {
    TestBed.overrideProvider(AutoFillSetupService, {
      useValue: { blockReason: () => "requiresApproval" },
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();

    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("System Settings > General > Login Items");
    expect(nativeHost.entryContext).not.toHaveBeenCalled();
    expect(nativeHost.agentSession).not.toHaveBeenCalled();
    expect(candidateHost.queryCandidates).not.toHaveBeenCalled();
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

  it("moves a visible active option with arrows and selects only on Enter", async () => {
    const second = {
      cipherId: "cipher-second",
      displayName: "Second Login",
      username: "second@example.test",
      group: "relevant" as const,
      reason: "host_or_domain",
      requiresMismatchConfirmation: false,
    };
    candidateHost.queryCandidates.mockResolvedValue({
      contextToken: crypto.randomUUID(),
      candidates: [candidateHostCandidate(), second],
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    fixture.componentInstance.onListKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    fixture.detectChanges();

    const listbox = fixture.nativeElement.querySelector('[role="listbox"]') as HTMLElement;
    const options = [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
    expect(options[1].classList.contains("autofill-picker__option--highlighted")).toBe(true);
    expect(options[1].getAttribute("aria-selected")).toBe("false");
    expect(listbox.getAttribute("tabindex")).toBe("0");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(fixture.componentInstance.selected).toBeNull();

    fixture.componentInstance.onListKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    fixture.detectChanges();
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(fixture.componentInstance.selected?.cipherId).toBe("cipher-second");
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

  it("supersedes a delayed field query when selection changes before secret release", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    const query = deferred<unknown>();
    candidateHost.queryCandidates.mockImplementationOnce(() => query.promise);

    const operation = fixture.componentInstance.perform("fill", "password");
    fixture.componentInstance.selectCandidate({
      ...candidateHostCandidate(),
      cipherId: "another-cipher",
      displayName: "Another",
    });
    query.resolve({ contextToken: crypto.randomUUID(), candidates: [candidateHostCandidate()] });
    await operation;

    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
    expect(fixture.componentInstance.statusMessage).toBe("");
  });

  it("burns a protected receipt on cancel and never resumes delayed Touch ID", async () => {
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    const touchId = deferred<"success">();
    nativeHost.biometricReprompt.mockImplementationOnce(() => touchId.promise);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    await fixture.componentInstance.perform("fill", "password");
    const verification = fixture.componentInstance.verifyWithTouchId();
    fixture.componentInstance.selectCandidate({ ...candidateHostCandidate(), cipherId: "another-cipher" });
    touchId.resolve("success");
    await verification;

    expect(nativeHost.cancelReprompt).toHaveBeenCalledWith(expect.objectContaining({ candidateId: demoVaultItems[0].id }), "receipt-a");
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
    expect(fixture.componentInstance.statusMessage).toBe("");
  });

  it("best-effort burns a verified receipt after a failed protected release", async () => {
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    nativeHost.releaseSecret.mockResolvedValueOnce({ status: "error", code: "unavailable" });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    await fixture.componentInstance.perform("fill", "password");

    await fixture.componentInstance.verifyWithTouchId();

    expect(nativeHost.cancelReprompt).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: demoVaultItems[0].id, field: "password" }),
      "receipt-a",
    );
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
    expect(fixture.componentInstance.statusMessage).toBe("AutoFill could not release this field.");
  });

  it("does not paste a delayed release after the picker is destroyed", async () => {
    const release = deferred<{ status: "success"; field: "password"; value: string }>();
    nativeHost.releaseSecret.mockImplementationOnce(() => release.promise);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    const operation = fixture.componentInstance.perform("fill", "password");
    await vi.waitFor(() => expect(nativeHost.releaseSecret).toHaveBeenCalledOnce());
    fixture.destroy();
    release.resolve({ status: "success", field: "password", value: "late-secret" });
    await operation;

    expect(nativeHost.pasteText).not.toHaveBeenCalled();
    expect(nativeHost.copyText).not.toHaveBeenCalled();
  });

  it("does not paste when target revalidation finishes after destruction", async () => {
    const target = deferred<{ status: "available"; bundleId: string; appName: string }>();
    const available = { status: "available" as const, bundleId: "com.example.App", appName: "Example" };
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    nativeHost.entryContext
      .mockResolvedValueOnce(available)
      .mockResolvedValueOnce(available)
      .mockImplementationOnce(() => target.promise);

    const operation = fixture.componentInstance.perform("fill", "password");
    await vi.waitFor(() => expect(nativeHost.releaseSecret).toHaveBeenCalledOnce());
    fixture.destroy();
    target.resolve(available);
    await operation;

    expect(nativeHost.pasteText).not.toHaveBeenCalled();
    expect(fixture.componentInstance.statusMessage).toBe("");
  });

  it("burns a receipt returned after the picker was destroyed", async () => {
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    const begin = deferred<{ status: "pending"; receipt: string }>();
    nativeHost.beginReprompt.mockImplementationOnce(() => begin.promise);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    const operation = fixture.componentInstance.perform("fill", "password");
    await vi.waitFor(() => expect(nativeHost.beginReprompt).toHaveBeenCalledOnce());
    fixture.destroy();
    begin.resolve({ status: "pending", receipt: "late-receipt" });
    await operation;

    expect(nativeHost.cancelReprompt).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: demoVaultItems[0].id, field: "password" }),
      "late-receipt",
    );
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
  });

  it("supersedes delayed master-password verification and burns its receipt", async () => {
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    const verification = deferred<boolean>();
    verifyReprompt.mockImplementationOnce(() => verification.promise);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    await fixture.componentInstance.perform("fill", "password");
    fixture.componentInstance.showMasterPasswordReprompt();
    fixture.componentInstance.masterPassword = "not-logged";
    const operation = fixture.componentInstance.verifyWithMasterPassword(new Event("submit"));
    fixture.componentInstance.search("new query");
    expect(fixture.componentInstance.pendingProtected).toBeNull();
    expect(fixture.componentInstance.masterPasswordMode).toBe(false);
    verification.resolve(true);
    await operation;

    expect(nativeHost.cancelReprompt).toHaveBeenCalledWith(expect.anything(), "receipt-a");
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
  });

  it("does not publish query results after the unlocked account owner changes", async () => {
    const query = deferred<ReturnType<typeof candidateResponse>>();
    candidateHost.queryCandidates.mockImplementation(() => query.promise);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(candidateHost.queryCandidates).toHaveBeenCalledTimes(3));
    store.setItems([demoVaultItems[0]], [], new Date(), "account-b");
    query.resolve(candidateResponse());
    await query.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.componentInstance.candidates).toEqual([]);
    expect(fixture.componentInstance.mode).toBe("loading");
  });

  it("does not continue a delayed account override after destruction", async () => {
    nativeHost.agentSession.mockResolvedValue({
      status: "success",
      generation: "00000000-0000-4000-8000-000000000004",
      accountId: "account-b",
      vaultRevision: 2,
    });
    const switched = deferred<void>();
    switchAccount.mockImplementationOnce(() => switched.promise);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("account-override"));

    const operation = fixture.componentInstance.useProjectedAccount();
    fixture.destroy();
    switched.resolve();
    await operation;

    expect(candidateHost.queryCandidates).not.toHaveBeenCalled();
    expect(fixture.componentInstance.statusMessage).toBe("");
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

function candidateHostCandidate() {
  return {
    cipherId: demoVaultItems[0].id,
    displayName: "Example Login",
    username: "person@example.test",
    group: "exact" as const,
    reason: "service_identifier",
    requiresMismatchConfirmation: false,
  };
}

function candidateResponse() {
  return { contextToken: crypto.randomUUID(), candidates: [candidateHostCandidate()] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((completion) => { resolve = completion; });
  return { promise, resolve };
}
