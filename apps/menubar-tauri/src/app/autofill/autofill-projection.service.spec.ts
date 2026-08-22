import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { PopupStateStore } from "../popup-state";
import { demoVaultItems } from "../vault-demo";
import {
  AutoFillProjectionService,
  type AutoFillProjectionHost,
} from "./autofill-projection.service";
import { AutoFillBindingsService } from "./autofill-bindings.service";

const accountId = "a".repeat(64);
const session = {
  environment: { apiUrl: "https://api.example.test", identityUrl: "https://identity.example.test" },
  token: {
    accessToken: "ACCESS-TOKEN-MUST-NOT-LEAVE-ANGULAR",
    refreshToken: "REFRESH-TOKEN-MUST-NOT-LEAVE-ANGULAR",
    tokenType: "Bearer",
    expiresIn: 3600,
  },
  crypto: { userKeyB64: "DEVICE-OR-USER-KEY-MUST-NOT-LEAVE-ANGULAR" },
} satisfies AuthSession;

describe("AutoFillProjectionService", () => {
  it("projects only matching-safe Login fields from active records after unlocked fresh sync", async () => {
    const fixture = createFixture();
    const login = {
      ...demoVaultItems[0],
      opaqueServerPayload: { forbidden: "MASTER-PASSWORD-PIN-DEVICE-KEY" },
      notes: "Tencent production account",
      fields: [
        ...demoVaultItems[0].fields,
        { id: "custom-secret", label: "Master password", value: "MASTER-PASSWORD-MUST-NOT-LEAVE" },
      ],
    };

    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([login, ...demoVaultItems.slice(1)]);
    await fixture.service.settled();

    expect(fixture.host.replacements).toHaveLength(1);
    expect(fixture.host.replacements[0]).toEqual({
      accountId,
      createdAt: "2026-08-08T08:00:00.000Z",
      logins: [{
        cipherId: "github",
        name: "GitHub",
        notes: "Tencent production account",
        username: "ops@example.com",
        password: "correct-horse-demo",
        uris: [
          { uri: "https://github.com", matchType: 0 },
          { uri: "https://gist.github.com", matchType: 0 },
        ],
        totp: "123456",
        favorite: true,
        reprompt: false,
      }],
      bindings: [],
      history: [],
    });
    const wire = JSON.stringify(fixture.host.replacements[0]);
    for (const forbidden of [
      "ACCESS-TOKEN-MUST-NOT-LEAVE-ANGULAR",
      "REFRESH-TOKEN-MUST-NOT-LEAVE-ANGULAR",
      "DEVICE-OR-USER-KEY-MUST-NOT-LEAVE-ANGULAR",
      "MASTER-PASSWORD-MUST-NOT-LEAVE",
      "4111111111111111",
      "Deploy key",
    ]) {
      expect(wire).not.toContain(forbidden);
    }
    fixture.service.destroy();
  });

  it("canonicalizes every Bitwarden URI match value to the numeric projection wire enum", async () => {
    const fixture = createFixture();
    const login = {
      ...demoVaultItems[0],
      uris: [
        { id: "domain", uri: "https://domain.example", matchType: "0" },
        { id: "host", uri: "https://host.example", matchType: "1" },
        { id: "starts", uri: "https://starts.example/path", matchType: "2" },
        { id: "exact", uri: "https://exact.example/path", matchType: "3" },
        { id: "regex", uri: "^https://regex\\.example$", matchType: "4" },
        { id: "never", uri: "https://never.example", matchType: "5" },
        { id: "default", uri: "https://default.example", matchType: "default" },
        { id: "future", uri: "https://future.example", matchType: "99" },
      ],
    };

    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([login]);
    await fixture.service.settled();

    expect(fixture.host.replacements[0].logins[0].uris.map((uri) => uri.matchType))
      .toEqual([0, 1, 2, 3, 4, 5, 0, 5]);
    fixture.service.destroy();
  });

  it("drops blank Login URI entries instead of rejecting the entire native projection", async () => {
    const fixture = createFixture();
    const login = {
      ...demoVaultItems[0],
      uris: [
        { id: "blank", uri: "   ", matchType: "0" },
        { id: "usable", uri: "https://github.com", matchType: "0" },
      ],
    };

    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([login]);
    await fixture.service.settled();

    expect(fixture.host.replacements[0].logins[0].uris).toEqual([
      { uri: "https://github.com", matchType: 0 },
    ]);
    fixture.service.destroy();
  });

  it("leaves revision allocation to the one native writer shared by all windows", async () => {
    const fixture = createFixture();
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();

    fixture.store.updateVaultItem("github", (item) => ({ ...item, favorite: false }));
    await fixture.service.settled();

    expect(fixture.host.replacements).toHaveLength(2);
    expect(fixture.host.replacements.every((input) => !("vaultRevision" in input))).toBe(true);
    expect(fixture.host.replacements[1].logins[0].favorite).toBe(false);
    fixture.service.destroy();
  });

  it("replaces the encrypted projection when a user binding changes without a vault mutation", async () => {
    const matching = new AutoFillBindingsService();
    const fixture = createFixture(new RecordingProjectionHost(), matching);
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();

    matching.bind(accountId, "com.example.app", "github");
    await fixture.service.settled();

    expect(fixture.host.replacements).toHaveLength(2);
    expect(fixture.host.replacements[1].bindings).toEqual([
      { bundleId: "com.example.app", cipherId: "github" },
    ]);
    fixture.service.destroy();
  });

  it("projects recent usage from the explicit successful selection timestamp, never revisionDate", async () => {
    const matching = new AutoFillBindingsService();
    const fixture = createFixture(new RecordingProjectionHost(), matching);
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([{ ...demoVaultItems[0], revisionDate: "2099-01-01T00:00:00Z" }]);
    await fixture.service.settled();

    expect(fixture.host.replacements[0].logins[0].lastUsedAt).toBeUndefined();
    matching.recordSuccessfulSelection({
      accountId,
      bundleId: "com.example.app",
      serviceIdentifiers: [],
      cipherId: "github",
      selectedAt: "2026-08-09T00:00:00+00:00",
      explicitUserAction: true,
      succeeded: true,
    });
    await fixture.service.settled();

    expect(fixture.host.replacements[1].logins[0].lastUsedAt).toBe(1_786_233_600_000);
    expect(fixture.host.replacements[1].history[0].lastSelectedAt).toBe(1_786_233_600_000);
    fixture.service.destroy();
  });

  it("locks the Agent on every unlocked to locked transition", async () => {
    const fixture = createFixture();
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();

    fixture.store.setLocked();
    await fixture.service.settled();

    expect(fixture.host.lockAttempts).toBe(1);
    fixture.service.destroy();
  });

  it("deletes the requested account projection during logout cleanup", async () => {
    const fixture = createFixture();

    await fixture.service.clearAccount(accountId);

    expect(fixture.host.clears).toEqual([accountId]);
    fixture.service.destroy();
  });

  it("deletes account-scoped bindings and history only after native projection clear succeeds", async () => {
    const matching = new AutoFillBindingsService();
    matching.bind(accountId, "com.example.app", "github");
    matching.recordSuccessfulSelection({
      accountId,
      bundleId: "com.example.app",
      serviceIdentifiers: [],
      cipherId: "github",
      selectedAt: "2026-08-08T00:00:00Z",
      explicitUserAction: true,
      succeeded: true,
    });
    const fixture = createFixture(new RecordingProjectionHost(), matching);

    await fixture.service.clearAccount(accountId);

    expect(matching.snapshot(accountId)).toEqual({ bindings: [], history: [] });
    fixture.service.destroy();
  });

  it("retries a transient native clear transaction", async () => {
    const fixture = createFixture();
    fixture.host.clearFailures = 1;

    await expect(fixture.service.clearAccount(accountId)).resolves.toBeUndefined();

    expect(fixture.host.clearAttempts).toBe(2);
    fixture.service.destroy();
  });

  it("serializes replacement calls and never reenters the native writer", async () => {
    let releaseFirst = () => undefined;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const host = new RecordingProjectionHost(async (call) => {
      if (call === 1) await firstPending;
    });
    const fixture = createFixture(host);
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await vi.waitFor(() => expect(host.replacements).toHaveLength(1));
    fixture.store.updateVaultItem("github", (item) => ({ ...item, favorite: false }));
    await Promise.resolve();

    expect(host.maximumConcurrentReplacements).toBe(1);
    expect(host.replacements).toHaveLength(1);
    releaseFirst();
    await fixture.service.settled();

    expect(host.replacements).toHaveLength(2);
    expect(host.maximumConcurrentReplacements).toBe(1);
    fixture.service.destroy();
  });

  it("rejects a suspended A write after another window globally invalidates and activates B", async () => {
    const sharedHost = new SharedAuthoritativeProjectionHost(accountId);
    const windowA = createFixture(sharedHost);
    const windowB = createFixture(sharedHost);
    windowA.store.setActiveSession(session);
    windowA.store.setUnlocked("person-a@example.test");
    windowA.store.setItems([{ ...demoVaultItems[0], fields: [
      { id: "username", label: "Username", value: "A-ONLY-USERNAME" },
      { id: "password", label: "Password", value: "A-ONLY-PASSWORD" },
    ] }], undefined, undefined, accountId);
    await sharedHost.replaceStarted.promise;

    const accountB = "b".repeat(64);
    await windowB.service.invalidateAndLock();
    sharedHost.activate(accountB);
    windowB.store.setActiveSession({ ...session });
    windowB.store.setUnlocked("person-b@example.test");
    windowB.store.setItems([demoVaultItems[0]], undefined, undefined, accountB);
    sharedHost.resumeReplace();
    await windowA.service.settled();
    await windowB.service.settled();

    expect(sharedHost.committedWrites).toHaveLength(1);
    expect(sharedHost.committedWrites[0].accountId).toBe(accountB);
    expect(JSON.stringify(sharedHost.committedWrites)).not.toContain("A-ONLY");
    windowA.service.destroy();
    windowB.service.destroy();
  });

  it("retries a transient Agent lock failure before acknowledging invalidation", async () => {
    const host = new RecordingProjectionHost();
    host.lockFailures = 1;
    const fixture = createFixture(host);

    await expect(fixture.service.invalidateAndLock()).resolves.toBeUndefined();

    expect(host.lockAttempts).toBe(2);
    fixture.service.destroy();
  });

  it("uses the dedicated setup reset so the current owner can be reprojected", async () => {
    const host = new RecordingProjectionHost();
    const fixture = createFixture(host);

    await fixture.service.resetForReprojection();

    expect(host.resetAttempts).toBe(1);
    expect(host.lockAttempts).toBe(0);
    fixture.service.destroy();
  });

  it("explicitly reprojects the current owner after an acknowledged switch abort", async () => {
    const fixture = createFixture();
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();

    await fixture.service.invalidateAndLock();
    await fixture.service.reprojectCurrent();

    expect(fixture.host.lockAttempts).toBe(1);
    expect(fixture.host.replacements).toHaveLength(2);
    expect(fixture.host.replacements[1].accountId).toBe(accountId);
    fixture.service.destroy();
  });

  it("retries an explicit reprojection when a concurrent store refresh stales its first snapshot", async () => {
    const fixture = createFixture();
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();

    await fixture.service.invalidateAndLock();
    let refreshed = false;
    fixture.host.onCaptureBinding = () => {
      if (refreshed) return;
      refreshed = true;
      fixture.store.updateVaultItem("github", (item) => ({ ...item, favorite: false }));
    };
    await fixture.service.reprojectCurrent();

    expect(fixture.host.replacements).toHaveLength(2);
    expect(fixture.host.replacements[1].logins[0].favorite).toBe(false);
    fixture.service.destroy();
  });

  it("does not report an explicit reprojection ready when its native replace became stale in flight", async () => {
    const staleReplace = deferred<void>();
    const currentReplace = deferred<void>();
    const host = new RecordingProjectionHost(async (call) => {
      if (call === 2) await staleReplace.promise;
      if (call === 3) await currentReplace.promise;
    });
    const fixture = createFixture(host);
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();
    await fixture.service.invalidateAndLock();

    let settled = false;
    const reprojection = fixture.service.reprojectCurrent().then(() => { settled = true; });
    await vi.waitFor(() => expect(host.replacements).toHaveLength(2));
    fixture.store.updateVaultItem("github", (item) => ({ ...item, favorite: false }));
    staleReplace.resolve();
    await vi.waitFor(() => expect(host.replacements).toHaveLength(3));

    expect(settled).toBe(false);
    currentReplace.resolve();
    await reprojection;
    expect(host.replacements[2].logins[0].favorite).toBe(false);
    fixture.service.destroy();
  });

  it("surfaces a bounded background lock failure without exposing native details", async () => {
    const fixture = createFixture();
    fixture.host.lockFailures = 3;
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();

    fixture.store.setLocked();
    await fixture.service.settled();

    expect(fixture.host.lockAttempts).toBe(3);
    expect([
      "Unable to lock AutoFill. Try again.",
      "无法锁定自动填充。请重试。",
    ]).toContain(fixture.store.snapshot().syncError);
    expect(fixture.store.snapshot().syncError).not.toContain("transient");
    fixture.service.destroy();
  });
});

class RecordingProjectionHost implements AutoFillProjectionHost {
  readonly replacements: Parameters<AutoFillProjectionHost["replaceProjection"]>[0][] = [];
  readonly clears: string[] = [];
  clearAttempts = 0;
  clearFailures = 0;
  lockAttempts = 0;
  lockFailures = 0;
  resetAttempts = 0;
  maximumConcurrentReplacements = 0;
  onCaptureBinding: (() => void) | null = null;
  private concurrentReplacements = 0;

  constructor(private readonly onReplace: (call: number) => Promise<void> = async () => undefined) {}

  async captureBinding(accountId: string) {
    this.onCaptureBinding?.();
    return { token: `binding:${accountId}`, accountId };
  }

  async replaceProjection(input: Parameters<AutoFillProjectionHost["replaceProjection"]>[0]): Promise<void> {
    this.concurrentReplacements += 1;
    this.maximumConcurrentReplacements = Math.max(
      this.maximumConcurrentReplacements,
      this.concurrentReplacements,
    );
    this.replacements.push(input);
    try {
      await this.onReplace(this.replacements.length);
    } finally {
      this.concurrentReplacements -= 1;
    }
  }

  async clearProjection(id: string): Promise<void> {
    this.clearAttempts += 1;
    if (this.clearFailures > 0) {
      this.clearFailures -= 1;
      throw new Error("transient clear failure");
    }
    this.clears.push(id);
  }

  async lockProjection(): Promise<void> {
    this.lockAttempts += 1;
    if (this.lockFailures > 0) {
      this.lockFailures -= 1;
      throw new Error("transient lock failure");
    }
  }

  async resetProjection(): Promise<void> {
    this.resetAttempts += 1;
  }
}

function createFixture(
  host = new RecordingProjectionHost(),
  matching = new AutoFillBindingsService(),
) {
  const store = new PopupStateStore();
  const service = new AutoFillProjectionService(
    store,
    host,
    () => new Date("2026-08-08T08:00:00.000Z"),
    matching,
  );
  store.setItems([], undefined, undefined, accountId);
  return { store, host, service };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

class SharedAuthoritativeProjectionHost implements AutoFillProjectionHost {
  readonly replaceStarted = deferred<void>();
  readonly committedWrites: Parameters<AutoFillProjectionHost["replaceProjection"]>[0][] = [];
  private epoch = 0;
  private activeAccountId: string | null;
  private replaceRelease = deferred<void>();
  private suspended = true;

  constructor(accountId: string) {
    this.activeAccountId = accountId;
  }

  activate(accountId: string): void {
    this.activeAccountId = accountId;
  }

  resumeReplace(): void {
    this.suspended = false;
    this.replaceRelease.resolve();
  }

  async captureBinding(accountId: string) {
    if (accountId !== this.activeAccountId) throw new Error("stale binding owner");
    return { token: `${this.epoch}:${accountId}`, accountId };
  }

  async replaceProjection(
    input: Parameters<AutoFillProjectionHost["replaceProjection"]>[0],
    binding: Awaited<ReturnType<AutoFillProjectionHost["captureBinding"]>>,
  ): Promise<void> {
    this.replaceStarted.resolve();
    if (this.suspended) await this.replaceRelease.promise;
    if (binding.token !== `${this.epoch}:${this.activeAccountId}` || input.accountId !== this.activeAccountId) {
      throw new Error("stale binding");
    }
    this.committedWrites.push(input);
  }

  async clearProjection(): Promise<void> {}

  async lockProjection(): Promise<void> {
    this.epoch += 1;
    this.activeAccountId = null;
  }


  async resetProjection(): Promise<void> {
    this.epoch += 1;
  }
}
