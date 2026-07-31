import { firstValueFrom, skip, take } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import type {
  ProcessSessionAttachment,
  ProcessSessionBrokerHost,
  ProcessSessionMutation,
  ProcessSessionSnapshot,
} from "../../host/host-api";
import {
  ProcessSessionBrokerService,
  type ProcessSessionEventSource,
} from "./process-session-broker.service";

describe("ProcessSessionBrokerService", () => {
  it("attaches once, subscribes before reconciling, and keeps the newest process snapshot", async () => {
    const initial = snapshot({ version: 2, authorization: "locked" });
    const reconciled = snapshot({
      version: 3,
      authorization: "unlocked",
      activeAccountId: "account-1",
    });
    const host = new FakeProcessSessionHost(
      { startupMode: "attach", snapshot: initial },
      reconciled,
    );
    const events = new FakeProcessSessionEvents();
    const broker = new ProcessSessionBrokerService(host, events);

    await expect(broker.attach()).resolves.toEqual({
      startupMode: "attach",
      snapshot: reconciled,
    });
    await expect(broker.attach()).resolves.toEqual({
      startupMode: "attach",
      snapshot: reconciled,
    });

    expect(events.listenCount).toBe(1);
    expect(host.attachCount).toBe(1);
    expect(host.snapshotCount).toBe(1);
  });

  it("coalesces broker events through a fresh snapshot read and emits each newer version once", async () => {
    const host = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: snapshot({ version: 0 }) },
      snapshot({ version: 0 }),
    );
    const events = new FakeProcessSessionEvents();
    const broker = new ProcessSessionBrokerService(host, events);
    await broker.attach();
    const next = firstValueFrom(broker.changes$.pipe(skip(1), take(1)));

    host.current = snapshot({
      version: 4,
      authorization: "unlocked",
      activeAccountId: "account-1",
      syncState: "fresh",
    });
    events.emit();
    events.emit();

    await expect(next).resolves.toMatchObject({
      version: 4,
      authorization: "unlocked",
      activeAccountId: "account-1",
      syncState: "fresh",
    });
    expect(host.snapshotCount).toBe(2);
  });

  it("retries a transient event snapshot failure and converges without a second event", async () => {
    const host = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: snapshot({ version: 0 }) },
      snapshot({ version: 0 }),
    );
    const events = new FakeProcessSessionEvents();
    const broker = new ProcessSessionBrokerService(host, events);
    await broker.attach();
    const next = firstValueFrom(broker.changes$.pipe(skip(1), take(1)));
    host.current = snapshot({ version: 2, authorization: "unlocked" });
    host.snapshotFailuresRemaining = 1;

    events.emit();

    await expect(next).resolves.toMatchObject({ version: 2, authorization: "unlocked" });
    expect(host.snapshotCount).toBe(3);
    broker.destroy();
  });

  it("forwards only typed mutations to the host and exposes the committed snapshot", async () => {
    const host = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: snapshot({ version: 0 }) },
      snapshot({ version: 0 }),
    );
    const broker = new ProcessSessionBrokerService(host, new FakeProcessSessionEvents());
    await broker.attach();
    const mutation: ProcessSessionMutation = {
      type: "unlocked",
      activeAccountId: "account-1",
      sharedSnapshot: { isUnlocked: true, email: "person@example.com" },
    };
    host.current = snapshot({
      version: 1,
      authorization: "unlocked",
      activeAccountId: "account-1",
    });

    await expect(broker.mutate(mutation)).resolves.toEqual(host.current);
    expect(host.mutations).toEqual([mutation]);
  });

  it("serializes lifecycle mutations so a later logout cannot be overtaken by an earlier lock", async () => {
    const initial = snapshot({
      version: 0,
      authorization: "unlocked",
      activeAccountId: "account-1",
    });
    const firstMutation = deferred<void>();
    let current = initial;
    let inFlight = 0;
    let maximumInFlight = 0;
    const mutations: ProcessSessionMutation[] = [];
    const host: ProcessSessionBrokerHost = {
      attachProcessSession: async () => ({ startupMode: "cold", snapshot: initial }),
      processSessionSnapshot: async () => current,
      mutateProcessSession: async (mutation) => {
        mutations.push(mutation);
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        if (mutation.type === "locked") {
          await firstMutation.promise;
        }
        current = snapshot({
          version: current.version + 1,
          authorization: mutation.type === "logged-out" ? "signed-out" : "locked",
          activeAccountId: mutation.type === "logged-out" ? null : "account-1",
        });
        inFlight -= 1;
        return current;
      },
    };
    const broker = new ProcessSessionBrokerService(
      host,
      new FakeProcessSessionEvents(),
    );
    await broker.attach();

    const locked = broker.mutate({ type: "locked" });
    await vi.waitFor(() => expect(mutations).toEqual([{ type: "locked" }]));
    const loggedOut = broker.mutate({ type: "logged-out" });
    await Promise.resolve();

    expect(mutations).toEqual([{ type: "locked" }]);
    firstMutation.resolve();
    await Promise.all([locked, loggedOut]);

    expect(maximumInFlight).toBe(1);
    expect(mutations).toEqual([{ type: "locked" }, { type: "logged-out" }]);
    expect(current).toMatchObject({
      authorization: "signed-out",
      activeAccountId: null,
    });
  });

  it("never echoes a local mutation even when its native event arrives before invoke resolves", async () => {
    const host = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: snapshot({ version: 0 }) },
      snapshot({ version: 0 }),
    );
    const events = new FakeProcessSessionEvents();
    const broker = new ProcessSessionBrokerService(host, events);
    const observed: ProcessSessionSnapshot[] = [];
    await broker.attach();
    broker.changes$.subscribe((value) => observed.push(value));
    const mutationGate = deferred<void>();
    host.mutationGate = mutationGate.promise;
    host.current = snapshot({
      version: 1,
      authorization: "unlocked",
      activeAccountId: "account-1",
      syncState: "syncing",
    });

    const mutation = broker.mutate({ type: "sync-started" });
    await Promise.resolve();
    events.emit();
    await Promise.resolve();

    expect(observed).toHaveLength(1);
    mutationGate.resolve();
    await mutation;
    await vi.waitFor(() => expect(host.snapshotCount).toBe(2));
    expect(observed).toHaveLength(1);

    host.current = snapshot({
      version: 2,
      authorization: "unlocked",
      activeAccountId: "account-1",
      syncState: "fresh",
    });
    events.emit();

    await vi.waitFor(() => expect(observed).toHaveLength(2));
    expect(observed[1]).toMatchObject({ version: 2, syncState: "fresh" });
  });

  it("forwards the ephemeral sibling-window session handoff without publishing it as a snapshot", async () => {
    const host = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: snapshot({ version: 0 }) },
      snapshot({ version: 0 }),
    );
    const broker = new ProcessSessionBrokerService(host, new FakeProcessSessionEvents());
    const handoff = { accessToken: "process-only-token" };

    await broker.setSessionHandoff(handoff);

    await expect(broker.sessionHandoff()).resolves.toEqual(handoff);
    expect(host.handoff).toEqual(handoff);
    expect(host.current.sharedSnapshot).toBeNull();
  });

  it("clears a failed attach attempt so retry succeeds and installs live reconciliation", async () => {
    const initial = snapshot({ version: 0 });
    let attachAttempts = 0;
    const baseHost = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: initial },
      initial,
    );
    const host: ProcessSessionBrokerHost = {
      ...baseHost,
      attachProcessSession: async () => {
        attachAttempts += 1;
        if (attachAttempts === 1) {
          throw new Error("private native failure");
        }
        return { startupMode: "cold", snapshot: initial };
      },
      processSessionSnapshot: () => baseHost.processSessionSnapshot(),
      mutateProcessSession: (mutation) => baseHost.mutateProcessSession(mutation),
    };
    const events = new FakeProcessSessionEvents();
    const broker = new ProcessSessionBrokerService(host, events);

    await expect(broker.attach()).rejects.toMatchObject({
      name: "ProcessSessionBrokerError",
      code: "unavailable",
      message: "Process session unavailable.",
    });
    await expect(broker.attach()).resolves.toEqual({
      startupMode: "cold",
      snapshot: initial,
    });

    expect(attachAttempts).toBe(2);
    expect(events.listenCount).toBe(1);
  });

  it("fails closed when listener installation fails, then retries and receives remote versions", async () => {
    const host = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: snapshot({ version: 0 }) },
      snapshot({ version: 0 }),
    );
    const events = new FailsOnceProcessSessionEvents();
    const broker = new ProcessSessionBrokerService(host, events);

    await expect(broker.attach()).rejects.toMatchObject({
      name: "ProcessSessionBrokerError",
      code: "unavailable",
    });
    await expect(broker.attach()).resolves.toEqual({
      startupMode: "cold",
      snapshot: snapshot({ version: 0 }),
    });
    const remote = firstValueFrom(broker.changes$.pipe(skip(1), take(1)));
    host.current = snapshot({
      version: 1,
      authorization: "unlocked",
      activeAccountId: "account-1",
    });
    events.emit();

    await expect(remote).resolves.toMatchObject({
      version: 1,
      authorization: "unlocked",
    });
    expect(events.listenCount).toBe(2);
  });

  it("stops native event delivery on destruction", async () => {
    const host = new FakeProcessSessionHost(
      { startupMode: "cold", snapshot: snapshot({ version: 0 }) },
      snapshot({ version: 0 }),
    );
    const events = new FakeProcessSessionEvents();
    const broker = new ProcessSessionBrokerService(host, events);
    await broker.attach();

    broker.destroy();

    expect(events.unlistenCount).toBe(1);
  });
});

class FakeProcessSessionHost implements ProcessSessionBrokerHost {
  attachCount = 0;
  snapshotCount = 0;
  mutations: ProcessSessionMutation[] = [];
  handoff: unknown | null = null;
  snapshotFailuresRemaining = 0;
  mutationGate: Promise<void> | null = null;

  constructor(
    private readonly attachment: ProcessSessionAttachment,
    public current: ProcessSessionSnapshot,
  ) {}

  async attachProcessSession(): Promise<ProcessSessionAttachment> {
    this.attachCount += 1;
    return this.attachment;
  }

  async processSessionSnapshot(): Promise<ProcessSessionSnapshot> {
    this.snapshotCount += 1;
    if (this.snapshotFailuresRemaining > 0) {
      this.snapshotFailuresRemaining -= 1;
      throw new Error("transient snapshot failure");
    }
    return this.current;
  }

  async mutateProcessSession(
    mutation: ProcessSessionMutation,
  ): Promise<ProcessSessionSnapshot> {
    this.mutations.push(mutation);
    await this.mutationGate;
    return this.current;
  }

  async setProcessSessionHandoff(session: unknown): Promise<void> {
    this.handoff = session;
  }

  async processSessionHandoff(): Promise<unknown | null> {
    return this.handoff;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeProcessSessionEvents implements ProcessSessionEventSource {
  listenCount = 0;
  unlistenCount = 0;
  private listener: (() => void) | null = null;

  async listen(listener: () => void): Promise<() => void> {
    this.listenCount += 1;
    this.listener = listener;
    return () => {
      this.unlistenCount += 1;
      this.listener = null;
    };
  }

  emit(): void {
    this.listener?.();
  }
}

class FailsOnceProcessSessionEvents implements ProcessSessionEventSource {
  listenCount = 0;
  private listener: (() => void) | null = null;

  async listen(listener: () => void): Promise<() => void> {
    this.listenCount += 1;
    if (this.listenCount === 1) {
      throw new Error("event subscription unavailable");
    }
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(): void {
    this.listener?.();
  }
}

function snapshot(
  overrides: Partial<ProcessSessionSnapshot>,
): ProcessSessionSnapshot {
  return {
    processGeneration: "process-generation",
    version: 0,
    syncVersion: 0,
    authorization: "signed-out",
    activeAccountId: null,
    syncState: "idle",
    failureCode: null,
    sharedSnapshot: null,
    originWindowLabel: null,
    ...overrides,
  };
}
