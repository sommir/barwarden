import { describe, expect, it, vi } from "vitest";

import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../popup-state";
import { demoVaultItems } from "../vault-demo";
import type { VaultItem } from "./vault-item.model";
import type { RetainedPersonalCipherFormSubmit } from "./retained-personal-cipher-form.adapter";
import type { VaultCipherWritePort } from "./vault-cipher-write.service";
import { VaultFacade } from "./vault.facade";

describe("PersonalCipherSaveOperation", () => {
  it("suppresses a pending duplicate and seals the operation immediately after commit", async () => {
    const {
      PersonalCipherSaveOperation,
    } = await import("./personal-cipher-save-operation");
    const store = unlockedStore();
    const vault = new VaultFacade(store);
    const pending = deferred<(typeof demoVaultItems)[number]>();
    const write = personalWritePort({ createCardCipher: vi.fn(() => pending.promise) });
    const navigation = {
      currentUrl: () => "/add-cipher?type=3",
      navigateByUrl: vi.fn(async () => false),
    };
    const operation = new PersonalCipherSaveOperation({
      store,
      vault,
      navigation,
      context: () => ({ mode: "add", cipherType: "card", selectedItem: undefined }),
      writePort: () => write,
    });

    expect(operation.pending).toBe(false);
    const first = operation.submit(personalSubmit("add", CipherType.Card));
    await vi.waitFor(() => expect(write.createCardCipher).toHaveBeenCalledOnce());
    expect(operation.pending).toBe(true);
    await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
      committed: false,
      reason: "duplicate",
    });

    const returned = { ...demoVaultItems.find((item) => item.type === "card")!, id: "server-id" };
    pending.resolve(returned);
    await expect(first).resolves.toEqual({ committed: true, item: returned });

    expect(operation.pending).toBe(false);
    expect(store.snapshot().items[0]).toBe(returned);
    expect(operation.submitDisabled).toBe(true);
    expect(store.snapshot().statusMessage).toBe("项目已保存，但无法打开。");
    await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
      committed: false,
      reason: "stale",
    });
    expect(write.createCardCipher).toHaveBeenCalledOnce();
  });

  it.each(["route", "session", "selected", "active", "archived", "deleted"] as const)(
    "rejects a late result after %s ownership replacement",
    async (replacement) => {
      const {
        PersonalCipherSaveOperation,
      } = await import("./personal-cipher-save-operation");
      const selected = demoVaultItems.find((item) => item.type === "card")!;
      const store = unlockedStore([selected]);
      const vault = new VaultFacade(store);
      const pending = deferred<(typeof demoVaultItems)[number]>();
      const write = personalWritePort({ updateCardCipher: vi.fn(() => pending.promise) });
      let routeUrl = "/edit-cipher?cipherId=card&type=3";
      let selectedItem = selected;
      const operation = new PersonalCipherSaveOperation({
        store,
        vault,
        navigation: {
          currentUrl: () => routeUrl,
          navigateByUrl: vi.fn(async () => true),
        },
        context: () => ({ mode: "edit", cipherType: "card", selectedItem }),
        writePort: () => write,
      });

      const saving = operation.submit(personalSubmit("edit", CipherType.Card));
      await vi.waitFor(() => expect(write.updateCardCipher).toHaveBeenCalledOnce());
      if (replacement === "route") routeUrl = "/tabs/vault";
      if (replacement === "session") store.setActiveSession({ ...store.snapshot().activeSession! });
      if (replacement === "selected") {
        selectedItem = { ...selected };
        store.setItems([selectedItem]);
      }
      if (replacement === "active") store.setItems([...store.snapshot().items]);
      if (replacement === "archived") store.setArchivedItems([...store.snapshot().archivedItems]);
      if (replacement === "deleted") store.setDeletedItems([...store.snapshot().deletedItems]);

      pending.resolve({ ...selected, name: "Late returned item" });
      await expect(saving).resolves.toEqual({ committed: false, reason: "stale" });
      expect(store.snapshot().items[0]).toBe(replacement === "selected" ? selectedItem : selected);
    },
  );

  it("invalidates pending ownership on cancel without clearing a committed terminal", async () => {
    const {
      PersonalCipherSaveOperation,
    } = await import("./personal-cipher-save-operation");
    const store = unlockedStore();
    const vault = new VaultFacade(store);
    const firstPending = deferred<(typeof demoVaultItems)[number]>();
    const write = personalWritePort({ createCardCipher: vi.fn(() => firstPending.promise) });
    const operation = new PersonalCipherSaveOperation({
      store,
      vault,
      navigation: {
        currentUrl: () => "/add-cipher?type=3",
        navigateByUrl: vi.fn(async () => false),
      },
      context: () => ({ mode: "add", cipherType: "card", selectedItem: undefined }),
      writePort: () => write,
    });

    const stale = operation.submit(personalSubmit("add", CipherType.Card));
    await vi.waitFor(() => expect(write.createCardCipher).toHaveBeenCalledOnce());
    operation.invalidate();
    expect(operation.pending).toBe(true);
    expect(operation.submitDisabled).toBe(true);
    await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
      committed: false,
      reason: "duplicate",
    });
    expect(write.createCardCipher).toHaveBeenCalledOnce();
    firstPending.resolve({ ...demoVaultItems[1]!, id: "late-id" });
    await expect(stale).resolves.toEqual({ committed: false, reason: "stale" });
    expect(operation.pending).toBe(false);

    vi.mocked(write.createCardCipher).mockResolvedValueOnce({
      ...demoVaultItems.find((item) => item.type === "card")!,
      id: "committed-id",
    });
    await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toMatchObject({
      committed: true,
    });
    operation.invalidate();
    expect(operation.submitDisabled).toBe(true);
  });

  it.each(PERSONAL_OPERATION_CASES.flatMap((entry) =>
    MALFORMED_PERSONAL_RESULTS.map((malformed) => ({ ...entry, malformed }))))(
    "fails hostile $label $malformed.label runtime results without committing or retaining pending ownership",
    async ({ type, cipherType, malformed }) => {
      const {
        PersonalCipherSaveOperation,
      } = await import("./personal-cipher-save-operation");
      const store = unlockedStore();
      const vault = new VaultFacade(store);
      const valid = personalServerItem(type, `valid-${type}`);
      const { write, create } = personalCreateWritePort(type, [malformed.value(valid), valid]);
      const navigation = {
        currentUrl: () => "/add-cipher",
        navigateByUrl: vi.fn(async () => true),
      };
      const operation = new PersonalCipherSaveOperation({
        store,
        vault,
        navigation,
        context: () => ({ mode: "add", cipherType: type, selectedItem: undefined }),
        writePort: () => write,
      });
      const before = store.snapshot().items;

      await expect(operation.submit(personalSubmit("add", cipherType))).resolves.toEqual({
        committed: false,
        reason: "failure",
      });

      expect(store.snapshot().items).toBe(before);
      expect(navigation.navigateByUrl).not.toHaveBeenCalled();
      expect(operation.submitDisabled).toBe(false);
      expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。");
      expect(JSON.stringify(store.snapshot())).not.toContain("pending-sync-");

      await expect(operation.submit(personalSubmit("add", cipherType))).resolves.toEqual({
        committed: true,
        item: valid,
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(store.snapshot().items[0]).toBe(valid);
    },
  );

  it.each(POST_COMMIT_INVALIDATION_CAUSES.flatMap((cause) =>
    (["false", "reject"] as const).map((navigationResult) => ({ cause, navigationResult }))))(
    "does not leak late navigation $navigationResult feedback after $cause invalidation",
    async ({ cause, navigationResult }) => {
      const {
        PersonalCipherSaveOperation,
      } = await import("./personal-cipher-save-operation");
      const selected = demoVaultItems.find((item) => item.type === "card")!;
      const returned = { ...selected, id: "committed-server-id", name: "Committed server item" };
      const store = unlockedStore([selected]);
      const vault = new VaultFacade(store);
      const pendingNavigation = deferred<boolean>();
      const write = personalWritePort({ updateCardCipher: vi.fn(async () => returned) });
      let routeUrl = "/edit-cipher";
      let selectedItem = selected;
      const navigation = {
        currentUrl: () => routeUrl,
        navigateByUrl: vi.fn(() => pendingNavigation.promise),
      };
      const operation = new PersonalCipherSaveOperation({
        store,
        vault,
        navigation,
        context: () => ({ mode: "edit", cipherType: "card", selectedItem }),
        writePort: () => write,
      });

      const saving = operation.submit(personalSubmit("edit", CipherType.Card));
      await vi.waitFor(() => expect(navigation.navigateByUrl).toHaveBeenCalledOnce());

      if (cause === "route") routeUrl = "/tabs/vault";
      if (cause === "account") store.setUnlocked("new-context@example.test");
      if (cause === "session") store.setActiveSession({ ...store.snapshot().activeSession! });
      if (cause === "lock") store.setLocked();
      if (cause === "logout") store.setLoggedOut();
      if (cause === "selected") selectedItem = { ...selected };
      if (cause === "active") store.setItems([...store.snapshot().items]);
      if (cause === "archived") store.setArchivedItems([...store.snapshot().archivedItems]);
      if (cause === "deleted") store.setDeletedItems([...store.snapshot().deletedItems]);
      if (cause === "folders") {
        const state = store.snapshot();
        store.setItems(state.items, [...state.folders]);
      }
      if (cause === "organizations") {
        const state = store.snapshot();
        store.setOrganizationData([...state.organizations], state.collections);
      }
      if (cause === "collections") {
        const state = store.snapshot();
        store.setOrganizationData(state.organizations, [...state.collections]);
      }
      if (cause === "operation") operation.invalidate();
      store.setStatus("New context status");
      const invalidatedState = store.snapshot();

      if (navigationResult === "false") {
        pendingNavigation.resolve(false);
      } else {
        pendingNavigation.reject(new Error("private navigation failure"));
      }

      await expect(saving).resolves.toEqual({ committed: true, item: returned });
      expect(store.snapshot().statusMessage).toBe("New context status");
      expect(store.snapshot().items).toBe(invalidatedState.items);
      expect(store.snapshot().archivedItems).toBe(invalidatedState.archivedItems);
      expect(store.snapshot().deletedItems).toBe(invalidatedState.deletedItems);
      if (cause !== "lock" && cause !== "logout") {
        expect(vault.itemById(returned.id)).toBe(returned);
      }
      expect(operation.submitDisabled).toBe(true);
    },
  );

  it.each(["before-mutation", "after-mutation"] as const)(
    "rolls back and clears pending ownership when the store throws %s",
    async (mode) => {
      const {
        PersonalCipherSaveOperation,
      } = await import("./personal-cipher-save-operation");
      const store = unlockedStore();
      const vault = new VaultFacade(store);
      const first = personalServerItem("card", "first-server-id");
      const second = personalServerItem("card", "second-server-id");
      const { write, create } = personalCreateWritePort("card", [first, second]);
      const navigation = {
        currentUrl: () => "/add-cipher",
        navigateByUrl: vi.fn(async () => true),
      };
      const operation = new PersonalCipherSaveOperation({
        store,
        vault,
        navigation,
        context: () => ({ mode: "add", cipherType: "card", selectedItem: undefined }),
        writePort: () => write,
      });
      const before = store.snapshot().items;
      const addActiveVaultItem = store.addActiveVaultItem.bind(store);
      const commit = vi.spyOn(store, "addActiveVaultItem").mockImplementationOnce((item) => {
        if (mode === "after-mutation") {
          addActiveVaultItem(item);
        }
        throw new Error("private store failure");
      });

      await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
        committed: false,
        reason: "failure",
      });
      expect(store.snapshot().items).toBe(before);
      expect(store.snapshot().items).not.toContain(first);
      expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。");
      expect(operation.submitDisabled).toBe(false);
      expect(navigation.navigateByUrl).not.toHaveBeenCalled();

      commit.mockImplementation(addActiveVaultItem);
      await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
        committed: true,
        item: second,
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(store.snapshot().items[0]).toBe(second);
    },
  );

  it.each([
    {
      label: "throwing",
      proxy: (valid: VaultItem) => new Proxy(valid, {
        get: (_target, key, receiver) => {
          if (key === "id") throw new Error("private empty-vault get failure");
          return Reflect.get(valid, key, receiver);
        },
      }),
    },
    {
      label: "descriptor-inconsistent",
      proxy: (valid: VaultItem) => new Proxy(valid, {
        get: (_target, key, receiver) =>
          key === "id" ? "different-observable-id" : Reflect.get(valid, key, receiver),
      }),
    },
    {
      label: "stateful",
      proxy: (valid: VaultItem) => {
        let idReads = 0;
        return new Proxy(valid, {
          get: (_target, key, receiver) => {
            if (key !== "id") return Reflect.get(valid, key, receiver);
            idReads += 1;
            if (idReads === 1) return valid.id;
            throw new Error("private stateful proxy failure");
          },
        });
      },
    },
  ])(
    "rejects a descriptor-valid $label ID proxy before committing into an empty vault",
    async ({ proxy }) => {
      const {
        PersonalCipherSaveOperation,
      } = await import("./personal-cipher-save-operation");
      const store = unlockedStore([]);
      const valid = personalServerItem("card", "retry-server-id");
      const hostile = proxy(personalServerItem("card", "hostile-server-id"));
      const { write, create } = personalCreateWritePort("card", [hostile, valid]);
      const navigation = {
        currentUrl: () => "/add-cipher",
        navigateByUrl: vi.fn(async () => true),
      };
      const operation = new PersonalCipherSaveOperation({
        store,
        vault: new VaultFacade(store),
        navigation,
        context: () => ({ mode: "add", cipherType: "card", selectedItem: undefined }),
        writePort: () => write,
      });
      const before = store.snapshot().items;

      await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
        committed: false,
        reason: "failure",
      });
      expect(store.snapshot().items).toBe(before);
      expect(store.snapshot().items).toEqual([]);
      expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。");
      expect(operation.submitDisabled).toBe(false);
      expect(navigation.navigateByUrl).not.toHaveBeenCalled();

      await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
        committed: true,
        item: valid,
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(store.snapshot().items[0]).toBe(valid);
    },
  );

  it("preserves exact plain returned-object identity in an empty vault", async () => {
    const {
      PersonalCipherSaveOperation,
    } = await import("./personal-cipher-save-operation");
    const store = unlockedStore([]);
    const returned = personalServerItem("card", "plain-server-id");
    const { write } = personalCreateWritePort("card", [returned]);
    const navigation = {
      currentUrl: () => "/add-cipher",
      navigateByUrl: vi.fn(async () => true),
    };
    const operation = new PersonalCipherSaveOperation({
      store,
      vault: new VaultFacade(store),
      navigation,
      context: () => ({ mode: "add", cipherType: "card", selectedItem: undefined }),
      writePort: () => write,
    });

    await expect(operation.submit(personalSubmit("add", CipherType.Card))).resolves.toEqual({
      committed: true,
      item: returned,
    });
    expect(store.snapshot().items[0]).toBe(returned);
    expect(navigation.navigateByUrl).toHaveBeenCalledWith("/view-cipher/plain-server-id");
    expect(operation.submitDisabled).toBe(true);
  });
});

const PERSONAL_OPERATION_CASES = [
  { type: "card", label: "Card", cipherType: CipherType.Card },
  { type: "identity", label: "Identity", cipherType: CipherType.Identity },
  { type: "secure-note", label: "Secure Note", cipherType: CipherType.SecureNote },
] as const;

const MALFORMED_PERSONAL_RESULTS = [
  { label: "undefined item", value: () => undefined },
  { label: "null item", value: () => null },
  { label: "non-object item", value: () => 7 },
  { label: "undefined ID", value: (valid: VaultItem) => ({ ...valid, id: undefined }) },
  { label: "null ID", value: (valid: VaultItem) => ({ ...valid, id: null }) },
  { label: "non-string ID", value: (valid: VaultItem) => ({ ...valid, id: {} }) },
  { label: "blank ID", value: (valid: VaultItem) => ({ ...valid, id: "" }) },
  { label: "whitespace ID", value: (valid: VaultItem) => ({ ...valid, id: "   " }) },
  { label: "wrong type", value: (valid: VaultItem) => ({ ...valid, type: "login" }) },
  { label: "organization ownership", value: (valid: VaultItem) => ({ ...valid, organizationId: "org" }) },
  { label: "collection ownership", value: (valid: VaultItem) => ({ ...valid, collectionIds: ["collection"] }) },
  { label: "inherited ID", value: (valid: VaultItem) => inheritedRequiredField(valid, "id") },
  { label: "inherited type", value: (valid: VaultItem) => inheritedRequiredField(valid, "type") },
  { label: "non-enumerable ID", value: (valid: VaultItem) => nonEnumerableDataField(valid, "id") },
  { label: "enumerable ID accessor", value: (valid: VaultItem) => accessorField(valid, "id", true) },
  { label: "non-enumerable name accessor", value: (valid: VaultItem) => accessorField(valid, "name", false) },
  { label: "throwing name getter", value: (valid: VaultItem) => throwingAccessorField(valid, "name") },
  { label: "stateful ID getter", value: (valid: VaultItem) => statefulIdAccessor(valid) },
  { label: "custom prototype", value: (valid: VaultItem) => Object.setPrototypeOf({ ...valid }, {}) },
  { label: "symbol top-level field", value: (valid: VaultItem) => symbolField(valid) },
  { label: "throwing ownKeys proxy", value: (valid: VaultItem) => proxyOwnKeysTrap(valid) },
  { label: "throwing descriptor proxy", value: (valid: VaultItem) => proxyDescriptorTrap(valid) },
  { label: "throwing prototype proxy", value: (valid: VaultItem) => proxyPrototypeTrap(valid) },
  { label: "throwing get proxy", value: (valid: VaultItem) => proxyGetTrap(valid) },
] as const;

const POST_COMMIT_INVALIDATION_CAUSES = [
  "route",
  "account",
  "session",
  "lock",
  "logout",
  "selected",
  "active",
  "archived",
  "deleted",
  "folders",
  "organizations",
  "collections",
  "operation",
] as const;

function inheritedRequiredField(valid: VaultItem, key: "id" | "type"): object {
  const own = { ...valid } as Record<string, unknown>;
  const value = own[key];
  delete own[key];
  return Object.assign(Object.create({ [key]: value }) as object, own);
}

function nonEnumerableDataField(valid: VaultItem, key: "id"): object {
  const result = { ...valid } as Record<string, unknown>;
  Object.defineProperty(result, key, {
    value: result[key],
    enumerable: false,
    configurable: true,
  });
  return result;
}

function accessorField(valid: VaultItem, key: "id" | "name", enumerable: boolean): object {
  const result = { ...valid } as Record<string, unknown>;
  const value = result[key];
  Object.defineProperty(result, key, {
    get: () => value,
    enumerable,
    configurable: true,
  });
  return result;
}

function throwingAccessorField(valid: VaultItem, key: "name"): object {
  const result = { ...valid } as Record<string, unknown>;
  Object.defineProperty(result, key, {
    get: () => { throw new Error("private getter failure"); },
    enumerable: true,
    configurable: true,
  });
  return result;
}

function statefulIdAccessor(valid: VaultItem): object {
  const result = { ...valid } as Record<string, unknown>;
  let reads = 0;
  Object.defineProperty(result, "id", {
    get: () => {
      reads += 1;
      if (reads <= 2) return valid.id;
      throw new Error("private stateful getter failure");
    },
    enumerable: true,
    configurable: true,
  });
  return result;
}

function symbolField(valid: VaultItem): object {
  const result = { ...valid } as Record<PropertyKey, unknown>;
  Object.defineProperty(result, Symbol("private-field"), {
    value: "private-value",
    enumerable: true,
  });
  return result;
}

function proxyOwnKeysTrap(valid: VaultItem): object {
  return new Proxy(valid, {
    ownKeys: () => { throw new Error("private ownKeys failure"); },
  });
}

function proxyDescriptorTrap(valid: VaultItem): object {
  return new Proxy(valid, {
    getOwnPropertyDescriptor: () => { throw new Error("private descriptor failure"); },
  });
}

function proxyPrototypeTrap(valid: VaultItem): object {
  return new Proxy(valid, {
    getPrototypeOf: () => { throw new Error("private prototype failure"); },
  });
}

function proxyGetTrap(valid: VaultItem): object {
  return new Proxy(valid, {
    get: (_target, key, receiver) => {
      if (key === "id") throw new Error("private get failure");
      return Reflect.get(valid, key, receiver);
    },
  });
}

function unlockedStore(items = demoVaultItems) {
  const store = new PopupStateStore();
  store.setItems(items);
  store.setUnlocked("operator@example.test");
  store.setActiveSession(fakeAuthSession());
  return store;
}

function personalSubmit(
  mode: RetainedPersonalCipherFormSubmit["mode"],
  cipherType: CipherType.Card | CipherType.Identity | CipherType.SecureNote,
): RetainedPersonalCipherFormSubmit {
  return {
    mode,
    cipherType,
    value: CipherView.fromJSON({
      type: cipherType,
      name: "Personal item",
      organizationId: null,
      collectionIds: [],
      fields: [],
      card: {},
      identity: {},
      secureNote: { type: 0 },
    })!,
  };
}

function personalWritePort(
  overrides: Partial<VaultCipherWritePort>,
): VaultCipherWritePort {
  const unused = vi.fn(async () => {
    throw new Error("unexpected write");
  });
  return {
    createLoginCipher: unused,
    updateLoginCipher: unused,
    createCardCipher: unused,
    updateCardCipher: unused,
    createIdentityCipher: unused,
    updateIdentityCipher: unused,
    createSecureNoteCipher: unused,
    updateSecureNoteCipher: unused,
    ...overrides,
  } as VaultCipherWritePort;
}

function personalServerItem(
  type: (typeof PERSONAL_OPERATION_CASES)[number]["type"],
  id: string,
): VaultItem {
  return {
    ...demoVaultItems.find((item) => item.type === type)!,
    id,
    organizationId: undefined,
    collectionIds: [],
  };
}

function personalCreateWritePort(
  type: (typeof PERSONAL_OPERATION_CASES)[number]["type"],
  results: readonly unknown[],
): { readonly write: VaultCipherWritePort; readonly create: ReturnType<typeof vi.fn> } {
  let resultIndex = 0;
  const create = vi.fn(async () => results[resultIndex++] as VaultItem);
  const overrides = type === "card"
    ? { createCardCipher: create as unknown as VaultCipherWritePort["createCardCipher"] }
    : type === "identity"
      ? { createIdentityCipher: create as unknown as VaultCipherWritePort["createIdentityCipher"] }
      : { createSecureNoteCipher: create as unknown as VaultCipherWritePort["createSecureNoteCipher"] };
  return { write: personalWritePort(overrides), create };
}

function fakeAuthSession(): AuthSession {
  return {
    environment: buildSelfHostedEnvironmentFromServerUrl("https://bitwarden.example.test"),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    crypto: { userKeyB64: "test-user-key" },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
