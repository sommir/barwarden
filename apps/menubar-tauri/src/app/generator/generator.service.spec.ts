import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountSessionPort } from "../../auth/account-session-port";
import type { HostApi } from "../../host/host-api";
import { GeneratorHistoryStore } from "./generator-history.store";
import { GeneratorService, type GeneratorSettingsSnapshot } from "./generator.service";
import type { OfficialGeneratorEngine } from "./official-generator-engine";

describe("GeneratorService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("generates with official settings for the active account and tracks it securely", async () => {
    const history = historyStore();
    const engine = officialEngine();
    const service = new GeneratorService(history, engine, activeAccount("account-a"));

    await expect(service.generate("password")).resolves.toEqual({
      credential: "official-password",
      category: "password",
      generationDate: expect.any(Date),
      algorithm: "password",
    });
    expect(engine.generatePassword).toHaveBeenCalledWith({
      length: 14,
      ambiguous: true,
      uppercase: true,
      minUppercase: 1,
      lowercase: true,
      minLowercase: 1,
      number: true,
      minNumber: 1,
      special: false,
      minSpecial: 0,
    });
    expect(history.prepareTrack).toHaveBeenCalledWith(
      "account-a",
      expect.objectContaining({ credential: "official-password", algorithm: "password" }),
      expect.any(Function),
    );
  });

  it("loads settings for the active account for route initialization", async () => {
    const service = new GeneratorService(historyStore(), officialEngine(), activeAccount("account-b"));
    service.updatePasswordSettings("account-b", { length: 24 });

    await expect(service.activeSettings()).resolves.toMatchObject({
      accountId: "account-b",
      settings: { password: { length: 24 } },
    });
  });

  it.each([
    ["word", { type: "word" }],
    ["subaddress", { type: "subaddress", subaddressEmail: "owner@example.test" }],
    ["catchall", { type: "catchall", catchallDomain: "example.test" }],
  ] as const)("passes retained %s username settings to the official engine", async (_name, patch) => {
    const engine = officialEngine();
    const service = new GeneratorService(historyStore(), engine, activeAccount("account-a"));
    service.updateUsernameSettings("account-a", patch);

    await service.generate("username");

    expect(engine.generateUsername).toHaveBeenCalledWith(expect.objectContaining(patch));
  });

  it("reads and clears secure history for the active account", async () => {
    const history = historyStore();
    const credential = {
      credential: "secret-history-value",
      category: "password" as const,
      generationDate: new Date("2026-07-11T00:00:00.000Z"),
      algorithm: "password" as const,
    };
    vi.mocked(history.credentials).mockResolvedValue([credential]);
    const service = new GeneratorService(history, officialEngine(), activeAccount("account-a"));

    await expect(service.history()).resolves.toEqual([credential]);
    await service.clearHistory();

    expect(history.credentials).toHaveBeenCalledWith("account-a");
    expect(history.prepareClear).toHaveBeenCalledWith("account-a", expect.any(Function));
  });

  it("fails safely before generating when no active account is available", async () => {
    const engine = officialEngine();
    const service = new GeneratorService(historyStore(), engine, activeAccount(null));

    await expect(service.generate("password")).rejects.toThrow("No active account is available");
    expect(engine.generatePassword).not.toHaveBeenCalled();
  });

  it("fails safely before generating when the active account is locked", async () => {
    const engine = officialEngine();
    const service = new GeneratorService(historyStore(), engine, activeAccount("account-a", "locked"));

    await expect(service.generate("password")).rejects.toThrow("Active account is locked");
    expect(engine.generatePassword).not.toHaveBeenCalled();
  });

  it("rejects a generated credential when the active account changes before completion", async () => {
    const generated = deferred<string>();
    const history = historyStore();
    const engine = officialEngine();
    vi.mocked(engine.generatePassword).mockReturnValue(generated.promise);
    const accounts = changingActiveAccount("account-a");
    const service = new GeneratorService(history, engine, accounts.port);

    const generation = service.generate("password");
    await Promise.resolve();
    accounts.set("account-b");
    generated.resolve("stale-account-credential");

    await expect(generation).rejects.toThrow("Generator account changed or locked during generation");
    expect(history.prepareTrack).not.toHaveBeenCalled();
    expect(localStorage.getItem("barwarden.generator-settings.account-a") ?? "")
      .not.toContain("stale-account-credential");
  });

  it("rejects a generated credential when the caller route is no longer current", async () => {
    const generated = deferred<string>();
    const history = historyStore();
    const engine = officialEngine();
    vi.mocked(engine.generatePassword).mockReturnValue(generated.promise);
    const service = new GeneratorService(history, engine, activeAccount("account-a"));
    let current = true;

    const generation = service.generate("password", async () => current);
    await vi.waitFor(() => expect(engine.generatePassword).toHaveBeenCalledOnce());
    current = false;
    generated.resolve("stale-route-credential");

    await expect(generation).rejects.toThrow("Generator operation is no longer current");
    expect(history.prepareTrack).not.toHaveBeenCalled();
  });

  it("leaves caller completion receipt ownership outside the shared generator runtime", async () => {
    const generated = deferred<string>();
    const tracked = deferred<{ commit(): void; rollback(): Promise<void> }>();
    const history = historyStore();
    const engine = officialEngine();
    vi.mocked(engine.generatePassword).mockReturnValue(generated.promise);
    vi.mocked(history.prepareTrack).mockReturnValue(tracked.promise);
    const complete = vi.fn();
    const receipt = { begin: vi.fn(() => complete) };
    const Service = GeneratorService as unknown as new (
      history: GeneratorHistoryStore,
      engine: OfficialGeneratorEngine,
      accounts: AccountSessionPort,
      receipt: typeof receipt,
    ) => GeneratorService;
    const service = new Service(history, engine, activeAccount("account-a"), receipt);

    const operation = service.generate("password");
    await vi.waitFor(() => expect(engine.generatePassword).toHaveBeenCalledOnce());
    generated.resolve("receipt-value");
    await vi.waitFor(() => expect(history.prepareTrack).toHaveBeenCalledOnce());

    expect(receipt.begin).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();

    tracked.resolve({ commit: vi.fn(), rollback: vi.fn(async () => undefined) });
    await operation;

    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    ["switches", (accounts: ReturnType<typeof mutableAccountState>) => accounts.set("account-b", "unlocked")],
    ["locks", (accounts: ReturnType<typeof mutableAccountState>) => accounts.set("account-a", "locked")],
    ["has no active account", (accounts: ReturnType<typeof mutableAccountState>) => accounts.set(null)],
  ] as const)("rejects before history tracking when ownership %s", async (_name, mutate) => {
    const generated = deferred<string>();
    const history = historyStore();
    const engine = officialEngine();
    vi.mocked(engine.generatePassword).mockReturnValue(generated.promise);
    const accounts = mutableAccountState("account-a");
    const service = new GeneratorService(history, engine, accounts.port);

    const generation = service.generate("password");
    await vi.waitFor(() => expect(engine.generatePassword).toHaveBeenCalledOnce());
    mutate(accounts);
    generated.resolve("pre-track-stale-credential");

    await expect(generation).rejects.toThrow("Generator account changed or locked during generation");
    expect(history.prepareTrack).not.toHaveBeenCalled();
  });

  it.each([
    ["switches", (accounts: ReturnType<typeof mutableAccountState>) => accounts.set("account-b", "unlocked")],
    ["locks", (accounts: ReturnType<typeof mutableAccountState>) => accounts.set("account-a", "locked")],
    ["has no active account", (accounts: ReturnType<typeof mutableAccountState>) => accounts.set(null)],
  ] as const)("rejects after history tracking when ownership %s", async (_name, mutate) => {
    const tracked = deferred<{ commit(): void; rollback(): Promise<void> }>();
    const history = historyStore();
    vi.mocked(history.prepareTrack).mockReturnValue(tracked.promise);
    const accounts = mutableAccountState("account-a");
    const service = new GeneratorService(history, officialEngine(), accounts.port);

    const generation = service.generate("password");
    await vi.waitFor(() => expect(history.prepareTrack).toHaveBeenCalledOnce());
    mutate(accounts);
    tracked.resolve({ commit: vi.fn(), rollback: vi.fn(async () => undefined) });

    await expect(generation).rejects.toThrow("Generator account changed or locked during generation");
  });

  it("rolls prepared history back when the caller operation becomes stale before commit", async () => {
    const tracked = deferred<{ commit(): void; rollback(): Promise<void> }>();
    const commit = vi.fn();
    const rollback = vi.fn(async () => undefined);
    const history = historyStore();
    vi.mocked(history.prepareTrack).mockReturnValue(tracked.promise);
    const service = new GeneratorService(history, officialEngine(), activeAccount("account-a"));
    let current = true;

    const generation = service.generate("password", () => current);
    await vi.waitFor(() => expect(history.prepareTrack).toHaveBeenCalledOnce());
    current = false;
    tracked.resolve({ commit, rollback });

    await expect(generation).rejects.toThrow("Generator operation is no longer current");
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
  });

  it.each([
    ["switches", "account-b", "unlocked"],
    ["locks", "account-a", "locked"],
    ["has no active account", null, "unlocked"],
  ] as const)("rolls real history back when final ownership %s", async (_name, nextId, nextStatus) => {
    const history = new GeneratorHistoryStore(new ServiceMemoryHost());
    await history.track("account-a", {
      credential: "existing",
      category: "password",
      generationDate: new Date(1),
      algorithm: "password",
    });
    const service = new GeneratorService(
      history,
      officialEngine(),
      ownershipChangesOnCheck(5, nextId, nextStatus),
    );

    await expect(service.generate("password")).rejects.toThrow(
      "Generator account changed or locked during generation",
    );
    await expect(history.credentials("account-a")).resolves.toMatchObject([
      { credential: "existing" },
    ]);
  });

  it("keeps official option defaults and persists sanitized settings per account", () => {
    const service = new GeneratorService();

    expect(service.settings("account-a")).toEqual(defaultSettings());
    expect(
      service.updatePasswordSettings("account-a", { length: 1, minNumber: 99, minSpecial: -1 }),
    ).toMatchObject({
      password: { length: 11, minNumber: 9, minSpecial: 0 },
    });
    expect(
      service.updatePassphraseSettings("account-a", { numWords: 99, wordSeparator: "long" }),
    ).toMatchObject({
      passphrase: { numWords: 20, wordSeparator: "l" },
    });
    expect(service.updateUsernameSettings("account-b", { wordCapitalize: true })).toMatchObject({
      username: {
        type: "word",
        wordCapitalize: true,
        wordIncludeNumber: false,
        subaddressEmail: "",
        catchallDomain: "",
      },
    });
    expect(service.settings("account-b")).toEqual({
      ...defaultSettings(),
      username: {
        type: "word",
        wordCapitalize: true,
        wordIncludeNumber: false,
        subaddressEmail: "",
        catchallDomain: "",
      },
    });
    expect(service.settings("account-a")).toMatchObject({
      password: { length: 11, minNumber: 9, minSpecial: 0 },
      passphrase: { numWords: 20, wordSeparator: "l" },
    });
    expect(localStorage.getItem("barwarden.generator-settings.account-a")).not.toContain(
      "official-password",
    );
  });

  it("normalizes password updates into an SDK-valid configuration", () => {
    const service = new GeneratorService();

    expect(
      service.updatePasswordSettings("account-a", {
        length: 1,
        uppercase: true,
        minUppercase: 99,
        lowercase: true,
        minLowercase: 99,
        number: true,
        minNumber: 99,
        special: true,
        minSpecial: 99,
      }),
    ).toMatchObject({
      password: {
        length: 36,
        uppercase: true,
        minUppercase: 9,
        lowercase: true,
        minLowercase: 9,
        number: true,
        minNumber: 9,
        special: true,
        minSpecial: 9,
      },
    });

    expect(
      service.updatePasswordSettings("account-a", {
        length: 1,
        uppercase: false,
        minUppercase: 9,
        lowercase: false,
        minLowercase: 9,
        number: false,
        minNumber: 9,
        special: false,
        minSpecial: 9,
      }),
    ).toMatchObject({
      password: {
        length: 5,
        uppercase: true,
        minUppercase: 1,
        lowercase: true,
        minLowercase: 1,
        number: false,
        minNumber: 0,
        special: false,
        minSpecial: 0,
      },
    });
  });

  it("normalizes malformed restored password settings into an SDK-valid configuration", () => {
    localStorage.setItem(
      "barwarden.generator-settings.account-a",
      JSON.stringify({
        password: {
          length: 1,
          minLength: 128,
          uppercase: false,
          minUppercase: 99,
          lowercase: false,
          minLowercase: 99,
          number: true,
          minNumber: 0,
          special: true,
          minSpecial: 99,
        },
      }),
    );

    const password = new GeneratorService().settings("account-a").password;

    expect(password).toEqual({
      length: 10,
      ambiguous: true,
      uppercase: false,
      minUppercase: 0,
      lowercase: false,
      minLowercase: 0,
      number: true,
      minNumber: 1,
      special: true,
      minSpecial: 9,
    });
    expect(password).not.toHaveProperty("minLength");
  });
});

function activeAccount(
  id: string | null,
  status: "unlocked" | "locked" = "unlocked",
): AccountSessionPort {
  return {
    list: async () => (id ? [{
      id,
      email: `${id}@example.test`,
      serverUrl: "https://vault.example.test",
      status,
      isActive: true,
    }] : []),
    saveAccount: vi.fn(),
    setActive: vi.fn(),
    setStatus: vi.fn(),
    readSession: vi.fn(),
    remove: vi.fn(),
    lockAll: vi.fn(),
  } as unknown as AccountSessionPort;
}

function changingActiveAccount(initialId: string) {
  let id = initialId;
  return {
    port: {
      ...activeAccount(null),
      list: vi.fn(async () => [{
        id,
        email: `${id}@example.test`,
        serverUrl: "https://vault.example.test",
        status: "unlocked" as const,
        isActive: true,
      }]),
    } as unknown as AccountSessionPort,
    set(nextId: string) { id = nextId; },
  };
}

function mutableAccountState(initialId: string) {
  let id: string | null = initialId;
  let status: "unlocked" | "locked" = "unlocked";
  return {
    port: {
      ...activeAccount(null),
      list: vi.fn(async () => id ? [{
        id,
        email: `${id}@example.test`,
        serverUrl: "https://vault.example.test",
        status,
        isActive: true,
      }] : []),
    } as unknown as AccountSessionPort,
    set(nextId: string | null, nextStatus: "unlocked" | "locked" = "unlocked") {
      id = nextId;
      status = nextStatus;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function officialEngine(): OfficialGeneratorEngine {
  return {
    generatePassword: vi.fn(async () => "official-password"),
    generatePassphrase: vi.fn(async () => "official-passphrase"),
    generateUsername: vi.fn(async () => "official-username"),
  } as unknown as OfficialGeneratorEngine;
}

function historyStore(): GeneratorHistoryStore {
  const pending = { commit: vi.fn(), rollback: vi.fn(async () => undefined) };
  return {
    credentials: vi.fn(async () => []),
    prepareTrack: vi.fn(async () => pending),
    prepareClear: vi.fn(async () => pending),
    track: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  } as unknown as GeneratorHistoryStore;
}

function ownershipChangesOnCheck(
  changeAtCall: number,
  nextId: string | null,
  nextStatus: "unlocked" | "locked",
): AccountSessionPort {
  let calls = 0;
  return {
    ...activeAccount(null),
    list: vi.fn(async () => {
      calls += 1;
      const changed = calls >= changeAtCall;
      const id = changed ? nextId : "account-a";
      const status = changed ? nextStatus : "unlocked";
      return id ? [{
        id,
        email: `${id}@example.test`,
        serverUrl: "https://vault.example.test",
        status,
        isActive: true,
      }] : [];
    }),
  } as unknown as AccountSessionPort;
}

class ServiceMemoryHost implements HostApi {
  private readonly values = new Map<string, string>();
  showPopup = async () => undefined;
  hidePopup = async () => undefined;
  copyText = async () => undefined;
  pasteText = async () => undefined;
  openUrl = async () => undefined;
  secureGet = async (key: string) => this.values.get(key) ?? null;
  secureSet = async (key: string, value: string) => { this.values.set(key, value); };
  secureDelete = async (key: string) => { this.values.delete(key); };
}

function defaultSettings(): GeneratorSettingsSnapshot {
  return {
    password: {
      length: 14,
      ambiguous: true,
      uppercase: true,
      minUppercase: 1,
      lowercase: true,
      minLowercase: 1,
      number: true,
      minNumber: 1,
      special: false,
      minSpecial: 0,
    },
    passphrase: { numWords: 6, wordSeparator: "-", capitalize: false, includeNumber: false },
    username: {
      type: "word",
      wordCapitalize: false,
      wordIncludeNumber: false,
      subaddressEmail: "",
      catchallDomain: "",
    },
  };
}
