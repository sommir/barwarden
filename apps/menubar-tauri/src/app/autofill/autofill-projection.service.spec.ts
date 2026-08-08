import { describe, expect, it, vi } from "vitest";

import type { AccountSessionPort } from "../../auth/account-session-port";
import type { AuthSession } from "../../auth/auth-session-store";
import { PopupStateStore } from "../popup-state";
import { demoVaultItems } from "../vault-demo";
import {
  AutoFillProjectionService,
  type AutoFillProjectionHost,
} from "./autofill-projection.service";

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
  it("projects only necessary fields from active Login records after unlocked fresh sync", async () => {
    const fixture = createFixture();
    const login = {
      ...demoVaultItems[0],
      opaqueServerPayload: { forbidden: "MASTER-PASSWORD-PIN-DEVICE-KEY" },
      notes: "SECURE-NOTES-MUST-NOT-LEAVE-ANGULAR",
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
        username: "ops@example.com",
        password: "correct-horse-demo",
        uris: [
          { uri: "https://github.com", matchType: "default" },
          { uri: "https://gist.github.com", matchType: "default" },
        ],
        totp: "123456",
        favorite: true,
        reprompt: false,
      }],
    });
    const wire = JSON.stringify(fixture.host.replacements[0]);
    for (const forbidden of [
      "ACCESS-TOKEN-MUST-NOT-LEAVE-ANGULAR",
      "REFRESH-TOKEN-MUST-NOT-LEAVE-ANGULAR",
      "DEVICE-OR-USER-KEY-MUST-NOT-LEAVE-ANGULAR",
      "SECURE-NOTES-MUST-NOT-LEAVE-ANGULAR",
      "MASTER-PASSWORD-MUST-NOT-LEAVE",
      "4111111111111111",
      "Deploy key",
    ]) {
      expect(wire).not.toContain(forbidden);
    }
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

  it("invalidates an A snapshot before an account lookup can resolve as B", async () => {
    const lookup = deferred<readonly ReturnType<typeof activeAccount>[]>() ;
    const accounts = {
      list: vi.fn(() => lookup.promise),
    } as unknown as AccountSessionPort;
    const fixture = createFixture(new RecordingProjectionHost(), accounts);
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person-a@example.test");
    fixture.store.setItems([{ ...demoVaultItems[0], fields: [
      { id: "username", label: "Username", value: "A-ONLY-USERNAME" },
      { id: "password", label: "Password", value: "A-ONLY-PASSWORD" },
    ] }]);
    await vi.waitFor(() => expect(accounts.list).toHaveBeenCalledTimes(1));

    const locked = fixture.service.invalidateAndLock();
    lookup.resolve([activeAccount("b".repeat(64))]);
    await locked;
    await fixture.service.settled();

    expect(fixture.host.replacements).toEqual([]);
    expect(JSON.stringify(fixture.host.replacements)).not.toContain("A-ONLY");
    fixture.service.destroy();
  });

  it("retries a transient Agent lock failure before acknowledging invalidation", async () => {
    const host = new RecordingProjectionHost();
    host.lockFailures = 1;
    const fixture = createFixture(host);

    await expect(fixture.service.invalidateAndLock()).resolves.toBeUndefined();

    expect(host.lockAttempts).toBe(2);
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
  maximumConcurrentReplacements = 0;
  private concurrentReplacements = 0;

  constructor(private readonly onReplace: (call: number) => Promise<void> = async () => undefined) {}

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
}

function createFixture(
  host = new RecordingProjectionHost(),
  accountStore: AccountSessionPort | null = null,
) {
  const store = new PopupStateStore();
  const accounts = accountStore ?? ({
    list: vi.fn(async () => [activeAccount(accountId)]),
  } as unknown as AccountSessionPort);
  const service = new AutoFillProjectionService(
    store,
    host,
    accounts,
    () => new Date("2026-08-08T08:00:00.000Z"),
  );
  return { store, host, service };
}

function activeAccount(id: string) {
  return {
    id,
    email: "person@example.test",
    serverUrl: "https://vault.example.test",
    status: "unlocked" as const,
    isActive: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
