import type { Provider } from "@angular/core";
import "@angular/compiler";
import { beforeEach, describe, expect, it } from "vitest";

import { ACCOUNT_SESSION_PORT } from "../../auth/account-session-port";
import { PASSWORD_LOGIN_PORT } from "../auth/auth.facade";
import { BitwardenApiError } from "../../bitwarden-api/bitwarden-api";
import { BIOMETRIC_HOST_PORT } from "../auth/unlock-methods.service";
import { AUTH_EVIDENCE_STATE } from "../auth/auth-evidence-state";
import { OfficialChallengeAdapter } from "../auth/official-challenge.adapter";
import { VAULT_ACTION_HOST, VAULT_CIPHER_ACTION_PORT } from "../vault/vault-actions.service";
import { VAULT_CIPHER_WRITE_PORT } from "../vault/vault-cipher-write.service";
import { VAULT_FOLDER_API, VAULT_FOLDER_CRYPTO } from "../vault/vault-folder.service";
import { VAULT_MAIN_EVIDENCE_STATE } from "../vault/vault-main-evidence-state";
import { VaultSessionService } from "../vault/vault-session.service";
import { PopupStateStore } from "../popup-state";
import { applyVaultMainEvidenceState } from "../vault/vault-main-evidence-preview";
import { createEvidenceProviders } from "./evidence-providers";

describe("evidence providers", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.bwEvidenceLastHostAction;
    delete document.documentElement.dataset.bwEvidenceHostActionCount;
    delete document.documentElement.dataset.bwEvidenceOutcome;
    delete document.documentElement.dataset.bwEvidenceTransportPending;
    delete document.documentElement.dataset.bwEvidenceTransportCallCount;
    delete document.documentElement.dataset.bwEvidenceRecoveryReceipt;
    delete document.documentElement.dataset.bwEvidenceRecoveryBarrier;
  });

  it("does not provide auth evidence when the compile-time gate is disabled", () => {
    expect(createEvidenceProviders("?authEvidence=account-switcher", false)).toEqual([]);
  });

  it("provides a strict auth state and synthetic account boundary when enabled", () => {
    const providers = createEvidenceProviders("?authEvidence=account-switcher", true);

    expect(providerValue(providers, AUTH_EVIDENCE_STATE)).toBe("account-switcher");
    expect(providerFactory(providers, ACCOUNT_SESSION_PORT)).toBeTypeOf("function");
  });

  it("uses a deterministic invalid-credentials port for the lock-error evidence state", async () => {
    const providers = createEvidenceProviders("?authEvidence=lock-error", true);
    const passwordLogin = providerValue(providers, PASSWORD_LOGIN_PORT) as {
      login(): Promise<never>;
    };

    await expect(passwordLogin.login()).rejects.toMatchObject({
      name: "BitwardenApiError",
      status: 400,
      responseJson: { ErrorModel: { Message: "username or password is incorrect" } },
    } satisfies Partial<BitwardenApiError>);
  });

  it("gives auth evidence precedence over unrelated vault evidence", () => {
    const providers = createEvidenceProviders(
      "?vaultEvidence=populated&authEvidence=long-text",
      true,
    );

    expect(providerValue(providers, AUTH_EVIDENCE_STATE)).toBe("long-text");
    expect(providers).toHaveLength(2);
  });

  it("accepts one popout layout marker while building populated vault evidence", () => {
    const providers = createEvidenceProviders(
      "?vaultEvidence=populated&uilocation=popout",
      true,
    );

    expect(providerValue(providers, VAULT_MAIN_EVIDENCE_STATE)).toBe("populated");
    expect(providerFactory(providers, VaultSessionService)).toBeTypeOf("function");
  });

  it.each([
    ["a missing value", "?vaultEvidence=populated&uilocation"],
    ["a different value", "?vaultEvidence=populated&uilocation=popup"],
    ["duplicate values", "?vaultEvidence=populated&uilocation=popout&uilocation=popout"],
  ])("fails closed for %s on the popout layout marker", (_boundary, search) => {
    expect(() => createEvidenceProviders(search, true)).toThrow("Invalid Vault evidence query");
  });

  it("provides isolated alternative-unlock boundaries only for explicit states", () => {
    const providers = createEvidenceProviders(
      "?authEvidence=alternative-unlock-startup",
      true,
    );

    expect(providerValue(providers, AUTH_EVIDENCE_STATE)).toBe(
      "alternative-unlock-startup",
    );
    expect(providerValue(providers, ACCOUNT_SESSION_PORT)).toBeDefined();
    expect(providerValue(providers, BIOMETRIC_HOST_PORT)).toBeDefined();
  });

  it("isolates challenge evidence from credentialed authentication services", async () => {
    const providers = createEvidenceProviders("?authEvidence=email-two-factor", true);
    const challenge = providerValue(providers, OfficialChallengeAdapter) as {
      providers$: { subscribe(callback: (providers: readonly number[]) => void): void };
      sendEmail(): Promise<void>;
    };
    const observed: readonly number[][] = [];

    challenge.providers$.subscribe((providers) => observed.push(providers));

    await expect(challenge.sendEmail()).resolves.toBeUndefined();
    expect(observed).toEqual([[1, 0]]);
  });

  it("rejects invalid auth evidence before creating any fixture provider", () => {
    expect(() => createEvidenceProviders("?authEvidence=private-host", true)).toThrow(
      "Invalid auth evidence state",
    );
  });

  it("provides a retry service that preserves evidence state without rejecting", async () => {
    delete document.documentElement.dataset.bwEvidenceLastHostAction;
    const providers = createEvidenceProviders("?vaultEvidence=stale", true);
    const factory = providerFactory(providers, VaultSessionService) as () => {
      syncNow(): Promise<void>;
    };

    await expect(factory().syncNow()).resolves.toBeUndefined();
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe("sync_now");
  });

  it("preserves the populated settings-page sync failure fixture", async () => {
    const providers = createEvidenceProviders("?vaultEvidence=populated", true);
    const factory = providerFactory(providers, VaultSessionService) as () => {
      syncNow(): Promise<void>;
    };

    await expect(factory().syncNow()).rejects.toThrow("Synthetic evidence sync failure");
  });

  it("provides a secret-free host action receipt for retained control evidence", async () => {
    const providers = createEvidenceProviders("?vaultEvidence=populated", true);
    const factory = providerFactory(providers, VAULT_ACTION_HOST) as () => {
      copyText(value: string, clearAfterSeconds?: number): Promise<void>;
    };

    await factory().copyText("must-not-be-recorded", 30);

    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe("copy_text");
    expect(document.documentElement.outerHTML).not.toContain("must-not-be-recorded");
  });

  it("backs populated favorite evidence with a synthetic session and typed action port", async () => {
    const store = new PopupStateStore();
    applyVaultMainEvidenceState(store, "populated");
    const providers = createEvidenceProviders("?vaultEvidence=populated", true);
    const factory = providerFactory(providers, VAULT_CIPHER_ACTION_PORT) as (() => {
      updateCipherPartial(session: unknown, itemId: string, request: unknown): Promise<void>;
    }) | undefined;

    expect(store.snapshot().activeSession).not.toBeNull();
    expect(factory).toBeTypeOf("function");
    await expect(
      factory?.().updateCipherPartial(
        store.snapshot().activeSession,
        "profile",
        { favorite: true },
      ),
    ).resolves.toBeUndefined();
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe(
      "update_cipher_partial",
    );
  });

  it("records Login workflow action names without recording field values", async () => {
    const providers = createEvidenceProviders(
      "?vaultEvidence=login-workflow-detail-default",
      true,
    );
    const factory = providerFactory(providers, VAULT_ACTION_HOST) as () => {
      pasteText(value: string): Promise<void>;
      openUrl(value: string): Promise<void>;
    };
    const host = factory();

    await host.pasteText("private-field-value");
    await host.openUrl("https://private.example.test/path");

    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe("open_url");
    expect(document.documentElement.dataset.bwEvidenceHostActionCount).toBe("2");
    expect(document.documentElement.outerHTML).not.toMatch(
      /private-field-value|private\.example\.test/,
    );
  });

  it("does not record a receipt when the Login workflow host action fails", async () => {
    const providers = createEvidenceProviders(
      "?vaultEvidence=login-workflow-detail-action-failure",
      true,
    );
    const factory = providerFactory(providers, VAULT_ACTION_HOST) as () => {
      copyText(value: string): Promise<void>;
    };

    await expect(factory().copyText("failed-private-value")).rejects.toThrow(
      "Synthetic evidence action failure",
    );
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBeUndefined();
    expect(document.documentElement.outerHTML).not.toContain("failed-private-value");
  });

  it("records only the create action name for the Login workflow write port", async () => {
    const providers = createEvidenceProviders(
      "?vaultEvidence=login-workflow-form-add",
      true,
    );
    const factory = providerFactory(providers, VAULT_CIPHER_WRITE_PORT) as (
      store: PopupStateStore,
    ) => {
      createLoginCipher(session: unknown, draft: {
        name: string;
        username: string;
        password: string;
        totp: string;
        uri: string;
        notes: string;
      }): Promise<unknown>;
    };

    await factory(new PopupStateStore()).createLoginCipher({}, {
      name: "Private item",
      username: "private-user",
      password: "private-password",
      totp: "PRIVATE-TOTP-SEED",
      uri: "https://private.example.test",
      notes: "private-notes",
    });

    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe("create_login");
    expect(document.documentElement.dataset.bwEvidenceHostActionCount).toBe("1");
    expect(document.documentElement.outerHTML).not.toMatch(
      /Private item|private-user|private-password|PRIVATE-TOTP-SEED|private-notes/,
    );
  });

  it("does not record a successful write receipt when the evidence transport fails", async () => {
    const providers = createEvidenceProviders(
      "?vaultEvidence=login-workflow-form-save-failure",
      true,
    );
    const factory = providerFactory(providers, VAULT_CIPHER_WRITE_PORT) as (
      store: PopupStateStore,
    ) => {
      createLoginCipher(session: unknown, draft: {
        name: string;
        username: string;
        password: string;
        totp: string;
        uri: string;
        notes: string;
      }): Promise<unknown>;
    };

    await expect(factory(new PopupStateStore()).createLoginCipher({}, {
      name: "Failed private item",
      username: "failed-private-user",
      password: "failed-private-password",
      totp: "FAILED-PRIVATE-TOTP",
      uri: "https://failed-private.example.test",
      notes: "failed-private-notes",
    })).rejects.toThrow("Synthetic evidence save failure");

    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBeUndefined();
    expect(document.documentElement.dataset.bwEvidenceHostActionCount).toBeUndefined();
  });

  it("records only type-aware personal action names without field values", async () => {
    const cardProviders = createEvidenceProviders("?vaultEvidence=card-detail", true);
    const cardHost = (providerFactory(cardProviders, VAULT_ACTION_HOST) as () => {
      copyText(value: string): Promise<void>;
    })();

    await cardHost.copyText("4242424242424242");
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe("copy_card_number");
    expect(document.documentElement.outerHTML).not.toContain("4242424242424242");

    delete document.documentElement.dataset.bwEvidenceLastHostAction;
    delete document.documentElement.dataset.bwEvidenceHostActionCount;
    const identityProviders = createEvidenceProviders("?vaultEvidence=identity-detail", true);
    const identityHost = (providerFactory(identityProviders, VAULT_ACTION_HOST) as () => {
      pasteText(value: string): Promise<void>;
    })();

    await identityHost.pasteText("identity@example.test");
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe("paste_identity_email");
    expect(document.documentElement.outerHTML).not.toContain("identity@example.test");
  });

  it.each([
    ["card-form-add", "createCardCipher", "create_card"],
    ["card-form-edit", "updateCardCipher", "update_card"],
    ["identity-form-edit", "updateIdentityCipher", "update_identity"],
    ["note-form-add", "createSecureNoteCipher", "create_secure_note"],
  ] as const)("records only the %s write action name", async (state, method, receipt) => {
    const store = new PopupStateStore();
    const providers = createEvidenceProviders(`?vaultEvidence=${state}`, true);
    const port = (providerFactory(providers, VAULT_CIPHER_WRITE_PORT) as (
      stateStore: PopupStateStore,
    ) => Record<string, (...args: unknown[]) => Promise<unknown>>)(store);
    const draft = personalDraft(method);
    const original = personalOriginal(method);

    await port[method](
      {},
      ...(method.startsWith("update") ? [original, draft] : [draft]),
    );

    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe(receipt);
    expect(document.documentElement.dataset.bwEvidenceHostActionCount).toBe("1");
    expect(document.documentElement.outerHTML).not.toMatch(
      /private-card|private-identity|private-note|4242424242424242|identity@example\.test/,
    );
  });

  it("emits no success receipt when a personal evidence write fails", async () => {
    const providers = createEvidenceProviders("?vaultEvidence=personal-form-failure", true);
    const port = (providerFactory(providers, VAULT_CIPHER_WRITE_PORT) as (
      store: PopupStateStore,
    ) => {
      createCardCipher(session: unknown, draft: unknown): Promise<unknown>;
    })(new PopupStateStore());

    await expect(port.createCardCipher({}, personalDraft("createCardCipher"))).rejects.toThrow(
      "Synthetic personal evidence save failure",
    );
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBeUndefined();
    expect(document.documentElement.dataset.bwEvidenceHostActionCount).toBeUndefined();
  });

  it.each([
    ["card-form-edit", "updateCardCipher"],
    ["identity-form-edit", "updateIdentityCipher"],
    ["note-form-edit", "updateSecureNoteCipher"],
  ] as const)("returns observably server-transformed %s state", async (state, method) => {
    const providers = createEvidenceProviders(`?vaultEvidence=${state}`, true);
    const port = (providerFactory(providers, VAULT_CIPHER_WRITE_PORT) as (
      stateStore: PopupStateStore,
    ) => Record<string, (...args: unknown[]) => Promise<unknown>>)(new PopupStateStore());
    const draft = personalDraft(method);
    const original = personalOriginal(method);
    const result = await port[method]({}, original, draft);

    expect(result).toEqual(expectedServerEditItem(method));
    expect(result).not.toBe(original);
    expect((result as { name: string }).name).not.toBe(draft.name);
  });

  it("holds duplicate evidence transport behind an explicit release event", async () => {
    const providers = createEvidenceProviders("?vaultEvidence=personal-form-duplicate", true);
    const port = (providerFactory(providers, VAULT_CIPHER_WRITE_PORT) as (
      stateStore: PopupStateStore,
    ) => {
      createCardCipher(session: unknown, draft: unknown): Promise<unknown>;
    })(new PopupStateStore());

    const pending = port.createCardCipher({}, personalDraft("createCardCipher"));
    expect(document.documentElement.dataset.bwEvidenceTransportPending).toBe("true");
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBeUndefined();

    document.dispatchEvent(new Event("bw-evidence-release-personal-write"));
    await expect(pending).resolves.toMatchObject({ id: "m9-created-card" });
    expect(document.documentElement.dataset.bwEvidenceTransportPending).toBeUndefined();
    expect(document.documentElement.dataset.bwEvidenceLastHostAction).toBe("create_card");
  });

  it("registers every typed M10 recovery boundary without production credentials", () => {
    const providers = createEvidenceProviders("?vaultEvidence=archive-list", true);

    for (const token of [VAULT_ACTION_HOST, VAULT_FOLDER_API, VAULT_FOLDER_CRYPTO, VAULT_CIPHER_ACTION_PORT]) {
      expect(providerFactory(providers, token)).toBeTypeOf("function");
    }
    expect(document.documentElement.dataset.bwEvidenceRecoveryReceipt).toBeUndefined();
  });
});

function personalDraft(method: string): Record<string, unknown> {
  if (method.includes("Identity")) {
    return {
      name: "private-identity",
      firstName: "Example",
      lastName: "Identity",
      email: "identity@example.test",
      phone: "+1 555 0100",
      address1: "1 Example Way",
      notes: "private-identity-notes",
    };
  }
  if (method.includes("SecureNote")) {
    return { name: "private-note", notes: "private-note-value", noteType: 0 };
  }
  return {
    name: "private-card",
    cardholderName: "Example Holder",
    brand: "Visa",
    number: "4242424242424242",
    expMonth: "04",
    expYear: "2029",
    code: "123",
    notes: "private-card-notes",
  };
}

function personalOriginal(method: string): Record<string, unknown> {
  const type = method.includes("Identity")
    ? "identity"
    : method.includes("SecureNote") ? "secure-note" : "card";
  return {
    id: `${type}-original`,
    type,
    name: `${type} original`,
    subtitle: "synthetic",
    favorite: false,
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [],
    createdDate: "2026-07-17T00:00:00.000Z",
    revisionDate: "2026-07-17T00:00:00.000Z",
    notes: "",
    canLaunch: false,
    canFill: type === "identity",
    uri: "",
    ...(type === "identity"
      ? {
          identity: {
            title: "",
            firstName: "Example",
            middleName: "",
            lastName: "Identity",
            username: "",
            company: "",
            ssn: "",
            passportNumber: "",
            licenseNumber: "",
            email: "identity@example.test",
            phone: "+1 555 0100",
            address1: "1 Example Way",
            address2: "",
            address3: "",
            city: "Example City",
            state: "CA",
            postalCode: "00000",
            country: "US",
          },
        }
      : type === "secure-note"
        ? { secureNote: { type: 0 } }
        : {
            card: {
              cardholderName: "Example Holder",
              brand: "Visa",
              number: "4242424242424242",
              expMonth: "04",
              expYear: "2029",
              code: "123",
            },
          }
    ),
  };
}

function expectedServerEditItem(method: string): Record<string, unknown> {
  const common = {
    favorite: false,
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    createdDate: "2026-07-17T00:00:00.000Z",
    revisionDate: "2026-07-17T12:00:00.000Z",
    canLaunch: false,
    uri: "",
  };
  if (method === "updateCardCipher") {
    return {
      ...common,
      id: "card-original",
      type: "card",
      name: "Server-confirmed Card example.test",
      subtitle: "•••• 4242",
      fields: [
        { id: "brand", label: "Brand", value: "Visa", type: "text" },
        { id: "cardholder-name", label: "Cardholder", value: "Server Cardholder Example", type: "text" },
        { id: "number", label: "Number", value: "4242424242424242", type: "hidden", concealed: true },
        { id: "exp-month", label: "Expiration month", value: "04", type: "text" },
        { id: "exp-year", label: "Expiration year", value: "2029", type: "text" },
        { id: "code", label: "Security code", value: "123", type: "hidden", concealed: true },
      ],
      card: {
        cardholderName: "Server Cardholder Example",
        brand: "Visa",
        number: "4242424242424242",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
      notes: "private-card-notes",
      canFill: false,
    };
  }
  if (method === "updateIdentityCipher") {
    return {
      ...common,
      id: "identity-original",
      type: "identity",
      name: "Server-confirmed Identity example.test",
      subtitle: "identity@example.test",
      fields: [
        { id: "full-name", label: "Name", value: "Server Identity Example", type: "text" },
        { id: "email", label: "Email", value: "identity@example.test", type: "text" },
        { id: "phone", label: "Phone", value: "+1 555 0100", type: "text" },
        { id: "address", label: "Address", value: "1 Example Way", type: "text" },
      ],
      identity: {
        title: "",
        firstName: "Server",
        middleName: "",
        lastName: "Identity Example",
        username: "",
        company: "",
        ssn: "",
        passportNumber: "",
        licenseNumber: "",
        email: "identity@example.test",
        phone: "+1 555 0100",
        address1: "1 Example Way",
        address2: "",
        address3: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
      },
      notes: "private-identity-notes",
      canFill: true,
    };
  }
  return {
    ...common,
    id: "secure-note-original",
    type: "secure-note",
    name: "Server-confirmed Secure Note example.test",
    subtitle: "Secure note",
    fields: [{
      id: "notes",
      label: "Notes",
      value: "Server-confirmed synthetic note body example.test",
      type: "text",
    }],
    secureNote: { type: 0 },
    notes: "Server-confirmed synthetic note body example.test",
    canFill: false,
  };
}

function providerValue(providers: Provider[], token: unknown): unknown {
  return providers
    .filter((provider): provider is { provide: unknown; useValue: unknown } =>
      typeof provider === "object" && provider !== null && "useValue" in provider)
    .find((provider) => provider.provide === token)?.useValue;
}

function providerFactory(providers: Provider[], token: unknown): unknown {
  return providers
    .filter((provider): provider is { provide: unknown; useFactory: unknown } =>
      typeof provider === "object" && provider !== null && "useFactory" in provider)
    .find((provider) => provider.provide === token)?.useFactory;
}
