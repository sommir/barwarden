import "@angular/compiler";
import "zone.js";

import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthFacade } from "../auth/auth.facade";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { GLOBAL_SHORTCUT_SETTINGS_HOST } from "../settings/global-shortcut-settings.service";
import { demoVaultItems } from "../vault-demo";
import { VaultRepromptService } from "../vault/vault-reprompt.service";
import {
  AUTOFILL_CANDIDATE_HOST,
  type AutoFillCandidateHost,
  type AutoFillSecretField,
} from "./autofill-candidate.service";
import { AutoFillBindingsService } from "./autofill-bindings.service";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import type { DetectedFillMode, DetectedFieldKind, FieldConfidence, LiveAutoFillContext } from "./autofill-fill-context.model";
import { AUTOFILL_NATIVE_HOST, type AutoFillNativeHost } from "./autofill-native.host";
import { AutoFillPickerComponent } from "./autofill-picker.component";
import { AutoFillSetupService } from "./autofill-setup.service";

beforeAll(() => {
  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch {}
});

describe("AutoFillPickerComponent contextual actions", () => {
  let store: PopupStateStore;
  let candidateHost: AutoFillCandidateHost & { queryCandidates: ReturnType<typeof vi.fn> };
  let nativeHost: AutoFillNativeHost & NativeSpies;
  let activeContext: LiveAutoFillContext;
  let switchAccount: ReturnType<typeof vi.fn>;
  let verifyReprompt: ReturnType<typeof vi.fn>;
  let setupState: "ready" | "requiresAccessibility";

  beforeEach(async () => {
    TestBed.resetTestingModule();
    store = new PopupStateStore();
    store.setActiveSession({
      environment: { apiUrl: "https://api.example", identityUrl: "https://identity.example" },
      token: { accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", expiresIn: 3600 },
    });
    store.setUnlocked("person@example.test");
    store.setItems([demoVaultItems[0]], [], new Date(), "account-a");
    activeContext = context({ kind: "password", confidence: "high", mode: "field", fields: ["password"] });
    candidateHost = {
      queryCandidates: vi.fn(async (request: { field: AutoFillSecretField }) => response(request.field)),
    };
    nativeHost = native(() => activeContext);
    switchAccount = vi.fn(async () => undefined);
    verifyReprompt = vi.fn(async () => true);
    setupState = "ready";
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
          provide: AutoFillSetupService,
          useValue: {
            blockReason: () => setupState,
            enableFromEntry: vi.fn(async () => setupState),
            disable: vi.fn(async () => undefined),
          },
        },
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
    await TestBed.inject(OfficialI18nService).setLocale("zh-CN");
  });

  it.each([
    ["email", "high", "field", ["username"]],
    ["password", "high", "field", ["password"]],
    ["one-time-code", "high", "field", ["totp"]],
    ["username", "high", "form", ["username", "password"]],
  ] as const)(
    "uses a confident %s context behind one generic Fill action",
    async (kind, confidence, mode, fields) => {
      activeContext = context({ kind, confidence, mode, fields });
      const fixture = await renderPicker();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector("[data-testid='autofill-field-switcher']")).toBeNull();
      expect(host.querySelector("[data-testid^='autofill-context-']")).toBeNull();
      expect(actionLabels(host)).toEqual(["填入"]);
      expect(capabilityFields(host)).toEqual(["username", "password", "totp"]);
      const primary = host.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement;
      expect(primary).not.toBeNull();
      expect(primary.querySelector(".bwi")).toBeNull();

      primary.click();
      await vi.waitFor(() => expect(nativeHost.fillDetected).toHaveBeenCalledOnce());
      expect(nativeHost.fillDetected.mock.calls[0][0].authorizations.map(({ scope }) => scope.field)).toEqual(fields);
    },
  );

  it("shows only the candidate fields that are actually available and authorized", async () => {
    candidateHost.queryCandidates.mockImplementation(async (request: { field: AutoFillSecretField }) => (
      request.field === "totp" ? { contextToken: "totp-token", candidates: [] } : response(request.field)
    ));
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;

    expect(capabilityFields(host)).toEqual(["username", "password"]);
    expect(host.querySelector("[data-testid^='autofill-capabilities-']")?.getAttribute("aria-label"))
      .toBe("可填入：用户名、密码");
  });

  it("renders low-confidence choose mode with only available field icon actions", async () => {
    activeContext = context({
      kind: "unknown", confidence: "low", mode: "choose", fields: ["username", "password", "totp"],
    });
    candidateHost.queryCandidates.mockImplementation(async (request: { field: AutoFillSecretField }) => (
      request.field === "username" ? { contextToken: "username-token", candidates: [] } : response(request.field)
    ));
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("[data-testid^='autofill-context-']")).toBeNull();
    const actions = actionButtons(host);
    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual(["填入密码", "填入验证码"]);
    expect(actions.map((button) => button.getAttribute("title"))).toEqual(["填入密码", "填入验证码"]);
    expect(actions[0].querySelector(".bwi-lock")).not.toBeNull();
    expect(actions[1].querySelector(".bwi-clock")).not.toBeNull();
    expect(host.querySelector("[data-testid^='autofill-primary-action-']")).toBeNull();
  });

  it("keeps a confident form row automatic without exposing another field chooser", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector(".autofill-picker__expand-actions")).toBeNull();
    expect(actionButtons(host)).toEqual([]);

    (host.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nativeHost.fillDetected).toHaveBeenCalledOnce());
    expect(nativeHost.fillDetected.mock.calls[0][0].authorizations.map(({ scope }) => scope.field))
      .toEqual(["username", "password"]);
  });

  it("does not expose candidate fields outside a confident single-field context", async () => {
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector(".autofill-picker__expand-actions")).toBeNull();
    expect(actionButtons(host)).toEqual([]);
    expect(actionLabels(host)).toEqual(["填入"]);
  });

  it("keeps exact, relevant, and other order with fixed localized match reasons", async () => {
    candidateHost.queryCandidates.mockImplementation(async (request: { field: AutoFillSecretField }) => ({
      contextToken: `${request.field}-token`,
      candidates: [
        candidate("cipher-other", "Other Login", "other", "recent"),
        candidate("cipher-exact", "Exact Login", "exact", "service_identifier"),
        candidate("cipher-related", "Related Login", "relevant", "application_name_similar"),
      ],
    }));
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;

    expect([...host.querySelectorAll(".autofill-picker__groups section > h2")].map((node) => node.textContent?.trim()))
      .toEqual(["精确匹配", "相关账户", "其他账户"]);
    expect(host.textContent).toContain("服务标识完全匹配");
    expect(host.textContent).toContain("应用名称相似");
    expect(host.textContent).toContain("最近使用");
    expect(host.textContent).not.toMatch(/7200|8800|10000/);
  });

  it("opens candidate details after saving the ephemeral selection and releases nothing", async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const fixture = await renderPicker();
    const body = fixture.nativeElement.querySelector("[data-testid^='autofill-candidate-body-']") as HTMLButtonElement;
    body.click();
    await fixture.whenStable();

    expect(TestBed.inject(AutoFillContextSessionService).snapshot()?.selectedCipherId).toBe(demoVaultItems[0].id);
    expect(navigate).toHaveBeenCalledWith(`/view-cipher/${encodeURIComponent(demoVaultItems[0].id)}`);
    expect(nativeHost.fillDetected).not.toHaveBeenCalled();
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
  });

  it("fills one explicitly chosen field through fillDetected without a plaintext fallback", async () => {
    activeContext = context({
      kind: "unknown", confidence: "low", mode: "choose", fields: ["username", "password", "totp"],
    });
    nativeHost.fillDetected.mockResolvedValue({ status: "success", fields: ["totp"] });
    const fixture = await renderPicker();
    const totp = fixture.nativeElement.querySelector("[aria-label='填入验证码']") as HTMLButtonElement;
    totp.click();
    await vi.waitFor(() => expect(nativeHost.fillDetected).toHaveBeenCalledOnce());

    expect(nativeHost.fillDetected).toHaveBeenCalledWith({
      fillContextToken: activeContext.fillContextToken,
      authorizations: [{
        scope: expect.objectContaining({ field: "totp", contextToken: "totp-token" }),
        mismatchConfirmed: false,
      }],
    });
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
    expect(nativeHost.copyText).not.toHaveBeenCalled();
  });

  it("uses one visible mismatch confirmation while preserving exact per-field flags", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    candidateHost.queryCandidates.mockImplementation(async (request: { field: AutoFillSecretField }) => ({
      contextToken: `${request.field}-token`,
      candidates: [candidate(
        demoVaultItems[0].id,
        "Example Login",
        "exact",
        "service_identifier",
        request.field === "password",
      )],
    }));
    nativeHost.fillDetected.mockResolvedValue({ status: "success", fields: ["username", "password"] });
    const fixture = await renderPicker();
    const primary = fixture.nativeElement.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement;
    primary.focus();
    primary.click();
    await vi.waitFor(() => expect(fixture.componentInstance.pendingMismatch).not.toBeNull());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll("[data-testid='autofill-mismatch-dialog']")).toHaveLength(1);
    expect(nativeHost.fillDetected).not.toHaveBeenCalled();
    (fixture.nativeElement.querySelector("[data-autofill-dialog-primary]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nativeHost.fillDetected).toHaveBeenCalledOnce());
    expect(nativeHost.fillDetected).toHaveBeenCalledWith({
      fillContextToken: activeContext.fillContextToken,
      authorizations: [
        { scope: expect.objectContaining({ field: "username" }), mismatchConfirmed: false },
        { scope: expect.objectContaining({ field: "password" }), mismatchConfirmed: true },
      ],
    });
    expect(document.activeElement).toBe(primary);
  });

  it("reprompts once for a form and forwards one exact batch receipt", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    nativeHost.beginRepromptBatch.mockResolvedValue({ status: "pending", receipt: "form-receipt" });
    nativeHost.fillDetected.mockResolvedValue({ status: "success", fields: ["username", "password"] });
    const fixture = await renderPicker();
    (fixture.nativeElement.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nativeHost.beginRepromptBatch).toHaveBeenCalledOnce());
    fixture.detectChanges();

    const scopes = nativeHost.beginRepromptBatch.mock.calls[0][0];
    expect(scopes.map((scope) => scope.field)).toEqual(["username", "password"]);
    expect(nativeHost.beginReprompt).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll("[data-testid='autofill-verify-dialog']")).toHaveLength(1);
    (fixture.nativeElement.querySelector("[data-testid='autofill-use-touch-id']") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nativeHost.fillDetected).toHaveBeenCalledOnce());
    expect(nativeHost.biometricReprompt).toHaveBeenCalledWith("account-a", "form-receipt");
    expect(nativeHost.fillDetected).toHaveBeenCalledWith(expect.objectContaining({ repromptReceipt: "form-receipt" }));
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
  });

  it("keeps search mounted, focused, and contextually inferred while delayed queries settle", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;
    const search = host.querySelector("input[type='search']") as HTMLInputElement;
    const delayed = new Map<AutoFillSecretField, ReturnType<typeof deferred<unknown>>>([
      ["username", deferred()], ["password", deferred()], ["totp", deferred()],
    ]);
    candidateHost.queryCandidates.mockImplementation((request: { field: AutoFillSecretField }) => (
      delayed.get(request.field)?.promise ?? Promise.reject(new Error("missing field"))
    ));
    search.focus();
    search.value = "git";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();

    expect(search.isConnected).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(host.querySelector("[data-testid^='autofill-context-']")).toBeNull();
    for (const field of ["username", "password", "totp"] as const) delayed.get(field)?.resolve(response(field));
    await vi.waitFor(() => expect(fixture.componentInstance.query).toBe("git"));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.activeElement).toBe(search);
    expect(host.querySelector("[data-testid^='autofill-context-']")).toBeNull();
  });

  it("Arrow keys move the active option with nearest scrolling and Enter only selects", async () => {
    candidateHost.queryCandidates.mockImplementation(async (request: { field: AutoFillSecretField }) => ({
      contextToken: `${request.field}-token`,
      candidates: [
        candidate(demoVaultItems[0].id, "Example Login", "exact", "service_identifier"),
        candidate("cipher-second", "Second Login", "relevant", "host_or_domain"),
      ],
    }));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const fixture = await renderPicker();
    const listbox = fixture.nativeElement.querySelector("[role='listbox']") as HTMLElement;
    const options = [...fixture.nativeElement.querySelectorAll("[role='option']")] as HTMLElement[];
    const scrollIntoView = vi.fn();
    Object.defineProperty(options[1], "scrollIntoView", { value: scrollIntoView });

    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[1].classList.contains("autofill-picker__option--highlighted")).toBe(false);
    expect(options[1].closest(".autofill-picker__candidate-row")?.classList)
      .toContain("autofill-picker__candidate-row--highlighted");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    fixture.detectChanges();
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(navigate).not.toHaveBeenCalled();
    expect(nativeHost.fillDetected).not.toHaveBeenCalled();
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
  });

  it("keeps the trailing capabilities and Fill action inside the same highlighted row", async () => {
    candidateHost.queryCandidates.mockImplementation(async (request: { field: AutoFillSecretField }) => ({
      contextToken: `${request.field}-token`,
      candidates: [
        candidate(demoVaultItems[0].id, "Example Login", "exact", "service_identifier"),
        candidate("cipher-second", "Second Login", "exact", "service_identifier"),
      ],
    }));
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;
    const primary = host.querySelector("[data-testid='autofill-primary-action-cipher-second']") as HTMLButtonElement;
    const row = primary.closest(".autofill-picker__candidate-row") as HTMLElement;

    primary.focus();
    fixture.detectChanges();

    expect(row.classList).toContain("autofill-picker__candidate-row--highlighted");
    expect(row.querySelector(".autofill-picker__candidate")?.classList)
      .not.toContain("autofill-picker__option--highlighted");
    expect(row.querySelector("[data-testid='autofill-capabilities-cipher-second']")).not.toBeNull();
  });

  it("leaves automatic and low-confidence field button keyboard events to the buttons", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    candidateHost.queryCandidates.mockImplementation(async (request: { field: AutoFillSecretField }) => ({
      contextToken: `${request.field}-token`,
      candidates: [
        candidate(demoVaultItems[0].id, "Example Login", "exact", "service_identifier"),
        candidate("cipher-second", "Second Login", "relevant", "host_or_domain"),
      ],
    }));
    const fixture = await renderPicker();
    const host = fixture.nativeElement as HTMLElement;
    const primary = host.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement;

    for (const key of ["ArrowDown", "Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      primary.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(fixture.componentInstance.highlightedIndex).toBe(0);
    }
    fixture.destroy();

    activeContext = context({
      kind: "unknown", confidence: "low", mode: "choose", fields: ["username", "password"],
    });
    const chooseFixture = await renderPicker();
    const field = chooseFixture.nativeElement.querySelector("[data-testid$='-username']") as HTMLButtonElement;
    for (const key of ["ArrowDown", "Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(chooseFixture.componentInstance.highlightedIndex).toBe(0);
    }
  });

  it("announces one inferred form transition politely after loading", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    const delayed = new Map<AutoFillSecretField, ReturnType<typeof deferred<ReturnType<typeof response>>>>([
      ["username", deferred()], ["password", deferred()], ["totp", deferred()],
    ]);
    candidateHost.queryCandidates.mockImplementation((request: { field: AutoFillSecretField }) => (
      delayed.get(request.field)?.promise ?? Promise.reject(new Error("missing field"))
    ));
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(candidateHost.queryCandidates).toHaveBeenCalledTimes(3));
    fixture.detectChanges();

    const liveRegion = fixture.nativeElement.querySelector("[data-testid='autofill-live-region']") as HTMLElement;
    expect(liveRegion).not.toBeNull();
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.textContent?.trim()).toBe("");
    expect(fixture.nativeElement.querySelectorAll("[aria-live='polite']")).toHaveLength(1);

    for (const field of ["username", "password", "totp"] as const) delayed.get(field)?.resolve(response(field));
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    fixture.detectChanges();
    expect(liveRegion.textContent).toContain("已识别用户名 + 密码");
    expect(fixture.nativeElement.querySelectorAll("[aria-live='polite']")).toHaveLength(1);
  });

  it("shows a fixed localized partial summary without native or plaintext detail", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    nativeHost.fillDetected.mockResolvedValue({
      status: "partial", filled: ["username"], failed: "password", code: "fill-failed",
    });
    const fixture = await renderPicker();
    (fixture.nativeElement.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain("已填入用户名；未能填入密码。"));

    expect(fixture.nativeElement.querySelectorAll("[role='status']")).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain("fill-failed");
    expect(fixture.nativeElement.textContent).not.toContain("one-secret");
  });

  it("fails closed with a fixed stale-target state when context changes", async () => {
    const fixture = await renderPicker();
    activeContext = { ...activeContext, fillContextToken: "00000000-0000-4000-8000-000000000006" };
    (fixture.nativeElement.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain("目标输入框已变化，请重新打开自动填充。"));

    expect(nativeHost.fillDetected).not.toHaveBeenCalled();
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(TestBed.inject(AutoFillContextSessionService).snapshot()).toBeNull();
  });

  it("cancels the exact form receipt and restores focus without filling", async () => {
    activeContext = context({
      kind: "username", confidence: "high", mode: "form", fields: ["username", "password"],
    });
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    nativeHost.beginRepromptBatch.mockResolvedValue({ status: "pending", receipt: "cancel-receipt" });
    const fixture = await renderPicker();
    const primary = fixture.nativeElement.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement;
    primary.focus();
    primary.click();
    await vi.waitFor(() => expect(nativeHost.beginRepromptBatch).toHaveBeenCalledOnce());
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector("[data-testid='autofill-verify-dialog']") as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.detectChanges();
    await vi.waitFor(() => expect(nativeHost.cancelRepromptBatch).toHaveBeenCalledOnce());

    expect(nativeHost.cancelRepromptBatch).toHaveBeenCalledWith(
      nativeHost.beginRepromptBatch.mock.calls[0][0], "cancel-receipt",
    );
    expect(nativeHost.fillDetected).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(primary);
  });

  it("burns a late batch receipt after destroy and never resumes the action", async () => {
    store.setItems([{ ...demoVaultItems[0], reprompt: true }], [], new Date(), "account-a");
    const begin = deferred<{ status: "pending"; receipt: string }>();
    nativeHost.beginRepromptBatch.mockImplementation(() => begin.promise);
    const fixture = await renderPicker();
    (fixture.nativeElement.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nativeHost.beginRepromptBatch).toHaveBeenCalledOnce());
    const scopes = nativeHost.beginRepromptBatch.mock.calls[0][0];
    fixture.destroy();
    begin.resolve({ status: "pending", receipt: "late-receipt" });
    await vi.waitFor(() => expect(nativeHost.cancelRepromptBatch).toHaveBeenCalledWith(scopes, "late-receipt"));

    expect(nativeHost.fillDetected).not.toHaveBeenCalled();
    expect(nativeHost.releaseSecret).not.toHaveBeenCalled();
    expect(nativeHost.pasteText).not.toHaveBeenCalled();
  });

  it("binds and records one successful detected Login selection", async () => {
    const fixture = await renderPicker();
    (fixture.nativeElement.querySelector("[data-testid^='autofill-primary-action-']") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nativeHost.fillDetected).toHaveBeenCalledOnce());
    const bindings = TestBed.inject(AutoFillBindingsService);

    expect(bindings.bindingFor("account-a", activeContext.bundleId)).toBe(demoVaultItems[0].id);
    expect(bindings.snapshot("account-a").history).toEqual([
      expect.objectContaining({ cipherId: demoVaultItems[0].id, successfulSelectionCount: 1 }),
    ]);
  });

  it("keeps locked, setup-repair, unavailable-target, and account-override fail-closed", async () => {
    store.setLocked();
    let fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("[data-testid='autofill-locked']")).not.toBeNull();
    fixture.destroy();

    store.setUnlocked("person@example.test");
    store.setItems([demoVaultItems[0]], [], new Date(), "account-a");
    setupState = "requiresAccessibility";
    fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("repair"));
    expect(fixture.nativeElement.textContent).toContain("辅助功能");
    fixture.destroy();

    setupState = "ready";
    nativeHost.entryContext.mockResolvedValueOnce({ status: "unavailable" });
    fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("context-unavailable"));
    expect(fixture.nativeElement.textContent).toContain("未检测到可填入的输入框");
    fixture.destroy();

    nativeHost.agentSession.mockResolvedValue({
      status: "success",
      accountId: "account-b",
      generation: "00000000-0000-4000-8000-000000000004",
      vaultRevision: 2,
    });
    fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("account-override"));
    await fixture.componentInstance.useProjectedAccount();
    expect(switchAccount).toHaveBeenCalledWith("account-b");
    expect(nativeHost.fillDetected).not.toHaveBeenCalled();
  });

  async function renderPicker() {
    const fixture = TestBed.createComponent(AutoFillPickerComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.mode).toBe("ready"));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
});

interface NativeSpies {
  entryContext: ReturnType<typeof vi.fn>;
  agentSession: ReturnType<typeof vi.fn>;
  beginReprompt: ReturnType<typeof vi.fn>;
  cancelReprompt: ReturnType<typeof vi.fn>;
  beginRepromptBatch: ReturnType<typeof vi.fn>;
  cancelRepromptBatch: ReturnType<typeof vi.fn>;
  biometricReprompt: ReturnType<typeof vi.fn>;
  fillDetected: ReturnType<typeof vi.fn>;
  releaseSecret: ReturnType<typeof vi.fn>;
  pasteText: ReturnType<typeof vi.fn>;
  copyText: ReturnType<typeof vi.fn>;
}

function context(options: {
  kind: DetectedFieldKind;
  confidence: FieldConfidence;
  mode: DetectedFillMode;
  fields: readonly AutoFillSecretField[];
}): LiveAutoFillContext {
  return {
    bundleId: "com.example.App",
    appName: "文本编辑",
    fillContextToken: "00000000-0000-4000-8000-000000000005",
    focusedField: { kind: options.kind, confidence: options.confidence },
    action: { mode: options.mode, fields: options.fields },
  };
}

function candidate(
  cipherId = demoVaultItems[0].id,
  displayName = "Example Login",
  group: "exact" | "relevant" | "other" = "exact",
  reason = "service_identifier",
  requiresMismatchConfirmation = false,
) {
  return {
    cipherId,
    displayName,
    username: "person@example.test",
    group,
    reason,
    requiresMismatchConfirmation,
  };
}

function response(field: AutoFillSecretField) {
  return { contextToken: `${field}-token`, candidates: [candidate()] };
}

function native(readContext: () => LiveAutoFillContext): AutoFillNativeHost & NativeSpies {
  return {
    entryContext: vi.fn<AutoFillNativeHost["entryContext"]>(async () => ({ status: "available", context: readContext() })),
    agentSession: vi.fn<AutoFillNativeHost["agentSession"]>(async () => ({
      status: "success",
      accountId: "account-a",
      generation: "00000000-0000-4000-8000-000000000004",
      vaultRevision: 1,
    })),
    beginReprompt: vi.fn(),
    cancelReprompt: vi.fn(async () => undefined),
    beginRepromptBatch: vi.fn(async () => ({ status: "pending", receipt: "receipt-a" })),
    cancelRepromptBatch: vi.fn(async () => undefined),
    biometricReprompt: vi.fn(async () => "success"),
    fillDetected: vi.fn(async (request: { authorizations: Array<{ scope: { field: AutoFillSecretField } }> }) => ({
      status: "success" as const,
      fields: request.authorizations.map(({ scope }) => scope.field),
    })),
    releaseSecret: vi.fn(),
    pasteText: vi.fn(),
    copyText: vi.fn(),
  } as AutoFillNativeHost & NativeSpies;
}

function actionButtons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("[data-testid^='autofill-field-action-']")];
}

function actionLabels(host: HTMLElement): Array<string | null> {
  return [...host.querySelectorAll<HTMLButtonElement>("[data-testid^='autofill-primary-action-']")]
    .map((button) => button.getAttribute("aria-label"));
}

function capabilityFields(host: HTMLElement): string[] {
  const group = host.querySelector("[data-testid^='autofill-capabilities-']");
  return [...(group?.querySelectorAll<HTMLElement>("[data-autofill-capability]") ?? [])]
    .map((icon) => icon.dataset["autofillCapability"] ?? "");
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
