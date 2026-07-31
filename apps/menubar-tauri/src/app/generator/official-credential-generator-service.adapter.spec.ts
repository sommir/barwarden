import { firstValueFrom, of, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import type { Account } from "@bitwarden/common/auth/abstractions/account.service";
import {
  Algorithm,
  BuiltIn,
  type AlgorithmMetadata,
  type PasswordGenerationOptions,
} from "@bitwarden/generator-core";

import type {
  GeneratorOperationReceiptPort,
  GeneratorRuntimePort,
  GeneratorSettingsSnapshot,
} from "./generator-runtime.port";
import { OfficialCredentialGeneratorServiceAdapter } from "./official-credential-generator-service.adapter";

describe("OfficialCredentialGeneratorServiceAdapter", () => {
  it("keeps the operation receipt pending through official subscriber publication", async () => {
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-a", settings: settings(14) });
    runtime.generate.mockResolvedValue(generated("official-value"));
    const publication: string[] = [];
    const completeReceipt = vi.fn(() => publication.push("receipt complete"));
    const receipt: GeneratorOperationReceiptPort = {
      begin: vi.fn(() => completeReceipt),
    };
    const Adapter = OfficialCredentialGeneratorServiceAdapter as unknown as new (
      runtime: GeneratorRuntimePort,
      initialAlgorithm: null,
      ownership: null,
      receipt: GeneratorOperationReceiptPort,
    ) => OfficialCredentialGeneratorServiceAdapter;
    const adapter = new Adapter(runtime, null, null, receipt);
    let receiptPendingAtNext = false;
    let receiptPendingAtComplete = false;

    await new Promise<void>((resolve, reject) => {
      adapter.generate$({
        on$: of({ algorithm: Algorithm.password, source: "user request" }),
        account$: of({ id: "account-a" } as Account),
      }).subscribe({
        next: () => {
          publication.push("subscriber next");
          receiptPendingAtNext = runtime.activeSettings.mock.calls.length === 2
            && vi.mocked(receipt.begin).mock.calls.length === 1
            && completeReceipt.mock.calls.length === 0;
        },
        error: reject,
        complete: () => {
          publication.push("subscriber complete");
          receiptPendingAtComplete = completeReceipt.mock.calls.length === 0;
          resolve();
        },
      });
    });
    await vi.waitFor(() => expect(completeReceipt).toHaveBeenCalledOnce());

    expect(receiptPendingAtNext).toBe(true);
    expect(receiptPendingAtComplete).toBe(true);
    expect(publication).toEqual([
      "subscriber next",
      "subscriber complete",
      "receipt complete",
    ]);
  });

  it("rejects a request before generation when its captured account is no longer active", async () => {
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-b", settings: settings(14) });
    runtime.generate.mockResolvedValue(generated("account-b-value"));
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);

    await expect(firstValueFrom(adapter.generate$({
      on$: of({ algorithm: Algorithm.plusAddress, source: "user request" }),
      account$: of({ id: "account-a" } as Account),
    }))).rejects.toThrow("Generator account changed during generation");

    expect(runtime.updateUsernameSettings).not.toHaveBeenCalled();
    expect(runtime.generate).not.toHaveBeenCalled();
  });

  it("rejects a generated result when account ownership changes before publication", async () => {
    const runtime = runtimePort();
    runtime.activeSettings
      .mockResolvedValueOnce({ accountId: "account-a", settings: settings(14) })
      .mockResolvedValueOnce({ accountId: "account-b", settings: settings(14) });
    runtime.generate.mockResolvedValue(generated("account-b-value"));
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);

    await expect(firstValueFrom(adapter.generate$({
      on$: of({ algorithm: Algorithm.password, source: "user request" }),
      account$: of({ id: "account-a" } as Account),
    }))).rejects.toThrow("Generator account changed during generation");

    expect(runtime.generate).toHaveBeenCalledWith("password", expect.any(Function));
  });

  it("invalidates the runtime owner when a newer request replaces the same-account request", async () => {
    const requests = new Subject<{ algorithm: typeof Algorithm.password; source: string }>();
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-a", settings: settings(14) });
    const first = deferred<ReturnType<typeof generated>>();
    const second = deferred<ReturnType<typeof generated>>();
    runtime.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const observed: string[] = [];
    const subscription = adapter.generate$({
      on$: requests,
      account$: of({ id: "account-a" } as Account),
    }).subscribe((value) => observed.push(value.credential));

    requests.next({ algorithm: Algorithm.password, source: "user request" });
    await vi.waitFor(() => expect(runtime.generate).toHaveBeenCalledTimes(1));
    const firstOwner = runtime.generate.mock.calls[0]![1]!;
    expect(await firstOwner()).toBe(true);

    requests.next({ algorithm: Algorithm.password, source: "user request" });
    await vi.waitFor(() => expect(runtime.generate).toHaveBeenCalledTimes(2));
    const secondOwner = runtime.generate.mock.calls[1]![1]!;
    expect(await firstOwner()).toBe(false);
    expect(await secondOwner()).toBe(true);

    second.resolve(generated("latest-value"));
    await vi.waitFor(() => expect(observed).toEqual(["latest-value"]));
    first.resolve(generated("stale-value"));
    await Promise.resolve();
    expect(observed).toEqual(["latest-value"]);
    subscription.unsubscribe();
  });

  it("invalidates the runtime owner when the generator route subscription is destroyed", async () => {
    const requests = new Subject<{ algorithm: typeof Algorithm.password; source: string }>();
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-a", settings: settings(14) });
    const pending = deferred<ReturnType<typeof generated>>();
    runtime.generate.mockReturnValue(pending.promise);
    let pendingReceipts = 0;
    const completeReceipt = vi.fn(() => {
      pendingReceipts -= 1;
    });
    const receipt: GeneratorOperationReceiptPort = {
      begin: vi.fn(() => {
        pendingReceipts += 1;
        return completeReceipt;
      }),
    };
    const Adapter = OfficialCredentialGeneratorServiceAdapter as unknown as new (
      runtime: GeneratorRuntimePort,
      initialAlgorithm: null,
      ownership: null,
      receipt: GeneratorOperationReceiptPort,
    ) => OfficialCredentialGeneratorServiceAdapter;
    const adapter = new Adapter(runtime, null, null, receipt);
    const observed: string[] = [];
    const subscription = adapter.generate$({
      on$: requests,
      account$: of({ id: "account-a" } as Account),
    }).subscribe((value) => observed.push(value.credential));

    requests.next({ algorithm: Algorithm.password, source: "user request" });
    await vi.waitFor(() => expect(runtime.generate).toHaveBeenCalledOnce());
    const owner = runtime.generate.mock.calls[0]![1]!;
    expect(await owner()).toBe(true);
    expect(pendingReceipts).toBe(1);

    subscription.unsubscribe();

    expect(await owner()).toBe(false);
    expect(pendingReceipts).toBe(0);
    expect(completeReceipt).toHaveBeenCalledOnce();

    pending.resolve(generated("late-value"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(observed).toEqual([]);
    expect(pendingReceipts).toBe(0);
    expect(completeReceipt).toHaveBeenCalledOnce();
  });

  it("invalidates the runtime owner when the same account receives a replacement session", async () => {
    const requests = new Subject<{ algorithm: typeof Algorithm.password; source: string }>();
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-a", settings: settings(14) });
    runtime.generate.mockReturnValue(new Promise(() => undefined));
    let activeSession: object = { token: "initial" };
    const ownership = {
      snapshot: () => ({ activeSession, isUnlocked: true }),
    };
    const Adapter = OfficialCredentialGeneratorServiceAdapter as unknown as new (
      runtime: GeneratorRuntimePort,
      initialAlgorithm: null,
      ownership: typeof ownership,
    ) => OfficialCredentialGeneratorServiceAdapter;
    const adapter = new Adapter(runtime, null, ownership);
    const subscription = adapter.generate$({
      on$: requests,
      account$: of({ id: "account-a" } as Account),
    }).subscribe();

    requests.next({ algorithm: Algorithm.password, source: "user request" });
    await vi.waitFor(() => expect(runtime.generate).toHaveBeenCalledOnce());
    const owner = runtime.generate.mock.calls[0]![1]!;
    expect(await owner()).toBe(true);

    activeSession = { token: "replacement" };

    expect(await owner()).toBe(false);
    subscription.unsubscribe();
  });

  it("silently discards a stale runtime rejection after same-account session replacement", async () => {
    const requests = new Subject<{ algorithm: typeof Algorithm.password; source: string }>();
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-a", settings: settings(14) });
    const pending = deferred<ReturnType<typeof generated>>();
    runtime.generate.mockReturnValue(pending.promise);
    let activeSession: object = { token: "initial" };
    const ownership = { snapshot: () => ({ activeSession, isUnlocked: true }) };
    const Adapter = OfficialCredentialGeneratorServiceAdapter as unknown as new (
      runtime: GeneratorRuntimePort,
      initialAlgorithm: null,
      ownership: typeof ownership,
    ) => OfficialCredentialGeneratorServiceAdapter;
    const error = vi.fn();
    const subscription = new Adapter(runtime, null, ownership).generate$({
      on$: requests,
      account$: of({ id: "account-a" } as Account),
    }).subscribe({ error });

    requests.next({ algorithm: Algorithm.password, source: "user request" });
    await vi.waitFor(() => expect(runtime.generate).toHaveBeenCalledOnce());
    activeSession = { token: "replacement" };
    pending.reject(new Error("stale private generator failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(error).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("exposes only the three official provider-free username and email algorithms", async () => {
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-a", settings: settings(14) });
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const account$ = of({ id: "account-a" } as Account);

    await expect(firstValueFrom(adapter.algorithms$("username", { account$ })))
      .resolves.toMatchObject([{ id: Algorithm.username }]);
    await expect(firstValueFrom(adapter.algorithms$("email", { account$ })))
      .resolves.toMatchObject([{ id: Algorithm.plusAddress }, { id: Algorithm.catchall }]);
    expect(adapter.algorithm(Algorithm.username)).toMatchObject({ id: Algorithm.username });
    expect(adapter.algorithm(Algorithm.plusAddress)).toMatchObject({ id: Algorithm.plusAddress });
    expect(adapter.algorithm(Algorithm.catchall)).toMatchObject({ id: Algorithm.catchall });
  });

  it.each([
    ["effWordList", "word", { wordCapitalize: true, wordIncludeNumber: true }],
    ["plusAddress", "subaddress", { subaddressEmail: "owner@example.test" }],
    ["catchall", "catchall", { catchallDomain: "example.test" }],
  ] as const)("maps official %s settings into the account username snapshot", async (metadataKey, type, update) => {
    const runtime = runtimePort();
    runtime.activeSettings.mockResolvedValue({ accountId: "account-a", settings: settings(14) });
    runtime.updateUsernameSettings.mockImplementation((_accountId, value) => ({
      ...settings(14),
      username: value,
    }));
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const metadata = (BuiltIn as unknown as Record<string, AlgorithmMetadata>)[metadataKey]!;
    const subject = adapter.settings<Record<string, unknown>>(metadata, {
      account$: of({ id: "account-a" } as Account),
    });

    await firstValueFrom(subject);
    subject.next(update);
    await vi.waitFor(() => expect(runtime.updateUsernameSettings).toHaveBeenCalledOnce());

    expect(runtime.updateUsernameSettings).toHaveBeenCalledWith(
      "account-a",
      expect.objectContaining({ type, ...update }),
    );
  });

  it("does not publish a username settings completion after account ownership changes", async () => {
    const persisted = deferred<GeneratorSettingsSnapshot>();
    const runtime = runtimePort();
    runtime.activeSettings
      .mockResolvedValueOnce({ accountId: "account-a", settings: settings(14) })
      .mockResolvedValueOnce({ accountId: "account-a", settings: settings(14) })
      .mockResolvedValueOnce({ accountId: "account-b", settings: settings(14) });
    runtime.updateUsernameSettings.mockReturnValue(persisted.promise);
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const metadata = (BuiltIn as unknown as Record<string, AlgorithmMetadata>)["effWordList"]!;
    const subject = adapter.settings<Record<string, unknown>>(metadata, {
      account$: of({ id: "account-a" } as Account),
    });
    const observed: Record<string, unknown>[] = [];
    subject.subscribe((value) => observed.push(value));
    await vi.waitFor(() => expect(observed).toHaveLength(1));

    subject.next({ wordCapitalize: true, wordIncludeNumber: false });
    await vi.waitFor(() => expect(runtime.updateUsernameSettings).toHaveBeenCalledOnce());
    persisted.resolve({
      ...settings(14),
      username: { ...settings(14).username, wordCapitalize: true },
    });
    await vi.waitFor(() => expect(runtime.activeSettings).toHaveBeenCalledTimes(3));

    expect(observed).toHaveLength(1);
  });

  it("serializes settings writes across algorithm subjects so the newest write persists last", async () => {
    let persisted = settings(14);
    const firstWrite = deferred<GeneratorSettingsSnapshot>();
    const secondWrite = deferred<GeneratorSettingsSnapshot>();
    const runtime = runtimePort();
    runtime.activeSettings.mockImplementation(async () => ({
      accountId: "account-a",
      settings: persisted,
    }));
    runtime.updateUsernameSettings
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const account$ = of({ id: "account-a" } as Account);
    const username = adapter.settings<Record<string, unknown>>(BuiltIn.effWordList, { account$ });
    const subaddress = adapter.settings<Record<string, unknown>>(BuiltIn.plusAddress, { account$ });

    await Promise.all([firstValueFrom(username), firstValueFrom(subaddress)]);
    username.next({ wordCapitalize: true, wordIncludeNumber: false });
    subaddress.next({ subaddressEmail: "owner@example.test" });
    await vi.waitFor(() => expect(runtime.updateUsernameSettings).toHaveBeenCalledTimes(1));

    const firstValue = runtime.updateUsernameSettings.mock.calls[0]![1];
    persisted = { ...persisted, username: { ...firstValue } };
    firstWrite.resolve(persisted);
    await vi.waitFor(() => expect(runtime.updateUsernameSettings).toHaveBeenCalledTimes(2));

    const secondValue = runtime.updateUsernameSettings.mock.calls[1]![1];
    expect(secondValue).toMatchObject({
      type: "subaddress",
      wordCapitalize: true,
      subaddressEmail: "owner@example.test",
    });
    persisted = { ...persisted, username: { ...secondValue } };
    secondWrite.resolve(persisted);
  });

  it("orders a username generation mode write after pending settings persistence", async () => {
    let persisted = settings(14);
    const pendingWrite = deferred<GeneratorSettingsSnapshot>();
    const runtime = runtimePort();
    runtime.activeSettings.mockImplementation(async () => ({
      accountId: "account-a",
      settings: persisted,
    }));
    runtime.updateUsernameSettings
      .mockReturnValueOnce(pendingWrite.promise)
      .mockImplementation((_accountId, value) => {
        persisted = { ...persisted, username: { ...value } };
        return persisted;
      });
    runtime.generate.mockResolvedValue(generated("generated-value"));
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const account$ = of({ id: "account-a" } as Account);
    const username = adapter.settings<Record<string, unknown>>(BuiltIn.effWordList, { account$ });
    await firstValueFrom(username);

    username.next({ wordCapitalize: true, wordIncludeNumber: false });
    await vi.waitFor(() => expect(runtime.updateUsernameSettings).toHaveBeenCalledTimes(1));
    const generation = firstValueFrom(adapter.generate$({
      on$: of({ algorithm: Algorithm.plusAddress, source: "user request" }),
      account$,
    }));
    await Promise.resolve();
    expect(runtime.generate).not.toHaveBeenCalled();

    persisted = {
      ...persisted,
      username: { ...runtime.updateUsernameSettings.mock.calls[0]![1] },
    };
    pendingWrite.resolve(persisted);
    await generation;

    expect(runtime.updateUsernameSettings.mock.calls[1]![1]).toMatchObject({
      type: "subaddress",
      wordCapitalize: true,
    });
    expect(runtime.generate).toHaveBeenCalledWith("username", expect.any(Function));
  });

  it("does not run a queued settings write after same-account session replacement", async () => {
    let persisted = settings(14);
    const pendingWrite = deferred<GeneratorSettingsSnapshot>();
    const runtime = runtimePort();
    runtime.activeSettings.mockImplementation(async () => ({
      accountId: "account-a",
      settings: persisted,
    }));
    runtime.updateUsernameSettings
      .mockReturnValueOnce(pendingWrite.promise)
      .mockImplementation((_accountId, value) => {
        persisted = { ...persisted, username: { ...value } };
        return persisted;
      });
    let activeSession: object = { token: "initial" };
    const ownership = { snapshot: () => ({ activeSession, isUnlocked: true }) };
    const Adapter = OfficialCredentialGeneratorServiceAdapter as unknown as new (
      runtime: GeneratorRuntimePort,
      initialAlgorithm: null,
      ownership: typeof ownership,
    ) => OfficialCredentialGeneratorServiceAdapter;
    const adapter = new Adapter(runtime, null, ownership);
    const account$ = of({ id: "account-a" } as Account);
    const username = adapter.settings<Record<string, unknown>>(BuiltIn.effWordList, { account$ });
    await firstValueFrom(username);

    username.next({ wordCapitalize: true, wordIncludeNumber: false });
    await vi.waitFor(() => expect(runtime.updateUsernameSettings).toHaveBeenCalledOnce());
    username.next({ wordCapitalize: false, wordIncludeNumber: true });
    activeSession = { token: "replacement" };
    username.next({ wordCapitalize: true, wordIncludeNumber: true });
    persisted = { ...persisted, username: { ...runtime.updateUsernameSettings.mock.calls[0]![1] } };
    pendingWrite.resolve(persisted);
    await vi.waitFor(() => expect(runtime.updateUsernameSettings).toHaveBeenCalledWith(
      "account-a",
      expect.objectContaining({ wordCapitalize: true, wordIncludeNumber: true }),
    ));

    expect(runtime.updateUsernameSettings).toHaveBeenCalledTimes(2);
    expect(runtime.updateUsernameSettings).not.toHaveBeenCalledWith(
      "account-a",
      expect.objectContaining({ wordCapitalize: false, wordIncludeNumber: true }),
    );
  });

  it("does not write settings when the active account changes before persistence", async () => {
    const account = { id: "account-a" } as Account;
    const runtime = runtimePort();
    runtime.activeSettings
      .mockResolvedValueOnce({ accountId: "account-a", settings: settings(14) })
      .mockResolvedValueOnce({ accountId: "account-b", settings: settings(32) });
    runtime.updatePasswordSettings.mockResolvedValue(settings(20));
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const subject = adapter.settings<PasswordGenerationOptions>(BuiltIn.password, {
      account$: of(account),
    });

    await firstValueFrom(subject);
    subject.next({ ...settings(20).password });
    await vi.waitFor(() => expect(runtime.activeSettings).toHaveBeenCalledTimes(2));

    expect(runtime.updatePasswordSettings).not.toHaveBeenCalled();
  });

  it("contains a locked-account rejection without writing settings", async () => {
    const account = { id: "account-a" } as Account;
    const runtime = runtimePort();
    runtime.activeSettings
      .mockResolvedValueOnce({ accountId: "account-a", settings: settings(14) })
      .mockRejectedValueOnce(new Error("Active account is locked"));
    const adapter = new OfficialCredentialGeneratorServiceAdapter(runtime);
    const subject = adapter.settings<PasswordGenerationOptions>(BuiltIn.password, {
      account$: of(account),
    });

    await firstValueFrom(subject);
    subject.next({ ...settings(20).password });
    await vi.waitFor(() => expect(runtime.activeSettings).toHaveBeenCalledTimes(2));

    expect(runtime.updatePasswordSettings).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function generated(credential: string) {
  return {
    credential,
    category: "password" as const,
    generationDate: new Date(0),
    algorithm: "password",
  };
}

function runtimePort() {
  return {
    activeSettings: vi.fn<GeneratorRuntimePort["activeSettings"]>(),
    generate: vi.fn<GeneratorRuntimePort["generate"]>(),
    updatePasswordSettings: vi.fn<GeneratorRuntimePort["updatePasswordSettings"]>(),
    updatePassphraseSettings: vi.fn<GeneratorRuntimePort["updatePassphraseSettings"]>(),
    updateUsernameSettings: vi.fn<GeneratorRuntimePort["updateUsernameSettings"]>(),
  };
}

function settings(length: number): GeneratorSettingsSnapshot {
  return {
    password: {
      length,
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
    passphrase: {
      numWords: 6,
      wordSeparator: "-",
      capitalize: false,
      includeNumber: false,
    },
    username: {
      type: "word",
      wordCapitalize: false,
      wordIncludeNumber: false,
      subaddressEmail: "",
      catchallDomain: "",
    },
  };
}
