import { describe, expect, it } from "vitest";

import type { AuthSession } from "../../src/auth/auth-session-store";
import { buildBitwardenEnvironment } from "../../src/bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../../src/app/popup-state";
import type { SendActionPort } from "../../src/app/send/send-actions.service";
import type { SendItem } from "../../src/app/send/send-item.model";
import { TextSendOperation } from "../../src/app/send/text-send-operation";
import type { VaultSyncResult } from "../../src/vault/vault-sync.service";
import {
  fileSendIds,
  LiveTextSendTransportGuard,
  runTextSendScenario,
  type LiveTextSendDependencies,
} from "./live-text-send-scenarios";
import { createLiveRunContext } from "./live-test-protocol";

describe("live Text Send scenarios", () => {
  it("owns a Text Send lifecycle without changing the File Send snapshot", async () => {
    const harness = new TextSendScenarioHarness();

    await expect(runTextSendScenario(harness.dependencies())).resolves.toEqual([
      { service: "self-hosted", mode: "mutation", stage: "text-send", status: "passed" },
      {
        service: "self-hosted",
        mode: "mutation",
        stage: "file-send-non-interference",
        status: "passed",
      },
    ]);

    expect(harness.calls).toEqual([
      "sync:file-snapshot",
      "create",
      "sync:create",
      "update:content",
      "sync:content",
      "update:password",
      "sync:password",
      "remove-password",
      "refresh",
      "sync:refresh",
      "copy",
      "delete",
      "sync:final",
    ]);
    expect(harness.directDeleteCalls).toBe(0);
    expect(harness.protectedFileIds).toEqual(["file-send"]);
    expect(harness.copiedLinks).toHaveLength(1);
    expect(harness.artifactChecks).toBe(1);
  });

  it("switches diagnostics before File Send non-interference checks can fail", async () => {
    const harness = new TextSendScenarioHarness("file-snapshot-changed");
    const stages: string[] = [];

    await expect(
      runTextSendScenario(harness.dependencies(), (stage) => stages.push(stage)),
    ).rejects.toThrow("Live cleanup did not complete");

    expect(stages).toEqual(["file-send-non-interference"]);
  });

  it("keeps Text Send diagnostics when the mutation body fails before cleanup", async () => {
    const harness = new TextSendScenarioHarness("create");
    const stages: string[] = [];

    await expect(
      runTextSendScenario(harness.dependencies(), (stage) => stages.push(stage)),
    ).rejects.toThrow("Live mutation did not complete");

    expect(stages).toEqual([]);
  });

  it.each([
    "create",
    "update:content",
    "update:password",
    "remove-password",
    "refresh",
    "delete",
  ] as const)("uses the registered direct cleanup when %s fails", async (failure) => {
    const harness = new TextSendScenarioHarness(failure);

    await expect(runTextSendScenario(harness.dependencies())).rejects.toThrow(
      "Live mutation did not complete",
    );

    expect(harness.hasTextSend).toBe(false);
    expect(harness.artifactChecks).toBe(1);
    expect(harness.directDeleteCalls).toBe(failure === "create" ? 0 : 1);
  });

  it("registers direct cleanup before a successful create reaches the local store", async () => {
    const harness = new TextSendScenarioHarness("store-save");

    await expect(runTextSendScenario(harness.dependencies())).rejects.toThrow(
      "Live mutation did not complete",
    );

    expect(harness.directDeleteCalls).toBe(1);
    expect(harness.hasTextSend).toBe(false);
    expect(harness.artifactChecks).toBe(1);
  });

  it("keeps cleanup owned by the create id when an update returns another id", async () => {
    const harness = new TextSendScenarioHarness("update-id");

    await expect(runTextSendScenario(harness.dependencies())).rejects.toThrow(
      "Live mutation did not complete",
    );

    expect(harness.directDeletedIds).toEqual(["text-send"]);
    expect(harness.hasTextSend).toBe(false);
  });

  it.each([
    "content-text",
    "content-max-access",
    "password-text",
    "password-max-access",
    "refresh-text",
    "refresh-max-access",
  ] as const)("rejects a fixed-field mismatch at the %s projection", async (projectionFault) => {
    const harness = new TextSendScenarioHarness(undefined, projectionFault);

    await expect(runTextSendScenario(harness.dependencies())).rejects.toThrow(
      "Live mutation did not complete",
    );
    expect(harness.directDeleteCalls).toBe(1);
    expect(harness.hasTextSend).toBe(false);
  });

  it("extracts only opaque File Send ids from PascalCase and camelCase sync responses", () => {
    expect([...fileSendIds({
      Sends: [{ Id: "file-pascal", Type: 1 }, { Id: "text-pascal", Type: 0 }],
      sends: [{ id: "file-camel", type: 1 }, { id: "text-camel", type: 0 }],
    })]).toEqual(["file-pascal", "file-camel"]);
  });

  it.each([
    undefined,
    { Sends: "not-an-array" },
    { Sends: [{ Id: "", Type: 1 }] },
    { Sends: [{ Id: "file", Type: "1" }] },
  ])("rejects a malformed File Send snapshot with a fixed error", (sync) => {
    expect(() => fileSendIds(sync)).toThrow("Live File Send snapshot is malformed");
  });

  it.each([
    ["Pascal Type", "https://api.example.test/api/sends", "POST", { Type: 1, file: null }],
    ["camel type", "https://api.example.test/api/sends", "POST", { type: 1, file: null }],
    ["camel file", "https://api.example.test/api/sends", "POST", { type: 0, file: {} }],
    ["Pascal File", "https://api.example.test/api/sends/text-id", "PUT", { Type: 0, File: {} }],
    ["camel fileLength", "https://api.example.test/api/sends", "POST", { type: 0, file: null, fileLength: 0 }],
    ["Pascal FileLength", "https://api.example.test/api/sends/text-id", "PUT", { Type: 0, file: null, FileLength: 12 }],
  ] as const)("rejects a shared Send %s bypass", (_label, url, method, body) => {
    const guard = new LiveTextSendTransportGuard();

    expect(() => guard.assertAllowed(url, { method, body: JSON.stringify(body) })).toThrow(
      "Live Text Send transport called a File Send endpoint",
    );
  });

  it("rejects an uninspectable shared Send mutation body", () => {
    const guard = new LiveTextSendTransportGuard();

    expect(() => guard.assertAllowed("https://api.example.test/api/sends", {
      method: "POST",
      body: new URLSearchParams({ type: "0" }),
    })).toThrow("Live Text Send transport called a File Send endpoint");
  });

  it.each([
    ["PUT", "https://api.example.test/api/sends/protected-file"],
    ["DELETE", "https://api.example.test/api/sends/protected-file"],
    ["PUT", "https://api.example.test/api/sends/protected-file/remove-password"],
    ["DELETE", "https://api.example.test/api/sends/protected-file/access"],
  ] as const)("rejects %s targeting an initially protected File Send", (method, url) => {
    const guard = new LiveTextSendTransportGuard();
    guard.protectFileSendIds(new Set(["protected-file"]));

    expect(() => guard.assertAllowed(url, {
      method,
      ...(method === "PUT" ? { body: JSON.stringify({ type: 0, file: null }) } : {}),
    })).toThrow("Live Text Send transport called a File Send endpoint");
  });

  it("rejects an explicit File Send endpoint", () => {
    const guard = new LiveTextSendTransportGuard();

    expect(() => guard.assertAllowed("https://api.example.test/api/sends/text-id/file", {
      method: "POST",
      body: JSON.stringify({}),
    })).toThrow("Live Text Send transport called a File Send endpoint");
  });

  it("allows sync and ordinary unprotected Text Send requests", () => {
    const guard = new LiveTextSendTransportGuard();

    expect(() => guard.assertAllowed("https://api.example.test/api/sync?excludeDomains=true", {
      method: "GET",
    })).not.toThrow();
    expect(() => guard.assertAllowed("https://api.example.test/api/sends", {
      method: "POST",
      body: JSON.stringify({ type: 0, file: null }),
    })).not.toThrow();
    expect(() => guard.assertAllowed("https://api.example.test/api/sends/text-id", {
      method: "DELETE",
    })).not.toThrow();
  });
});

class TextSendScenarioHarness {
  readonly calls: string[] = [];
  readonly copiedLinks: string[] = [];
  readonly directDeletedIds: string[] = [];
  protectedFileIds: string[] = [];
  directDeleteCalls = 0;
  artifactChecks = 0;
  hasTextSend = false;
  private lastSyncLabel = "";
  private serverSend: SendItem | undefined;

  constructor(
    private readonly failure?: string,
    private readonly projectionFault?: string,
  ) {}

  dependencies(): LiveTextSendDependencies {
    const store = new PopupStateStore();
    const session = this.session();
    store.setActiveSession(session);
    store.setUnlocked("live@example.test");
    if (this.failure === "store-save") {
      store.saveSend = () => { throw new Error("private store failure"); };
    }
    const actions = this.actions();
    return {
      session,
      api: {
        getSync: async () => this.sync(),
        deleteSend: async (id) => {
          this.directDeleteCalls += 1;
          this.directDeletedIds.push(id);
          this.hasTextSend = false;
        },
      },
      actions,
      store,
      operation: new TextSendOperation({
        store,
        actions,
        navigation: { currentUrl: () => "/tabs/send" },
      }),
      context: createLiveRunContext("self-hosted", "mutation", () => new Uint8Array(16).fill(1)),
      linkBuilder: {
        linkFor: (send) => `https://send.example.test/base/#/send/${send.accessId}/${send.urlB64Key}`,
      },
      clipboard: {
        copyText: async () => {
          this.calls.push("copy");
          this.copiedLinks.push("copied");
        },
        copyCallCount: () => this.calls.filter((call) => call === "copy").length,
      },
      transportGuard: {
        protectFileSendIds: (ids) => { this.protectedFileIds = [...ids]; },
      },
      syncProjection: async () => this.projection(),
      assertGeneratedArtifactAbsence: () => { this.artifactChecks += 1; },
    };
  }

  private actions(): SendActionPort {
    const fail = (stage: string) => {
      if (this.failure === stage) throw new Error("private mutation failure");
    };
    return {
      createTextSend: async (_session, draft) => {
        this.calls.push("create");
        fail("create");
        this.hasTextSend = true;
        this.serverSend = this.send(draft);
        return this.serverSend;
      },
      updateTextSend: async (_session, _send, draft) => {
        const stage = draft.authType === "password" ? "update:password" : "update:content";
        this.calls.push(stage);
        fail(stage);
        this.serverSend = {
          ...this.serverSend!,
          ...this.send(draft),
          id: this.serverSend!.id,
          accessId: this.serverSend!.accessId,
          urlB64Key: this.serverSend!.urlB64Key,
        };
        if (this.failure === "update-id" && stage === "update:content") {
          this.serverSend = { ...this.serverSend, id: "wrong-id" };
        }
        return this.serverSend;
      },
      removePassword: async () => {
        this.calls.push("remove-password");
        fail("remove-password");
      },
      refreshTextSend: async () => {
        this.calls.push("refresh");
        fail("refresh");
        this.serverSend = { ...this.serverSend!, hasPassword: undefined, password: undefined };
        return this.serverSend;
      },
      deleteSend: async () => {
        this.calls.push("delete");
        fail("delete");
        this.hasTextSend = false;
      },
    };
  }

  private async sync(): Promise<unknown> {
    const label = this.calls.includes("delete") || this.directDeleteCalls > 0
      ? "final"
      : this.calls.length === 0
        ? "file-snapshot"
        : this.calls.includes("refresh")
          ? "refresh"
        : this.calls.includes("update:password")
          ? "password"
          : this.calls.includes("update:content")
            ? "content"
          : "create";
    this.lastSyncLabel = label;
    this.calls.push(`sync:${label}`);
    return {
      Ciphers: [],
      Folders: [],
      Sends: [
        {
          Id: this.failure === "file-snapshot-changed" && label === "final"
            ? "file-send-changed"
            : "file-send",
          Type: 1,
        },
        ...(this.hasTextSend ? [{ Id: "text-send", Type: 0 }] : []),
      ],
    };
  }

  private async projection(): Promise<VaultSyncResult> {
    let current = this.currentSend();
    if (current && this.projectionFault === `${this.lastSyncLabel}-text`) {
      current = { ...current, text: "private mismatched text" };
    }
    if (current && this.projectionFault === `${this.lastSyncLabel}-max-access`) {
      current = { ...current, maxAccessCount: 99 };
    }
    return {
      items: [], archivedItems: [], deletedItems: [], folders: [], organizations: [], collections: [],
      sends: current ? [current] : [], sendPolicy: { disabled: false, hideEmailAllowed: true },
      cipherCount: 0, encryptedCipherCount: 0, folderCount: 0, sendCount: current ? 1 : 0,
    };
  }

  private currentSend(): SendItem | undefined {
    if (!this.hasTextSend) return undefined;
    return this.serverSend;
  }

  private send(draft: Partial<{ name: string; text: string; maxAccessCount: number; authType: string }>): SendItem {
    return {
      id: "text-send", accessId: "text-access", urlB64Key: "text-key", type: "text",
      name: draft.name ?? "barwarden-m14-01010101010101010101010101010101 Text Send",
      text: draft.text, notes: "", revisionDate: "2030-01-01T00:00:00.000Z",
      deletionDate: "2030-02-01T00:00:00.000Z", disabled: false, accessCount: 0,
      ...(draft.maxAccessCount == null ? {} : { maxAccessCount: draft.maxAccessCount }),
      ...(draft.authType === "password" ? { hasPassword: true } : {}),
    };
  }

  private session(): AuthSession {
    return {
      environment: { ...buildBitwardenEnvironment(), sendUrl: "https://send.example.test/base" },
      token: { accessToken: "live-access", refreshToken: "live-refresh", tokenType: "Bearer", expiresIn: 3600 },
      crypto: { userKeyB64: "live-user-key" },
    };
  }
}
