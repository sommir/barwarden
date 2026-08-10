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
import { AutoFillBindingsService } from "./autofill-bindings.service";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillNativeHost,
} from "./autofill-native.host";
import { AutoFillPickerComponent } from "./autofill-picker.component";
import { AutoFillSetupService } from "./autofill-setup.service";
import { GLOBAL_SHORTCUT_SETTINGS_HOST } from "../settings/global-shortcut-settings.service";

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
        {
          provide: GLOBAL_SHORTCUT_SETTINGS_HOST,
          useValue: {
            getGlobalShortcut: vi.fn(async () => ({
              shortcut: { modifiers: ["option"], code: "KeyB" },
              availability: "active",
            })),
          },
        },
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
    expect(fixture.nativeElement.textContent).toContain("精确匹配");
    expect(JSON.stringify(candidateHost.queryCandidates.mock.calls)).not.toMatch(/one-secret/);
  });

  it("explains an exact application-name match as a related account", async () => {
    candidateHost.queryCandidates.mockResolvedValue({
      contextToken: crypto.randomUUID(),
      candidates: [{
        cipherId: demoVaultItems[0].id,
        displayName: "Termius",
        username: "person@example.test",
        group: "relevant",
        reason: "application_name",
        requiresMismatchConfirmation: false,
      }],
    });
    nativeHost.entryContext.mockResolvedValue({
      status: "available",
      bundleId: "com.termius-dmg.mac",
      appName: "Termius",
    });

    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("应用名称相同");
    expect(fixture.nativeElement.querySelector('[data-testid="autofill-group-relevant"]')).not.toBeNull();
  });

  it("explains an approximate application-name match without exposing its raw score", async () => {
    candidateHost.queryCandidates.mockResolvedValue({
      contextToken: crypto.randomUUID(),
      candidates: [{
        cipherId: demoVaultItems[0].id,
        displayName: "Trmius",
        username: "person@example.test",
        group: "relevant",
        reason: "application_name_similar",
        requiresMismatchConfirmation: true,
      }],
    });

    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("应用名称相似");
    expect(fixture.nativeElement.textContent).not.toMatch(/\b(?:7200|8800|10000)\b/);
  });

  it("shows the registered shortcut and reports when another instance owns it", async () => {
    TestBed.overrideProvider(GLOBAL_SHORTCUT_SETTINGS_HOST, {
      useValue: {
        getGlobalShortcut: vi.fn(async () => ({
          shortcut: { modifiers: ["command", "shift"], code: "KeyP" },
          availability: "unavailable",
        })),
      },
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="autofill-shortcut"]')?.textContent).toContain("⇧⌘ P");
    expect(fixture.nativeElement.querySelector('[data-testid="autofill-shortcut-unavailable"]')).not.toBeNull();
  });

  it("uses the selected field when activating a candidate row", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    const usernameField = fixture.nativeElement.querySelector(
      '[data-testid="autofill-field-username"]',
    ) as HTMLButtonElement;
    const candidateAction = fixture.nativeElement.querySelector(
      '[data-testid^="autofill-fill-candidate-"]',
    ) as HTMLButtonElement;

    expect(usernameField).not.toBeNull();
    expect(candidateAction).not.toBeNull();
    usernameField.click();
    fixture.detectChanges();
    expect(usernameField.getAttribute("aria-pressed")).toBe("true");

    candidateAction.click();
    await vi.waitFor(() => expect(nativeHost.releaseSecret).toHaveBeenCalledOnce());

    expect(nativeHost.releaseSecret).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ field: "username" }),
    }));
    expect(nativeHost.pasteText).toHaveBeenCalledWith("one-secret", 30);
    expect(nativeHost.copyText).not.toHaveBeenCalled();
  });

  it("shows only accounts that actually contain the selected field", async () => {
    const usernameOnly = {
      cipherId: "username-only",
      displayName: "Username Only",
      username: "username@example.test",
      group: "relevant" as const,
      reason: "host_or_domain",
      requiresMismatchConfirmation: false,
    };
    const passwordOnly = candidateHostCandidate();
    candidateHost.queryCandidates.mockImplementation(async (request) => ({
      contextToken: crypto.randomUUID(),
      candidates: request.field === "username"
        ? [usernameOnly]
        : request.field === "password"
          ? [passwordOnly]
          : [],
    }));
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(passwordOnly.displayName);
    expect(fixture.nativeElement.textContent).not.toContain(usernameOnly.displayName);

    (fixture.nativeElement.querySelector('[data-testid="autofill-field-username"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(usernameOnly.displayName);
    expect(fixture.nativeElement.textContent).not.toContain(passwordOnly.displayName);
  });

  it("copies the highlighted field without invoking paste", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    const copyOnly = fixture.nativeElement.querySelector(
      '[data-testid="autofill-copy-only"]',
    ) as HTMLButtonElement;
    expect(copyOnly).not.toBeNull();

    copyOnly.click();
    await vi.waitFor(() => expect(nativeHost.releaseSecret).toHaveBeenCalledOnce());

    expect(nativeHost.releaseSecret).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ field: "password" }),
    }));
    expect(nativeHost.copyText).toHaveBeenCalledWith("one-secret", 30);
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
  });

  it("renders a fully localized, actionable unavailable-target state", async () => {
    await TestBed.inject(OfficialI18nService).setLocale("zh-CN");
    nativeHost.entryContext.mockResolvedValue({ status: "unavailable" });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("context-unavailable"));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("未检测到可填入的输入框");
    expect(text).toContain("返回目标应用并聚焦输入框后，再按已设置的自动填充快捷键");
    expect(text).not.toContain("⌥B");
    expect(text).not.toContain("Target app unavailable");
    const back = fixture.nativeElement.querySelector(
      '[data-testid="autofill-back-vault"]',
    ) as HTMLButtonElement;
    expect(back).not.toBeNull();
    back.click();
    expect(navigate).toHaveBeenCalledWith("/tabs/vault", { replaceUrl: true });
  });

  it("shows fixed Login Items repair guidance and performs no query while approval is required", async () => {
    TestBed.overrideProvider(AutoFillSetupService, {
      useValue: { blockReason: () => "requiresApproval" },
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();

    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("系统设置 > 通用 > 登录项");
    expect(fixture.nativeElement.querySelector('[data-testid="autofill-turn-off"]')).not.toBeNull();
    expect(nativeHost.entryContext).not.toHaveBeenCalled();
    expect(nativeHost.agentSession).not.toHaveBeenCalled();
    expect(candidateHost.queryCandidates).not.toHaveBeenCalled();
  });

  it("shows focused-field permission guidance instead of silently hiding app AutoFill", async () => {
    TestBed.overrideProvider(AutoFillSetupService, {
      useValue: { blockReason: () => "requiresAccessibility" },
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();

    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("辅助功能");
    expect(nativeHost.entryContext).not.toHaveBeenCalled();
    expect(nativeHost.agentSession).not.toHaveBeenCalled();
    expect(candidateHost.queryCandidates).not.toHaveBeenCalled();
  });

  it("Retry performs setup recovery and queries only after the Agent becomes ready", async () => {
    let setupState = "requiresApproval";
    let finishEnable: (() => void) | undefined;
    const enableFromEntry = vi.fn(() => new Promise<"ready">((resolve) => {
      finishEnable = () => {
        setupState = "ready";
        resolve("ready");
      };
    }));
    TestBed.overrideProvider(AutoFillSetupService, {
      useValue: { blockReason: () => setupState, enableFromEntry, disable: vi.fn() },
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));

    (fixture.nativeElement.querySelector('[data-testid="autofill-retry"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    await vi.waitFor(() => expect(enableFromEntry).toHaveBeenCalledOnce());
    expect(nativeHost.entryContext).not.toHaveBeenCalled();
    expect(nativeHost.agentSession).not.toHaveBeenCalled();
    expect(candidateHost.queryCandidates).not.toHaveBeenCalled();
    finishEnable?.();

    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    expect(enableFromEntry).toHaveBeenCalledOnce();
    expect(nativeHost.entryContext).toHaveBeenCalledTimes(2);
    expect(nativeHost.agentSession).toHaveBeenCalledOnce();
    expect(candidateHost.queryCandidates).toHaveBeenCalled();
  });

  it("Retry remains query-free while Login Items approval is still required", async () => {
    const enableFromEntry = vi.fn(async () => "requiresApproval");
    TestBed.overrideProvider(AutoFillSetupService, {
      useValue: { blockReason: () => "requiresApproval", enableFromEntry, disable: vi.fn() },
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));

    (fixture.nativeElement.querySelector('[data-testid="autofill-retry"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(enableFromEntry).toHaveBeenCalledOnce());

    expect(fixture.componentInstance.mode).toBe("repair");
    expect(nativeHost.entryContext).not.toHaveBeenCalled();
    expect(nativeHost.agentSession).not.toHaveBeenCalled();
    expect(candidateHost.queryCandidates).not.toHaveBeenCalled();
  });

  it("closes the normal picker without disabling AutoFill", async () => {
    const disable = vi.fn(async () => undefined);
    TestBed.overrideProvider(AutoFillSetupService, {
      useValue: { blockReason: () => "ready", enableFromEntry: vi.fn(), disable },
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    const close = fixture.nativeElement.querySelector('[data-testid="autofill-close"]') as HTMLButtonElement;
    expect(close).not.toBeNull();
    expect(close.getAttribute("aria-label")).toBe("关闭");
    close.click();

    expect(navigate).toHaveBeenCalledWith("/tabs/vault", { replaceUrl: true });
    expect(disable).not.toHaveBeenCalled();
  });

  it("shows a fixed Turn Off failure without native error details", async () => {
    TestBed.overrideProvider(AutoFillSetupService, {
      useValue: {
        blockReason: () => "requiresApproval",
        enableFromEntry: vi.fn(),
        disable: vi.fn(async () => { throw new Error("private native detail"); }),
      },
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="autofill-turn-off"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain("无法关闭自动填充，请重试。"));

    expect(fixture.nativeElement.textContent).not.toContain("private native detail");
    expect(fixture.componentInstance.mode).toBe("repair");
  });

  it("fills the selected field when Enter activates the highlighted account", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.changeDetectorRef.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    await fixture.whenStable();
    fixture.changeDetectorRef.detectChanges();

    fixture.componentInstance.onListKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(nativeHost.releaseSecret).toHaveBeenCalledOnce());

    expect(nativeHost.releaseSecret).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ field: "password" }),
    }));
    expect(nativeHost.pasteText).toHaveBeenCalledWith("one-secret", 30);
  });

  it("does not fill an account when Enter is pressed in search", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
  });

  it("keeps the search control mounted and focused while an async query is pending", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();

    const pending = deferred<Awaited<ReturnType<AutoFillCandidateHost["queryCandidates"]>>>();
    candidateHost.queryCandidates.mockImplementation(() => pending.promise);
    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.focus();
    search.value = "g";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();

    expect(search.isConnected).toBe(true);
    expect(document.activeElement).toBe(search);
    search.value = "gi";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(search);

    pending.resolve({ contextToken: crypto.randomUUID(), candidates: [candidateHostCandidate()] });
    await fixture.whenStable();
  });

  it("moves a visible active option with arrows without releasing a secret", async () => {
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

    const optionsBeforeMove = [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
    const scrollIntoView = vi.fn();
    Object.defineProperty(optionsBeforeMove[1], "scrollIntoView", { value: scrollIntoView });
    fixture.componentInstance.onListKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    fixture.detectChanges();
    await Promise.resolve();

    const listbox = fixture.nativeElement.querySelector('[role="listbox"]') as HTMLElement;
    const options = [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
    expect(options[1].classList.contains("autofill-picker__option--highlighted")).toBe(true);
    expect(options[1].getAttribute("aria-selected")).toBe("false");
    expect(listbox.getAttribute("tabindex")).toBe("0");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options.every((option) => option.tabIndex === -1)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(fixture.componentInstance.selected).toBeNull();
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

  it("binds an explicitly filled account to the target app after delivery succeeds", async () => {
    const bindings = TestBed.inject(AutoFillBindingsService);
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);

    await fixture.componentInstance.perform("fill", "password");

    expect(bindings.bindingFor("account-a", "com.example.App")).toBe(demoVaultItems[0].id);
    expect(bindings.snapshot("account-a").history).toEqual([
      expect.objectContaining({
        cipherId: demoVaultItems[0].id,
        successfulSelectionCount: 1,
      }),
    ]);
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
    expect(fixture.componentInstance.statusMessage).toBe("无法读取这个字段。");
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

  it("closes a failed master-password prompt and starts a fresh reprompt on retry", async () => {
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    verifyReprompt.mockRejectedValueOnce(new Error("incorrect password"));
    nativeHost.beginReprompt
      .mockResolvedValueOnce({ status: "pending", receipt: "receipt-a" })
      .mockResolvedValueOnce({ status: "pending", receipt: "receipt-b" });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();
    const candidate = fixture.nativeElement.querySelector('[data-testid^="autofill-fill-candidate-"]') as HTMLButtonElement;
    candidate.focus();
    fixture.componentInstance.selectIndex(0);
    await fixture.componentInstance.perform("fill", "password");
    fixture.componentInstance.showMasterPasswordReprompt();
    fixture.componentInstance.masterPassword = "wrong";

    await fixture.componentInstance.verifyWithMasterPassword(new Event("submit"));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(nativeHost.cancelReprompt).toHaveBeenCalledWith(expect.anything(), "receipt-a");
    expect(fixture.componentInstance.pendingProtected).toBeNull();
    expect(fixture.componentInstance.masterPasswordMode).toBe(false);
    expect(document.activeElement).toBe(candidate);
    await fixture.componentInstance.perform("fill", "password");
    expect(nativeHost.beginReprompt).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.pendingProtected?.receipt).toBe("receipt-b");
  });

  it("opens mismatch as a keyboard-contained modal, closes with Escape, and restores focus", async () => {
    candidateHost.queryCandidates.mockResolvedValue({
      contextToken: crypto.randomUUID(),
      candidates: [{ ...candidateHostCandidate(), requiresMismatchConfirmation: true }],
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();
    const candidate = fixture.nativeElement.querySelector('[data-testid^="autofill-fill-candidate-"]') as HTMLButtonElement;
    candidate.focus();
    candidate.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('[data-testid="autofill-mismatch-dialog"]') as HTMLElement;
    const primary = dialog.querySelector('[data-autofill-dialog-primary]') as HTMLButtonElement;
    const cancel = dialog.querySelector('[data-autofill-dialog-cancel]') as HTMLButtonElement;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(primary);
    cancel.focus();
    cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(primary);
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="autofill-mismatch-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(candidate);
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
  });

  it("restores the candidate focus when mismatch is confirmed", async () => {
    candidateHost.queryCandidates.mockResolvedValue({
      contextToken: crypto.randomUUID(),
      candidates: [{ ...candidateHostCandidate(), requiresMismatchConfirmation: true }],
    });
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();
    const candidate = fixture.nativeElement.querySelector('[data-testid^="autofill-fill-candidate-"]') as HTMLButtonElement;
    candidate.focus();
    candidate.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const primary = fixture.nativeElement.querySelector("[data-autofill-dialog-primary]") as HTMLButtonElement;
    primary.click();
    fixture.detectChanges();
    await vi.waitFor(() => expect(nativeHost.releaseSecret).toHaveBeenCalledOnce());
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="autofill-mismatch-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(candidate);
  });

  it("rejects release when the target app changes before delivery", async () => {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.componentInstance.selectIndex(0);
    nativeHost.entryContext.mockResolvedValue({
      status: "available",
      bundleId: "com.example.Other",
      appName: "Other",
    });

    await fixture.componentInstance.perform("fill", "password");

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
