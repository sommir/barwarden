import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

import { FetchHttpTransport } from "../../src/bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../../src/app/popup-state";
import type { VaultFolderCrypto } from "../../src/app/vault/vault-folder.service";
import {
  cloudInputNames,
  LiveIsolationHost,
  loginLiveServiceWithChallenge,
  livePasswordLoginAndSync,
  officialCloudEnvironment,
  requireLiveInputSet,
  selfHostedInputNames,
  selfHostedLiveEnvironment,
} from "./live-standard-password-login";
import {
  runFolderScenario,
  runPersonalCipherScenario,
  runVaultReadOnlyScenario,
  type LiveVaultDependencies,
  type LiveVaultReadOnlyDependencies,
  type LiveVaultReadOnlySnapshot,
} from "./live-vault-scenarios";
import {
  liveVaultFailureId,
  recordLiveGateFailure,
  recordLiveGateRows,
  type LiveGateFailureId,
} from "./m14-live-gate-result";
import {
  createLiveRunContext,
  resolveLiveServiceDisposition,
  type LiveServiceClass,
  type LiveStageResult,
} from "./live-test-protocol";

const require = createRequire(import.meta.url);

test.use({ screenshot: "off", trace: "off", video: "off" });
test.describe.configure({ mode: "serial", timeout: 180_000 });

for (const service of ["cloud-us", "cloud-eu", "self-hosted"] as const) {
  test(`runs or externally declares the ${service} read-only vault cache row`, async () => {
    const names = service === "self-hosted" ? selfHostedInputNames : cloudInputNames;
    const disposition = resolveLiveServiceDisposition(service, names, "read-only", process.env);
    if (disposition.status !== "ready") {
      test.skip(true, disposition.reasonCode);
      return;
    }

    let loginDisposition;
    try {
      loginDisposition = await loginForService(service);
    } catch {
      failWithFixedIdentifier(liveVaultFailureId(service, "read-only"));
    }
    if (loginDisposition.status !== "ready") {
      test.skip(true, loginDisposition.reasonCode);
      return;
    }
    try {
      const { api, session } = loginDisposition.login;
      const results = await runVaultReadOnlyScenario(await readOnlyDependencies(service, api, session));
      expect(results).toHaveLength(2);
    } catch {
      failWithFixedIdentifier(liveVaultFailureId(service, "read-only"));
    }
  });

  for (const kind of ["folder", "login", "card", "identity", "secure-note"] as const) {
    test(`runs or externally declares the ${service} ${kind} disposable mutation row`, async () => {
      const names = service === "self-hosted" ? selfHostedInputNames : cloudInputNames;
      const disposition = resolveLiveServiceDisposition(service, names, "mutation", process.env);
      if (disposition.status !== "ready") {
        recordLiveGateRows([externalMutationRow(service, kind, disposition)]);
        test.skip(true, disposition.reasonCode);
        return;
      }

      let loginDisposition;
      try {
        loginDisposition = await loginForService(service);
      } catch {
        failWithFixedIdentifier(liveVaultFailureId(service, kind));
      }
      if (loginDisposition.status !== "ready") {
        recordLiveGateRows([externalMutationRow(service, kind, loginDisposition)]);
        test.skip(true, loginDisposition.reasonCode);
        return;
      }
      try {
        const { api, session } = loginDisposition.login;
        const deps = await mutationDependencies(service, api, session);
        const result = kind === "folder"
          ? await runFolderScenario(deps)
          : await runPersonalCipherScenario(kind, deps);
        expect(result).toMatchObject({ service, mode: "mutation", stage: kind, status: "passed" });
        recordLiveGateRows([result]);
      } catch {
        failWithFixedIdentifier(liveVaultFailureId(service, kind));
      }
    });
  }
}

function externalMutationRow(
  service: LiveServiceClass,
  stage: Extract<LiveStageResult["stage"], "folder" | "login" | "card" | "identity" | "secure-note">,
  disposition: Exclude<ReturnType<typeof resolveLiveServiceDisposition>, { status: "ready" }>,
): LiveStageResult {
  return { service, mode: "mutation", stage, ...disposition };
}

function failWithFixedIdentifier(identifier: LiveGateFailureId): never {
  try {
    recordLiveGateFailure(identifier);
  } catch {
    // The controller will use its fixed fallback if the child artifact is unavailable.
  }
  throw new Error(identifier);
}

async function loginForService(service: LiveServiceClass) {
  if (service === "self-hosted") {
    const inputs = requireLiveInputSet(selfHostedInputNames);
    return loginLiveServiceWithChallenge(
      selfHostedLiveEnvironment(inputs.BARWARDEN_LIVE_SERVER_URL),
      inputs.BARWARDEN_LIVE_EMAIL,
      inputs.BARWARDEN_LIVE_PASSWORD,
      process.env,
    );
  }

  const inputs = requireLiveInputSet(cloudInputNames);
  const selected = inputs.BARWARDEN_LIVE_CLOUD_REGION.trim().toUpperCase() === "EU" ? "cloud-eu" : "cloud-us";
  if (selected !== service) throw new Error("Live cloud service selection drift");
  return loginLiveServiceWithChallenge(
    officialCloudEnvironment(inputs.BARWARDEN_LIVE_CLOUD_REGION),
    inputs.BARWARDEN_LIVE_CLOUD_EMAIL,
    inputs.BARWARDEN_LIVE_CLOUD_PASSWORD,
    process.env,
  );
}

async function mutationDependencies(
  service: LiveServiceClass,
  api: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["api"],
  session: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["session"],
): Promise<LiveVaultDependencies> {
  const runtime = await liveVaultRuntime();
  const folderStore = new PopupStateStore();
  folderStore.setActiveSession(session);
  return {
    api,
    session,
    context: createLiveRunContext(service, "mutation"),
    folders: new runtime.VaultFolderService(folderStore, api, officialNodeFolderCrypto()),
    writes: new runtime.BitwardenVaultCipherWriteActions(session, new LiveMutationHost()),
    syncProjection: () => new runtime.VaultSyncService({ getSync: (accessToken) => api.getSync(accessToken) }).sync(session),
  };
}

async function readOnlyDependencies(
  service: LiveServiceClass,
  api: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["api"],
  session: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["session"],
): Promise<LiveVaultReadOnlyDependencies> {
  const runtime = await liveVaultRuntime();
  const store = new PopupStateStore();
  store.setActiveSession(session);
  store.setUnlocked("");
  const apiBoundary = new SwitchableLiveSyncApi(api);
  const syncService = new runtime.VaultSyncService(apiBoundary);
  const sessionService = new runtime.VaultSessionService(store, syncService);
  let freshSnapshot: ReturnType<PopupStateStore["snapshot"]> | null = null;
  const snapshot = (): LiveVaultReadOnlySnapshot => {
    const value = store.snapshot();
    if (
      value.vaultSyncStatus !== "fresh" &&
      value.vaultSyncStatus !== "stale" &&
      value.vaultSyncStatus !== "unavailable"
    ) {
      throw new Error("Live vault cache state is unavailable");
    }
    if (value.vaultSyncStatus === "fresh" && !freshSnapshot) {
      freshSnapshot = value;
    }
    return {
      vaultSyncStatus: value.vaultSyncStatus,
      lastSuccessfulSyncDate: value.lastSuccessfulSyncDate,
      items: value.items,
      folders: value.folders,
      sends: value.sends,
      message: value.vaultSyncMessage,
    };
  };
  return {
    service,
    syncNow: () => sessionService.syncNow(),
    snapshot,
    useTransportFailure: () => apiBoundary.useTransportFailure(),
    failInitial: async () => {
      const emptyStore = new PopupStateStore();
      emptyStore.setActiveSession(session);
      emptyStore.setUnlocked("");
      const failedSync = new runtime.VaultSyncService({
        getSync: async () => { throw new Error("Synthetic live transport failure"); },
      });
      await new runtime.VaultSessionService(emptyStore, failedSync).syncNow();
      const value = emptyStore.snapshot();
      return {
        vaultSyncStatus: value.vaultSyncStatus,
        lastSuccessfulSyncDate: value.lastSuccessfulSyncDate,
        items: value.items,
        folders: value.folders,
        sends: value.sends,
        message: value.vaultSyncMessage,
      };
    },
    assertRetained: (value) => {
      if (value.vaultSyncStatus === "stale") {
        expect(value.items).toBe(freshSnapshot?.items);
        expect(value.folders).toBe(freshSnapshot?.folders);
        expect(value.sends).toBe(freshSnapshot?.sends);
      }
    },
  };
}

class SwitchableLiveSyncApi {
  private transportFailure = false;

  constructor(
    private readonly liveApi: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["api"],
  ) {}

  useTransportFailure(): void {
    this.transportFailure = true;
  }

  getSync(accessToken: string): Promise<unknown> {
    if (this.transportFailure) {
      return Promise.reject(new Error("Synthetic live transport failure"));
    }
    return this.liveApi.getSync(accessToken);
  }
}

async function liveVaultRuntime() {
  const [folders, sessions, sync, writes] = await Promise.all([
    import("../../src/app/vault/vault-folder.service"),
    import("../../src/app/vault/vault-session.service"),
    import("../../src/vault/vault-sync.service"),
    import("../../src/app/vault/vault-cipher-write.service"),
  ]);
  return {
    VaultFolderService: folders.VaultFolderService,
    VaultSessionService: sessions.VaultSessionService,
    VaultSyncService: sync.VaultSyncService,
    BitwardenVaultCipherWriteActions: writes.BitwardenVaultCipherWriteActions,
  };
}

function officialNodeFolderCrypto(): VaultFolderCrypto {
  interface NodePureCrypto { symmetric_encrypt_string(plain: string, key: Uint8Array): string; }
  const { PureCrypto } = require("@bitwarden/sdk-internal") as { readonly PureCrypto: NodePureCrypto };
  return { async encryptString(value, key) { return PureCrypto.symmetric_encrypt_string(value, key); } };
}

class LiveMutationHost extends LiveIsolationHost {
  private readonly transport = new FetchHttpTransport(30_000);
  fetchJson<T>(url: string, init: RequestInit): Promise<T> { return this.transport.fetchJson<T>(url, init); }
}
