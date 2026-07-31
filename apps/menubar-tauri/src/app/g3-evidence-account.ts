import type { StoredAccount } from "../auth/account-session-store";
import type { AccountSessionPort } from "../auth/account-session-port";
import type { HostApi } from "../host/host-api";
import type { UsernameGenerationOptions } from "./generator/official-generator-engine";
import type { VaultCipherActionPort } from "./vault/vault-actions.service";

const evidenceAccount: StoredAccount = {
  id: "evidence-account",
  email: "evidence@example.test",
  serverUrl: "https://vault.example.test",
  status: "unlocked",
  isActive: true,
};

const lockedEvidenceAccount: StoredAccount = {
  id: "locked-evidence-account",
  email: "locked-fixture@example.test",
  serverUrl: "https://vault.with-a-deliberately-long-self-hosted-name.example.test",
  status: "locked",
  isActive: false,
};

export function createG3EvidenceAccountPort(): AccountSessionPort {
  return {
    list: async () => [evidenceAccount, lockedEvidenceAccount],
    saveAccount: async () => evidenceAccount,
    setActive: async () => evidenceAccount,
    setStatus: async () => undefined,
    readSession: async () => null,
    replaceSession: async () => false,
    remove: async () => null,
    lockAll: async () => undefined,
  };
}

export function createG3EvidenceGeneratorEngine() {
  return {
    generatePassword: async (settings: { readonly length: number }) =>
      settings.length === 128
        ? "Mango-River-47!".repeat(8).slice(0, 128)
        : "Mango-River-47!",
    generatePassphrase: async () => "orbit-lantern-copper-signal",
    generateUsername: async (options: Required<UsernameGenerationOptions>) => {
      if (options.type === "subaddress") {
        const [local, domain] = options.subaddressEmail.split("@");
        if (!local || !domain) {
          throw new Error("Synthetic subaddress evidence requires an email");
        }
        return `${local}+evidence4821@${domain}`;
      }
      if (options.type === "catchall") {
        if (!options.catchallDomain) {
          throw new Error("Synthetic catch-all evidence requires a domain");
        }
        return `evidence4821@${options.catchallDomain}`;
      }
      return "evidence-user-4821";
    },
  };
}

export function createG3EvidenceVaultSessionService(rejectSync = false) {
  return {
    syncNow: async () => {
      if (rejectSync) {
        throw new Error("Synthetic evidence sync failure");
      }
      if (globalThis.document) {
        globalThis.document.documentElement.dataset.bwEvidenceLastHostAction = "sync_now";
      }
    },
  };
}

export function createG3EvidenceVaultActionHost(): HostApi {
  const record = (action: string) => {
    if (globalThis.document) {
      globalThis.document.documentElement.dataset.bwEvidenceLastHostAction = action;
    }
  };

  return {
    showPopup: async () => undefined,
    hidePopup: async () => undefined,
    copyText: async () => {
      const scenario = new URLSearchParams(globalThis.location?.search ?? "").get("generatorEvidence");
      if (scenario === "history-copy-retry" && globalThis.document) {
        const root = globalThis.document.documentElement;
        const attempts = Number(root.dataset.bwEvidenceGeneratorCopyAttempts ?? "0") + 1;
        root.dataset.bwEvidenceGeneratorCopyAttempts = String(attempts);
        if (attempts === 1) {
          throw new Error("Synthetic generator evidence copy failure");
        }
      }
      record("copy_text");
    },
    pasteText: async () => record("paste_text"),
    openUrl: async () => record("open_url"),
    secureGet: async () => null,
    secureSet: async () => undefined,
    secureDelete: async () => undefined,
    getAccountLockIntents: async () => [],
    setAccountLockIntents: async () => undefined,
  };
}

export function createG3EvidenceVaultCipherActionPort(): VaultCipherActionPort {
  const record = (action: string) => {
    if (globalThis.document) {
      globalThis.document.documentElement.dataset.bwEvidenceLastHostAction = action;
    }
  };

  return {
    updateCipherPartial: async () => record("update_cipher_partial"),
    softDeleteCipher: async () => record("soft_delete_cipher"),
    archiveCipher: async () => record("archive_cipher"),
    unarchiveCipher: async () => record("unarchive_cipher"),
    restoreCipher: async () => record("restore_cipher"),
    deleteCipher: async () => record("delete_cipher"),
  };
}
