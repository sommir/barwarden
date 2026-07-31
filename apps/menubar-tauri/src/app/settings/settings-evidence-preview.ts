import type { Provider } from "@angular/core";
import { of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import type { UserId } from "@bitwarden/common/types/guid";
import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import { VaultSessionService } from "../vault/vault-session.service";
import { ENVIRONMENT_HANDOFF_HOST } from "./environment-handoff.service";
import {
  SETTINGS_EVIDENCE_STATE,
  settingsEvidenceStates,
  type SettingsEvidenceState,
} from "./settings-evidence-state";
import { SettingsService } from "./settings.service";

const evidenceSubjectId = "m13-settings-runtime";
const evidenceWebVaultUrl = "https://vault.example.test";
const evidenceSyncDate = new Date("2026-07-20T04:00:00.000Z");
const evidenceUserId = evidenceSubjectId as UserId;

export interface SettingsEvidencePreview {
  readonly state: SettingsEvidenceState;
  readonly providers: readonly Provider[];
}

export function createSettingsEvidencePreview(
  search: string,
  evidenceEnabled = import.meta.env.VITE_BW_VAULT_EVIDENCE === "true",
): SettingsEvidencePreview | null {
  const state = resolveSettingsEvidenceState(evidenceEnabled, search);
  if (!state) return null;

  return {
    state,
    providers: [
      { provide: SETTINGS_EVIDENCE_STATE, useValue: state },
      {
        provide: AccountService,
        useValue: {
          activeAccount$: of({
            id: evidenceUserId,
            name: "Evidence Vault",
            email: "vault-user@example.test",
          }),
        },
      },
      {
        provide: AvatarService,
        useValue: {
          avatarColor$: of("#175ddc"),
        },
      },
      {
        provide: AuthService,
        useValue: {
          activeAccountStatus$: of(AuthenticationStatus.Unlocked),
        },
      },
      {
        provide: VaultSessionService,
        deps: [PopupStateStore],
        useFactory: (store: PopupStateStore) => createSettingsEvidenceSync(state, store),
      },
      {
        provide: ENVIRONMENT_HANDOFF_HOST,
        useFactory: createSettingsEvidenceHost,
      },
    ],
  };
}

function resolveSettingsEvidenceState(
  enabled: boolean,
  search: string,
): SettingsEvidenceState | null {
  if (!enabled) return null;
  const params = new URLSearchParams(search);
  if (!params.has("settingsEvidence")) return null;
  const entries = [...params.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "settingsEvidence") {
    throw new Error("Invalid Settings evidence query");
  }
  const value = entries[0][1];
  if (!(settingsEvidenceStates as readonly string[]).includes(value)) {
    throw new Error("Invalid Settings evidence state");
  }
  return value as SettingsEvidenceState;
}

export function applySettingsEvidenceState(
  store: PopupStateStore,
  settings: SettingsService,
  state: SettingsEvidenceState,
): string {
  resetSettings(settings);
  store.setServerUrl(evidenceWebVaultUrl);
  store.setUnlocked(evidenceSubjectId);
  store.setItems([], [], evidenceSyncDate);

  const root = globalThis.document?.documentElement;
  if (root) {
    delete root.dataset.bwEvidenceSettingsReceipts;
    delete root.dataset.bwEvidenceSettingsSyncCalls;
  }

  switch (state) {
    case "settings-main": return "/tabs/settings";
    case "account-security": return "/account-security";
    case "vault-settings":
    case "vault-settings-sync-failure": return "/vault-settings";
    case "one-field-settings": return "/autofill";
    case "appearance": return "/appearance";
    case "about":
    case "about-dialog": return "/about";
    case "change-password-handoff": return "/settings-password";
  }
}

function resetSettings(settings: SettingsService): void {
  try {
    globalThis.localStorage?.removeItem("barwarden.settings");
    globalThis.localStorage?.removeItem(
      `barwarden.account-settings.${evidenceSubjectId}`,
    );
  } catch {
    // The in-memory reset below remains deterministic in restricted WebViews.
  }
  settings.useAccount(null);
  settings.setAnimations(true);
  settings.setClipboardClearSeconds(30);
  settings.setCompactMode(false);
  settings.setFillMode("clipboard-paste");
  settings.setShowFavicons(true);
  settings.setShowQuickCopyActions(true);
  settings.setTheme("system");
  settings.useAccount(evidenceSubjectId);
  settings.setVaultTimeoutMinutes(5);
  settings.setVaultTimeoutAction("lock");
}

function createSettingsEvidenceSync(state: SettingsEvidenceState, store: PopupStateStore) {
  let failNext = state === "vault-settings-sync-failure";
  let releasePendingSync: (() => void) | null = null;
  globalThis.__bwReleaseSettingsEvidenceSync = () => releasePendingSync?.();

  return {
    async syncNow(): Promise<void> {
      recordSyncCall();
      if (failNext) {
        failNext = false;
        throw new Error("Synthetic Settings sync failure");
      }
      const isInteractiveHold = state === "vault-settings"
        && new URLSearchParams(globalThis.location?.search ?? "").get("settingsEvidence") === state;
      if (isInteractiveHold) {
        await new Promise<void>((resolve) => {
          releasePendingSync = resolve;
        });
        releasePendingSync = null;
      }
      store.setItems(store.snapshot().items, store.snapshot().folders, evidenceSyncDate);
    },
  };
}

function createSettingsEvidenceHost(): HostApi {
  return {
    showPopup: async () => undefined,
    hidePopup: async () => undefined,
    copyText: async () => undefined,
    pasteText: async () => undefined,
    openUrl: async (url) => recordDestination(url),
    secureGet: async () => null,
    secureSet: async () => undefined,
    secureDelete: async () => undefined,
    getAccountLockIntents: async () => [],
    setAccountLockIntents: async () => undefined,
  };
}

function recordDestination(url: string): void {
  const destinations = new Map([
    [evidenceWebVaultUrl, "web-vault"],
    [`${evidenceWebVaultUrl}/#/settings/security/password`, "web-vault-password"],
    ["https://bitwarden.com/help/", "help"],
    ["https://bitwarden.com/help/setup-two-step-login/", "two-step-login-help"],
    [
      "https://github.com/bitwarden/clients/tree/f47b6946e01aed474875789081966d311d5b8289",
      "upstream-source",
    ],
  ]);
  const destination = destinations.get(url);
  if (!destination) throw new Error("Unsupported Settings evidence destination");
  recordReceipt(`open_url:${destination}`);
}

function recordReceipt(receipt: string): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  const receipts = root.dataset.bwEvidenceSettingsReceipts?.split(",").filter(Boolean) ?? [];
  root.dataset.bwEvidenceSettingsReceipts = [...receipts, receipt].join(",");
}

function recordSyncCall(): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.dataset.bwEvidenceSettingsSyncCalls = String(
    Number(root.dataset.bwEvidenceSettingsSyncCalls ?? "0") + 1,
  );
}

declare global {
  var __bwReleaseSettingsEvidenceSync: (() => void) | undefined;
}
