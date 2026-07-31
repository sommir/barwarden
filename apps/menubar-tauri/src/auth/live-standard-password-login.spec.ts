import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FetchHttpTransport } from "../bitwarden-api/bitwarden-api";
import {
  cloudInputNames,
  LiveIsolationHost,
  liveInputState,
  livePasswordLoginAndSync,
  officialCloudEnvironment,
  requireLiveInputSet,
  selfHostedInputNames,
  selfHostedLiveEnvironment,
} from "../../e2e/live/live-standard-password-login";
import {
  runFolderScenario,
  runPersonalCipherScenario,
  type LiveVaultDependencies,
} from "../../e2e/live/live-vault-scenarios";
import { createLiveRunContext, resolveLiveDisposition } from "../../e2e/live/live-test-protocol";
import { PopupStateStore } from "../app/popup-state";
import { BitwardenVaultCipherWriteActions } from "../app/vault/vault-cipher-write.service";
import { VaultFolderService, type VaultFolderCrypto } from "../app/vault/vault-folder.service";
import { VaultSyncService } from "../vault/vault-sync.service";

const require = createRequire(import.meta.url);

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("live standard password login", () => {
  it.skipIf(resolveLiveDisposition(selfHostedInputNames, "read-only").status !== "ready")(
    "logs in and performs read-only sync against an explicit self-hosted server",
    async () => {
      const inputs = requireLiveInputSet(selfHostedInputNames);
      await livePasswordLoginAndSync(
        selfHostedLiveEnvironment(inputs.BARWARDEN_LIVE_SERVER_URL),
        inputs.BARWARDEN_LIVE_EMAIL,
        inputs.BARWARDEN_LIVE_PASSWORD,
      );
    },
    120_000,
  );

  it.skipIf(resolveLiveDisposition(cloudInputNames, "read-only").status !== "ready")(
    "logs in and performs read-only sync against an explicit official cloud region",
    async () => {
      const inputs = requireLiveInputSet(cloudInputNames);
      await livePasswordLoginAndSync(
        officialCloudEnvironment(inputs.BARWARDEN_LIVE_CLOUD_REGION),
        inputs.BARWARDEN_LIVE_CLOUD_EMAIL,
        inputs.BARWARDEN_LIVE_CLOUD_PASSWORD,
      );
    },
    120_000,
  );

  it.skipIf(resolveLiveDisposition(selfHostedInputNames, "mutation").status !== "ready")(
    "creates, updates, syncs, and cleans up an isolated Folder",
    async () => {
      const { api, session } = await selfHostedSession();
      const result = await runFolderScenario(liveVaultDependencies(api, session));
      expect(result).toEqual({ service: "self-hosted", mode: "mutation", stage: "folder", status: "passed" });
    },
    180_000,
  );

  for (const kind of ["login", "card", "identity", "secure-note"] as const) {
    it.skipIf(resolveLiveDisposition(selfHostedInputNames, "mutation").status !== "ready")(
      `creates, updates, exercises lifecycle, and cleans up an isolated ${kind}`,
      async () => {
        const { api, session } = await selfHostedSession();
        const result = await runPersonalCipherScenario(kind, liveVaultDependencies(api, session));
        expect(result).toEqual({ service: "self-hosted", mode: "mutation", stage: kind, status: "passed" });
      },
      180_000,
    );
  }
});

async function selfHostedSession() {
  const inputs = requireLiveInputSet(selfHostedInputNames);
  return livePasswordLoginAndSync(
    selfHostedLiveEnvironment(inputs.BARWARDEN_LIVE_SERVER_URL),
    inputs.BARWARDEN_LIVE_EMAIL,
    inputs.BARWARDEN_LIVE_PASSWORD,
  );
}

function liveVaultDependencies(
  api: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["api"],
  session: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["session"],
): LiveVaultDependencies {
  const folderStore = new PopupStateStore();
  folderStore.setActiveSession(session);
  return {
    api,
    session,
    context: createLiveRunContext("self-hosted", "mutation"),
    folders: new VaultFolderService(folderStore, api, officialNodeFolderCrypto()),
    writes: new BitwardenVaultCipherWriteActions(session, new LiveMutationHost()),
    syncProjection: async () => new VaultSyncService({
      getSync: (accessToken) => api.getSync(accessToken),
    }).sync(session),
  };
}

describe("live verification guards", () => {
  it("uses the official Node crypto binding at the live-test runtime boundary", async () => {
    await expect(
      officialNodeFolderCrypto().encryptString("isolated folder", new Uint8Array(64)),
    ).resolves.toMatch(/^2\./);
  });

  it("preserves valid self-hosted base paths and ports while trimming whitespace and trailing slash", () => {
    expect(selfHostedLiveEnvironment(" https://vault.example.test:8443/base/ ").webVaultUrl)
      .toBe("https://vault.example.test:8443/base");
  });

  it.each([
    "http://vault.example.test",
    "https://user:password@vault.example.test",
    "https://vault.example.test/path?query=value",
    "https://vault.example.test/path?",
    "https://vault.example.test/path#fragment",
    "https://vault.example.test/path#",
    "https:///",
    "not-a-url",
  ])("rejects invalid self-hosted live URLs with a fixed error", (runtimeValue) => {
    expect(() => selfHostedLiveEnvironment(runtimeValue)).toThrow("Live self-hosted environment is invalid");
    try {
      selfHostedLiveEnvironment(runtimeValue);
    } catch (error) {
      expect((error as Error).message).not.toContain(runtimeValue);
    }
  });

  it("distinguishes absent, complete, and partial live input sets", () => {
    const [server, email, password] = selfHostedInputNames;
    expect(liveInputState(selfHostedInputNames, {})).toBe("absent");
    expect(liveInputState(selfHostedInputNames, {
      [server]: "https://vault.example.test", [email]: "user@example.test", [password]: "test-password",
    })).toBe("complete");
    expect(liveInputState(selfHostedInputNames, { [server]: "https://vault.example.test" })).toBe("partial");
  });

  it("maps partial live input sets to a fixed configuration error", () => {
    expect(() => requireLiveInputSet(selfHostedInputNames, {
      BARWARDEN_LIVE_SERVER_URL: "https://vault.example.test",
    })).toThrow("Live test input configuration is incomplete");
  });

  it("rejects any live session persistence attempt", async () => {
    await expect(new LiveIsolationHost().secureSet("probe", "value")).rejects.toThrow(
      "Live session persistence is disabled",
    );
  });
});

function officialNodeFolderCrypto(): VaultFolderCrypto {
  interface NodePureCrypto {
    symmetric_encrypt_string(plain: string, key: Uint8Array): string;
  }
  const { PureCrypto } = require("@bitwarden/sdk-internal") as { readonly PureCrypto: NodePureCrypto };
  return {
    async encryptString(value, key) {
      if (key.byteLength !== 64) throw new Error("Live folder encryption key must be 64 bytes");
      return PureCrypto.symmetric_encrypt_string(value, key);
    },
  };
}

class LiveMutationHost extends LiveIsolationHost {
  private readonly transport = new FetchHttpTransport(30_000);

  fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    return this.transport.fetchJson<T>(url, init);
  }
}
