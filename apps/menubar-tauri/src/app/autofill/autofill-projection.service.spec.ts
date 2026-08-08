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
      vaultRevision: 1,
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

  it("replaces after a committed unlocked mutation with a higher revision", async () => {
    const fixture = createFixture();
    fixture.store.setActiveSession(session);
    fixture.store.setUnlocked("person@example.test");
    fixture.store.setItems([demoVaultItems[0]]);
    await fixture.service.settled();

    fixture.store.updateVaultItem("github", (item) => ({ ...item, favorite: false }));
    await fixture.service.settled();

    expect(fixture.host.replacements.map(({ vaultRevision }) => vaultRevision)).toEqual([1, 2]);
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

    expect(fixture.host.locks).toBe(1);
    fixture.service.destroy();
  });

  it("deletes the requested account projection during logout cleanup", async () => {
    const fixture = createFixture();

    await fixture.service.clearAccount(accountId);

    expect(fixture.host.clears).toEqual([accountId]);
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
});

class RecordingProjectionHost implements AutoFillProjectionHost {
  readonly replacements: Parameters<AutoFillProjectionHost["replaceProjection"]>[0][] = [];
  readonly clears: string[] = [];
  locks = 0;
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
    this.clears.push(id);
  }

  async lockProjection(): Promise<void> {
    this.locks += 1;
  }
}

function createFixture(host = new RecordingProjectionHost()) {
  const store = new PopupStateStore();
  const accounts = {
    list: vi.fn(async () => [{
      id: accountId,
      email: "person@example.test",
      serverUrl: "https://vault.example.test",
      status: "unlocked" as const,
      isActive: true,
    }]),
  } as unknown as AccountSessionPort;
  const service = new AutoFillProjectionService(
    store,
    host,
    accounts,
    () => new Date("2026-08-08T08:00:00.000Z"),
  );
  return { store, host, service };
}
