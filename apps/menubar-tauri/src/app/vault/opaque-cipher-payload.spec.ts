import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import type { LoginCipherCreateRequest } from "../../bitwarden-api/bitwarden-api";
import {
  mergePreservedCipherUpdate,
  mergePreservedLoginUpdate,
  retainOpaqueCipherPayload,
} from "./opaque-cipher-payload";
import * as opaqueCipherPayloadModule from "./opaque-cipher-payload";

const encrypted = (label: string) => `2.synthetic-${label}`;

describe("retainOpaqueCipherPayload", () => {
  it("retains plain JSON records created in another JavaScript realm", () => {
    const source = runInNewContext(
      `JSON.parse('{"Type":1,"Name":"encrypted-name","Login":{"Username":"encrypted-user"},"Fields":[]}')`,
    ) as unknown;

    const retained = retainOpaqueCipherPayload(source);

    expect(retained).toEqual({
      Type: 1,
      Name: "encrypted-name",
      Login: { Username: "encrypted-user" },
      Fields: [],
    });
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained["Login"])).toBe(true);
  });

  it("retains an own __proto__ data key without polluting any prototype", () => {
    const source = JSON.parse(
      `{"__proto__":{"Polluted":"${encrypted("prototype")}"},"Login":{"URLMetadata":"${encrypted("url-metadata")}"}}`,
    ) as unknown;

    const retained = retainOpaqueCipherPayload(source);

    expect(Object.getPrototypeOf(retained)).toBeNull();
    expect(Object.hasOwn(retained, "__proto__")).toBe(true);
    expect(retained["__proto__"]).toEqual({ Polluted: encrypted("prototype") });
    expect(({} as Record<string, unknown>)["Polluted"]).toBeUndefined();
  });

  it("rejects a custom array prototype without invoking inherited map", () => {
    let inheritedMapReads = 0;
    const customPrototype = Object.create(Array.prototype) as object;
    Object.defineProperty(customPrototype, "map", {
      get: () => {
        inheritedMapReads += 1;
        return () => [];
      },
    });
    const hostileArray = [encrypted("array-value")];
    Object.setPrototypeOf(hostileArray, customPrototype);

    expect(() => retainOpaqueCipherPayload({ hostileArray })).toThrowError(
      "Invalid opaque cipher payload",
    );
    expect(inheritedMapReads).toBe(0);
  });

  it("rejects nested accessors without executing them", () => {
    let accessorReads = 0;
    const nested = Object.defineProperty({}, "Secret", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return encrypted("accessor");
      },
    });

    expect(() => retainOpaqueCipherPayload({ Login: nested })).toThrowError(
      "Invalid opaque cipher payload",
    );
    expect(accessorReads).toBe(0);
  });

  it("deep-clones and freezes every retained JSON node", () => {
    const source = {
      Attachments: [{ Id: "attachment-1", Key: encrypted("attachment-key") }],
      Login: {
        Fido2Credentials: [{ CredentialId: encrypted("credential") }],
      },
    };

    const retained = retainOpaqueCipherPayload(source);

    expect(retained).toEqual(source);
    expect(retained).not.toBe(source);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained["Attachments"])).toBe(true);
    expect(Object.isFrozen((retained["Attachments"] as readonly unknown[])[0])).toBe(true);
    expect(Object.isFrozen(retained["Login"])).toBe(true);

    source.Attachments[0].Key = encrypted("mutated");
    expect(retained).toEqual({
      Attachments: [{ Id: "attachment-1", Key: encrypted("attachment-key") }],
      Login: {
        Fido2Credentials: [{ CredentialId: encrypted("credential") }],
      },
    });
  });

  it.each([
    ["non-record root", []],
    ["custom prototype", Object.create({ inherited: encrypted("value") })],
    ["function", { value: () => encrypted("value") }],
    ["symbol", { value: Symbol("opaque") }],
    ["bigint", { value: 1n }],
    ["undefined", { value: undefined }],
    ["non-finite number", { value: Number.NaN }],
    ["sparse array", { value: new Array(1) }],
    ["accessor", Object.defineProperty({}, "value", { enumerable: true, get: () => encrypted("value") })],
  ])("rejects %s without reading or coercing it", (_label, source) => {
    expect(() => retainOpaqueCipherPayload(source)).toThrowError("Invalid opaque cipher payload");
  });
});

describe("mergePreservedLoginUpdate", () => {
  it("drops stale aggregate data when legacy Login fields are re-encrypted", () => {
    const update = mergePreservedLoginUpdate(
      retainOpaqueCipherPayload({
        Type: 1,
        Data: encrypted("stale-aggregate-data"),
        Name: encrypted("old-name"),
        Login: { Username: encrypted("old-username") },
      }),
      loginRequest({
        name: encrypted("edited-name"),
        login: {
          ...loginRequest().login,
          username: encrypted("edited-username"),
        },
      }),
      personalOwnership,
    );

    expect(Object.keys(update).some((key) => key.toLowerCase() === "data")).toBe(false);
  });

  it("keeps linked-field metadata inside the existing opaque Login association boundary", () => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      Fields: [{
        Name: encrypted("linked-name"),
        Value: null,
        Type: 3,
        LinkedId: 100,
      }],
    });
    const edited = loginRequest({
      fields: [{ name: encrypted("edited-name"), value: encrypted("edited-value"), type: 0 }],
    });

    expect(() => mergePreservedLoginUpdate(preserved, edited, personalOwnership)).toThrowError(
      "Unable to safely preserve opaque Login collection data",
    );
  });

  it.each([
    ["zero", [], []],
    [
      "one",
      [{ Password: encrypted("old-1"), LastUsedDate: "2026-07-01T00:00:00.000Z", Future: encrypted("future-1") }],
      [{ password: encrypted("reencrypted-1"), lastUsedDate: "2026-07-01T00:00:00.000Z" }],
    ],
    [
      "multiple",
      [
        { Password: encrypted("old-2"), LastUsedDate: "2026-07-02T00:00:00.000Z", Future: encrypted("future-2") },
        { Password: encrypted("old-1"), LastUsedDate: "2026-07-01T00:00:00.000Z", Future: encrypted("future-1") },
      ],
      [
        { password: encrypted("reencrypted-2"), lastUsedDate: "2026-07-02T00:00:00.000Z" },
        { password: encrypted("reencrypted-1"), lastUsedDate: "2026-07-01T00:00:00.000Z" },
      ],
    ],
  ])("preserves an unchanged %s-entry password history", (_label, sourceHistory, editedHistory) => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      PasswordHistory: sourceHistory,
    });

    const update = mergePreservedLoginUpdate(
      preserved,
      loginRequest({ passwordHistory: editedHistory }),
      personalOwnership,
    );

    expect(update.passwordHistory).toEqual(sourceHistory);
  });

  it("recognizes a real prepend to an empty password history", () => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      PasswordHistory: [],
    });
    const inserted = {
      password: encrypted("new-entry"),
      lastUsedDate: "2026-07-03T00:00:00.000Z",
    };

    const update = mergePreservedLoginUpdate(
      preserved,
      loginRequest({ passwordHistory: [inserted] }),
      personalOwnership,
    );

    expect(update.passwordHistory).toEqual([inserted]);
  });

  it("preserves five unchanged entries when password-change context is explicit", () => {
    const sourceHistory = Array.from({ length: 5 }, (_, index) => ({
      Password: encrypted(`old-${index}`),
      LastUsedDate: `2026-07-0${5 - index}T00:00:00.000Z`,
      Future: encrypted(`future-${index}`),
    }));
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      PasswordHistory: sourceHistory,
    });

    const update = mergePreservedLoginUpdate(
      preserved,
      loginRequest({
        passwordHistory: sourceHistory.map((entry, index) => ({
          password: encrypted(`reencrypted-${index}`),
          lastUsedDate: entry.LastUsedDate,
        })),
      }),
      personalOwnership,
      { passwordChanged: false },
    );

    expect(update.passwordHistory).toEqual(sourceHistory);
  });

  it("rejects an over-bound password history with unmatched opaque entries", () => {
    const unmatched = { FutureHistory: encrypted("unmatched") };
    const sourceHistory = [
      ...Array.from({ length: 5 }, (_, index) => ({
        Password: encrypted(`old-${index}`),
        LastUsedDate: `2026-07-0${5 - index}T00:00:00.000Z`,
        Future: encrypted(`future-${index}`),
      })),
      unmatched,
    ];
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      PasswordHistory: sourceHistory,
    });
    const inserted = { password: encrypted("inserted"), lastUsedDate: "2026-07-06T00:00:00.000Z" };

    expect(() => mergePreservedLoginUpdate(
      preserved,
      loginRequest({
        passwordHistory: [
          inserted,
          ...sourceHistory.slice(0, 4).map((entry, index) => ({
            password: encrypted(`reencrypted-${index}`),
            lastUsedDate: "LastUsedDate" in entry ? entry.LastUsedDate : "",
          })),
        ],
      }),
      personalOwnership,
      { passwordChanged: true },
    )).toThrowError("Unable to safely preserve opaque password history");
  });

  it("merges edited URI and field properties into retained records without dropping nested data", () => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {
        Uris: [{
          Uri: encrypted("old-uri"),
          Match: 1,
          UriChecksum: encrypted("uri-checksum"),
          FutureUri: { Blob: encrypted("future-uri") },
        }],
      },
      Fields: [{
        Name: encrypted("old-field-name"),
        Value: encrypted("old-field-value"),
        Type: 0,
        FutureField: { Blob: encrypted("future-field") },
      }],
    });
    const edited = loginRequest({
      login: {
        ...loginRequest().login,
        uris: [{ uri: encrypted("edited-uri"), match: 2 }],
      },
      fields: [{
        name: encrypted("edited-field-name"),
        value: encrypted("edited-field-value"),
        type: 1,
      }],
    });

    const update = mergePreservedLoginUpdate(preserved, edited, personalOwnership, {
      passwordChanged: false,
      collectionAssociations: { uris: [0], fields: [0] },
    });

    expect(update.login.uris[0]).toEqual({
      uri: encrypted("edited-uri"),
      match: 2,
      uriChecksum: encrypted("uri-checksum"),
      FutureUri: { Blob: encrypted("future-uri") },
    });
    expect(Object.keys(update.login).filter((key) => key.toLowerCase() === "uris")).toEqual(["uris"]);
    expect(update.fields[0]).toEqual({
      name: encrypted("edited-field-name"),
      value: encrypted("edited-field-value"),
      type: 1,
      FutureField: { Blob: encrypted("future-field") },
    });
  });

  it("reassociates opaque URI and field metadata only through supplied proven mappings", () => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {
        Uris: [
          { Uri: encrypted("old-a"), Match: null, FutureUri: encrypted("future-a") },
          { Uri: encrypted("old-b"), Match: 1, FutureUri: encrypted("future-b") },
        ],
      },
      Fields: [
        { Name: encrypted("field-a"), Value: encrypted("value-a"), Type: 0, FutureField: encrypted("field-future-a") },
        { Name: encrypted("field-b"), Value: encrypted("value-b"), Type: 1, FutureField: encrypted("field-future-b") },
      ],
    });
    const edited = loginRequest({
      login: {
        ...loginRequest().login,
        uris: [
          { uri: encrypted("new-b"), match: 1 },
          { uri: encrypted("new-a"), match: null },
        ],
      },
      fields: [
        { name: encrypted("new-field-b"), value: encrypted("new-value-b"), type: 1 },
        { name: encrypted("new-field-a"), value: encrypted("new-value-a"), type: 0 },
      ],
    });

    const update = mergePreservedLoginUpdate(preserved, edited, personalOwnership, {
      passwordChanged: false,
      collectionAssociations: { uris: [1, 0], fields: [1, 0] },
    });

    expect(update.login.uris).toEqual([
      { uri: encrypted("new-b"), match: 1, FutureUri: encrypted("future-b") },
      { uri: encrypted("new-a"), match: null, FutureUri: encrypted("future-a") },
    ]);
    expect(update.fields).toEqual([
      { name: encrypted("new-field-b"), value: encrypted("new-value-b"), type: 1, FutureField: encrypted("field-future-b") },
      { name: encrypted("new-field-a"), value: encrypted("new-value-a"), type: 0, FutureField: encrypted("field-future-a") },
    ]);
  });

  it("allows arbitrary URI and field length changes when retained records have no opaque extras", () => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: { Uris: [{ Uri: encrypted("old-uri"), Match: null }] },
      Fields: [{ Name: encrypted("old-field"), Value: encrypted("old-value"), Type: 0 }],
    });
    const edited = loginRequest({
      login: {
        ...loginRequest().login,
        uris: [
          { uri: encrypted("new-uri-1"), match: null },
          { uri: encrypted("new-uri-2"), match: 1 },
        ],
      },
      fields: [],
    });

    const update = mergePreservedLoginUpdate(preserved, edited, personalOwnership);

    expect(update.login.uris).toEqual(edited.login.uris);
    expect(update.fields).toEqual([]);
  });

  it("preserves unknown acronym spelling and canonicalizes only known Login protocol keys", () => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {
        Fido2Credentials: [{ CredentialId: encrypted("credential") }],
        URLMetadata: { Blob: encrypted("url-metadata") },
      },
    });

    const update = mergePreservedLoginUpdate(preserved, loginRequest(), personalOwnership);

    expect(Object.hasOwn(update.login, "fido2Credentials")).toBe(true);
    expect(Object.hasOwn(update.login, "URLMetadata")).toBe(true);
    expect(Object.hasOwn(update.login, "uRLMetadata")).toBe(false);
  });

  it.each([
    ["URI insertion", { uriCount: 2, fieldCount: 1 }],
    ["field deletion", { uriCount: 1, fieldCount: 0 }],
  ])("rejects ambiguous %s instead of dropping or misattaching opaque data", (_label, counts) => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: { Uris: [{ Uri: encrypted("old-uri"), FutureUri: encrypted("future-uri") }] },
      Fields: [{ Name: encrypted("old-field"), Value: encrypted("old-value"), Type: 0, FutureField: encrypted("future-field") }],
    });
    const edited = loginRequest({
      login: {
        ...loginRequest().login,
        uris: Array.from({ length: counts.uriCount }, (_, index) => ({
          uri: encrypted(`edited-uri-${index}`),
          match: null,
        })),
      },
      fields: Array.from({ length: counts.fieldCount }, (_, index) => ({
        name: encrypted(`edited-field-${index}`),
        value: encrypted(`edited-value-${index}`),
        type: 0 as const,
      })),
    });

    expect(() => mergePreservedLoginUpdate(preserved, edited, personalOwnership)).toThrowError(
      "Unable to safely preserve opaque Login collection data",
    );
  });

  it("preserves unmatched opaque password-history records", () => {
    const opaqueHistory = { FutureHistory: encrypted("opaque-history") };
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      PasswordHistory: [
        { Password: encrypted("old-history"), LastUsedDate: "2026-07-01T00:00:00.000Z", Future: encrypted("history-future") },
        opaqueHistory,
      ],
    });
    const edited = loginRequest({
      passwordHistory: [{
        password: encrypted("history-reencrypted"),
        lastUsedDate: "2026-07-01T00:00:00.000Z",
      }],
    });

    const update = mergePreservedLoginUpdate(preserved, edited, personalOwnership);

    expect(update.passwordHistory).toEqual([
      { Password: encrypted("old-history"), LastUsedDate: "2026-07-01T00:00:00.000Z", Future: encrypted("history-future") },
      opaqueHistory,
    ]);
  });

  it("recognizes an unambiguous newly inserted password-history entry", () => {
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      PasswordHistory: [
        { Password: encrypted("old-1"), LastUsedDate: "2026-07-02T00:00:00.000Z", Future: encrypted("future-1") },
        { Password: encrypted("old-2"), LastUsedDate: "2026-07-01T00:00:00.000Z", Future: encrypted("future-2") },
      ],
    });
    const inserted = { password: encrypted("new-entry"), lastUsedDate: "2026-07-03T00:00:00.000Z" };
    const edited = loginRequest({
      passwordHistory: [
        inserted,
        { password: encrypted("old-1-reencrypted"), lastUsedDate: "2026-07-02T00:00:00.000Z" },
        { password: encrypted("old-2-reencrypted"), lastUsedDate: "2026-07-01T00:00:00.000Z" },
      ],
    });

    const update = mergePreservedLoginUpdate(preserved, edited, personalOwnership);

    expect(update.passwordHistory).toEqual([
      inserted,
      { Password: encrypted("old-1"), LastUsedDate: "2026-07-02T00:00:00.000Z", Future: encrypted("future-1") },
      { Password: encrypted("old-2"), LastUsedDate: "2026-07-01T00:00:00.000Z", Future: encrypted("future-2") },
    ]);
  });

  it("preserves a newly inserted password-history entry when its timestamp collides", () => {
    const collisionDate = "2026-07-01T00:00:00.000Z";
    const preserved = retainOpaqueCipherPayload({
      Type: 1,
      Name: encrypted("old-name"),
      Login: {},
      PasswordHistory: [{ Password: encrypted("old"), LastUsedDate: collisionDate, Future: encrypted("future") }],
    });
    const inserted = { password: encrypted("new-collision"), lastUsedDate: collisionDate };
    const edited = loginRequest({
      passwordHistory: [
        inserted,
        { password: encrypted("old-reencrypted"), lastUsedDate: collisionDate },
      ],
    });

    const update = mergePreservedLoginUpdate(preserved, edited, personalOwnership);

    expect(update.passwordHistory).toEqual([
      inserted,
      { Password: encrypted("old"), LastUsedDate: collisionDate, Future: encrypted("future") },
    ]);
  });

  it("preserves unsupported encrypted values while canonical edited fields and ownership win", () => {
    const source = {
      Id: "server-login-1",
      Type: 1,
      type: 99,
      OrganizationId: "old-org",
      CollectionIds: ["old-collection"],
      Key: encrypted("cipher-key"),
      Name: encrypted("old-name"),
      name: encrypted("duplicate-old-name"),
      Attachments: [{ Id: "attachment-1", Key: encrypted("attachment-key"), Future: encrypted("attachment-future") }],
      PasswordHistory: [{ Password: encrypted("history"), LastUsedDate: "2026-07-01T00:00:00.000Z", Future: encrypted("history-future") }],
      FutureTopLevel: { Blob: encrypted("top-level") },
      Login: {
        Username: encrypted("old-username"),
        Password: encrypted("old-password"),
        Fido2Credentials: [{ CredentialId: encrypted("credential"), Key: encrypted("passkey") }],
        FutureNestedLogin: { Blob: encrypted("nested") },
      },
      login: {
        password: encrypted("duplicate-password"),
      },
    };
    const preserved = retainOpaqueCipherPayload(source);
    const edited: LoginCipherCreateRequest = {
      type: 1,
      folderId: "folder-2",
      organizationId: null,
      key: encrypted("cipher-key"),
      name: encrypted("edited-name"),
      notes: encrypted("edited-notes"),
      favorite: true,
      reprompt: 1,
      lastKnownRevisionDate: "2026-07-14T00:00:00.000Z",
      login: {
        username: encrypted("edited-username"),
        password: encrypted("edited-password"),
        passwordRevisionDate: "2026-07-15T00:00:00.000Z",
        totp: null,
        autofillOnPageLoad: null,
        uris: [],
      },
      fields: [],
      passwordHistory: [{ password: encrypted("history-reencrypted"), lastUsedDate: "2026-07-01T00:00:00.000Z" }],
    };

    const update = mergePreservedLoginUpdate(preserved, edited, {
      organizationId: "org-1",
      collectionIds: ["collection-1"],
    });

    expect(update.Attachments).toEqual(source.Attachments);
    expect(update.FutureTopLevel).toEqual(source.FutureTopLevel);
    expect((update.login as Record<string, unknown>)["fido2Credentials"]).toEqual(
      source.Login.Fido2Credentials,
    );
    expect((update.login as Record<string, unknown>)["FutureNestedLogin"]).toEqual(
      source.Login.FutureNestedLogin,
    );
    expect(update.passwordHistory).toEqual(source.PasswordHistory);
    expect(update).toMatchObject({
      type: 1,
      organizationId: "org-1",
      collectionIds: ["collection-1"],
      key: encrypted("cipher-key"),
      name: encrypted("edited-name"),
      login: {
        username: encrypted("edited-username"),
        password: encrypted("edited-password"),
      },
    });
    for (const key of Object.keys(update)) {
      expect(["type", "organizationid", "collectionids", "key", "name", "login", "passwordhistory"].includes(key.toLowerCase())
        ? key === key.charAt(0).toLowerCase() + key.slice(1)
        : true).toBe(true);
    }
    expect(Object.keys(update).filter((key) => key.toLowerCase() === "name")).toEqual(["name"]);
    expect(Object.keys(update).filter((key) => key.toLowerCase() === "login")).toEqual(["login"]);
    expect(Object.keys(update.login).filter((key) => key.toLowerCase() === "password")).toEqual(["password"]);
  });
});

describe("mergePreservedCipherUpdate", () => {
  it.each([
    ["card", 3, "card", { Card: { Number: encrypted("old-number"), FutureCard: "opaque-card" } }],
    ["identity", 4, "identity", { Identity: { FirstName: encrypted("old-first"), FutureIdentity: "opaque-identity" } }],
    ["secure-note", 2, "secureNote", { SecureNote: { Type: 0, FutureNote: "opaque-note" } }],
  ] as const)("preserves opaque %s data while replacing edited fields", (type, cipherType, editedTypeKey, typedPayload) => {
    const preserved = retainOpaqueCipherPayload({
      Id: `${type}-1`,
      Type: cipherType,
      Data: encrypted("stale-aggregate-data"),
      Key: null,
      Login: null,
      Card: null,
      Identity: null,
      SecureNote: null,
      Attachments: [{ Id: "attachment-1", FutureAttachment: "opaque-attachment" }],
      Fields: [{ Name: encrypted("name"), Value: encrypted("value"), Type: 0, FutureField: "opaque-field" }],
      FutureTopLevel: "opaque-top",
      ...typedPayload,
    });
    const editedType = editedTypeKey === "card"
      ? { card: { number: encrypted("new-number") } }
      : editedTypeKey === "identity"
        ? { identity: { firstName: encrypted("new-first") } }
        : { secureNote: { type: 0 } };

    const merged = mergePreservedCipherUpdate({
      cipherType: type,
      preserved,
      edited: retainOpaqueCipherPayload({
        type: cipherType,
        organizationId: null,
        collectionIds: [],
        name: encrypted("edited-name"),
        fields: [{ name: encrypted("edited-field"), value: encrypted("edited-value"), type: 0 }],
        lastKnownRevisionDate: "2026-07-18T00:00:00.000Z",
        ...editedType,
      }),
      ownership: { organizationId: null, collectionIds: [] },
      associations: [{ path: ["Fields"], editedToSource: [0] }],
    });

    expect(merged).toMatchObject({
      Attachments: [{ FutureAttachment: "opaque-attachment" }],
      fields: [{ FutureField: "opaque-field" }],
      FutureTopLevel: "opaque-top",
      organizationId: null,
      collectionIds: [],
    });
    expect(Object.keys(merged).filter((key) => key.toLowerCase() === "fields")).toEqual(["fields"]);
    expect(Object.keys(merged).some((key) => key.toLowerCase() === "data")).toBe(false);
    expect(Object.isFrozen(merged)).toBe(true);
  });

  it.each([
    ["mismatched type object", { edited: { type: 3, identity: {} } }],
    ["conflicting field casing", { preserved: { Type: 3, Card: {}, Fields: [], fIeLdS: [] } }],
    ["conflicting ownership casing", { preserved: { Type: 3, Card: {}, OrganizationId: null, organizationID: "org-1" } }],
  ])("rejects %s", (_label, override) => {
    expect(() => mergePreservedCipherUpdate({
      cipherType: "card",
      preserved: retainOpaqueCipherPayload(override.preserved ?? { Type: 3, Card: {}, Fields: [] }),
      edited: retainOpaqueCipherPayload(override.edited ?? { type: 3, card: {}, fields: [] }),
      ownership: { organizationId: null, collectionIds: [] },
      associations: [],
    })).toThrow();
  });
});

describe("preflightPreservedCipherUpdate", () => {
  type Preflight = (input: {
    readonly cipherType: "card" | "identity" | "secure-note";
    readonly preserved: unknown;
    readonly ownership: { readonly organizationId: null; readonly collectionIds: readonly [] };
    readonly renderedEncryptedKey?: unknown;
  }) => { readonly preserved: unknown; readonly encryptedKey?: string };
  const preflight = (opaqueCipherPayloadModule as unknown as {
    readonly preflightPreservedCipherUpdate?: Preflight;
  }).preflightPreservedCipherUpdate;

  it("validates and retains the keyed graph before personal encryption", () => {
    expect(preflight).toBeTypeOf("function");
    const result = preflight!({
      cipherType: "card",
      preserved: {
        Type: 3,
        Card: {},
        Fields: [],
        OrganizationId: null,
        CollectionIds: [],
        Key: "2.synthetic-key",
      },
      ownership: { organizationId: null, collectionIds: [] },
      renderedEncryptedKey: "2.synthetic-key",
    });

    expect(result.encryptedKey).toBe("2.synthetic-key");
    expect(Object.isFrozen(result.preserved)).toBe(true);
  });

  it.each([
    ["wrong type object", { Type: 3, Identity: {}, Fields: [] }, undefined],
    ["duplicate type object", { Type: 3, Card: {}, cArD: {}, Fields: [] }, undefined],
    ["conflicting duplicate ownership", { Type: 3, Card: {}, Fields: [], OrganizationId: null, organizationID: "org-1" }, undefined],
    ["duplicate key", { Type: 3, Card: {}, Fields: [], Key: "one", kEy: "one" }, "one"],
    ["missing rendered key", { Type: 3, Card: {}, Fields: [], Key: "one" }, undefined],
    ["mismatched rendered key", { Type: 3, Card: {}, Fields: [], Key: "one" }, "two"],
    ["unexpected rendered key", { Type: 3, Card: {}, Fields: [] }, "one"],
  ])("rejects a %s during descriptor-safe preflight", (_label, preserved, renderedEncryptedKey) => {
    expect(preflight).toBeTypeOf("function");
    expect(() => preflight!({
      cipherType: "card",
      preserved,
      ownership: { organizationId: null, collectionIds: [] },
      ...(renderedEncryptedKey === undefined ? {} : { renderedEncryptedKey }),
    })).toThrow(/safely preserve opaque personal cipher data/);
  });
});

const personalOwnership = { organizationId: null, collectionIds: [] } as const;

function loginRequest(
  overrides: Partial<LoginCipherCreateRequest> = {},
): LoginCipherCreateRequest {
  return {
    type: 1,
    folderId: null,
    organizationId: null,
    name: encrypted("edited-name"),
    notes: null,
    favorite: false,
    reprompt: 0,
    login: {
      username: null,
      password: encrypted("edited-password"),
      passwordRevisionDate: null,
      totp: null,
      autofillOnPageLoad: null,
      uris: [],
    },
    fields: [],
    passwordHistory: [],
    ...overrides,
  };
}
