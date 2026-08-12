import type { Provider } from "@angular/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { VaultSessionService } from "../vault/vault-session.service";
import { ENVIRONMENT_HANDOFF_HOST } from "./environment-handoff.service";
import {
  SETTINGS_EVIDENCE_STATE,
  settingsEvidenceStates,
} from "./settings-evidence-state";
import {
  applySettingsEvidenceState,
  createSettingsEvidencePreview,
} from "./settings-evidence-preview";
import { createSettingsEvidencePreview as createProductionSettingsEvidencePreview } from "./settings-evidence-preview.production";
import { SettingsService } from "./settings.service";

describe("Settings evidence preview", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.bwEvidenceSettingsReceipts;
    delete document.documentElement.dataset.bwEvidenceSettingsSyncCalls;
  });

  it("activates only for the explicit development evidence query", () => {
    expect(createSettingsEvidencePreview("?settingsEvidence=settings-main", false)).toBeNull();
    expect(createSettingsEvidencePreview("", true)).toBeNull();
    expect(createSettingsEvidencePreview("?vaultEvidence=populated", true)).toBeNull();
    expect(() => createSettingsEvidencePreview(
      "?settingsEvidence=settings-main&vaultEvidence=populated",
      true,
    )).toThrow("Invalid Settings evidence query");
    expect(() => createSettingsEvidencePreview("?settingsEvidence=unknown", true)).toThrow(
      "Invalid Settings evidence state",
    );
  });

  it("declares exactly the nine M13 authority states", () => {
    expect(settingsEvidenceStates).toEqual([
      "settings-main",
      "account-security",
      "vault-settings",
      "vault-settings-sync-failure",
      "one-field-settings",
      "appearance",
      "about",
      "about-dialog",
      "change-password-handoff",
    ]);
  });

  it("provides only synthetic Settings state, sync, and HTTPS handoff boundaries", () => {
    const preview = createSettingsEvidencePreview("?settingsEvidence=vault-settings", true);

    expect(preview?.state).toBe("vault-settings");
    expect(providerValue(preview?.providers ?? [], SETTINGS_EVIDENCE_STATE)).toBe("vault-settings");
    expect(providerFactory(preview?.providers ?? [], VaultSessionService)).toBeTypeOf("function");
    expect(providerFactory(preview?.providers ?? [], ENVIRONMENT_HANDOFF_HOST)).toBeTypeOf("function");
    expect(providerValue(preview?.providers ?? [], AccountService)).toMatchObject({
      activeAccount$: expect.anything(),
    });
    expect(providerValue(preview?.providers ?? [], AvatarService)).toMatchObject({
      avatarColor$: expect.anything(),
    });
    expect(providerValue(preview?.providers ?? [], AuthService)).toMatchObject({
      activeAccountStatus$: expect.anything(),
    });
  });

  it("initializes fixed credential-free state at the example Web Vault", () => {
    const store = new PopupStateStore();
    const settings = new SettingsService();

    expect(applySettingsEvidenceState(store, settings, "account-security")).toBe(
      "/account-security",
    );
    expect(store.snapshot()).toMatchObject({
      activeSession: null,
      email: "m13-settings-runtime",
      isUnlocked: true,
      serverUrl: "https://vault.example.test",
    });
    expect(settings.snapshot()).toEqual({
      animations: true,
      biometricEnabled: false,
      clipboardClearSeconds: 30,
      compactMode: false,
      fillMode: "clipboard-paste",
      language: null,
      showFavicons: true,
      showInputFieldIcon: true,
      showQuickCopyActions: true,
      theme: "system",
      vaultTimeoutMinutes: 5,
      vaultTimeoutAction: "lock",
    });
    expect(document.documentElement.outerHTML).not.toMatch(
      /accessToken|refreshToken|userKey|credential|password|clipboard value/i,
    );
  });

  it("records command names and sanitized destinations without retaining URLs or values", async () => {
    const preview = createSettingsEvidencePreview("?settingsEvidence=about", true);
    const host = (providerFactory(preview?.providers ?? [], ENVIRONMENT_HANDOFF_HOST) as () => HostApi)();

    await host.openUrl("https://vault.example.test/#/settings/security/password");
    await host.openUrl("https://bitwarden.com/help/");
    await expect(host.openUrl("https://outside.example.test/private?token=value")).rejects.toThrow(
      "Unsupported Settings evidence destination",
    );

    expect(document.documentElement.dataset.bwEvidenceSettingsReceipts).toBe(
      "open_url:web-vault-password,open_url:help",
    );
    expect(document.documentElement.outerHTML).not.toMatch(
      /outside\.example\.test|token=value|#\/settings\/security\/password/,
    );
  });

  it("keeps sync receipts deterministic and exposes a recoverable failure", async () => {
    const success = createSettingsEvidencePreview("?settingsEvidence=vault-settings", true);
    const successSync = (providerFactory(success?.providers ?? [], VaultSessionService) as (_store: PopupStateStore) => {
      syncNow(): Promise<void>;
    })(new PopupStateStore());
    await expect(successSync.syncNow()).resolves.toBeUndefined();

    const failure = createSettingsEvidencePreview(
      "?settingsEvidence=vault-settings-sync-failure",
      true,
    );
    const failureSync = (providerFactory(failure?.providers ?? [], VaultSessionService) as (_store: PopupStateStore) => {
      syncNow(): Promise<void>;
    })(new PopupStateStore());
    await expect(failureSync.syncNow()).rejects.toThrow("Synthetic Settings sync failure");
    await expect(failureSync.syncNow()).resolves.toBeUndefined();

    expect(document.documentElement.dataset.bwEvidenceSettingsSyncCalls).toBe("3");
  });

  it("terminates the production provider at null without fixture imports", () => {
    expect(createProductionSettingsEvidencePreview("?settingsEvidence=settings-main", true)).toBeNull();
    const source = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/settings/settings-evidence-preview.production.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/settings-evidence-state|vault\.example\.test|m13-settings-runtime/);
  });
});

function providerValue(providers: readonly Provider[], token: unknown): unknown {
  return providers
    .filter((provider): provider is { provide: unknown; useValue: unknown } =>
      typeof provider === "object" && provider !== null && "useValue" in provider)
    .find((provider) => provider.provide === token)?.useValue;
}

function providerFactory(providers: readonly Provider[], token: unknown): unknown {
  return providers
    .filter((provider): provider is { provide: unknown; useFactory: unknown } =>
      typeof provider === "object" && provider !== null && "useFactory" in provider)
    .find((provider) => provider.provide === token)?.useFactory;
}
