import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildBitwardenEnvironment } from "../../bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../popup-state";
import type { SendActionPort } from "./send-actions.service";
import type { SendItem } from "./send-item.model";
import { TextSendOperation, type TextSendDraft } from "./text-send-operation";

describe("TextSendOperation", () => {
  it("returns duplicate without sending a second request", async () => {
    const pending = deferred<SendItem>();
    const actions = actionPort({ createTextSend: vi.fn(() => pending.promise) });
    const harness = createHarness(actions);

    const first = harness.operation.create(draft());
    await expect(harness.operation.create(draft())).resolves.toEqual({ committed: false, reason: "duplicate" });
    expect(actions.createTextSend).toHaveBeenCalledTimes(1);
    pending.resolve(send({ id: "created" }));
    await expect(first).resolves.toEqual({ committed: true, send: send({ id: "created" }) });
  });

  it.each(["lock", "account-switch", "route-teardown", "newer-sync"] as const)(
    "ignores a late mutation after %s",
    async (transition) => {
      const pending = deferred<SendItem>();
      const actions = actionPort({ updateTextSend: vi.fn(() => pending.promise) });
      const harness = createHarness(actions);
      const source = send();
      harness.store.setSends([source]);

      const result = harness.operation.update(source, draft());
      if (transition === "lock") harness.store.setLocked();
      if (transition === "account-switch") {
        harness.store.setActiveSession(session("other"));
        harness.store.setUnlocked("other@example.test");
      }
      if (transition === "route-teardown") harness.navigation.url = "/send";
      if (transition === "newer-sync") harness.store.setSends([send({ name: "Fresh" })]);
      const updated = send({ name: "Updated" });
      pending.resolve(updated);

      await expect(result).resolves.toEqual({ committed: false, reason: "stale" });
      expect(harness.store.snapshot().sends).not.toContainEqual(updated);
    },
  );

  it("rejects File Send update before transport", async () => {
    const actions = actionPort();
    const harness = createHarness(actions);
    const file = send({ type: "file" });
    harness.store.setSends([file]);

    await expect(harness.operation.update(file, draft())).resolves.toEqual({ committed: false, reason: "failure" });
    expect(actions.updateTextSend).not.toHaveBeenCalled();
    expect(harness.store.snapshot().statusMessage).toBe("无法保存 Send，请重试。");
  });

  it("reconciles remove-password without deleting the Send", async () => {
    const refreshed = send({
      name: "Server exact",
      revisionDate: "2026-07-19T12:03:04.567Z",
      accessCount: 7,
      hasPassword: false,
    });
    const actions = actionPort({
      refreshTextSend: vi.fn(async () => refreshed),
    } as Partial<SendActionPort>);
    const harness = createHarness(actions);
    const source = send({ hasPassword: true });
    harness.store.setSends([source]);

    await expect(harness.operation.removePassword(source)).resolves.toEqual({ committed: true, send: refreshed });
    expect(harness.store.snapshot().sends[0]).toBe(refreshed);
    expect(actions.removePassword).toHaveBeenCalledWith(expect.anything(), source);
  });

  it("does not refresh or commit password removal after ownership changes", async () => {
    const endpoint = deferred<void>();
    const actions = actionPort({ removePassword: vi.fn(() => endpoint.promise) });
    const harness = createHarness(actions);
    const source = send({ hasPassword: true });
    harness.store.setSends([source]);

    const result = harness.operation.removePassword(source);
    harness.store.setSends([send({ name: "Newer sync", hasPassword: true })]);
    endpoint.resolve(undefined);

    await expect(result).resolves.toEqual({ committed: false, reason: "stale" });
    expect(actions.refreshTextSend).not.toHaveBeenCalled();
    expect(harness.store.snapshot().sends[0]?.name).toBe("Newer sync");
  });

  it("rejects a changed past deletion date while preserving the source timestamp exactly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    try {
      const actions = actionPort();
      const harness = createHarness(actions);
      const source = send({ deletionDate: "2026-07-18T12:00:00.000Z" });
      harness.store.setSends([source]);

      await expect(harness.operation.update(source, {
        ...draft(),
        deletionDate: source.deletionDate,
      })).resolves.toMatchObject({ committed: true });
      await expect(harness.operation.update(harness.store.snapshot().sends[0]!, {
        ...draft(),
        deletionDate: "2026-07-18T13:00:00.000Z",
      })).resolves.toEqual({ committed: false, reason: "failure" });
      expect(actions.updateTextSend).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createHarness(actions: SendActionPort) {
  const store = new PopupStateStore();
  const activeSession = session("active");
  store.setActiveSession(activeSession);
  store.setUnlocked("user@example.test");
  const navigation = { url: "/send/edit/send", currentUrl() { return this.url; } };
  return {
    store,
    navigation,
    operation: new TextSendOperation({ store, actions, navigation }),
  };
}

function actionPort(overrides: Partial<SendActionPort> = {}): SendActionPort {
  return {
    createTextSend: vi.fn(async () => send({ id: "created" })),
    updateTextSend: vi.fn(async () => send({ name: "Updated" })),
    deleteSend: vi.fn(async () => undefined),
    removePassword: vi.fn(async () => undefined),
    refreshTextSend: vi.fn(async (_session, sendId) => send({ id: sendId, hasPassword: false })),
    ...overrides,
  };
}

function session(accessToken: string): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: { accessToken, refreshToken: "refresh", tokenType: "Bearer", expiresIn: 3600 },
    crypto: { userKeyB64: "key" },
  };
}

function draft(): TextSendDraft {
  return {
    name: "Secret",
    text: "value",
    notes: "",
    deletionDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    hidden: false,
    hideEmail: false,
  };
}

function send(overrides: Partial<SendItem> = {}): SendItem {
  return {
    id: "send", accessId: "access", urlB64Key: "key", type: "text", name: "Original", text: "value", notes: "",
    revisionDate: "2026-07-01T00:00:00.000Z", deletionDate: "2026-08-01T00:00:00.000Z", disabled: false, accessCount: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
