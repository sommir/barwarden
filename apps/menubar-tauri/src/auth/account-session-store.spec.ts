import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildBitwardenEnvironment,
  buildSelfHostedEnvironmentFromServerUrl,
} from "../bitwarden-api/bitwarden-api";
import type { HostApi } from "../host/host-api";
import {
  ACCOUNT_INDEX_KEY,
  AccountSessionStore,
  type AuthSession,
  type StoredAccount,
} from "./account-session-store";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("AccountSessionStore", () => {
  it("stores separate sessions and keeps the active account first", async () => {
    const store = new AccountSessionStore(memoryHost());

    await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("one"),
    });
    await store.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.bitwarden.eu",
      session: session("two"),
    });

    expect((await store.list()).map(({ email, isActive }) => [email, isActive])).toEqual([
      ["two@example.com", true],
      ["one@example.com", false],
    ]);
  });

  it("isolates identical JWT subjects returned by different servers", async () => {
    const store = new AccountSessionStore(memoryHost());
    const first = await store.saveAccount({
      email: "same@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "shared-subject", server: "one" })),
    });
    const second = await store.saveAccount({
      email: "same@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session(jwt({ sub: "shared-subject", server: "two" })),
    });

    expect(first.id).not.toBe(second.id);
    expect(await store.list()).toHaveLength(2);
    expect((await store.readSession(first.id))?.token.accessToken).not.toBe(
      (await store.readSession(second.id))?.token.accessToken,
    );
  });

  it("migrates a matching legacy subject ID after fresh authentication", async () => {
    const host = memoryHost();
    const legacySession = sessionForServer(
      jwt({ sub: "legacy-subject" }),
      "https://vault.one.example.com",
    );
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "legacy-subject",
        email: "one@example.com",
        serverUrl: "https://vault.one.example.com",
        status: "locked",
        isActive: true,
      }],
    }));
    host.values.set("auth.account.legacy-subject", JSON.stringify(legacySession));
    const store = new AccountSessionStore(host);

    const migrated = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", refreshed: true })),
    });

    expect(migrated.id).not.toBe("legacy-subject");
    expect(await store.list()).toEqual([expect.objectContaining({
      id: migrated.id,
      email: "one@example.com",
      status: "unlocked",
    })]);
    expect(host.values.has("auth.account.legacy-subject")).toBe(false);
    expect((await store.readSession(migrated.id))?.token.accessToken).toContain(".");
  });

  it("leaves neither legacy nor scoped session after a migrated account logs out", async () => {
    const host = memoryHost();
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "legacy-subject",
        email: "one@example.com",
        serverUrl: "https://vault.one.example.com",
        status: "locked",
        isActive: true,
      }],
    }));
    host.values.set(
      "auth.account.legacy-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "legacy-subject", version: "old" }),
        "https://vault.one.example.com",
      )),
    );
    const store = new AccountSessionStore(host);
    const migrated = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "fresh" })),
    });

    await store.remove(migrated.id);

    expect(host.values.has(`auth.account.${migrated.id}`)).toBe(false);
    expect(host.values.has("auth.account.legacy-subject")).toBe(false);
  });

  it("restores the legacy index and session when legacy deletion fails before applying", async () => {
    const host = new LegacyMigrationDeleteFailureHost("before");
    const legacyRaw = JSON.stringify(sessionForServer(
      jwt({ sub: "legacy-subject", version: "old" }),
      "https://vault.one.example.com",
    ));
    const unrelatedRaw = JSON.stringify(session(jwt({ sub: "unrelated", version: "old" })));
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [
        {
          id: "legacy-subject",
          email: "one@example.com",
          serverUrl: "https://vault.one.example.com",
          status: "locked",
          isActive: true,
        },
        {
          id: "unrelated",
          email: "other@example.com",
          serverUrl: "https://vault.other.example.com",
          status: "locked",
          isActive: false,
        },
      ],
    }));
    host.values.set("auth.account.legacy-subject", legacyRaw);
    host.values.set("auth.account.unrelated", unrelatedRaw);

    await expect(new AccountSessionStore(host).saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "fresh" })),
    })).rejects.toThrow("secure delete failed");

    const storedIndex = JSON.parse(host.values.get(ACCOUNT_INDEX_KEY)!) as { accounts: StoredAccount[] };
    expect(storedIndex.accounts).toEqual([
      expect.objectContaining({ id: "legacy-subject", isActive: true }),
      expect.objectContaining({ id: "unrelated", isActive: false }),
    ]);
    expect(host.values.get("auth.account.legacy-subject")).toBe(legacyRaw);
    expect(host.values.get("auth.account.unrelated")).toBe(unrelatedRaw);
    expect([...host.values.keys()].filter((key) => key.startsWith("auth.account.") &&
      key !== "auth.account.legacy-subject" && key !== "auth.account.unrelated")).toEqual([]);
  });

  it("accepts legacy deletion that applied before reporting failure", async () => {
    const host = new LegacyMigrationDeleteFailureHost("after");
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "legacy-subject",
        email: "one@example.com",
        serverUrl: "https://vault.one.example.com",
        status: "locked",
        isActive: true,
      }],
    }));
    host.values.set(
      "auth.account.legacy-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "legacy-subject", version: "old" }),
        "https://vault.one.example.com",
      )),
    );

    const migrated = await new AccountSessionStore(host).saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "fresh" })),
    });

    expect(host.values.has("auth.account.legacy-subject")).toBe(false);
    expect(host.values.has(`auth.account.${migrated.id}`)).toBe(true);
    expect(await new AccountSessionStore(host).list()).toEqual([
      expect.objectContaining({ id: migrated.id, isActive: true }),
    ]);
  });

  it("quarantines only involved IDs when migration rollback cannot restore consistency", async () => {
    const host = new LegacyMigrationDeleteFailureHost("before", true);
    const unrelatedRaw = JSON.stringify(session(jwt({ sub: "unrelated", version: "old" })));
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [
        {
          id: "legacy-subject",
          email: "one@example.com",
          serverUrl: "https://vault.one.example.com",
          status: "locked",
          isActive: true,
        },
        {
          id: "unrelated",
          email: "other@example.com",
          serverUrl: "https://vault.other.example.com",
          status: "locked",
          isActive: false,
        },
      ],
    }));
    host.values.set(
      "auth.account.legacy-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "legacy-subject", version: "old" }),
        "https://vault.one.example.com",
      )),
    );
    host.values.set("auth.account.unrelated", unrelatedRaw);

    await expect(new AccountSessionStore(host).saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "fresh" })),
    })).rejects.toMatchObject({
      name: "AccountSessionSaveConsistencyError",
      message: "Unable to safely save account session",
    });

    expect(await new AccountSessionStore(host).list()).toEqual([
      expect.objectContaining({ id: "unrelated", isActive: false }),
    ]);
    expect(host.values.get("auth.account.unrelated")).toBe(unrelatedRaw);
    expect(host.values.has("auth.account.legacy-subject")).toBe(false);
    expect([...host.values.keys()].filter((key) =>
      key.startsWith("auth.account.") && key !== "auth.account.unrelated")).toEqual([]);
  });

  it("does not delete another server account during migration or logout", async () => {
    const host = memoryHost();
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [
        {
          id: "legacy-subject",
          email: "one@example.com",
          serverUrl: "https://vault.one.example.com",
          status: "locked",
          isActive: true,
        },
        {
          id: "other-subject",
          email: "other@example.com",
          serverUrl: "https://vault.two.example.com",
          status: "locked",
          isActive: false,
        },
      ],
    }));
    host.values.set(
      "auth.account.legacy-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "legacy-subject", server: "one" }),
        "https://vault.one.example.com",
      )),
    );
    const otherRaw = JSON.stringify(sessionForServer(
      jwt({ sub: "other-subject", server: "two" }),
      "https://vault.two.example.com",
    ));
    host.values.set("auth.account.other-subject", otherRaw);
    const store = new AccountSessionStore(host);
    const migrated = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", server: "one", version: "fresh" })),
    });

    await store.remove(migrated.id);

    expect(await store.list()).toEqual([
      expect.objectContaining({ id: "other-subject", serverUrl: "https://vault.two.example.com" }),
    ]);
    expect(host.values.get("auth.account.other-subject")).toBe(otherRaw);
    expect(host.values.has("auth.account.legacy-subject")).toBe(false);
    expect(host.values.has(`auth.account.${migrated.id}`)).toBe(false);
  });

  it("fails closed before mutation when the same-server legacy session belongs to another subject", async () => {
    const host = memoryHost();
    const unrelatedRaw = JSON.stringify(sessionForServer(
      jwt({ sub: "another-subject" }),
      "https://vault.one.example.com",
    ));
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "legacy-subject",
        email: "one@example.com",
        serverUrl: "https://vault.one.example.com",
        status: "locked",
        isActive: true,
      }],
    }));
    host.values.set("auth.account.legacy-subject", unrelatedRaw);

    const before = new Map(host.values);

    await expect(new AccountSessionStore(host).saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "fresh" })),
    })).rejects.toMatchObject({ name: "AccountSessionSaveConsistencyError" });

    expect(host.values).toEqual(before);
  });

  it("fails closed before mutation for the same legacy subject on another server", async () => {
    const host = memoryHost();
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "shared-subject",
        email: "one@example.com",
        serverUrl: "https://vault.two.example.com",
        status: "locked",
        isActive: true,
      }],
    }));
    host.values.set(
      "auth.account.shared-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "shared-subject" }),
        "https://vault.one.example.com",
      )),
    );
    host.lockedAccountIds.add("shared-subject");
    const before = new Map(host.values);

    await expect(new AccountSessionStore(host).saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session(jwt({ sub: "shared-subject", server: "two" })),
    })).rejects.toMatchObject({ name: "AccountSessionSaveConsistencyError" });

    expect(host.values).toEqual(before);
    expect(host.lockedAccountIds).toEqual(new Set(["shared-subject"]));
  });

  it.each([
    ["missing", null],
    ["invalid", "not-an-auth-session"],
  ] as const)("fails closed before mutation when the legacy session is %s", async (_label, rawSession) => {
    const host = memoryHost();
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "legacy-subject",
        email: "one@example.com",
        serverUrl: "https://vault.one.example.com",
        status: "locked",
        isActive: true,
      }],
    }));
    if (rawSession !== null) {
      host.values.set("auth.account.legacy-subject", rawSession);
    }
    host.lockedAccountIds.add("legacy-subject");
    const before = new Map(host.values);

    await expect(new AccountSessionStore(host).saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "fresh" })),
    })).rejects.toMatchObject({ name: "AccountSessionSaveConsistencyError" });

    expect(host.values).toEqual(before);
    expect(host.lockedAccountIds).toEqual(new Set(["legacy-subject"]));
  });

  it("deduplicates a scoped account and its matching legacy subject entry", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);
    const scoped = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "shared-subject", version: "scoped" })),
    });
    const index = JSON.parse(host.values.get(ACCOUNT_INDEX_KEY)!) as { accounts: StoredAccount[] };
    index.accounts.push({
      id: "shared-subject",
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      status: "locked",
      isActive: false,
    });
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify(index));
    host.values.set(
      "auth.account.shared-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "shared-subject", version: "legacy" }),
        "https://vault.one.example.com",
      )),
    );

    const saved = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "shared-subject", version: "fresh" })),
    });

    expect(saved.id).toBe(scoped.id);
    expect(await store.list()).toEqual([expect.objectContaining({ id: scoped.id })]);
  });

  it("quarantines every migrated identity when lock-intent compensation fails", async () => {
    const host = memoryHost();
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "legacy-subject",
        email: "one@example.com",
        serverUrl: "https://vault.one.example.com",
        status: "unlocked",
        isActive: true,
      }],
    }));
    host.values.set(
      "auth.account.legacy-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "legacy-subject", version: "old" }),
        "https://vault.one.example.com",
      )),
    );
    const lockIntents = new ClearThenRejectAndFailRestoreLockIntentHost();
    await lockIntents.setAccountLockIntents(["legacy-subject"], true);
    lockIntents.failNextClearAndRestore = true;
    const store = new AccountSessionStore(host, lockIntents);

    await expect(store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "new" })),
    })).rejects.toMatchObject({ name: "AccountSessionSaveConsistencyError" });

    expect(await store.list()).toEqual([]);
  });

  it("quarantines every migrated identity when stale lock-intent restoration fails", async () => {
    const host = memoryHost();
    host.values.set(ACCOUNT_INDEX_KEY, JSON.stringify({
      accounts: [{
        id: "legacy-subject",
        email: "one@example.com",
        serverUrl: "https://vault.one.example.com",
        status: "unlocked",
        isActive: true,
      }],
    }));
    host.values.set(
      "auth.account.legacy-subject",
      JSON.stringify(sessionForServer(
        jwt({ sub: "legacy-subject", version: "old" }),
        "https://vault.one.example.com",
      )),
    );
    let isCurrent = true;
    const lockIntents = new StaleAfterClearFailingRestoreLockIntentHost(() => {
      isCurrent = false;
    });
    await lockIntents.setAccountLockIntents(["legacy-subject"], true);
    lockIntents.staleOnNextClear = true;
    const store = new AccountSessionStore(host, lockIntents);

    await expect(store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session(jwt({ sub: "legacy-subject", version: "new" })),
    }, () => isCurrent)).rejects.toMatchObject({ name: "AccountSessionSaveConsistencyError" });

    expect(await store.list()).toEqual([]);
  });

  it("serializes concurrent account saves without losing an account", async () => {
    const host = new DelayedIndexReadHost();
    const store = new AccountSessionStore(host);

    await Promise.all([
      store.saveAccount({
        email: "one@example.com",
        serverUrl: "https://vault.bitwarden.com",
        session: session(jwt({ sub: "one-id" })),
      }),
      store.saveAccount({
        email: "two@example.com",
        serverUrl: "https://vault.bitwarden.eu",
        session: session(jwt({ sub: "two-id" })),
      }),
    ]);

    expect((await store.list()).map(({ email }) => email).sort()).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
  });

  it("continues processing mutations after a rejected operation", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);
    host.failWritesForPrefix = "auth.account.";

    await expect(
      store.saveAccount({
        email: "failed@example.com",
        serverUrl: "https://vault.bitwarden.com",
        session: session("failed"),
      }),
    ).rejects.toThrow("secure write failed");

    host.failWritesForPrefix = null;
    await store.saveAccount({
      email: "saved@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("saved"),
    });

    expect((await store.list()).map(({ email }) => email)).toEqual(["saved@example.com"]);
  });

  it("marks accounts locked without deleting their sessions", async () => {
    const store = new AccountSessionStore(memoryHost());
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("one"),
    });

    await store.setStatus(account.id, "locked");

    expect((await store.list())[0]?.status).toBe("locked");
    expect((await store.readSession(account.id))?.token.accessToken).toBe("one");
  });

  it("atomically replaces an existing account session without rewriting the account index", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("old-access"),
    });
    const indexBefore = host.values.get(ACCOUNT_INDEX_KEY);

    await store.replaceSession(account.id, {
      ...session("fresh-access"),
      crypto: { userKeyB64: "preserved-user-key" },
    });

    expect(host.values.get(ACCOUNT_INDEX_KEY)).toBe(indexBefore);
    expect(await store.readSession(account.id)).toMatchObject({
      token: { accessToken: "fresh-access" },
      crypto: { userKeyB64: "preserved-user-key" },
    });
  });

  it("rejects replacement for an unknown account without writing a session", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);

    await expect(store.replaceSession("missing-account", session("fresh"))).rejects.toThrow(
      "Account not found",
    );

    expect([...host.values.keys()].filter((key) => key.startsWith("auth.account."))).toEqual([]);
  });

  it("restores the previous session when a replacement becomes stale while the secure write is pending", async () => {
    const host = new PendingSessionWriteHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("old-access"),
    });
    host.deferNextSessionWrite();
    let current = true;

    const replace = (store as AccountSessionStore & {
      replaceSession(id: string, session: AuthSession, isCurrent: () => boolean): Promise<boolean>;
    }).replaceSession(account.id, session("fresh-access"), () => current);
    await host.pendingSessionWrite.started.promise;
    current = false;
    const read = store.readSession(account.id);
    let readSettled = false;
    void read.then(() => {
      readSettled = true;
    });
    await Promise.resolve();

    expect(readSettled).toBe(false);
    host.pendingSessionWrite.release();

    await expect(replace).resolves.toBe(false);
    await expect(read).resolves.toMatchObject({
      token: { accessToken: "old-access" },
    });
    await expect(store.readSession(account.id)).resolves.toMatchObject({
      token: { accessToken: "old-access" },
    });
  });

  it("rolls back a guarded new-account save when it becomes stale while the session write is pending", async () => {
    const host = new PendingAccountWriteHost();
    const store = new AccountSessionStore(host);
    const current = await store.saveAccount({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      session: session(jwt({ sub: "current-account" })),
    });
    const indexBefore = host.values.get(ACCOUNT_INDEX_KEY);
    host.deferNextSessionWrite();
    let isCurrent = true;

    const save = (store as AccountSessionStore & {
      saveAccount(
        input: { email: string; serverUrl: string; session: AuthSession },
        currentnessGuard: () => boolean,
      ): Promise<unknown>;
    }).saveAccount({
      email: "next@example.com",
      serverUrl: "https://vault.next.example.com",
      session: session(jwt({ sub: "next-account" })),
    }, () => isCurrent);
    await host.pendingSessionWrite.started.promise;
    isCurrent = false;
    host.pendingSessionWrite.release();

    await expect(save).rejects.toMatchObject({
      name: "AccountSessionMutationCancelledError",
      message: "Account session mutation cancelled",
    });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: current.id, isActive: true, email: "current@example.com" }),
    ]);
    await expect(store.readSession("next-account")).resolves.toBeNull();
    expect(host.values.get(ACCOUNT_INDEX_KEY)).toBe(indexBefore);
  });

  it("rolls back a guarded existing-account save when it becomes stale while the index write is pending", async () => {
    const host = new PendingAccountWriteHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "existing-account", version: "old" })),
    });
    const indexBefore = host.values.get(ACCOUNT_INDEX_KEY);
    host.deferNextIndexWrite();
    let isCurrent = true;

    const save = (store as AccountSessionStore & {
      saveAccount(
        input: { email: string; serverUrl: string; session: AuthSession },
        currentnessGuard: () => boolean,
      ): Promise<unknown>;
    }).saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "existing-account", version: "new" })),
    }, () => isCurrent);
    await host.pendingIndexWrite.started.promise;
    isCurrent = false;
    host.pendingIndexWrite.release();

    await expect(save).rejects.toMatchObject({
      name: "AccountSessionMutationCancelledError",
      message: "Account session mutation cancelled",
    });
    expect(host.values.get(ACCOUNT_INDEX_KEY)).toBe(indexBefore);
    await expect(store.readSession(account.id)).resolves.toMatchObject({
      token: { accessToken: jwt({ sub: "existing-account", version: "old" }) },
    });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: account.id, isActive: true, email: "one@example.com" }),
    ]);
  });

  it("quarantines a guarded save when stale rollback cannot restore consistency", async () => {
    const host = new PendingAccountWriteHost();
    const store = new AccountSessionStore(host);
    const current = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "existing-account", version: "old" })),
    });
    host.deferNextIndexWrite();
    let isCurrent = true;

    const save = (store as AccountSessionStore & {
      saveAccount(
        input: { email: string; serverUrl: string; session: AuthSession },
        currentnessGuard: () => boolean,
      ): Promise<unknown>;
    }).saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "existing-account", version: "new" })),
    }, () => isCurrent);
    await host.pendingIndexWrite.started.promise;
    isCurrent = false;
    host.failRollbackWritesForPrefix = "auth.account.";
    host.pendingIndexWrite.release();

    await expect(save).rejects.toMatchObject({
      name: "AccountSessionSaveConsistencyError",
      message: "Unable to safely save account session",
    });
    await expect(store.list()).resolves.toEqual([]);
    await expect(store.readSession(current.id)).resolves.toBeNull();
  });

  it("quarantines an account when stale replacement rollback fails", async () => {
    const host = new PendingSessionWriteHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("old-access"),
    });
    host.deferNextSessionWrite();
    let current = true;

    const replacement = store.replaceSession(account.id, session("fresh-access"), () => current);
    await host.pendingSessionWrite.started.promise;
    current = false;
    host.failRollbackWritesForPrefix = "auth.account.";
    host.pendingSessionWrite.release();

    await expect(replacement).rejects.toMatchObject({
      name: "AccountSessionReplacementConsistencyError",
      message: "Unable to safely replace account session",
    });
    await expect(store.list()).resolves.toEqual([]);
    await expect(store.readSession(account.id)).resolves.toBeNull();
    expect(JSON.stringify(await store.list())).not.toContain("fresh-access");
  });

  it("throws a fixed consistency error when quarantine index persistence fails", async () => {
    const host = new PendingSessionWriteHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("old-access"),
    });
    host.deferNextSessionWrite();
    let current = true;

    const replacement = store.replaceSession(account.id, session("fresh-access"), () => current);
    await host.pendingSessionWrite.started.promise;
    current = false;
    host.failRollbackWritesForPrefix = "auth.account.";
    host.failWritesForPrefix = ACCOUNT_INDEX_KEY;
    host.pendingSessionWrite.release();

    await expect(replacement).rejects.toMatchObject({
      name: "AccountSessionReplacementConsistencyError",
      message: "Unable to safely replace account session",
    });
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("enforces the official five-account limit", async () => {
    const store = new AccountSessionStore(memoryHost());
    for (let index = 0; index < 5; index += 1) {
      await store.saveAccount({
        email: `user${index}@example.com`,
        serverUrl: "https://vault.bitwarden.com",
        session: session(String(index)),
      });
    }

    await expect(
      store.saveAccount({
        email: "six@example.com",
        serverUrl: "https://vault.bitwarden.com",
        session: session("six"),
      }),
    ).rejects.toThrow("Account limit reached");
  });

  it("keeps account-switcher snapshots active-first without exposing stored sessions", async () => {
    const store = new AccountSessionStore(memoryHost());
    const first = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("private-session-one"),
    });
    const second = await store.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("private-session-two"),
    });

    await store.setActive(first.id);
    const snapshot = await store.list();

    expect(snapshot.map((account) => account.id)).toEqual([first.id, second.id]);
    expect(snapshot[0]).toMatchObject({ isActive: true, status: "unlocked" });
    expect(JSON.stringify(snapshot)).not.toMatch(/private-session|accessToken|refreshToken/);
  });

  it("switches accounts without deleting either encrypted session", async () => {
    const host = memoryHost();
    const deleteSpy = vi.spyOn(host, "secureDelete");
    const store = new AccountSessionStore(host);
    const first = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("session-one"),
    });
    const second = await store.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("session-two"),
    });
    deleteSpy.mockClear();

    await store.setActive(first.id);

    expect(deleteSpy).not.toHaveBeenCalled();
    await expect(store.readSession(first.id)).resolves.toMatchObject({
      token: { accessToken: "session-one" },
    });
    await expect(store.readSession(second.id)).resolves.toMatchObject({
      token: { accessToken: "session-two" },
    });
  });

  it("offline relaunch restores both existing sessions without a network dependency", async () => {
    const host = memoryHost();
    const initial = new AccountSessionStore(host);
    const first = await initial.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("offline-one"),
    });
    const second = await initial.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("offline-two"),
    });

    const relaunched = new AccountSessionStore(host);

    await expect(relaunched.list()).resolves.toHaveLength(2);
    await expect(relaunched.readSession(first.id)).resolves.toMatchObject({
      token: { accessToken: "offline-one" },
    });
    await expect(relaunched.readSession(second.id)).resolves.toMatchObject({
      token: { accessToken: "offline-two" },
    });
  });

  it("offline relaunch restores an official desktop client session", async () => {
    const host = memoryHost();
    const initial = new AccountSessionStore(host);
    const baseSession = session(jwt({ sub: "desktop-account" }));
    const desktopSession: AuthSession = {
      ...baseSession,
      token: {
        ...baseSession.token,
        clientId: "desktop",
      },
    };
    const account = await initial.saveAccount({
      email: "desktop@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: desktopSession,
    });

    await expect(new AccountSessionStore(host).readSession(account.id)).resolves.toEqual(
      desktopSession,
    );
  });

  it("derives a stable server-scoped account id from the access-token subject", async () => {
    const store = new AccountSessionStore(memoryHost());

    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "account-id" })),
    });

    expect(account.id).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "account-id", refreshed: true })),
    })).id).toBe(account.id);
  });

  it("uses a stable SHA-256 id for the normalized account identity without a token subject", async () => {
    const store = new AccountSessionStore(memoryHost());

    const first = await store.saveAccount({
      email: " One@Example.com ",
      serverUrl: "https://vault.bitwarden.com/",
      session: session("one"),
    });
    const second = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("two"),
    });

    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
    expect((await store.readSession(first.id))?.token.accessToken).toBe("two");
  });

  it("ignores malformed stored index and session data", async () => {
    const host = memoryHost();
    await host.secureSet(ACCOUNT_INDEX_KEY, "{not-json");
    const store = new AccountSessionStore(host);

    await expect(store.list()).resolves.toEqual([]);

    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("one"),
    });
    await host.secureSet(`auth.account.${account.id}`, JSON.stringify({ token: { accessToken: "one" } }));

    await expect(store.readSession(account.id)).resolves.toBeNull();
  });

  it.each([
    ["FTP URL", "one@example.com", "ftp://vault.bitwarden.com"],
    ["URL credentials", "one@example.com", "https://user:password@vault.bitwarden.com"],
    ["URL query", "one@example.com", "https://vault.bitwarden.com?source=stored"],
    ["URL hash", "one@example.com", "https://vault.bitwarden.com#account"],
    ["noncanonical URL path", "one@example.com", "https://vault.bitwarden.com/path/../vault"],
    ["uppercase email", "One@Example.com", "https://vault.bitwarden.com"],
    ["email whitespace", " one@example.com ", "https://vault.bitwarden.com"],
    ["malformed URL", "one@example.com", "not a URL"],
  ])("ignores persisted account metadata with %s", async (_case, email, serverUrl) => {
    const host = memoryHost();
    await host.secureSet(
      ACCOUNT_INDEX_KEY,
      JSON.stringify({
        accounts: [
          {
            id: "account-id",
            email,
            serverUrl,
            status: "unlocked",
            isActive: true,
          },
        ],
      }),
    );

    await expect(new AccountSessionStore(host).list()).resolves.toEqual([]);
  });

  it("does not publish an account when writing its session fails", async () => {
    const host = memoryHost();
    host.failWritesForPrefix = "auth.account.";
    const store = new AccountSessionStore(host);

    await expect(
      store.saveAccount({
        email: "one@example.com",
        serverUrl: "https://vault.bitwarden.com",
        session: session("one"),
      }),
    ).rejects.toThrow("secure write failed");

    expect(await store.list()).toEqual([]);
    expect(host.values.has(ACCOUNT_INDEX_KEY)).toBe(false);
  });

  it("deletes a newly written session when publishing the account index fails", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);
    host.failWritesForPrefix = ACCOUNT_INDEX_KEY;

    await expect(
      store.saveAccount({
        email: "one@example.com",
        serverUrl: "https://vault.bitwarden.com",
        session: session(jwt({ sub: "new-account" })),
      }),
    ).rejects.toThrow("secure write failed");

    expect(host.values.has("auth.account.new-account")).toBe(false);
    expect(host.values.has(ACCOUNT_INDEX_KEY)).toBe(false);
  });

  it("restores an existing session when republishing its account index fails", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "existing-account", version: "old" })),
    });
    const originalSession = host.values.get(`auth.account.${account.id}`);
    host.failWritesForPrefix = ACCOUNT_INDEX_KEY;

    await expect(
      store.saveAccount({
        email: "one@example.com",
        serverUrl: "https://vault.bitwarden.com",
        session: session(jwt({ sub: "existing-account", version: "new" })),
      }),
    ).rejects.toThrow("secure write failed");

    expect(host.values.get(`auth.account.${account.id}`)).toBe(originalSession);
  });

  it("removes both the account index entry and its session", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("one"),
    });

    await expect(store.remove(account.id)).resolves.toMatchObject({ id: account.id });

    expect(await store.list()).toEqual([]);
    expect(host.values.has(`auth.account.${account.id}`)).toBe(false);
  });

  it("atomically promotes a successor when removing the active account", async () => {
    const store = new AccountSessionStore(memoryHost());
    const first = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const active = await store.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("two"),
    });

    await store.remove(active.id);

    expect(await store.list()).toEqual([
      expect.objectContaining({ id: first.id, isActive: true }),
    ]);
  });

  it("restores the original index when logout session deletion fails", async () => {
    const host = memoryHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    host.failDeletesForPrefix = `auth.account.${account.id}`;

    await expect(store.remove(account.id)).rejects.toThrow("secure delete failed");

    expect(await store.list()).toEqual([expect.objectContaining({ id: account.id, isActive: true })]);
    expect((await store.readSession(account.id))?.token.accessToken).toBe("one");
  });

  it("keeps a deleted session unindexed when logout deletion rejects after applying", async () => {
    const host = new DeleteThenRejectHost();
    const store = new AccountSessionStore(host);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    host.rejectDeletesForKey = `auth.account.${account.id}`;

    await expect(store.remove(account.id)).rejects.toThrow("secure delete failed after applying");

    expect(await store.list()).toEqual([]);
    expect(host.values.has(`auth.account.${account.id}`)).toBe(false);
  });

  it("reconciles delete-after-apply without deleting or unindexing another account", async () => {
    const host = new DeleteThenRejectHost();
    const store = new AccountSessionStore(host);
    const retained = await store.saveAccount({
      email: "retained@example.com",
      serverUrl: "https://vault.retained.example.com",
      session: session("retained-session"),
    });
    const removed = await store.saveAccount({
      email: "removed@example.com",
      serverUrl: "https://vault.removed.example.com",
      session: session("removed-session"),
    });
    host.rejectDeletesForKey = `auth.account.${removed.id}`;

    await expect(store.remove(removed.id)).rejects.toThrow("secure delete failed after applying");

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: retained.id, isActive: true }),
    ]);
    await expect(store.readSession(retained.id)).resolves.toMatchObject({
      token: { accessToken: "retained-session" },
    });
    expect(host.values.has(`auth.account.${removed.id}`)).toBe(false);
  });

  it("locks every stored account without deleting their sessions", async () => {
    const host = memoryHost();
    const lockIntents = new MemoryAccountLockIntentHost();
    const setLockIntents = vi.spyOn(lockIntents, "setAccountLockIntents");
    const store = new AccountSessionStore(host, lockIntents);
    const first = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session("one"),
    });
    const second = await store.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.bitwarden.eu",
      session: session("two"),
    });

    setLockIntents.mockClear();
    await store.lockAll();

    expect(setLockIntents).toHaveBeenNthCalledWith(1, [first.id, second.id], true);
    expect(setLockIntents).toHaveBeenNthCalledWith(2, [first.id, second.id], false);
    expect((await store.list()).map(({ status }) => status)).toEqual(["locked", "locked"]);
    expect((await store.readSession(first.id))?.token.accessToken).toBe("one");
    expect((await store.readSession(second.id))?.token.accessToken).toBe("two");
  });

  it("keeps a durable lock intent when the Keychain account-index write fails", async () => {
    const host = memoryHost();
    const lockIntents = new MemoryAccountLockIntentHost();
    const store = new AccountSessionStore(host, lockIntents);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one" })),
    });
    host.failWritesForPrefix = ACCOUNT_INDEX_KEY;

    await expect(store.setStatus(account.id, "locked")).rejects.toThrow("secure write failed");

    host.failWritesForPrefix = null;
    const restarted = new AccountSessionStore(host, lockIntents);
    expect(await restarted.list()).toEqual([
      expect.objectContaining({ id: account.id, status: "locked" }),
    ]);
    expect(await restarted.setActive(account.id)).toMatchObject({ status: "locked" });
    expect((await restarted.readSession(account.id))?.token.accessToken).toBeTruthy();
  });

  it("clears the durable lock intent after the Keychain lock state is committed", async () => {
    const host = memoryHost();
    const lockIntents = new MemoryAccountLockIntentHost();
    const store = new AccountSessionStore(host, lockIntents);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one" })),
    });

    await store.setStatus(account.id, "locked");

    expect(await lockIntents.getAccountLockIntents()).toEqual([]);
    expect((await store.list())[0]?.status).toBe("locked");
  });

  it("clears a stale lock intent only after a fresh authenticated session is committed", async () => {
    const host = memoryHost();
    const lockIntents = new MemoryAccountLockIntentHost();
    const store = new AccountSessionStore(host, lockIntents);
    const existing = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one" })),
    });
    await lockIntents.setAccountLockIntents([existing.id], true);

    await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one", refreshed: true })),
    });

    expect(await lockIntents.getAccountLockIntents()).toEqual([]);
    expect((await store.list())[0]?.status).toBe("unlocked");
  });

  it("restores a stale lock intent when clearing it rejects after applying", async () => {
    const host = memoryHost();
    const lockIntents = new ClearThenRejectLockIntentHost();
    const store = new AccountSessionStore(host, lockIntents);
    const existing = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one", version: "old" })),
    });
    await lockIntents.setAccountLockIntents([existing.id], true);
    lockIntents.rejectNextClear = true;

    await expect(store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one", version: "new" })),
    })).rejects.toThrow("lock intent clear failed after applying");

    expect(await lockIntents.getAccountLockIntents()).toEqual([existing.id]);
    expect((await store.list())[0]).toMatchObject({ id: existing.id, status: "locked" });
    expect((await store.readSession(existing.id))?.token.accessToken).toBe(
      jwt({ sub: "one", version: "old" }),
    );
  });

  it("rolls back a lock transaction superseded after its durable intent is written", async () => {
    const host = memoryHost();
    const lockIntents = new PendingAccountLockIntentHost();
    const store = new AccountSessionStore(host, lockIntents);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one" })),
    });
    let isCurrent = true;
    lockIntents.deferNextLock();

    const locking = store.setStatus(account.id, "locked", () => isCurrent);
    await lockIntents.lockIntentWritten.promise;
    isCurrent = false;
    lockIntents.release();

    await expect(locking).rejects.toMatchObject({ name: "AccountSessionMutationCancelledError" });
    expect((await store.list())[0]?.status).toBe("unlocked");
    expect(await lockIntents.getAccountLockIntents()).toEqual([]);
  });

  it("rolls back a lock transaction superseded after the Keychain index write", async () => {
    const host = new PendingAccountWriteHost();
    const lockIntents = new MemoryAccountLockIntentHost();
    const store = new AccountSessionStore(host, lockIntents);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one" })),
    });
    let isCurrent = true;
    host.deferNextIndexWrite();

    const locking = store.setStatus(account.id, "locked", () => isCurrent);
    await host.pendingIndexWrite.started.promise;
    isCurrent = false;
    host.pendingIndexWrite.release();

    await expect(locking).rejects.toMatchObject({ name: "AccountSessionMutationCancelledError" });
    expect((await store.list())[0]?.status).toBe("unlocked");
    expect(await lockIntents.getAccountLockIntents()).toEqual([]);
  });

  it("keeps the committed locked index when restoring a prior marker fails after clear", async () => {
    const host = memoryHost();
    const lockIntents = new PendingClearFailingRestoreLockIntentHost();
    await lockIntents.setAccountLockIntents(["one"], true);
    const store = new AccountSessionStore(host, lockIntents);
    const account = await store.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: session(jwt({ sub: "one" })),
    });
    await lockIntents.setAccountLockIntents([account.id], true);
    let isCurrent = true;
    lockIntents.deferNextClearAndFailRestore();

    const locking = store.setStatus(account.id, "locked", () => isCurrent);
    await lockIntents.clearWritten.promise;
    isCurrent = false;
    lockIntents.release();

    await expect(locking).rejects.toThrow("lock intent restore failed");
    expect((await store.list())[0]?.status).toBe("locked");
  });
});

function session(accessToken: string): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function sessionForServer(accessToken: string, serverUrl: string): AuthSession {
  return {
    ...session(accessToken),
    environment: buildSelfHostedEnvironmentFromServerUrl(serverUrl),
  };
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

class MemoryHostApi implements HostApi {
  readonly values = new Map<string, string>();
  readonly lockedAccountIds = new Set<string>();
  failWritesForPrefix: string | null = null;
  failDeletesForPrefix: string | null = null;

  showPopup(): Promise<void> {
    return Promise.resolve();
  }

  hidePopup(): Promise<void> {
    return Promise.resolve();
  }

  copyText(): Promise<void> {
    return Promise.resolve();
  }

  pasteText(): Promise<void> {
    return Promise.resolve();
  }

  openUrl(): Promise<void> {
    return Promise.resolve();
  }

  secureGet(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  secureSet(key: string, value: string): Promise<void> {
    if (this.failWritesForPrefix && key.startsWith(this.failWritesForPrefix)) {
      return Promise.reject(new Error("secure write failed"));
    }

    this.values.set(key, value);
    return Promise.resolve();
  }

  secureDelete(key: string): Promise<void> {
    if (this.failDeletesForPrefix && key.startsWith(this.failDeletesForPrefix)) {
      return Promise.reject(new Error("secure delete failed"));
    }
    this.values.delete(key);
    return Promise.resolve();
  }

  getAccountLockIntents(): Promise<readonly string[]> {
    return Promise.resolve([...this.lockedAccountIds]);
  }

  setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    for (const accountId of accountIds) {
      if (locked) this.lockedAccountIds.add(accountId);
      else this.lockedAccountIds.delete(accountId);
    }
    return Promise.resolve();
  }
}

class DeleteThenRejectHost extends MemoryHostApi {
  rejectDeletesForKey: string | null = null;

  override async secureDelete(key: string): Promise<void> {
    await super.secureDelete(key);
    if (key === this.rejectDeletesForKey) {
      throw new Error("secure delete failed after applying");
    }
  }
}

class LegacyMigrationDeleteFailureHost extends MemoryHostApi {
  private legacyDeleteFailed = false;
  private failScopedRollback = false;

  constructor(
    private readonly mode: "before" | "after",
    failScopedRollback = false,
  ) {
    super();
    this.failScopedRollback = failScopedRollback;
  }

  override async secureDelete(key: string): Promise<void> {
    if (key === "auth.account.legacy-subject" && !this.legacyDeleteFailed) {
      this.legacyDeleteFailed = true;
      if (this.mode === "before") {
        throw new Error("secure delete failed");
      }
      await super.secureDelete(key);
      throw new Error("secure delete failed after applying");
    }

    if (
      this.failScopedRollback &&
      this.legacyDeleteFailed &&
      key.startsWith("auth.account.") &&
      key !== "auth.account.legacy-subject" &&
      key !== "auth.account.unrelated"
    ) {
      this.failScopedRollback = false;
      throw new Error("scoped rollback delete failed");
    }

    await super.secureDelete(key);
  }
}

class DelayedIndexReadHost extends MemoryHostApi {
  private hasDelayedIndexRead = false;

  override async secureGet(key: string): Promise<string | null> {
    if (key !== ACCOUNT_INDEX_KEY) {
      return super.secureGet(key);
    }

    const capturedValue = this.values.get(key) ?? null;
    if (!this.hasDelayedIndexRead) {
      this.hasDelayedIndexRead = true;
      await Promise.resolve();
    }
    return capturedValue;
  }
}

class PendingSessionWriteHost extends MemoryHostApi {
  pendingSessionWrite = pendingGate();
  failRollbackWritesForPrefix: string | null = null;
  private hasPendingSessionWrite = false;
  private deferSessionWrite = false;

  deferNextSessionWrite(): void {
    this.deferSessionWrite = true;
  }

  override async secureSet(key: string, value: string): Promise<void> {
    if (this.failRollbackWritesForPrefix && key.startsWith(this.failRollbackWritesForPrefix)) {
      this.failRollbackWritesForPrefix = null;
      return Promise.reject(new Error("rollback secure write failed: fresh-access"));
    }

    await super.secureSet(key, value);
    if (this.deferSessionWrite && key.startsWith("auth.account.") && !this.hasPendingSessionWrite) {
      this.hasPendingSessionWrite = true;
      this.deferSessionWrite = false;
      this.pendingSessionWrite.started.resolve();
      await this.pendingSessionWrite.released.promise;
    }
  }
}

class PendingAccountWriteHost extends MemoryHostApi {
  pendingSessionWrite = pendingGate();
  pendingIndexWrite = pendingGate();
  failRollbackWritesForPrefix: string | null = null;
  private hasPendingSessionWrite = false;
  private hasPendingIndexWrite = false;
  private deferSessionWrite = false;
  private deferIndexWrite = false;

  deferNextSessionWrite(): void {
    this.deferSessionWrite = true;
  }

  deferNextIndexWrite(): void {
    this.deferIndexWrite = true;
  }

  override async secureSet(key: string, value: string): Promise<void> {
    if (this.failRollbackWritesForPrefix && key.startsWith(this.failRollbackWritesForPrefix)) {
      this.failRollbackWritesForPrefix = null;
      return Promise.reject(new Error("rollback secure write failed: next-account"));
    }

    await super.secureSet(key, value);
    if (this.deferSessionWrite && key.startsWith("auth.account.") && !this.hasPendingSessionWrite) {
      this.hasPendingSessionWrite = true;
      this.deferSessionWrite = false;
      this.pendingSessionWrite.started.resolve();
      await this.pendingSessionWrite.released.promise;
    }
    if (this.deferIndexWrite && key === ACCOUNT_INDEX_KEY && !this.hasPendingIndexWrite) {
      this.hasPendingIndexWrite = true;
      this.deferIndexWrite = false;
      this.pendingIndexWrite.started.resolve();
      await this.pendingIndexWrite.released.promise;
    }
  }
}

function memoryHost(): MemoryHostApi {
  return new MemoryHostApi();
}

class MemoryAccountLockIntentHost {
  private readonly lockedAccountIds = new Set<string>();

  getAccountLockIntents(): Promise<readonly string[]> {
    return Promise.resolve([...this.lockedAccountIds]);
  }

  setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    for (const accountId of accountIds) {
      if (locked) {
        this.lockedAccountIds.add(accountId);
      } else {
        this.lockedAccountIds.delete(accountId);
      }
    }
    return Promise.resolve();
  }
}

class ClearThenRejectLockIntentHost extends MemoryAccountLockIntentHost {
  rejectNextClear = false;

  override async setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    await super.setAccountLockIntents(accountIds, locked);
    if (!locked && this.rejectNextClear) {
      this.rejectNextClear = false;
      throw new Error("lock intent clear failed after applying");
    }
  }
}

class ClearThenRejectAndFailRestoreLockIntentHost extends MemoryAccountLockIntentHost {
  failNextClearAndRestore = false;
  private failRestore = false;

  override async setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    if (locked && this.failRestore) {
      throw new Error("lock intent restore failed");
    }
    await super.setAccountLockIntents(accountIds, locked);
    if (!locked && this.failNextClearAndRestore) {
      this.failNextClearAndRestore = false;
      this.failRestore = true;
      throw new Error("lock intent clear failed after applying");
    }
  }
}

class StaleAfterClearFailingRestoreLockIntentHost extends MemoryAccountLockIntentHost {
  staleOnNextClear = false;
  private failRestore = false;

  constructor(private readonly markStale: () => void) {
    super();
  }

  override async setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    if (locked && this.failRestore) {
      throw new Error("lock intent restore failed");
    }
    await super.setAccountLockIntents(accountIds, locked);
    if (!locked && this.staleOnNextClear) {
      this.staleOnNextClear = false;
      this.failRestore = true;
      this.markStale();
    }
  }
}

class PendingAccountLockIntentHost extends MemoryAccountLockIntentHost {
  readonly lockIntentWritten = deferred<void>();
  private readonly releaseGate = deferred<void>();
  private shouldDefer = false;

  deferNextLock(): void {
    this.shouldDefer = true;
  }

  release(): void {
    this.releaseGate.resolve();
  }

  override async setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    await super.setAccountLockIntents(accountIds, locked);
    if (locked && this.shouldDefer) {
      this.shouldDefer = false;
      this.lockIntentWritten.resolve();
      await this.releaseGate.promise;
    }
  }
}

class PendingClearFailingRestoreLockIntentHost extends MemoryAccountLockIntentHost {
  readonly clearWritten = deferred<void>();
  private readonly releaseGate = deferred<void>();
  private shouldDeferClear = false;
  private failRestore = false;

  deferNextClearAndFailRestore(): void {
    this.shouldDeferClear = true;
  }

  release(): void {
    this.releaseGate.resolve();
  }

  override async setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    if (locked && this.failRestore) {
      throw new Error("lock intent restore failed");
    }
    await super.setAccountLockIntents(accountIds, locked);
    if (!locked && this.shouldDeferClear) {
      this.shouldDeferClear = false;
      this.failRestore = true;
      this.clearWritten.resolve();
      await this.releaseGate.promise;
    }
  }
}

function pendingGate() {
  const started = deferred<void>();
  const released = deferred<void>();
  return {
    started,
    released,
    release: () => released.resolve(),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
