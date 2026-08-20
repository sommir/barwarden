import "@angular/compiler";
import "zone.js";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { Router } from "@angular/router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { AutoFillFillActionService } from "../autofill/autofill-fill-action.service";
import { AutoFillFieldActionService } from "../autofill/autofill-field-action.service";
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

  it.each(["context", "setup", "session", "account"] as const)(
    "hides the entire AutoFill group for an unavailable %s context",
    async (reason) => {
    const harness = await render({ status: "unavailable", reason });

      expect(harness.host.querySelector("[data-testid='vault-autofill-status']")).toBeNull();
      expect(harness.host.querySelector("[data-testid='vault-autofill-suggestions']")).toBeNull();
      expect(harness.host.textContent?.trim()).toBe("");
    },
  );

  it("shows at most five eligible Agent-ranked suggestions without exposing match reasons", async () => {
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
    expect(harness.host.textContent).not.toContain("服务标识完全匹配");
    expect(harness.host.textContent).not.toContain("名称相似");
    expect(rows[0].querySelector("[data-testid='vault-autofill-candidate-subtitle']")?.textContent?.trim())
      .toBe("github@example.test");
    expect(rows[0].querySelectorAll(".bwi-user, .bwi-key, .bwi-clock")).toHaveLength(3);
    expect(rows[0].querySelector("button[data-testid='vault-autofill-fill']")?.getAttribute("aria-label"))
      .toContain("GitHub");
    expect(rows[0].querySelectorAll("[tabindex='0']")).toHaveLength(0);
  });

  it("uses the shared vault disclosure group and can collapse its candidate rows", async () => {
    const harness = await render(ready([
      candidate("github", "exact", "service_identifier", ["username", "password"]),
    ]));

    const disclosure = harness.host.querySelector("bw-vault-disclosure-group[data-testid='vault-autofill-suggestions']");
    const trigger = disclosure?.querySelector<HTMLButtonElement>("[data-vault-group-trigger]");
    expect(disclosure).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(disclosure?.querySelector("[data-testid='vault-autofill-candidate']")).not.toBeNull();

    trigger?.click();
    harness.fixture.detectChanges();

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure?.querySelector("[data-testid='vault-autofill-candidate']")).not.toBeNull();
    expect(disclosure?.querySelector(".vault-hierarchy__content")?.getAttribute("aria-hidden"))
      .toBe("true");
  });

  it("does not reserve a blank subtitle line when a candidate has no username", async () => {
    const withoutUsername = Object.freeze({
      ...candidate("github", "exact", "service_identifier", ["password"]),
      username: "",
    });
    const harness = await render(ready([withoutUsername]));

    expect(harness.host.querySelector("[data-testid='vault-autofill-candidate-subtitle']"))
      .toBeNull();
  });

  it("composes suggestions from the same official item primitives as the retained vault list", async () => {
    const harness = await render(ready([
      candidate("github", "exact", "service_identifier", ["username", "password", "totp"]),
    ]));

    const group = harness.host.querySelector("bit-item-group[data-testid='vault-autofill-suggestion-group']");
    const row = group?.querySelector("bit-item[data-testid='vault-autofill-candidate']");

    expect(harness.host.querySelector(".vault-hierarchy > bw-vault-disclosure-group[data-testid='vault-autofill-suggestions']"))
      .not.toBeNull();
    expect(group).not.toBeNull();
    expect(row?.querySelector("button[bit-item-content][data-testid='vault-autofill-open-details']"))
      .not.toBeNull();
    expect(row?.querySelector("bw-vault-item-icon")).not.toBeNull();
    expect(row?.querySelector("[data-testid='vault-autofill-capability-summary']")).toBeNull();
    expect(row?.querySelectorAll("bit-item-action > button[biticonbutton][data-testid='vault-autofill-field-action']"))
      .toHaveLength(3);
    const actionFields = [...row!.querySelectorAll<HTMLElement>(
      '[data-testid="vault-autofill-field-action"]',
    )].map((button) => button.dataset["field"]);
    expect(actionFields).toEqual(["username", "password", "totp"]);
    expect(row?.querySelector("button[biticonbutton='bwi-user'][data-field='username']"))
      .not.toBeNull();
    expect(row?.querySelector("button[biticonbutton='bwi-key'][data-field='password']"))
      .not.toBeNull();
    expect(row?.querySelector("button[biticonbutton='bwi-clock'][data-field='totp']"))
      .not.toBeNull();
    expect(row?.querySelector("button[biticonbutton='bwi-user']")?.getAttribute("aria-label"))
      .toContain("用户名");
    expect(row?.querySelector("bit-item-action button[data-testid='vault-autofill-fill']"))
      .not.toBeNull();
    expect(row?.querySelector("app-item-more-options")).toBeNull();
    expect(row?.querySelector("[data-testid='vault-autofill-quick-copy']")).toBeNull();
    expect(row?.classList).toContain("vault-list-row");
    expect(row?.querySelector("[data-testid='vault-autofill-candidate-name']")?.className)
      .toContain("tw-truncate");
    expect(row?.querySelector("[data-testid='vault-autofill-candidate-name']")?.className)
      .not.toContain("tw-font-semibold");
    expect(row?.querySelector("[data-testid='vault-autofill-candidate-subtitle']")?.className)
      .toContain("tw-truncate");
    expect(row?.querySelector(".vault-autofill-suggestions__row")).toBeNull();
    expect(row?.querySelector(".vault-autofill-suggestions__capabilities")).toBeNull();
  });

  it("renders only username and TOTP capability actions before the generic Fill action", async () => {
    const selected = candidate(
      "github",
      "exact",
      "service_identifier",
      ["username", "totp"],
    );
    const item = {
      ...demoVaultItems[0],
      fields: demoVaultItems[0].fields.filter((field) =>
        field.id === "username" || field.id === "otp"),
    };
    const harness = await render(ready([selected]), [item]);
    const row = harness.host.querySelector<HTMLElement>(
      "[data-testid='vault-autofill-candidate']",
    )!;
    const actions = Array.from(row.querySelectorAll<HTMLButtonElement>(
      "[data-testid='vault-autofill-field-action'], [data-testid='vault-autofill-fill']",
    ));

    expect(actions.map((action) => action.dataset["field"] ?? "fill"))
      .toEqual(["username", "totp", "fill"]);
    expect(row.querySelector('[data-field="password"]')).toBeNull();
    expect(actions.slice(0, 2).map((action) => action.getAttribute("aria-label")))
      .toEqual([
        "使用GitHub填入用户名",
        "使用GitHub填入验证码",
      ]);
  });

  it("computes real suggestion rows at 48/44px with 44px owners and 32/28px glyph plates", async () => {
    const harness = await render(ready([
      candidate("github", "exact", "service_identifier", ["username", "password", "totp"]),
    ]));
    const cleanupCss = installInteractionCss();

    try {
      const row = harness.host.querySelector<HTMLElement>(
        "[data-testid='vault-autofill-candidate']",
      )!;
      const details = row.querySelector<HTMLElement>(
        "[data-testid='vault-autofill-open-details']",
      )!;
      const fill = row.querySelector<HTMLElement>("[data-testid='vault-autofill-fill']")!;
      const controls = row.querySelectorAll<HTMLElement>(
        "[data-testid='vault-autofill-field-action'], [data-testid='vault-autofill-fill']",
      );
      const fieldActions = row.querySelectorAll<HTMLElement>(
        "[data-testid='vault-autofill-field-action']",
      );
      const glyphs = row.querySelectorAll<HTMLElement>(
        "[data-testid='vault-autofill-field-action'] .bwi",
      );

      expect(row.classList).toContain("macos-row--double");
      expect(getComputedStyle(row).minHeight).toBe("48px");
      expect(getComputedStyle(details).height).toBe("auto");
      expect(Array.from(controls, (control) => [
        getComputedStyle(control).minWidth,
        getComputedStyle(control).minHeight,
      ])).toEqual(Array.from(controls, () => ["44px", "44px"]));
      expect(Array.from(fieldActions, (action) => action.classList.contains("macos-hit-target")))
        .toEqual(Array.from(fieldActions, () => true));
      expect(Array.from(glyphs, (glyph) => [
        getComputedStyle(glyph).width,
        getComputedStyle(glyph).height,
      ])).toEqual(Array.from(glyphs, () => ["32px", "32px"]));
      expect(getComputedStyle(fill).minWidth).toBe("44px");
      expect(getComputedStyle(row).borderRadius).toBe("0px");
      expect(getComputedStyle(row).boxShadow).toBe("none");

      document.documentElement.setAttribute("data-bw-compact-mode", "true");
      expect(getComputedStyle(row).minHeight).toBe("44px");
      expect(Array.from(glyphs, (glyph) => [
        getComputedStyle(glyph).width,
        getComputedStyle(glyph).height,
      ])).toEqual(Array.from(glyphs, () => ["28px", "28px"]));
    } finally {
      document.documentElement.removeAttribute("data-bw-compact-mode");
      harness.fixture.destroy();
      cleanupCss();
    }
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

  it("keeps application-ranked suggestions and field icons when no field is detected, without a primary Fill", async () => {
    const harness = await render(ready([
      candidate("github", "exact", "service_identifier", ["username", "password", "totp"]),
    ], null));

    expect(harness.host.querySelector("[data-testid='vault-autofill-suggestions']")).not.toBeNull();
    expect(harness.host.querySelector("[data-testid='vault-autofill-fill']")).toBeNull();
    expect(harness.host.querySelectorAll("[data-testid='vault-autofill-field-action']")).toHaveLength(3);
  });

  it("runs one explicit field action from each candidate icon", async () => {
    const selected = candidate("github", "exact", "service_identifier", ["username", "password", "totp"]);
    const harness = await render(ready([selected]));
    harness.fieldActions.execute.mockResolvedValue({ status: "filled", field: "password" });

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-field-action'][data-field='password']")?.click();
    expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.fieldActions.execute).toHaveBeenCalledWith(
      { application: APPLICATION, fillContext: CONTEXT }, SESSION, selected, "password",
      { mismatchConfirmed: false, requiresReprompt: false },
    ));
    expect(harness.store.snapshot().statusMessage).toBe("已填入。");
  });

  it("continues an explicit field action only after mismatch confirmation", async () => {
    const selected = candidate("github", "other", "fuzzy_name", ["password"], true);
    const harness = await render(ready([selected]));
    harness.fieldActions.execute
      .mockResolvedValueOnce({ status: "confirmation-required" })
      .mockResolvedValueOnce({ status: "filled", field: "password" });

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-field-action']")?.click();
    await vi.waitFor(() => expect(harness.host.querySelector("[data-testid='vault-autofill-mismatch']")).not.toBeNull());
    expect(harness.fieldActions.execute).toHaveBeenCalledWith(
      { application: APPLICATION, fillContext: CONTEXT }, SESSION, selected, "password",
      { mismatchConfirmed: false, requiresReprompt: false },
    );

    harness.host.querySelector<HTMLButtonElement>("[data-testid='vault-autofill-confirm-mismatch']")?.click();
    await vi.waitFor(() => expect(harness.store.snapshot().statusMessage).toBe("已填入。"));
    expect(harness.fieldActions.execute).toHaveBeenLastCalledWith(
      { application: APPLICATION, fillContext: CONTEXT }, SESSION, selected, "password",
      { mismatchConfirmed: true, requiresReprompt: false },
    );
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
  const fieldActions = {
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
      { provide: AutoFillFieldActionService, useValue: fieldActions },
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
    fieldActions,
    router,
  };
}

function ready(candidates: readonly ContextualCandidate[], fillContext: LiveAutoFillContext | null = CONTEXT): AutoFillVaultContextState {
  return Object.freeze({
    status: "ready",
    epoch: 1,
    application: APPLICATION,
    context: fillContext,
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
const APPLICATION = Object.freeze({ bundleId: CONTEXT.bundleId, appName: CONTEXT.appName });

const SESSION: AutoFillAgentSession = Object.freeze({
  accountId: "account-a",
  generation: "00000000-0000-4000-8000-000000000004",
  vaultRevision: 7,
});

function installInteractionCss(): () => void {
  const style = document.createElement("style");
  style.textContent = [
    "apps/menubar-tauri/src/styles/macos-tokens.css",
    "apps/menubar-tauri/src/styles/global.css",
    "apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css",
  ]
    .map((filename) => readFileSync(join(process.cwd(), filename), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    resolveCssVariable(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || value,
  );
  return () => style.remove();
}

function resolveCssVariable(
  value: string,
  rootStyle: CSSStyleDeclaration,
  seen: Set<string>,
): string {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, name) => {
    if (seen.has(name)) return reference;
    const next = rootStyle.getPropertyValue(name).trim();
    if (!next) return reference;
    return resolveCssVariable(next, rootStyle, new Set([...seen, name]));
  });
}
