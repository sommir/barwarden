import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  livePasswordLoginAndSync,
  requireLiveInputSet,
  selfHostedInputNames,
  selfHostedLiveEnvironment,
} from "../../e2e/live/live-standard-password-login";
import { PopupStateStore } from "../app/popup-state";
import { encodeProcessSharedPopupState } from "../app/auth/process-shared-popup-state";
import { TauriHostService } from "../host/tauri-host.service";
import { VaultSyncService } from "../vault/vault-sync.service";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("live process session snapshot", () => {
  it.skipIf(
    !selfHostedInputNames.every((name) => Boolean(process.env[name]?.trim())),
  )(
    "accepts the real self-hosted vault projection at the native broker boundary",
    async () => {
      const inputs = requireLiveInputSet(selfHostedInputNames);
      const environment = selfHostedLiveEnvironment(
        inputs.BARWARDEN_LIVE_SERVER_URL,
      );
      const { api, session } = await livePasswordLoginAndSync(
        environment,
        inputs.BARWARDEN_LIVE_EMAIL,
        inputs.BARWARDEN_LIVE_PASSWORD,
      );
      const synced = await new VaultSyncService({
        getSync: (accessToken) => api.getSync(accessToken),
      }).sync(session);
      const store = new PopupStateStore();
      store.restore({
        ...store.snapshot(),
        ...synced,
        isUnlocked: true,
        email: inputs.BARWARDEN_LIVE_EMAIL,
        serverUrl: environment.webVaultUrl ?? "",
        activeSession: session,
        vaultSyncStatus: "fresh",
      });
      const sharedSnapshot = encodeProcessSharedPopupState(store.snapshot());
      const invoke = vi.fn(async () => ({
        processGeneration: "live-process",
        version: 1,
        syncVersion: 0,
        authorization: "unlocked",
        activeAccountId: "live-account",
        syncState: "fresh",
        failureCode: null,
        sharedSnapshot,
        originWindowLabel: "main",
      }));

      await expect(
        new TauriHostService(invoke).mutateProcessSession({
          type: "unlocked",
          activeAccountId: "live-account",
          sharedSnapshot,
        }),
      ).resolves.toMatchObject({ authorization: "unlocked" });
      expect(invoke).toHaveBeenCalledOnce();
      expect(JSON.stringify(sharedSnapshot).length).toBeLessThan(3 * 1024 * 1024);
    },
    120_000,
  );
});
