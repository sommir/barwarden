import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import "@angular/compiler";
import { describe, expect, it } from "vitest";

import { ACCOUNT_SESSION_PORT } from "../../auth/account-session-port";
import { PopupStateStore } from "../popup-state";
import { VAULT_SYNC_PORT } from "../auth/vault-sync.shared";
import { VAULT_MAIN_EVIDENCE_STATE } from "../vault/vault-main-evidence-state";
import {
  applyVaultMainEvidenceState,
  vaultMainEvidenceRoute,
} from "../vault/vault-main-evidence-preview";
import { vaultMainEvidenceStates } from "../vault/vault-main-evidence-state";
import { createEvidenceProviders } from "./evidence-providers";
import { createEvidenceProviders as createProductionEvidenceProviders } from "./evidence-providers.production";

const implementationPath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.ts",
);
const productionShimPath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.production.ts",
);

const recoveryEvidenceStates = [
  "password-history-populated",
  "password-history-empty",
  "password-history-reprompt",
  "folders-list",
  "folders-empty",
  "folders-add-dialog",
  "folders-edit-dialog",
  "folders-delete-confirmation",
  "archive-list",
  "archive-menu",
  "archive-empty",
  "trash-list",
  "trash-menu",
  "trash-permanent-delete-confirmation",
  "trash-empty",
  "recovery-operation-error",
] as const;

const forbiddenReceiptKeys = [
  "folderName",
  "password",
  "itemName",
  "url",
  "serverUrl",
  "accountId",
  "token",
  "payload",
] as const;

describe("M10 recovery workflow evidence", () => {
  it("defines the exact fixed state inventory and secret-free receipt contract", () => {
    expect(existsSync(implementationPath), "M10 recovery evidence provider must exist").toBe(true);
    const source = readFileSync(implementationPath, "utf8");

    for (const state of recoveryEvidenceStates) {
      expect(source).toContain(`"${state}"`);
      expect(vaultMainEvidenceStates).toContain(state);
    }
    expect(source).toContain("export interface RecoveryEvidenceReceipt");
    expect(source).toContain('readonly outcome: "committed" | "duplicate" | "failure" | "stale" | "cancelled"');
    for (const key of forbiddenReceiptKeys) {
      expect(receiptInterface(source)).not.toContain(key);
    }
    expect(source).not.toMatch(/BARWARDEN_LIVE_|process\.env|import\.meta\.env/);
  });

  it("maps every recovery state to a fixed secret-free route", () => {
    const expectedRoutes = new Map<string, string>([
      ["password-history-populated", "/cipher-password-history?cipherId=calendar"],
      ["password-history-empty", "/cipher-password-history?cipherId=calendar"],
      ["password-history-reprompt", "/cipher-password-history?cipherId=calendar"],
      ["folders-list", "/folders"],
      ["folders-empty", "/folders"],
      ["folders-add-dialog", "/folders"],
      ["folders-edit-dialog", "/folders"],
      ["folders-delete-confirmation", "/folders"],
      ["archive-list", "/archive"],
      ["archive-menu", "/archive"],
      ["archive-empty", "/archive"],
      ["trash-list", "/trash"],
      ["trash-menu", "/trash"],
      ["trash-permanent-delete-confirmation", "/trash"],
      ["trash-empty", "/trash"],
      ["recovery-operation-error", "/folders"],
    ]);

    for (const [state, route] of expectedRoutes) {
      expect(vaultMainEvidenceRoute(state as never)).toBe(route);
      expect(route).not.toMatch(/[?&](?:password|folderName|itemName|url|serverUrl|accountId|token)=/i);
    }
  });

  it("seeds four synthetic personal types and only example.test endpoints", () => {
    for (const state of recoveryEvidenceStates) {
      const store = new PopupStateStore();
      applyVaultMainEvidenceState(store, state as never);
      const snapshot = store.snapshot();
      const serialized = JSON.stringify(snapshot);
      const itemTypes = new Set([
        ...snapshot.items,
        ...snapshot.archivedItems,
        ...snapshot.deletedItems,
      ].map((item) => item.type));

      expect(snapshot.serverUrl).toBe("https://vault.example.test");
      expect(serialized).not.toMatch(/bitwarden\.(?:com|eu)|BARWARDEN_LIVE_|PRIVATE KEY/i);
      if (!state.endsWith("empty") && !state.startsWith("folders")) {
        expect(itemTypes).toEqual(new Set(["login", "card", "identity", "secure-note"]));
      }
    }
  });

  it("seeds two distinct non-empty selected history values for the native copy boundary", () => {
    const store = new PopupStateStore();
    applyVaultMainEvidenceState(store, "password-history-populated");
    const history = store.snapshot().items.find((item) => item.id === "calendar")?.passwordHistory ?? [];

    expect(history).toHaveLength(2);
    expect(history.every((entry) => entry.password.length > 0)).toBe(true);
    expect(new Set(history.map((entry) => entry.password)).size).toBe(2);
  });

  it("uses secure account persistence and a typed fresh-sync port for recovery startup", () => {
    const providers = createEvidenceProviders(
      "?vaultEvidence=folders-list&recoveryStartup=1",
      true,
    );
    const source = readFileSync(implementationPath, "utf8");

    expect(providerFactory(providers, ACCOUNT_SESSION_PORT)).toBeTypeOf("function");
    expect(providerFactory(providers, VAULT_SYNC_PORT)).toBeTypeOf("function");
    expect(providerValue(providers, VAULT_MAIN_EVIDENCE_STATE)).toBeNull();
    expect(source).toContain("AccountSessionStore");
    expect(source).toContain("secureGet");
    expect(source).toContain("secureSet");
    expect(source).not.toContain("bwEvidenceCacheRelaunch");
  });

  it("registers typed recovery ports only for recovery evidence states", () => {
    const providers = createEvidenceProviders("?vaultEvidence=archive-list", true);
    const source = readFileSync(implementationPath, "utf8");

    expect(providers.length).toBeGreaterThan(5);
    expect(source).toContain("createRecoveryWorkflowEvidenceProviders");
    expect(source).toContain("RecoveryEvidenceReceipt");
  });

  it("terminates production recovery aliases at empty shims", () => {
    expect(existsSync(productionShimPath), "M10 production evidence shim must exist").toBe(true);
    expect(readFileSync(productionShimPath, "utf8")).toMatch(/return \[\];/);
    for (const state of recoveryEvidenceStates) {
      expect(createProductionEvidenceProviders(`?vaultEvidence=${state}`, true)).toEqual([]);
    }
  });
});

function receiptInterface(source: string): string {
  return source.slice(
    source.indexOf("export interface RecoveryEvidenceReceipt"),
    source.indexOf("}", source.indexOf("export interface RecoveryEvidenceReceipt")) + 1,
  );
}

function providerFactory(providers: readonly import("@angular/core").Provider[], token: unknown): unknown {
  return (providers.find((provider) =>
    typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === token
  ) as { useFactory?: unknown } | undefined)?.useFactory;
}

function providerValue(providers: readonly import("@angular/core").Provider[], token: unknown): unknown {
  return (providers.find((provider) =>
    typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === token
  ) as { useValue?: unknown } | undefined)?.useValue;
}
