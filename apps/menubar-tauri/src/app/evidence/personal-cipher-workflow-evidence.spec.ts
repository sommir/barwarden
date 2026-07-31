import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Provider } from "@angular/core";
import "@angular/compiler";
import { describe, expect, it } from "vitest";

import { PopupStateStore } from "../popup-state";
import {
  applyVaultMainEvidenceState,
  vaultMainEvidenceRoute,
} from "../vault/vault-main-evidence-preview";
import { VAULT_CIPHER_WRITE_PORT } from "../vault/vault-cipher-write.service";
import { vaultMainEvidenceStates } from "../vault/vault-main-evidence-state";
import { createEvidenceProviders } from "./evidence-providers";
import { createEvidenceProviders as createProductionEvidenceProviders } from "./evidence-providers.production";

const implementationPath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/evidence/personal-cipher-workflow-evidence.ts",
);

const personalCipherEvidenceStates = [
  "card-detail",
  "card-detail-reprompt",
  "card-form-add",
  "card-form-edit",
  "card-form-clone",
  "identity-detail",
  "identity-detail-reprompt",
  "identity-form-add",
  "identity-form-edit",
  "identity-form-clone",
  "note-detail",
  "note-form-add",
  "note-form-edit",
  "note-form-clone",
  "personal-form-validation",
  "personal-form-failure",
  "personal-form-duplicate",
  "personal-form-stale",
] as const;

describe("M9 personal cipher workflow evidence", () => {
  it("defines the exact fixed state inventory in a production-excluded provider", () => {
    expect(existsSync(implementationPath)).toBe(true);
    const source = readFileSync(implementationPath, "utf8");

    for (const state of personalCipherEvidenceStates) {
      expect(source).toContain(`\"${state}\"`);
      expect(vaultMainEvidenceStates).toContain(state);
    }
    expect(source).not.toMatch(/BARWARDEN_LIVE_|process\.env|import\.meta\.env/);
  });

  it("maps every state to one fixed route without secret query data", () => {
    const routes = new Map<string, string>([
      ["card-detail", "/view-cipher/billing"],
      ["card-detail-reprompt", "/view-cipher/billing"],
      ["card-form-add", "/add-cipher?type=3"],
      ["card-form-edit", "/edit-cipher?cipherId=billing&type=3"],
      ["card-form-clone", "/clone-cipher?cipherId=billing&type=3"],
      ["identity-detail", "/view-cipher/profile"],
      ["identity-detail-reprompt", "/view-cipher/profile"],
      ["identity-form-add", "/add-cipher?type=4"],
      ["identity-form-edit", "/edit-cipher?cipherId=profile&type=4"],
      ["identity-form-clone", "/clone-cipher?cipherId=profile&type=4"],
      ["note-detail", "/view-cipher/recovery"],
      ["note-form-add", "/add-cipher?type=2"],
      ["note-form-edit", "/edit-cipher?cipherId=recovery&type=2"],
      ["note-form-clone", "/clone-cipher?cipherId=recovery&type=2"],
      ["personal-form-validation", "/add-cipher?type=3"],
      ["personal-form-failure", "/add-cipher?type=3"],
      ["personal-form-duplicate", "/add-cipher?type=3"],
      ["personal-form-stale", "/edit-cipher?cipherId=billing&type=3"],
    ]);

    for (const [state, route] of routes) {
      expect(vaultMainEvidenceRoute(state as never)).toBe(route);
      expect(route).not.toMatch(/[?&](?:number|code|ssn|passport|email|notes|itemId)=/i);
    }
  });

  it("seeds only sanitized personal fixtures and enables writes only for form states", () => {
    for (const state of personalCipherEvidenceStates) {
      const store = new PopupStateStore();
      applyVaultMainEvidenceState(store, state as never);
      const snapshot = store.snapshot();
      const serialized = JSON.stringify(snapshot);

      expect(snapshot.serverUrl).toBe("https://vault.example.test");
      expect(serialized).toContain("example.test");
      expect(serialized).not.toMatch(/bitwarden\.(?:com|eu)|BARWARDEN_LIVE_|PRIVATE KEY/i);
      if (state.includes("form-")) {
        expect(snapshot.activeSession?.crypto?.userKeyB64).toBeTruthy();
      }
    }
  });

  it("keeps the production provider unable to construct an M9 fixture", () => {
    expect(createProductionEvidenceProviders("?vaultEvidence=card-form-add", true)).toEqual([]);
    expect(createProductionEvidenceProviders("?vaultEvidence=personal-form-stale", true)).toEqual([]);
  });

  it("returns plain server items so stale ownership is decided outside the fixture", async () => {
    const store = new PopupStateStore();
    applyVaultMainEvidenceState(store, "personal-form-stale" as never);
    const original = store.snapshot().items.find((item) => item.id === "billing")!;
    const providers = createEvidenceProviders("?vaultEvidence=personal-form-stale", true);
    const factory = providerFactory(providers, VAULT_CIPHER_WRITE_PORT) as (
      stateStore: PopupStateStore,
    ) => {
      updateCardCipher(session: unknown, item: typeof original, draft: CardDraft): Promise<unknown>;
    };

    const result = await factory(store).updateCardCipher({}, original, cardDraft("stale-returned-sentinel"));

    expect(result).toMatchObject({ type: "card", name: "stale-returned-sentinel" });
    expect(result).not.toMatchObject({ committed: false, reason: "stale" });
    expect(
      [...store.snapshot().items, ...store.snapshot().archivedItems, ...store.snapshot().deletedItems]
        .map((item) => item.name),
    ).not.toContain("stale-returned-sentinel");
  });
});

interface CardDraft {
  readonly name: string;
  readonly cardholderName: string;
  readonly brand: string;
  readonly number: string;
  readonly expMonth: string;
  readonly expYear: string;
  readonly code: string;
  readonly notes: string;
}

function cardDraft(name: string): CardDraft {
  return {
    name,
    cardholderName: "Example Holder",
    brand: "Visa",
    number: "4242424242424242",
    expMonth: "04",
    expYear: "2029",
    code: "123",
    notes: "Synthetic example.test card notes",
  };
}

function providerFactory(providers: Provider[], token: unknown): unknown {
  return providers
    .filter((provider): provider is { provide: unknown; useFactory: unknown } =>
      typeof provider === "object" && provider !== null && "useFactory" in provider)
    .find((provider) => provider.provide === token)?.useFactory;
}
