import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import {
  bytesToBase64,
  decryptEncStringToUtf8,
  encryptBytesToEncString,
} from "../../auth/bitwarden-crypto";
import { buildBitwardenEnvironment } from "../../bitwarden-api/bitwarden-api";
import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import type { VaultItem } from "./vault-item.model";
import { retainOpaqueCipherPayload } from "./opaque-cipher-payload";
import { BitwardenVaultCipherWriteActions } from "./vault-cipher-write.service";
import * as vaultCipherWriteModule from "./vault-cipher-write.service";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BitwardenVaultCipherWriteActions", () => {
  it("resolves one Login write to typed committed, stale, and failure outcomes", async () => {
    type RunLoginWrite = (
      write: () => Promise<VaultItem>,
      isCurrent: () => boolean,
    ) => Promise<
      | { readonly committed: true; readonly item: VaultItem }
      | { readonly committed: false; readonly reason: "stale" | "failure" }
    >;
    const runLoginWrite = (vaultCipherWriteModule as unknown as {
      runLoginCipherWrite?: RunLoginWrite;
    }).runLoginCipherWrite;
    expect(runLoginWrite).toBeTypeOf("function");
    const item = loginItem({ id: "typed-result" });

    await expect(runLoginWrite!(() => Promise.resolve(item), () => true)).resolves.toEqual({
      committed: true,
      item,
    });
    await expect(runLoginWrite!(() => Promise.resolve(item), () => false)).resolves.toEqual({
      committed: false,
      reason: "stale",
    });
    await expect(runLoginWrite!(() => Promise.reject(new Error("private failure")), () => true))
      .resolves.toEqual({ committed: false, reason: "failure" });
    await expect(runLoginWrite!(() => Promise.reject(new Error("late failure")), () => false))
      .resolves.toEqual({ committed: false, reason: "stale" });
  });

  it("resolves one personal write to typed committed, stale, and failure outcomes", async () => {
    type RunPersonalWrite = (
      write: () => Promise<VaultItem>,
      isCurrent: () => boolean,
    ) => Promise<
      | { readonly committed: true; readonly item: VaultItem }
      | { readonly committed: false; readonly reason: "stale" | "failure" }
    >;
    const runPersonalWrite = (vaultCipherWriteModule as unknown as {
      runPersonalCipherWrite?: RunPersonalWrite;
    }).runPersonalCipherWrite;
    expect(runPersonalWrite).toBeTypeOf("function");
    const item = opaquePersonalItem("card");

    await expect(runPersonalWrite!(() => Promise.resolve(item), () => true)).resolves.toEqual({
      committed: true,
      item,
    });
    await expect(runPersonalWrite!(() => Promise.resolve(item), () => false)).resolves.toEqual({
      committed: false,
      reason: "stale",
    });
    await expect(runPersonalWrite!(() => Promise.reject(new Error("private failure")), () => true))
      .resolves.toEqual({ committed: false, reason: "failure" });
    await expect(runPersonalWrite!(() => Promise.reject(new Error("late failure")), () => false))
      .resolves.toEqual({ committed: false, reason: "stale" });
  });

  it.each(["uri", "field"] as const)(
    "rejects a same-length opaque %s replacement before encryption and transport",
    async (collection) => {
      const transport = { fetchJson: vi.fn() } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 9)));
      const item = loginItem({
        uris: [
          { id: "uri-1", uri: "https://one.example.test", matchType: "default" },
          { id: "uri-2", uri: "https://two.example.test", matchType: "1" },
        ],
        fields: [
          { id: "username", label: "Username", value: "operator" },
          { id: "password", label: "Password", value: "old-password", type: "hidden", concealed: true },
          { id: "custom:one", label: "One", value: "1", type: "text" },
          { id: "custom:two", label: "Two", value: "2", type: "text" },
        ],
        opaqueServerPayload: retainOpaqueCipherPayload({
          Id: "login-opaque",
          Type: 1,
          Name: "2.synthetic-old-name",
          Login: {
            Uris: [
              {
                Uri: "2.synthetic-uri-1",
                ...(collection === "uri" ? { FutureUri: "2.synthetic-future-uri-1" } : {}),
              },
              { Uri: "2.synthetic-uri-2" },
            ],
          },
          Fields: [
            {
              Name: "2.synthetic-field-1",
              Value: "2.synthetic-value-1",
              Type: 0,
              ...(collection === "field" ? { FutureField: "2.synthetic-future-field-1" } : {}),
            },
            { Name: "2.synthetic-field-2", Value: "2.synthetic-value-2", Type: 0 },
          ],
        }),
      });
      const uris = collection === "uri"
        ? [
            { uri: "https://replacement.example.test", matchType: "default" },
            { uri: "https://two.example.test", matchType: "1" },
          ]
        : item.uris;
      const fields = collection === "field"
        ? [
            { name: "Replacement", value: "3", type: 0 as const },
            { name: "Two", value: "2", type: 0 as const },
          ]
        : [
            { name: "One", value: "1", type: 0 as const },
            { name: "Two", value: "2", type: 0 as const },
          ];

      await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
        session,
        item,
        {
          name: "Edited",
          username: "operator",
          password: "old-password",
          totp: "",
          uri: uris[0]?.uri ?? "",
          uris,
          fields,
          notes: "",
        },
      )).rejects.toThrow("Unable to safely preserve opaque Login collection data");
      expect(transport.fetchJson).not.toHaveBeenCalled();
    },
  );

  it("recomputes the official URI checksum when a Login URI changes", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "login-opaque" };
      }),
    } as unknown as HostApi;
    const userKeyB64 = bytesToBase64(sequentialBytes(64, 10));
    const session = authSession(userKeyB64);
    const item = loginItem({
      uris: [{ id: "uri-1", uri: "https://one.example.test", matchType: "default" }],
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "login-opaque",
        Type: 1,
        Login: {
          Uris: [{ Uri: "2.synthetic-uri-1", UriChecksum: "2.synthetic-stale-checksum" }],
        },
      }),
    });

    await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      {
        name: "Edited",
        username: "operator",
        password: "old-password",
        totp: "",
        uri: "https://replacement.example.test",
        notes: "",
      },
    );

    const login = requestBody?.["login"] as Record<string, unknown>;
    const uri = (login["uris"] as Array<Record<string, unknown>>)[0]!;
    expect(uri["uriChecksum"]).not.toBe("2.synthetic-stale-checksum");
    await expect(decryptEncStringToUtf8(String(uri["uriChecksum"]), userKeyB64)).resolves.toBe(
      bytesToBase64(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode("https://replacement.example.test"),
          ),
        ),
      ),
    );
  });

  it("reassociates opaque metadata across a uniquely provable plaintext reorder", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "login-opaque" };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 11)));
    const item = loginItem({
      uris: [
        { id: "uri-1", uri: "https://one.example.test", matchType: "default" },
        { id: "uri-2", uri: "https://two.example.test", matchType: "1" },
      ],
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "login-opaque",
        Type: 1,
        Login: {
          Uris: [
            { Uri: "2.synthetic-uri-1", FutureUri: "2.synthetic-future-uri-1" },
            { Uri: "2.synthetic-uri-2", FutureUri: "2.synthetic-future-uri-2" },
          ],
        },
      }),
    });

    await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(session, item, {
      name: "Edited",
      username: "operator",
      password: "old-password",
      totp: "",
      uri: "https://two.example.test",
      uris: [
        { uri: "https://two.example.test", matchType: "1" },
        { uri: "https://one.example.test", matchType: "default" },
      ],
      notes: "",
    });

    expect(requestBody).toMatchObject({
      login: {
        uris: [
          { FutureUri: "2.synthetic-future-uri-2" },
          { FutureUri: "2.synthetic-future-uri-1" },
        ],
      },
    });
  });

  it.each([
    "uri-supported-edit",
    "uri-duplicate-edit",
    "uri-add",
    "uri-delete",
    "uri-reorder",
    "field-supported-edit",
    "field-duplicate-edit",
    "field-add",
    "field-delete",
    "field-reorder",
  ] as const)(
    "allows %s when retained URI/field records have no opaque extras",
    async (change) => {
      const transport = {
        fetchJson: vi.fn(async () => ({ Id: "login-opaque" })),
      } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 12)));
      const item = loginItem({
        uris: [
          { id: "uri-1", uri: "https://one.example.test", matchType: "default" },
          { id: "uri-2", uri: "https://two.example.test", matchType: "1" },
        ],
        fields: [
          { id: "username", label: "Username", value: "operator" },
          { id: "password", label: "Password", value: "old-password", type: "hidden", concealed: true },
          { id: "custom:one", label: "One", value: "1", type: "text" },
          { id: "custom:two", label: "Two", value: "2", type: "text" },
        ],
        opaqueServerPayload: retainOpaqueCipherPayload({
          Id: "login-opaque",
          Type: 1,
          Login: {
            Uris: [
              { Uri: "2.synthetic-uri-1", Match: null },
              { Uri: "2.synthetic-uri-2", Match: 1 },
            ],
          },
          Fields: [
            { Name: "2.synthetic-field-1", Value: "2.synthetic-value-1", Type: 0 },
            { Name: "2.synthetic-field-2", Value: "2.synthetic-value-2", Type: 0 },
          ],
        }),
      });
      const uris = change === "uri-supported-edit"
        ? [
            { uri: "https://replacement.example.test", matchType: "default" },
            { uri: "https://two.example.test", matchType: "1" },
          ]
        : change === "uri-duplicate-edit"
          ? [
              { uri: "https://replacement.example.test", matchType: "default" },
              { uri: "https://replacement.example.test", matchType: "default" },
            ]
          : change === "uri-add"
            ? [
                { uri: "https://one.example.test", matchType: "default" },
                { uri: "https://inserted.example.test", matchType: "default" },
                { uri: "https://two.example.test", matchType: "1" },
              ]
            : change === "uri-delete"
              ? [{ uri: "https://one.example.test", matchType: "default" }]
              : change === "uri-reorder"
                ? [
                  { uri: "https://two.example.test", matchType: "1" },
                  { uri: "https://one.example.test", matchType: "default" },
                ]
                : item.uris;
      const fields = change === "field-supported-edit"
        ? [
            { name: "Edited", value: "2", type: 0 as const },
            { name: "Two", value: "2", type: 0 as const },
          ]
        : change === "field-duplicate-edit"
          ? [
              { name: "Duplicate", value: "same", type: 0 as const },
              { name: "Duplicate", value: "same", type: 0 as const },
            ]
          : change === "field-add"
            ? [
                { name: "One", value: "1", type: 0 as const },
                { name: "Inserted", value: "3", type: 0 as const },
                { name: "Two", value: "2", type: 0 as const },
              ]
            : change === "field-delete"
              ? [{ name: "One", value: "1", type: 0 as const }]
              : change === "field-reorder"
                ? [
                    { name: "Two", value: "2", type: 0 as const },
                    { name: "One", value: "1", type: 0 as const },
                  ]
                : [
                    { name: "One", value: "1", type: 0 as const },
                    { name: "Two", value: "2", type: 0 as const },
                  ];

      await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(session, item, {
        name: "Edited",
        username: "operator",
        password: "old-password",
        totp: "",
        uri: uris[0]?.uri ?? "",
        uris,
        fields,
        notes: "",
      });

      expect(transport.fetchJson).toHaveBeenCalledOnce();
    },
  );

  it("retains the sent opaque request and blocks a second edit after a successful update", async () => {
    const userKey = sequentialBytes(64, 15);
    const requestBodies: Record<string, unknown>[] = [];
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return {
          id: "server-returned-id",
          revisionDate: "2026-07-15T02:00:00.000Z",
          futureTopLevel: "2.synthetic-response-top-level",
          ServerAddedOpaque: "2.synthetic-response-added",
          LOGIN: {
            URLMetadata: "2.synthetic-response-url-metadata",
            ServerNestedOpaque: "2.synthetic-response-nested",
          },
        };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(userKey));
    const item = loginItem({
      id: "original-id",
      uris: [{ id: "uri-1", uri: "https://one.example.test", matchType: "default" }],
      fields: [
        { id: "username", label: "Username", value: "operator" },
        { id: "password", label: "Password", value: "old-password", type: "hidden", concealed: true },
        { id: "custom:one", label: "One", value: "1", type: "text" },
      ],
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "original-id",
        RevisionDate: "2026-07-14T00:00:00.000Z",
        Type: 1,
        Name: "2.synthetic-old-name",
        FutureTopLevel: "2.synthetic-original-top-level",
        Login: {
          Username: "2.synthetic-old-user",
          Password: "2.synthetic-old-password",
          URLMetadata: "2.synthetic-original-url-metadata",
          Uris: [{ Uri: "2.synthetic-old-uri", FutureUri: "2.synthetic-uri-future" }],
        },
        Fields: [{
          Name: "2.synthetic-old-field-name",
          Value: "2.synthetic-old-field-value",
          Type: 0,
          FutureField: "2.synthetic-field-future",
        }],
      }),
    });
    const actions = new BitwardenVaultCipherWriteActions(session, transport);

    const first = await actions.updateLoginCipher(session, item, {
      name: "First Edit",
      username: "operator",
      password: "first-password",
      totp: "",
      uri: "https://one.example.test",
      fields: [{ name: "One", value: "1", type: 0 }],
      notes: "",
    });
    await expect(actions.updateLoginCipher(session, first, {
      name: "Second Edit",
      username: "operator",
      password: "first-password",
      totp: "",
      uri: "https://one.example.test",
      fields: [{ name: "One", value: "1", type: 0 }],
      notes: "",
    })).rejects.toThrow("Login requires vault sync before editing");

    expect(first.id).toBe("server-returned-id");
    expect(first.revisionDate).toBe("2026-07-15T02:00:00.000Z");
    expect(first.requiresVaultSyncBeforeEdit).toBe(true);
    expect(requestBodies).toHaveLength(1);
    expect(first.opaqueServerPayload).toMatchObject({
      Id: "original-id",
      FutureTopLevel: "2.synthetic-original-top-level",
      login: {
        URLMetadata: "2.synthetic-original-url-metadata",
        uris: [{ FutureUri: "2.synthetic-uri-future" }],
      },
      fields: [{ FutureField: "2.synthetic-field-future" }],
    });
    expect(first.opaqueServerPayload).not.toHaveProperty("ServerAddedOpaque");
    const firstLogin = requestBodies[0]["login"] as Record<string, unknown>;
    await expect(decryptEncStringToUtf8(firstLogin["password"] as string, bytesToBase64(userKey)))
      .resolves.toBe("first-password");
  });

  it.each([
    {
      name: "same-length replacement",
      response: {
        Login: {
          Uris: [
            { Uri: "2.response-c", FutureUri: "2.response-c-opaque" },
            { Uri: "2.response-b", FutureUri: "2.response-b-opaque" },
          ],
        },
      },
    },
    {
      name: "reorder",
      response: {
        Login: {
          Uris: [
            { Uri: "2.response-b", FutureUri: "2.response-b-opaque" },
            { Uri: "2.response-a", FutureUri: "2.response-a-opaque" },
          ],
        },
      },
    },
  ])("does not merge a response URI $name into the sent opaque graph", async ({ response }) => {
    const transport = {
      fetchJson: vi.fn(async () => response),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 18)));
    const item = loginItem({
      uris: [
        { id: "uri-1", uri: "https://one.example.test", matchType: "default" },
        { id: "uri-2", uri: "https://two.example.test", matchType: "default" },
      ],
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "login-opaque",
        Type: 1,
        Name: "2.synthetic-old-name",
        Login: {
          Uris: [
            { Uri: "2.synthetic-old-uri-1", FutureUri: "2.synthetic-old-future-1" },
            { Uri: "2.synthetic-old-uri-2", FutureUri: "2.synthetic-old-future-2" },
          ],
        },
      }),
    });

    const updated = await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      {
        name: "Edited",
        username: "operator",
        password: "old-password",
        totp: "",
        uri: "https://one.example.test",
        notes: "",
      },
    );

    expect(transport.fetchJson).toHaveBeenCalledOnce();
    expect(updated.opaqueServerPayload).toMatchObject({
      login: {
        uris: [
          { FutureUri: "2.synthetic-old-future-1" },
          { FutureUri: "2.synthetic-old-future-2" },
        ],
      },
    });
    expect(Object.isFrozen(updated.opaqueServerPayload)).toBe(true);
    expect(updated.requiresVaultSyncBeforeEdit).toBe(true);
    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      updated,
      {
        name: "Second edit",
        username: "operator",
        password: "old-password",
        totp: "",
        uri: "https://one.example.test",
        notes: "",
      },
    )).rejects.toThrow("Login requires vault sync before editing");
    expect(transport.fetchJson).toHaveBeenCalledOnce();
  });

  it.each([null, "ok", 7, true, ["valid-json-array"], { Login: null }, { Login: [] }])(
    "retains sent opaque state and requires sync after response %j",
    async (response) => {
      const transport = {
        fetchJson: vi.fn(async () => response),
      } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 19)));
      const item = loginItem({
        opaqueServerPayload: retainOpaqueCipherPayload({
          Id: "login-opaque",
          RevisionDate: "2026-07-14T00:00:00.000Z",
          Type: 1,
          Login: {},
          FutureOpaque: "2.synthetic-retained-after-response",
        }),
      });

      const updated = await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
        session,
        item,
        { name: "Edited", username: "operator", password: "old-password", totp: "", uri: "", notes: "" },
      );

      expect(transport.fetchJson).toHaveBeenCalledOnce();
      expect(updated.id).toBe("login-opaque");
      expect(updated.opaqueServerPayload).toMatchObject({
        Id: "login-opaque",
        FutureOpaque: "2.synthetic-retained-after-response",
      });
      expect(updated.requiresVaultSyncBeforeEdit).toBe(true);
    },
  );

  it("uses response identity only for display and does not retain response ownership", async () => {
    const transport = {
      fetchJson: vi.fn(async () => ({
        iD: "response-owned-id",
        rEvIsIoNdAtE: "2026-07-15T04:00:00.000Z",
        oRgAnIzAtIoNiD: "org-response",
        cOlLeCtIoNiDs: ["collection-response"],
      })),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 20)));
    const item = loginItem({
      id: "personal-before-response",
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "personal-before-response",
        RevisionDate: "2026-07-14T00:00:00.000Z",
        OrganizationId: null,
        CollectionIds: [],
        Type: 1,
        Login: {},
      }),
    });
    const actions = new BitwardenVaultCipherWriteActions(session, transport);

    const updated = await actions.updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "operator", password: "old-password", totp: "", uri: "", notes: "" },
    );

    expect(updated).toMatchObject({
      id: "response-owned-id",
      revisionDate: "2026-07-15T04:00:00.000Z",
      requiresVaultSyncBeforeEdit: true,
    });
    expect(updated).not.toHaveProperty("organizationId");
    expect(updated.opaqueServerPayload).not.toHaveProperty("oRgAnIzAtIoNiD");
    await expect(actions.updateLoginCipher(
      session,
      updated,
      { name: "Second", username: "operator", password: "old-password", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Login requires vault sync before editing");
    expect(transport.fetchJson).toHaveBeenCalledOnce();
  });

  it("preserves opaque Login data through transport and on the returned item", async () => {
    const userKey = sequentialBytes(64, 11);
    const opaqueValue = "2.synthetic-write-opaque-value";
    let requestBody: Record<string, unknown> | null = null;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "login-opaque", RevisionDate: "2026-07-15T01:00:00.000Z" };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(userKey));
    const item = loginItem({
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "login-opaque",
        Type: 1,
        Name: "2.synthetic-old-name",
        Attachments: [{ Id: "attachment-1", Key: opaqueValue }],
        PasswordHistory: [{ Password: "2.synthetic-history", LastUsedDate: "2026-07-01T00:00:00.000Z", Future: opaqueValue }],
        FutureTopLevel: opaqueValue,
        Login: {
          Username: "2.synthetic-old-user",
          Password: "2.synthetic-old-password",
          Fido2Credentials: [{ CredentialId: opaqueValue }],
          FutureNested: opaqueValue,
        },
      }),
    });

    const updated = await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited Login", username: "operator", password: "new-password", totp: "", uri: "", notes: "" },
    );

    expect(requestBody).toMatchObject({
      Attachments: [{ Id: "attachment-1", Key: opaqueValue }],
      FutureTopLevel: opaqueValue,
      login: {
        fido2Credentials: [{ CredentialId: opaqueValue }],
        FutureNested: opaqueValue,
      },
      passwordHistory: [
        expect.objectContaining({ password: expect.any(String) }),
        { Password: "2.synthetic-history", LastUsedDate: "2026-07-01T00:00:00.000Z", Future: opaqueValue },
      ],
    });
    expect(updated.opaqueServerPayload).toMatchObject({
      Attachments: [{ Id: "attachment-1", Key: opaqueValue }],
      FutureTopLevel: opaqueValue,
    });
    expect(Object.isFrozen(updated.opaqueServerPayload)).toBe(true);
    expect(JSON.stringify(updated).includes(opaqueValue)).toBe(true);
    expect(JSON.stringify(requestBody)).not.toContain("collectionAssociations");
  });

  it("validates a hostile opaque array before inherited collection methods can execute", async () => {
    let inheritedCalls = 0;
    const customPrototype = Object.create(Array.prototype) as object;
    for (const method of ["map", "some"]) {
      Object.defineProperty(customPrototype, method, {
        get: () => {
          inheritedCalls += 1;
          return Array.prototype[method as "map" | "some"];
        },
      });
    }
    const hostileUris = [{ Uri: "2.synthetic-uri", FutureUri: "2.synthetic-future" }];
    Object.setPrototypeOf(hostileUris, customPrototype);
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 30)));
    const item = loginItem({
      uris: [{ id: "uri-1", uri: "https://one.example.test", matchType: "default" }],
      opaqueServerPayload: {
        Id: "login-opaque",
        Login: { Uris: hostileUris },
      } as unknown as VaultItem["opaqueServerPayload"],
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      {
        name: "Edited",
        username: "operator",
        password: "old-password",
        totp: "",
        uri: "https://one.example.test",
        notes: "",
      },
    )).rejects.toThrow("Invalid opaque cipher payload");
    expect(inheritedCalls).toBe(0);
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("does not associate opaque field metadata through a NUL-delimiter collision", async () => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 29)));
    const item = loginItem({
      fields: [
        { id: "username", label: "Username", value: "operator" },
        { id: "password", label: "Password", value: "old-password", type: "hidden", concealed: true },
        { id: "custom:collision", label: "a\u0000b", value: "c", type: "text" },
      ],
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "login-opaque",
        Type: 1,
        Login: {},
        Fields: [{ Name: "2.synthetic-name", Value: "2.synthetic-value", Type: 0, Future: "2.opaque" }],
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      {
        name: "Edited",
        username: "operator",
        password: "old-password",
        totp: "",
        uri: "",
        fields: [{ name: "a", value: "b\u0000c", type: 0 }],
        notes: "",
      },
    )).rejects.toThrow("Unable to safely preserve opaque Login collection data");
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("rejects organization-owned Login edits before transport without rewriting ownership", async () => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 31)));
    const item = loginItem({
      organizationId: "org-1",
      collectionIds: ["collection-1"],
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "organization-login",
        OrganizationId: "org-1",
        CollectionIds: ["collection-1"],
        Type: 1,
        Name: "2.synthetic-name",
        Login: { Password: "2.synthetic-password" },
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Organization-owned Login editing requires an organization encryption key");
    expect(transport.fetchJson).not.toHaveBeenCalled();
    expect(item.organizationId).toBe("org-1");
  });

  it("rejects case-insensitive opaque organization ownership even when rendered ownership is absent", async () => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 32)));
    const item = loginItem({
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "organization-login",
        oRGaNiZaTiOnId: "org-opaque",
        cOLLectionIDs: ["collection-opaque"],
        Type: 1,
        Login: {},
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Organization-owned Login editing requires an organization encryption key");
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a later mixed-case duplicate is organization-owned",
      ownership: { OrganizationId: null, oRGaNiZaTiOnId: "org-later" },
    },
    {
      name: "conflicting duplicates are unsafe",
      ownership: { OrganizationId: "org-one", ORGANIZATIONID: "org-two" },
    },
    {
      name: "a malformed non-null value is unsafe",
      ownership: { organizationID: 42 },
    },
  ])("rejects $name before transport", async ({ ownership }) => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 34)));
    const item = loginItem({
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "organization-login",
        ...ownership,
        Type: 1,
        Login: {},
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Organization-owned Login editing requires an organization encryption key");
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("allows duplicate personal ownership variants when every value is null or empty", async () => {
    const transport = { fetchJson: vi.fn(async () => null) } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 35)));
    const item = loginItem({
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "personal-login",
        OrganizationId: null,
        ORGANIZATIONID: "",
        Type: 1,
        Login: {},
      }),
    });

    await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    );
    expect(transport.fetchJson).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "a nonempty opaque collection",
      collections: { CollectionIds: ["collection-opaque"] },
    },
    {
      name: "a later nonempty duplicate casing variant",
      collections: { CollectionIds: [], cOlLeCtIoNiDs: ["collection-later"] },
    },
    {
      name: "a null opaque collection value",
      collections: { CollectionIds: null },
    },
    {
      name: "a mixed-type opaque collection array",
      collections: { CollectionIds: ["collection-opaque", 42] },
    },
  ])("rejects $name before transport", async ({ collections }) => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 36)));
    const item = loginItem({
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "collection-login",
        OrganizationId: null,
        ...collections,
        Type: 1,
        Login: {},
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Collection-associated Login editing is not supported");
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("rejects rendered-only collection ownership before transport", async () => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 37)));
    const item = loginItem({ collectionIds: ["rendered-collection"] });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Collection-associated Login editing is not supported");
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("accepts and canonicalizes every empty CollectionIds variant", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return null;
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 38)));
    const item = loginItem({
      collectionIds: [],
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "personal-login",
        OrganizationId: null,
        CollectionIds: [],
        cOlLeCtIoNiDs: [],
        Type: 1,
        Login: {},
      }),
    });

    await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    );

    expect(transport.fetchJson).toHaveBeenCalledOnce();
    expect(Object.keys(requestBody ?? {}).filter((key) => key.toLowerCase() === "collectionids"))
      .toEqual(["collectionIds"]);
    expect(requestBody?.["collectionIds"]).toEqual([]);
  });

  it("rejects an over-bound merged password history before transport", async () => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 33)));
    const history = Array.from({ length: 5 }, (_, index) => ({
      password: `history-${index}`,
      lastUsedDate: `2026-07-0${5 - index}T00:00:00.000Z`,
    }));
    const item = loginItem({
      passwordHistory: history,
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "login-opaque",
        Type: 1,
        Login: {},
        PasswordHistory: [
          ...history.map((entry, index) => ({
            Password: `2.synthetic-history-${index}`,
            LastUsedDate: entry.lastUsedDate,
          })),
          { FutureHistory: "2.synthetic-unmatched-history" },
        ],
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "operator", password: "old-password", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Unable to safely preserve opaque password history");
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("fails before transport when an opaque payload is no longer JSON-representable", async () => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 51)));
    const item = loginItem({
      opaqueServerPayload: { Future: () => "2.synthetic-private" } as unknown as VaultItem["opaqueServerPayload"],
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      { name: "Edited", username: "", password: "", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Invalid opaque cipher payload");
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("creates a new personal Login without inherited opaque server identity", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "new-personal-login" };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 71)));

    const created = await new BitwardenVaultCipherWriteActions(session, transport).createLoginCipher(
      session,
      { name: "Cloned Login", username: "operator", password: "synthetic-password", totp: "", uri: "", notes: "" },
    );

    expect(requestBody).toMatchObject({ organizationId: null });
    expect(requestBody).not.toHaveProperty("Id");
    expect(requestBody).not.toHaveProperty("Attachments");
    expect(requestBody).not.toHaveProperty("CollectionIds");
    expect((requestBody?.["login"] as Record<string, unknown>)).not.toHaveProperty("fido2Credentials");
    expect(created).not.toHaveProperty("opaqueServerPayload");
    expect(created).not.toHaveProperty("organizationId");
    expect(created).not.toHaveProperty("collectionIds");
    expect(created.requiresVaultSyncBeforeEdit).toBe(true);

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      created,
      { name: "Unsynced edit", username: "operator", password: "synthetic-password", totp: "", uri: "", notes: "" },
    )).rejects.toThrow("Login requires vault sync before editing");
    expect(transport.fetchJson).toHaveBeenCalledOnce();
  });

  it.each([null, "ok", 7, true, ["valid-json-array"], { Login: null }, { Login: [] }])(
    "returns a sync-required create result after response %j",
    async (response) => {
      const transport = { fetchJson: vi.fn(async () => response) } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 72)));

      const created = await new BitwardenVaultCipherWriteActions(session, transport).createLoginCipher(
        session,
        { name: "Created Login", username: "operator", password: "secret", totp: "", uri: "", notes: "" },
      );

      expect(transport.fetchJson).toHaveBeenCalledOnce();
      expect(created.id.length).toBeGreaterThan(0);
      expect(created.requiresVaultSyncBeforeEdit).toBe(true);
    },
  );

  it.each(["missing", "throws"] as const)(
    "generates distinct pending create ids when randomUUID $mode and the clock is fixed",
    async (mode) => {
      const fallbackCrypto = {
        subtle: webcrypto.subtle,
        getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
        randomUUID: mode === "missing"
          ? undefined
          : () => { throw new Error("random UUID unavailable"); },
      } as unknown as Crypto;
      vi.stubGlobal("crypto", fallbackCrypto);
      const now = vi.spyOn(Date, "now").mockReturnValue(1_752_550_400_000);
      const transport = { fetchJson: vi.fn(async () => null) } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 73)));
      const actions = new BitwardenVaultCipherWriteActions(session, transport);
      const store = new PopupStateStore();

      try {
        const first = await actions.createLoginCipher(
          session,
          { name: "First pending", username: "first-user", password: "first-secret", totp: "", uri: "", notes: "" },
        );
        const second = await actions.createLoginCipher(
          session,
          { name: "Second pending", username: "second-user", password: "second-secret", totp: "", uri: "", notes: "" },
        );
        store.saveVaultItem(first);
        store.saveVaultItem(second);

        expect(first.id).not.toBe(second.id);
        expect(first.id).toMatch(/^pending-sync-login:\d+:\d+$/);
        expect(second.id).toMatch(/^pending-sync-login:\d+:\d+$/);
        expect(`${first.id}${second.id}`).not.toMatch(/first|second|user|secret/i);
        expect(store.snapshot().items.map((item) => item.id)).toEqual([second.id, first.id]);
      } finally {
        now.mockRestore();
      }
    },
  );

  it.each([
    {
      label: "Card",
      create: (actions: BitwardenVaultCipherWriteActions, session: AuthSession) =>
        actions.createCardCipher(session, cardDraft()),
    },
    {
      label: "Identity",
      create: (actions: BitwardenVaultCipherWriteActions, session: AuthSession) =>
        actions.createIdentityCipher(session, identityDraft()),
    },
    {
      label: "Secure Note",
      create: (actions: BitwardenVaultCipherWriteActions, session: AuthSession) =>
        actions.createSecureNoteCipher(session, noteDraft()),
    },
  ])("rejects missing or malformed server IDs for personal $label creates", async ({ create }) => {
    for (const response of [
      null,
      {},
      { Id: undefined },
      { Id: null },
      { Id: 7 },
      { Id: {} },
      { Id: "" },
      { Id: "   " },
    ]) {
      const transport = { fetchJson: vi.fn(async () => response) } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 74)));

      await expect(create(
        new BitwardenVaultCipherWriteActions(session, transport),
        session,
      )).rejects.toThrow("Missing server cipher ID");
      expect(transport.fetchJson).toHaveBeenCalledOnce();
    }
  });

  it("accepts a server cipher ID from a plain JSON response in another JavaScript realm", async () => {
    const response = runInNewContext(`JSON.parse('{"Id":"cross-realm-card-id"}')`) as unknown;
    const transport = { fetchJson: vi.fn(async () => response) } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 75)));

    const created = await new BitwardenVaultCipherWriteActions(session, transport)
      .createCardCipher(session, cardDraft());

    expect(created.id).toBe("cross-realm-card-id");
  });

  it.each([
    {
      label: "Card",
      create: (actions: BitwardenVaultCipherWriteActions, session: AuthSession) =>
        actions.createCardCipher(session, cardDraft()),
    },
    {
      label: "Identity",
      create: (actions: BitwardenVaultCipherWriteActions, session: AuthSession) =>
        actions.createIdentityCipher(session, identityDraft()),
    },
    {
      label: "Secure Note",
      create: (actions: BitwardenVaultCipherWriteActions, session: AuthSession) =>
        actions.createSecureNoteCipher(session, noteDraft()),
    },
  ])("rejects ambiguous or hostile server ID descriptors for personal $label creates", async ({ create }) => {
    for (const { response } of hostilePersonalIdResponses()) {
      const transport = { fetchJson: vi.fn(async () => response()) } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 75)));

      await expect(create(
        new BitwardenVaultCipherWriteActions(session, transport),
        session,
      )).rejects.toEqual(expect.objectContaining({
        name: "TypeError",
        message: "Missing server cipher ID",
      }));
      expect(transport.fetchJson).toHaveBeenCalledOnce();
    }
  });

  it("creates a complete typed Card without dropping common options", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const userKey = sequentialBytes(64, 21);
    let requestBody: Record<string, unknown> | null = null;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          Id: "card-complete",
          Favorite: true,
          FolderId: "travel",
          RevisionDate: "2026-07-13T02:00:00.000Z",
        };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(userKey));
    const draft = {
      name: "Complete Card",
      cardholderName: "Travel Ops",
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "04",
      expYear: "2029",
      code: "123",
      notes: "card note",
      favorite: true,
      folderId: "travel",
      reprompt: true,
      fields: [
        { name: "PIN", value: "first-secret", type: 1 },
        { name: "PIN", value: "second-secret", type: 1 },
      ],
    } as Parameters<BitwardenVaultCipherWriteActions["createCardCipher"]>[1];

    const created = await new BitwardenVaultCipherWriteActions(session, transport)
      .createCardCipher(session, draft);

    expect(requestBody).toMatchObject({
      favorite: true,
      folderId: "travel",
      reprompt: 1,
      fields: [{ type: 1 }, { type: 1 }],
    });
    const encryptedCard = (requestBody as { card: { brand: string } }).card;
    await expect(decryptEncStringToUtf8(encryptedCard.brand, bytesToBase64(userKey))).resolves.toBe(
      "Visa",
    );
    expect(created).toMatchObject({
      id: "card-complete",
      type: "card",
      favorite: true,
      reprompt: true,
      folderId: "travel",
      card: {
        cardholderName: "Travel Ops",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
      fields: expect.arrayContaining([
        expect.objectContaining({ id: "custom:0", label: "PIN", value: "first-secret" }),
        expect.objectContaining({ id: "custom:1", label: "PIN", value: "second-secret" }),
      ]),
    });
    expect(created.fields.map((field) => field.id)).toEqual([
      "brand", "cardholder-name", "number", "exp-month", "exp-year", "code", "notes",
      "custom:0", "custom:1",
    ]);
    expect(created.fields.map((field) => field.label)).toEqual([
      "品牌", "持卡人姓名", "号码", "过期月份", "过期年份", "安全码", "备注", "PIN", "PIN",
    ]);
  });

  it("creates a complete typed Identity without dropping concealed or address data", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const userKey = sequentialBytes(64, 41);
    let requestBody: Record<string, unknown> | null = null;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "identity-complete", Favorite: true, FolderId: "personal" };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(userKey));
    const draft = {
      name: "Complete Identity",
      title: "Dr",
      firstName: "Ada",
      middleName: "Augusta",
      lastName: "Lovelace",
      username: "ada",
      company: "Analytical Engines",
      ssn: "000-00-0000",
      passportNumber: "P1234567",
      licenseNumber: "L7654321",
      email: "ada@example.test",
      phone: "+44 20 0000",
      address1: "12 Engine Lane",
      address2: "Suite 2",
      address3: "Research Park",
      city: "London",
      state: "Greater London",
      postalCode: "N1 1AA",
      country: "United Kingdom",
      notes: "identity note",
      favorite: true,
      folderId: "personal",
      reprompt: true,
      fields: [{ name: "Region", value: "EU", type: 0 }],
    } as Parameters<BitwardenVaultCipherWriteActions["createIdentityCipher"]>[1];

    const created = await new BitwardenVaultCipherWriteActions(session, transport)
      .createIdentityCipher(session, draft);

    expect(requestBody).toMatchObject({
      favorite: true,
      folderId: "personal",
      reprompt: 1,
      fields: [{ type: 0 }],
    });
    expect(created).toMatchObject({
      id: "identity-complete",
      type: "identity",
      favorite: true,
      reprompt: true,
      folderId: "personal",
      identity: {
        title: "Dr",
        firstName: "Ada",
        middleName: "Augusta",
        lastName: "Lovelace",
        username: "ada",
        company: "Analytical Engines",
        ssn: "000-00-0000",
        passportNumber: "P1234567",
        licenseNumber: "L7654321",
        address2: "Suite 2",
        city: "London",
        country: "United Kingdom",
      },
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "Region", value: "EU" }),
      ]),
    });
    expect(created.fields.map((field) => field.id)).toEqual([
      "title", "first-name", "middle-name", "last-name", "full-name", "username", "company",
      "ssn", "passport-number", "license-number", "email", "phone", "address-1", "address-2",
      "address-3", "city", "state", "postal-code", "country", "address", "notes", "custom:0",
    ]);
    expect(created.fields.map((field) => field.label)).toEqual([
      "称呼", "名字", "中间名", "姓氏", "姓名", "用户名", "公司", "社会保障号码", "护照号码",
      "驾驶证号码", "电子邮箱", "电话", "地址 1", "地址 2", "地址 3", "市 / 镇", "州 / 省",
      "ZIP / 邮政编码", "国家 / 地区", "地址", "备注", "Region",
    ]);
  });

  it("creates a complete Secure Note with common options and custom fields", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const userKey = sequentialBytes(64, 61);
    let requestBody: Record<string, unknown> | null = null;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "note-complete", Favorite: true, FolderId: "personal" };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(userKey));

    const created = await new BitwardenVaultCipherWriteActions(session, transport)
      .createSecureNoteCipher(session, {
        name: "Recovery note",
        notes: "private note",
        noteType: 0,
        favorite: true,
        folderId: "personal",
        reprompt: true,
        fields: [{ name: "Region", value: "EU", type: 0 }],
      });

    expect(requestBody).toMatchObject({
      favorite: true,
      folderId: "personal",
      reprompt: 1,
      secureNote: { type: 0 },
      fields: [{ type: 0 }],
    });
    expect(created).toMatchObject({
      id: "note-complete",
      type: "secure-note",
      favorite: true,
      folderId: "personal",
      reprompt: true,
      secureNote: { type: 0 },
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "Region", value: "EU" }),
      ]),
    });
    expect(created.subtitle).toBe("备注");
    expect(created.fields.find((field) => field.id === "notes")?.label).toBe("备注");
  });

  it.each(["card", "identity", "secure-note"] as const)(
    "rejects a payload-less personal %s update before encryption or transport",
    async (type) => {
      const randomSpy = vi.spyOn(crypto, "getRandomValues");
      const transport = { fetchJson: vi.fn() } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 71)));
      const item = opaquePersonalItem(type, undefined, { opaqueServerPayload: undefined });
      const actions = new BitwardenVaultCipherWriteActions(session, transport);
      const update = type === "card"
        ? actions.updateCardCipher(session, item, cardDraft())
        : type === "identity"
          ? actions.updateIdentityCipher(session, item, identityDraft())
          : actions.updateSecureNoteCipher(session, item, noteDraft());

      await expect(update).rejects.toThrow(/fresh opaque server payload/);
      expect(randomSpy).not.toHaveBeenCalled();
      expect(transport.fetchJson).not.toHaveBeenCalled();
      randomSpy.mockRestore();
    },
  );

  it("updates a keyed Login without dropping protected metadata", async () => {
    const userKey = sequentialBytes(64, 1);
    const cipherKey = sequentialBytes(64, 101);
    const encryptedKey = await encryptBytesToEncString(
      cipherKey,
      userKey,
      (length) => sequentialBytes(length, 201),
    );
    let requestBody: Record<string, unknown> | null = null;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "login-1", RevisionDate: "2026-07-12T10:00:00.000Z" };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(userKey));
    const item: VaultItem = {
      id: "login-1",
      encryptedKey,
      type: "login",
      name: "Existing Login",
      subtitle: "operator",
      favorite: true,
      reprompt: true,
      folderId: "folder-1",
      folderName: "Operations",
      organizationName: "",
      attachmentCount: 0,
      uris: [
        { id: "uri-1", uri: "https://existing.example.test", matchType: "default" },
        { id: "uri-2", uri: "https://secondary.example.test", matchType: "1" },
      ],
      fields: [
        { id: "username", label: "Username", value: "operator" },
        { id: "password", label: "Password", value: "old-secret", type: "hidden", concealed: true },
        { id: "custom:PIN", label: "PIN", value: "1234", type: "hidden", concealed: true },
      ],
      createdDate: "2026-07-01T08:00:00.000Z",
      revisionDate: "2026-07-11T08:00:00.000Z",
      passwordRevisionDate: "2026-07-01T08:00:00.000Z",
      passwordHistory: [{ password: "older-secret", lastUsedDate: "2026-06-01T08:00:00.000Z" }],
      notes: "",
      canLaunch: true,
      canFill: true,
      uri: "https://existing.example.test",
    };

    const updated = await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      {
        name: "Updated Login",
        username: "operator",
        password: "new-secret",
        totp: "",
        uri: "https://updated.example.test",
        notes: "",
        favorite: false,
        folderId: "",
      },
    );

    expect(requestBody).toMatchObject({
      key: encryptedKey,
      reprompt: 1,
      favorite: false,
      folderId: null,
      login: { uris: [expect.any(Object), expect.any(Object)] },
      fields: [{ type: 1 }],
    });
    expect(updated).toMatchObject({
      id: "login-1",
      encryptedKey,
      reprompt: true,
      passwordRevisionDate: expect.any(String),
      passwordHistory: expect.any(Array),
      uris: [
        expect.objectContaining({ uri: "https://updated.example.test" }),
        expect.objectContaining({ uri: "https://secondary.example.test" }),
      ],
      favorite: false,
      folderId: "",
      folderName: "",
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "PIN", value: "1234", type: "hidden" }),
      ]),
    });

    const cleared = await new BitwardenVaultCipherWriteActions(session, transport).updateLoginCipher(
      session,
      item,
      {
        name: "Updated Login",
        username: "operator",
        password: "old-secret",
        totp: "",
        uri: "",
        uris: [],
        notes: "",
      },
    );

    expect(requestBody).toMatchObject({ login: { uris: [] } });
    expect(cleared.uris).toEqual([]);
    expect(cleared.uri).toBe("");
  });
});

describe("personal cipher fail-closed writes", () => {
  it.each(["card", "identity", "secure-note"] as const)(
    "preserves sent opaque %s state and ignores response-only fields",
    async (type) => {
      const userKey = sequentialBytes(64, 141);
      const cipherKey = sequentialBytes(64, 201);
      const encryptedKey = await encryptBytesToEncString(
        cipherKey,
        userKey,
        (length) => sequentialBytes(length, 31),
      );
      let requestBody: Record<string, unknown> | undefined;
      const transport = {
        fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return {
            Id: `${type}-1`,
            ServerAddedOpaque: "2.synthetic-response-only",
            RevisionDate: "2026-07-18T02:00:00.000Z",
          };
        }),
      } as unknown as HostApi;
      const session = authSession(bytesToBase64(userKey));
      const item = opaquePersonalItem(type, encryptedKey);
      const actions = new BitwardenVaultCipherWriteActions(session, transport);

      const updated = type === "card"
        ? await actions.updateCardCipher(session, item, cardDraft())
        : type === "identity"
          ? await actions.updateIdentityCipher(session, item, identityDraft())
          : await actions.updateSecureNoteCipher(session, item, noteDraft());

      expect(requestBody).toMatchObject({
        key: encryptedKey,
        Attachments: [{ FutureAttachment: "2.synthetic-attachment" }],
        fields: [{ FutureField: "2.synthetic-field" }],
        ArchivedDate: "2026-07-01T00:00:00.000Z",
        DeletedDate: null,
        FutureTopLevel: "2.synthetic-top",
        organizationId: null,
        collectionIds: [],
      });
      expect(updated.opaqueServerPayload).toEqual(requestBody);
      expect(updated.opaqueServerPayload).not.toHaveProperty("ServerAddedOpaque");
      expect(Object.isFrozen(updated.opaqueServerPayload)).toBe(true);
      expect(updated.encryptedKey).toBe(encryptedKey);
      expect(updated.collectionIds).toEqual([]);
      expect(updated.requiresVaultSyncBeforeEdit).toBe(true);
      await expect(
        decryptEncStringToUtf8(requestBody!.name as string, bytesToBase64(cipherKey)),
      ).resolves.toBe(type === "card" ? "Card" : type === "identity" ? "Identity" : "Note");
      await expect(
        decryptEncStringToUtf8(requestBody!.name as string, bytesToBase64(userKey)),
      ).rejects.toThrow();
    },
  );

  it.each(["missing", "mismatched"] as const)(
    "rejects a %s rendered key for a preserved keyed graph before encryption or transport",
    async (mode) => {
      const userKey = sequentialBytes(64, 31);
      const preservedKey = await encryptBytesToEncString(
        sequentialBytes(64, 61),
        userKey,
        (length) => sequentialBytes(length, 91),
      );
      const otherKey = await encryptBytesToEncString(
        sequentialBytes(64, 121),
        userKey,
        (length) => sequentialBytes(length, 151),
      );
      const item = opaquePersonalItem("card", preservedKey, {
        encryptedKey: mode === "missing" ? undefined : otherKey,
      });
      const randomSpy = vi.spyOn(crypto, "getRandomValues");
      const transport = { fetchJson: vi.fn() } as unknown as HostApi;
      const session = authSession(bytesToBase64(userKey));

      await expect(new BitwardenVaultCipherWriteActions(session, transport)
        .updateCardCipher(session, item, cardDraft()))
        .rejects.toThrow(/safely preserve opaque personal cipher data/);
      expect(randomSpy).not.toHaveBeenCalled();
      expect(transport.fetchJson).not.toHaveBeenCalled();
      randomSpy.mockRestore();
    },
  );

  it("does not invoke an encryptedKey accessor during personal update preflight", async () => {
    let getterCalls = 0;
    const item = opaquePersonalItem("card", "2.synthetic-preserved-key");
    Object.defineProperty(item, "encryptedKey", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalls += 1;
        return "2.synthetic-preserved-key";
      },
    });
    const randomSpy = vi.spyOn(crypto, "getRandomValues");
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 181)));

    await expect(new BitwardenVaultCipherWriteActions(session, transport)
      .updateCardCipher(session, item, cardDraft()))
      .rejects.toThrow(/safely preserve opaque personal cipher data/);
    expect(getterCalls).toBe(0);
    expect(randomSpy).not.toHaveBeenCalled();
    expect(transport.fetchJson).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it.each([
    ["card", 305],
    ["identity", 410],
  ] as const)(
    "reassociates the current page draft for linked %s fields without dropping a custom edit",
    async (type, linkedId) => {
      const userKey = sequentialBytes(64, type === "card" ? 41 : 51);
      let requestBody: Record<string, unknown> | undefined;
      const transport = {
        fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return { Id: `${type}-1` };
        }),
      } as unknown as HostApi;
      const item = opaquePersonalItem(type, undefined, {
        fields: [
          { id: "custom:linked", label: "Linked alias", value: "", type: "linked", linkedId },
          { id: "custom:region", label: "Region", value: "Old", type: "text" },
          { id: "custom:pin", label: "PIN", value: "1111", type: "hidden", concealed: true },
          { id: "custom:enabled", label: "Enabled", value: "false", type: "boolean" },
        ],
        opaqueServerPayload: retainOpaqueCipherPayload({
          ...personalOpaquePayload(type),
          Fields: [
            { Name: "2.old-linked", Value: null, Type: 3, LinkedId: linkedId, FutureField: "linked-extra" },
            { Name: "2.old-region", Value: "2.old-value", Type: 0, FutureField: "region-extra" },
            { Name: "2.old-pin", Value: "2.old-pin-value", Type: 1, FutureField: "pin-extra" },
            { Name: "2.old-enabled", Value: "2.old-enabled-value", Type: 2, FutureField: "enabled-extra" },
          ],
          OrganizationId: null,
          CollectionIds: [],
        }),
      });
      const session = authSession(bytesToBase64(userKey));
      const pageFields = [
        { name: "Linked alias", value: "", type: 0 as const },
        { name: "Region", value: "Edited", type: 0 as const },
        { name: "PIN", value: "2222", type: 1 as const },
        { name: "Enabled", value: "true", type: 2 as const },
      ];

      if (type === "card") {
        await new BitwardenVaultCipherWriteActions(session, transport).updateCardCipher(
          session,
          item,
          cardDraft({ fields: pageFields, notes: "unrelated card edit" }),
        );
      } else {
        await new BitwardenVaultCipherWriteActions(session, transport).updateIdentityCipher(
          session,
          item,
          { ...identityDraft(), fields: pageFields, notes: "unrelated identity edit" },
        );
      }

      const fields = requestBody!.fields as Array<Record<string, unknown>>;
      expect(fields).toMatchObject([
        { type: 3, linkedId, value: null, FutureField: "linked-extra" },
        { type: 0, FutureField: "region-extra" },
        { type: 1, FutureField: "pin-extra" },
        { type: 2, FutureField: "enabled-extra" },
      ]);
      await expect(decryptEncStringToUtf8(fields[0]!.name as string, bytesToBase64(userKey)))
        .resolves.toBe("Linked alias");
      await expect(decryptEncStringToUtf8(fields[1]!.value as string, bytesToBase64(userKey)))
        .resolves.toBe("Edited");
      await expect(decryptEncStringToUtf8(fields[2]!.value as string, bytesToBase64(userKey)))
        .resolves.toBe("2222");
      await expect(decryptEncStringToUtf8(fields[3]!.value as string, bytesToBase64(userKey)))
        .resolves.toBe("true");
    },
  );

  it("rejects a current-page Secure Note draft that would downgrade a linked field", async () => {
    const item = opaquePersonalItem("secure-note", undefined, {
      fields: [{ id: "custom:linked", label: "Linked alias", value: "", type: "linked", linkedId: 305 }],
      opaqueServerPayload: retainOpaqueCipherPayload({
        ...personalOpaquePayload("secure-note"),
        Fields: [{ Name: "2.old-linked", Value: null, Type: 3, LinkedId: 305, FutureField: "linked-extra" }],
        OrganizationId: null,
        CollectionIds: [],
      }),
    });
    const randomSpy = vi.spyOn(crypto, "getRandomValues");
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 61)));

    await expect(new BitwardenVaultCipherWriteActions(session, transport).updateSecureNoteCipher(
      session,
      item,
      { ...noteDraft(), fields: [{ name: "Linked alias", value: "", type: 0 }] },
    )).rejects.toThrow("Linked field target is not valid for this personal cipher type");
    expect(randomSpy).not.toHaveBeenCalled();
    expect(transport.fetchJson).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it.each(["card", "identity", "secure-note"] as const)(
    "rejects organization and collection-owned %s edits before encryption or transport",
    async (type) => {
      const randomSpy = vi.spyOn(crypto, "getRandomValues");
      const transport = { fetchJson: vi.fn() } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 81)));
      const actions = new BitwardenVaultCipherWriteActions(session, transport);
      const organizationItem = opaquePersonalItem(type, undefined, {
        organizationId: "org-1",
        opaqueServerPayload: retainOpaqueCipherPayload({
          ...personalOpaquePayload(type), OrganizationId: "org-1", CollectionIds: [],
        }),
      });
      const collectionItem = opaquePersonalItem(type, undefined, {
        collectionIds: ["collection-1"],
        opaqueServerPayload: retainOpaqueCipherPayload({
          ...personalOpaquePayload(type), OrganizationId: null, CollectionIds: ["collection-1"],
        }),
      });
      const update = (item: VaultItem) => type === "card"
        ? actions.updateCardCipher(session, item, cardDraft())
        : type === "identity"
          ? actions.updateIdentityCipher(session, item, identityDraft())
          : actions.updateSecureNoteCipher(session, item, noteDraft());

      await expect(update(organizationItem)).rejects.toThrow(/Organization-owned/);
      await expect(update(collectionItem)).rejects.toThrow(/Collection-associated/);
      expect(randomSpy).not.toHaveBeenCalled();
      expect(transport.fetchJson).not.toHaveBeenCalled();
      randomSpy.mockRestore();
    },
  );

  it("accepts only null and empty duplicate personal ownership variants and canonicalizes them", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const transport = {
      fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { Id: "card-1" };
      }),
    } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 101)));
    const item = opaquePersonalItem("card", undefined, {
      collectionIds: [],
      opaqueServerPayload: retainOpaqueCipherPayload({
        ...personalOpaquePayload("card"),
        OrganizationId: null,
        organizationID: null,
        CollectionIds: [],
        cOlLeCtIoNiDs: [],
      }),
    });

    await new BitwardenVaultCipherWriteActions(session, transport)
      .updateCardCipher(session, item, cardDraft());

    expect(Object.keys(requestBody ?? {}).filter((key) => key.toLowerCase() === "organizationid"))
      .toEqual(["organizationId"]);
    expect(Object.keys(requestBody ?? {}).filter((key) => key.toLowerCase() === "collectionids"))
      .toEqual(["collectionIds"]);
  });

  it.each([
    ["wrong type object", { Type: 3, Identity: {}, Fields: [] }],
    ["duplicate type object", { Type: 3, Card: {}, cArD: {}, Fields: [] }],
  ])("rejects a %s before encryption or transport", async (_label, invalidPayload) => {
    const randomSpy = vi.spyOn(crypto, "getRandomValues");
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 111)));
    const item = opaquePersonalItem("card", undefined, {
      opaqueServerPayload: retainOpaqueCipherPayload({
        ...invalidPayload,
        OrganizationId: null,
        CollectionIds: [],
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport)
      .updateCardCipher(session, item, cardDraft()))
      .rejects.toThrow(/safely preserve opaque personal cipher data/);
    expect(randomSpy).not.toHaveBeenCalled();
    expect(transport.fetchJson).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it.each([
    ["same-length replacement", () => opaquePersonalItem("card", undefined, {
      fields: [{ id: "custom:0", label: "Changed", value: "Changed", type: "text" }],
    })],
    ["duplicate signatures", () => opaquePersonalItem("card", undefined, {
      fields: [
        { id: "custom:0", label: "Label", value: "Value", type: "text" },
        { id: "custom:1", label: "Label", value: "Value", type: "text" },
      ],
      opaqueServerPayload: retainOpaqueCipherPayload({
        ...personalOpaquePayload("card"),
        Fields: [
          { Name: "2.old-name", Value: "2.old-value", Type: 0, FutureField: "2.synthetic-one" },
          { Name: "2.old-name-2", Value: "2.old-value-2", Type: 0, FutureField: "2.synthetic-two" },
        ],
      }),
    })],
  ])("rejects ambiguous opaque fields from a %s before transport", async (_label, itemFactory) => {
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 121)));

    await expect(new BitwardenVaultCipherWriteActions(session, transport)
      .updateCardCipher(session, itemFactory(), cardDraft({
        fields: [{ name: "replacement", value: "replacement", type: 0 }],
      }))).rejects.toThrow(/safely preserve opaque personal cipher fields/);
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("rejects a unique-label opaque field swap before encryption or transport", async () => {
    const randomSpy = vi.spyOn(crypto, "getRandomValues");
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 126)));
    const item = opaquePersonalItem("card", undefined, {
      fields: [
        { id: "custom:0", label: "A", value: "value-A", type: "text" },
        { id: "custom:1", label: "B", value: "value-B", type: "text" },
      ],
      opaqueServerPayload: retainOpaqueCipherPayload({
        ...personalOpaquePayload("card"),
        Fields: [
          { Name: "2.old-A", Value: "2.old-value-A", Type: 0, FutureField: "extra-A" },
          { Name: "2.old-B", Value: "2.old-value-B", Type: 0, FutureField: "extra-B" },
        ],
        OrganizationId: null,
        CollectionIds: [],
      }),
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport)
      .updateCardCipher(session, item, cardDraft({
        fields: [
          { name: "B", value: "value-B", type: 0 },
          { name: "A", value: "value-A", type: 0 },
        ],
      }))).rejects.toThrow(/safely preserve opaque personal cipher fields/);
    expect(randomSpy).not.toHaveBeenCalled();
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it("uses structured field association for delimiter-colliding tuples", async () => {
    const original = ["a\0b", "c", 0] as const;
    const edited = ["a", "b\0c", 0] as const;
    expect(original.join("\0")).toBe(edited.join("\0"));
    expect(original).not.toEqual(edited);

    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 131)));
    const item = opaquePersonalItem("card", undefined, {
      fields: [{ id: "custom:0", label: original[0], value: original[1], type: "text" }],
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport)
      .updateCardCipher(session, item, cardDraft({
        fields: [{ name: edited[0], value: edited[1], type: edited[2] }],
      }))).rejects.toThrow(/safely preserve opaque personal cipher fields/);
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    ["inherited getter", () => Object.create(Object.defineProperty({}, "Future", { get: () => "secret" }))],
    ["cycle", () => { const value: Record<string, unknown> = {}; value["self"] = value; return value; }],
    ["function", () => ({ Future: () => "secret" })],
    ["symbol", () => ({ Future: Symbol("secret") })],
    ["non-finite number", () => ({ Future: Number.POSITIVE_INFINITY })],
  ])("rejects hostile %s payloads before transport", async (_label, hostile) => {
    const randomSpy = vi.spyOn(crypto, "getRandomValues");
    const transport = { fetchJson: vi.fn() } as unknown as HostApi;
    const session = authSession(bytesToBase64(sequentialBytes(64, 151)));
    const item = opaquePersonalItem("card", undefined, {
      opaqueServerPayload: hostile() as VaultItem["opaqueServerPayload"],
    });

    await expect(new BitwardenVaultCipherWriteActions(session, transport)
      .updateCardCipher(session, item, cardDraft())).rejects.toThrow("Invalid opaque cipher payload");
    expect(randomSpy).not.toHaveBeenCalled();
    expect(transport.fetchJson).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it.each(["card", "identity", "secure-note"] as const)(
    "retains the existing %s identity for hostile update response IDs",
    async (type) => {
      let accessorCalls = 0;
      const accessorResponse = Object.defineProperty({}, "Id", {
        enumerable: true,
        get: () => {
          accessorCalls += 1;
          return "attacker-accessor";
        },
      });
      const customPrototypeResponse = Object.assign(Object.create({ inherited: true }), {
        Id: "attacker-prototype",
      });
      const responses = [
        { Id: "attacker-mismatch" },
        { Id: `${type}-1`, iD: "attacker-duplicate" },
        accessorResponse,
        customPrototypeResponse,
      ];
      const session = authSession(bytesToBase64(sequentialBytes(64, 161)));

      for (const response of responses) {
        const transport = { fetchJson: vi.fn(async () => response) } as unknown as HostApi;
        const item = opaquePersonalItem(type);
        const actions = new BitwardenVaultCipherWriteActions(session, transport);
        const updated = type === "card"
          ? await actions.updateCardCipher(session, item, cardDraft())
          : type === "identity"
            ? await actions.updateIdentityCipher(session, item, identityDraft())
            : await actions.updateSecureNoteCipher(session, item, noteDraft());
        const store = new PopupStateStore();
        store.setItems([item]);
        store.saveVaultItem(updated);

        expect(updated.id).toBe(item.id);
        expect(updated.requiresVaultSyncBeforeEdit).toBe(true);
        expect(store.snapshot().items.map((entry) => entry.id)).toEqual([item.id]);
      }
      expect(accessorCalls).toBe(0);
    },
  );

  it.each(["card", "identity", "secure-note"] as const)(
    "creates a stripped personal %s request and sync-required result",
    async (type) => {
      let requestBody: Record<string, unknown> | undefined;
      const transport = {
        fetchJson: vi.fn(async (_url: string, init: RequestInit) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return { Id: `${type}-created`, ServerAddedOpaque: "ignored" };
        }),
      } as unknown as HostApi;
      const session = authSession(bytesToBase64(sequentialBytes(64, 171)));
      const actions = new BitwardenVaultCipherWriteActions(session, transport);
      const created = type === "card"
        ? await actions.createCardCipher(session, cardDraft())
        : type === "identity"
          ? await actions.createIdentityCipher(session, identityDraft())
          : await actions.createSecureNoteCipher(session, noteDraft());

      expect(requestBody).toMatchObject({ organizationId: null });
      expect(requestBody).not.toHaveProperty("id");
      expect(requestBody).not.toHaveProperty("key");
      expect(requestBody).not.toHaveProperty("attachments");
      expect(requestBody).not.toHaveProperty("ArchivedDate");
      expect(requestBody).not.toHaveProperty("DeletedDate");
      expect(created).not.toHaveProperty("opaqueServerPayload");
      expect(created).not.toHaveProperty("encryptedKey");
      expect(created).not.toHaveProperty("organizationId");
      expect(created.requiresVaultSyncBeforeEdit).toBe(true);
    },
  );
});

function authSession(userKeyB64: string): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    crypto: { userKeyB64 },
  };
}

function personalOpaquePayload(type: "card" | "identity" | "secure-note") {
  return {
    Id: `${type}-1`,
    Type: type === "card" ? 3 : type === "identity" ? 4 : 2,
    Fields: [{ Name: "2.old-name", Value: "2.old-value", Type: 0, FutureField: "2.synthetic-field" }],
    Attachments: [{ Id: "attachment-1", FutureAttachment: "2.synthetic-attachment" }],
    ArchivedDate: "2026-07-01T00:00:00.000Z",
    DeletedDate: null,
    FutureTopLevel: "2.synthetic-top",
    ...(type === "card" ? { Card: { Number: "2.old-number", FutureCard: "2.synthetic-card" } } : {}),
    ...(type === "identity" ? { Identity: { FirstName: "2.old-first", FutureIdentity: "2.synthetic-identity" } } : {}),
    ...(type === "secure-note" ? { SecureNote: { Type: 0, FutureNote: "2.synthetic-note" } } : {}),
  };
}

function opaquePersonalItem(
  type: "card" | "identity" | "secure-note",
  encryptedKey?: string,
  overrides: Partial<VaultItem> = {},
): VaultItem {
  return personalItem({
    id: `${type}-1`,
    type,
    ...(encryptedKey ? { encryptedKey } : {}),
    collectionIds: [],
    opaqueServerPayload: retainOpaqueCipherPayload({
      ...personalOpaquePayload(type),
      ...(encryptedKey ? { Key: encryptedKey } : {}),
      OrganizationId: null,
      CollectionIds: [],
    }),
    fields: [{ id: "custom:0", label: "Label", value: "Value", type: "text" }],
    ...(type === "card" ? { card: { cardholderName: "Ada", brand: "Visa", number: "4111", expMonth: "04", expYear: "2029", code: "123" } } : {}),
    ...(type === "identity" ? { identity: { title: "", firstName: "Ada", middleName: "", lastName: "Lovelace", username: "", company: "", ssn: "", passportNumber: "", licenseNumber: "", email: "ada@example.test", phone: "", address1: "", address2: "", address3: "", city: "", state: "", postalCode: "", country: "" } } : {}),
    ...(type === "secure-note" ? { secureNote: { type: 0 } } : {}),
    ...overrides,
  });
}

function hostilePersonalIdResponses(): readonly {
  readonly response: () => unknown;
}[] {
  return [
    { response: () => ({ Id: "same-id", iD: "same-id" }) },
    { response: () => ({ iD: "first-id", Id: "second-id" }) },
    {
      response: () => Object.assign(
        Object.create({ Id: "inherited-id" }) as object,
        { RevisionDate: "2026-07-18T00:00:00.000Z" },
      ),
    },
    {
      response: () => {
        const result = {};
        Object.defineProperty(result, "Id", {
          get: () => "accessor-id",
          enumerable: true,
        });
        return result;
      },
    },
    {
      response: () => {
        const result = {};
        Object.defineProperty(result, "Id", {
          get: () => "hidden-accessor-id",
          enumerable: false,
        });
        return result;
      },
    },
    {
      response: () => {
        const result = { Id: "symbol-bearing-id" } as Record<PropertyKey, unknown>;
        result[Symbol("private-response-field")] = "private-value";
        return result;
      },
    },
    {
      response: () => new Proxy({ Id: "own-keys-id" }, {
        ownKeys: () => { throw new Error("private ownKeys failure"); },
      }),
    },
    {
      response: () => new Proxy({ Id: "descriptor-id" }, {
        getOwnPropertyDescriptor: () => { throw new Error("private descriptor failure"); },
      }),
    },
    {
      response: () => new Proxy({ Id: "prototype-id" }, {
        getPrototypeOf: () => { throw new Error("private prototype failure"); },
      }),
    },
  ];
}

function cardDraft(overrides: Record<string, unknown> = {}) {
  return { name: "Card", cardholderName: "Ada", brand: "Visa", number: "4111", expMonth: "04", expYear: "2029", code: "123", notes: "", fields: [{ name: "Label", value: "Value", type: 0 as const }], ...overrides };
}

function identityDraft() {
  return { name: "Identity", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "", address1: "", notes: "", fields: [{ name: "Label", value: "Value", type: 0 as const }] };
}

function noteDraft() {
  return { name: "Note", notes: "private", noteType: 0, fields: [{ name: "Label", value: "Value", type: 0 as const }] };
}

function loginItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "login-opaque",
    type: "login",
    name: "Existing Login",
    subtitle: "operator",
    favorite: false,
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [
      { id: "username", label: "Username", value: "operator" },
      { id: "password", label: "Password", value: "old-password", type: "hidden", concealed: true },
    ],
    createdDate: "2026-07-01T00:00:00.000Z",
    revisionDate: "2026-07-14T00:00:00.000Z",
    passwordHistory: [{ password: "history-password", lastUsedDate: "2026-07-01T00:00:00.000Z" }],
    notes: "",
    canLaunch: false,
    canFill: true,
    uri: "",
    ...overrides,
  };
}

function personalItem(overrides: Partial<VaultItem> & Pick<VaultItem, "id" | "type">): VaultItem {
  return {
    id: overrides.id,
    type: overrides.type,
    name: "Existing personal item",
    subtitle: "",
    favorite: false,
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [],
    createdDate: "2026-07-01T00:00:00.000Z",
    revisionDate: "2026-07-14T00:00:00.000Z",
    notes: "",
    canLaunch: false,
    canFill: false,
    uri: "",
    ...overrides,
  };
}

function sequentialBytes(length: number, start: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256);
}
