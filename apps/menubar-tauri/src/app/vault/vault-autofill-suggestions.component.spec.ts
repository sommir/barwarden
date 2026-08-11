import "@angular/compiler";
import "zone.js";

import { TestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { Router } from "@angular/router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { AutoFillFillActionService } from "../autofill/autofill-fill-action.service";
import {
  immutableAuthorizationMap,
  type ContextualCandidate,
  type LiveAutoFillContext,
} from "../autofill/autofill-fill-context.model";
import type { AutoFillAgentSession } from "../autofill/autofill-native.host";
import {
  AutoFillVaultContextService,
  type AutoFillVaultContextState,
} from "../autofill/autofill-vault-context.service";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { demoVaultItems } from "../vault-demo";
import { VaultRepromptService } from "./vault-reprompt.service";
import { VaultAutoFillSuggestionsComponent } from "./vault-autofill-suggestions.component";

beforeAll(() => {
  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
  }
});

describe("VaultAutoFillSuggestionsComponent", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("leaves the ordinary vault untouched when there is no live contextual match", async () => {
    const harness = await render({ status: "idle" });

    expect(harness.host.querySelector("[data-testid='vault-autofill-suggestions']")).toBeNull();
    expect(harness.host.textContent).not.toContain("自动填充建议");
  });

  it("shows at most five eligible Agent-ranked suggestions with fixed reasons and capabilities", async () => {
    const candidates = [
      candidate("github", "exact", "service_identifier", ["username", "password", "totp"]),
      candidate("login-2", "relevant", "host_or_domain", ["username", "password"]),
      candidate("login-3", "other", "application_name_similar", ["username", "password"]),
      candidate("login-4", "other", "fuzzy_name", ["username", "password"]),
      candidate("login-5", "exact", "user_binding", ["username", "password"]),
      candidate("login-6", "relevant", "vault_uri_rule", ["password"]),
      candidate("login-7", "other", "favorite", ["password"]),
    ];
    const items = [demoVaultItems[0], ...candidates.slice(1).map((value) => ({
      ...demoVaultItems[0],
      id: value.cipherId,
      name: value.displayName,
      fields: demoVaultItems[0].fields.filter((field) => value.availableFields.includes(
        field.id === "otp" ? "totp" : field.id as "username" | "password" | "totp",
      )),
    }))];
    const harness = await render(ready(candidates), items);

    const rows = [...harness.host.querySelectorAll<HTMLElement>("[data-testid='vault-autofill-candidate']")];
    expect(rows.map((row) => row.dataset["cipherId"])).toEqual([
      "github", "login-2", "login-3", "login-4", "login-5",
    ]);
    expect(harness.host.textContent).toContain("自动填充建议");
    expect(harness.host.textContent).toContain("服务标识完全匹配");
    expect(rows[0].querySelectorAll(".bwi-user, .bwi-lock, .bwi-clock")).toHaveLength(3);
    expect(rows[0].querySelector("button[data-testid='vault-autofill-fill']")?.getAttribute("aria-label"))
      .toContain("GitHub");
    expect(rows[0].querySelectorAll("[tabindex='0']")).toHaveLength(0);
  });

  it("opens the exact Login detail from the row body without filling", async () => {
    const harness = await render(ready([candidate("github", "exact", "service_identifier")]));

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-open-details']")?.click();
    await vi.waitFor(() => expect(harness.router.navigateByUrl).toHaveBeenCalledWith("/view-cipher/github"));

    expect(harness.context.select).toHaveBeenCalledWith("github");
    expect(harness.fillActions.execute).not.toHaveBeenCalled();
  });

  it("derives the detected form scope behind one generic Fill action", async () => {
    const formCandidate = candidate("github", "exact", "service_identifier", ["username", "password"]);
    const harness = await render(ready([formCandidate]));
    harness.fillActions.prepare.mockReturnValue(prepared(["username", "password"]));
    harness.fillActions.execute.mockResolvedValue({ status: "success", fields: ["username", "password"] });

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-fill']")?.click();
    await vi.waitFor(() => expect(harness.store.snapshot().statusMessage).toBe("已填入。"));

    expect(harness.fillActions.prepare).toHaveBeenCalledWith(CONTEXT, SESSION, formCandidate);
    expect(harness.context.invalidate).toHaveBeenCalledWith("cancel");
  });

  it("does not guess a field when the native action remains choose", async () => {
    const harness = await render(ready([candidate("github", "exact", "service_identifier")]));
    harness.fillActions.prepare.mockReturnValue({ status: "choose", fields: ["username", "password"] });

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-fill']")?.click();
    await Promise.resolve();

    expect(harness.fillActions.execute).not.toHaveBeenCalled();
    expect(harness.store.snapshot().statusMessage).toBe("无法确定要填入的字段。");
  });

  it("keeps mismatch candidates behind an explicit confirmation", async () => {
    const mismatch = candidate("github", "other", "fuzzy_name", ["username", "password"], true);
    const harness = await render(ready([mismatch]));
    harness.fillActions.prepare.mockReturnValue(prepared(["username", "password"], true));
    harness.fillActions.execute
      .mockResolvedValueOnce({ status: "confirmation-required" })
      .mockResolvedValueOnce({ status: "success", fields: ["username", "password"] });

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-fill']")?.click();
    await vi.waitFor(() => expect(harness.host.querySelector("[data-testid='vault-autofill-mismatch']")).not.toBeNull());
    expect(harness.fillActions.execute).toHaveBeenCalledWith(expect.anything(), {
      mismatchConfirmed: false,
      requiresReprompt: false,
    });

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-confirm-mismatch']")?.click();
    await vi.waitFor(() => expect(harness.store.snapshot().statusMessage).toBe("已填入。"));
    expect(harness.fillActions.execute).toHaveBeenLastCalledWith(expect.anything(), {
      mismatchConfirmed: true,
      requiresReprompt: false,
    });
  });

  it("cancels its active detected action when destroyed", async () => {
    const harness = await render(ready([candidate("github", "exact", "service_identifier")]));
    const action = prepared(["username"]);
    harness.fillActions.prepare.mockReturnValue(action);
    harness.fillActions.execute.mockResolvedValue(new Promise(() => undefined));
    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-fill']")?.click();
    await vi.waitFor(() => expect(harness.fillActions.execute).toHaveBeenCalledOnce());

    harness.fixture.destroy();

    expect(harness.fillActions.cancel).toHaveBeenCalledWith(action);
  });
});

async function render(
  initial: AutoFillVaultContextState,
  items = [demoVaultItems[0]],
) {
  const store = new PopupStateStore();
  store.setItems(items, [], new Date("2026-08-11T00:00:00Z"), "account-a");
  let state = initial;
  const listeners = new Set<() => void>();
  const context = {
    snapshot: vi.fn(() => state),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    select: vi.fn((cipherId: string) => state.status === "ready"
      ? state.candidates.find((value) => value.cipherId === cipherId) ?? null
      : null),
    selected: vi.fn(),
    invalidate: vi.fn(() => {
      state = { status: "idle" };
      for (const listener of listeners) listener();
    }),
  };
  const fillActions = {
    prepare: vi.fn(),
    execute: vi.fn(),
    cancel: vi.fn(async () => undefined),
  };
  const router = { navigateByUrl: vi.fn(async () => true) };
  await TestBed.configureTestingModule({
    imports: [VaultAutoFillSuggestionsComponent],
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: PopupStateStore, useValue: store },
      { provide: AutoFillVaultContextService, useValue: context },
      { provide: AutoFillFillActionService, useValue: fillActions },
      { provide: Router, useValue: router },
      { provide: VaultRepromptService, useValue: { verify: vi.fn() } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(VaultAutoFillSuggestionsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    store,
    context,
    fillActions,
    router,
  };
}

function ready(candidates: readonly ContextualCandidate[]): AutoFillVaultContextState {
  return Object.freeze({
    status: "ready",
    epoch: 1,
    context: CONTEXT,
    session: SESSION,
    candidates: Object.freeze(candidates),
  });
}

function candidate(
  cipherId: string,
  group: "exact" | "relevant" | "other",
  reason: string,
  availableFields: readonly ("username" | "password" | "totp")[] = ["username", "password"],
  mismatch = false,
): ContextualCandidate {
  return Object.freeze({
    cipherId,
    displayName: cipherId === "github" ? "GitHub" : cipherId,
    username: `${cipherId}@example.test`,
    group,
    reason,
    availableFields: Object.freeze([...availableFields]),
    authorizations: immutableAuthorizationMap(availableFields.map((field) => [field, {
      contextToken: `${field}-token`,
      requiresMismatchConfirmation: mismatch,
    }] as const)),
  });
}

function prepared(
  fields: readonly ("username" | "password" | "totp")[],
  mismatch = false,
) {
  return Object.freeze({
    status: "ready" as const,
    context: CONTEXT,
    session: SESSION,
    fields: Object.freeze([...fields]),
    scopes: Object.freeze(fields.map((field) => Object.freeze({
      accountId: "account-a",
      candidateId: "github",
      field,
      generation: SESSION.generation,
      contextToken: `${field}-token`,
    }))),
    mismatchRequiredFields: Object.freeze(mismatch ? [...fields] : []),
    requiresMismatchConfirmation: mismatch,
  });
}

const CONTEXT: LiveAutoFillContext = Object.freeze({
  bundleId: "com.example.Terminal",
  appName: "Terminal",
  fillContextToken: "00000000-0000-4000-8000-000000000005",
  focusedField: Object.freeze({ kind: "password", confidence: "high" }),
  action: Object.freeze({ mode: "form", fields: Object.freeze(["username", "password"]) }),
});

const SESSION: AutoFillAgentSession = Object.freeze({
  accountId: "account-a",
  generation: "00000000-0000-4000-8000-000000000004",
  vaultRevision: 7,
});
