import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../app/popup-state";
import { searchVaultItems } from "../app/vault-demo";
import { projectLoginDetail } from "../app/vault/login-cipher-view.adapter";
import { projectPersonalCipherDetail } from "../app/vault/personal-cipher-view.adapter";
import type { VaultItem } from "../app/vault/vault-item.model";
import type { AuthSession } from "../auth/auth-session-store";
import { bytesToBase64 } from "../auth/bitwarden-crypto";
import { buildBitwardenEnvironment } from "../bitwarden-api/bitwarden-api";
import type { BitwardenSdkCore } from "../sdk/bitwarden-sdk-core.service";
import { VaultSyncService, type VaultSyncApi } from "./vault-sync.service";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("VaultSyncService", () => {
  it("treats a sync containing only File Sends as an empty Text Send vault", async () => {
    const result = await new VaultSyncService(new RecordingSyncApi({
      Ciphers: [],
      Folders: [],
      Sends: [{ Id: "file", AccessId: "access", Type: 1, Name: "file", File: { FileName: "report.pdf" } }],
    })).sync(sessionWithoutCrypto());

    expect(result.sends).toEqual([]);
    expect(result.sendPolicy).toEqual({ disabled: false, hideEmailAllowed: true });
  });

  it.each([
    ["card", 3, { Card: { Number: "4111", FutureCard: "opaque-card" } }],
    ["identity", 4, { Identity: { FirstName: "Ada", FutureIdentity: "opaque-identity" } }],
    ["secure-note", 2, { SecureNote: { Type: 0, FutureNote: "opaque-note" } }],
  ] as const)("retains and deeply freezes opaque %s sync payloads", async (type, cipherType, typedPayload) => {
    const source = {
      Id: `${type}-opaque`,
      Type: cipherType,
      Name: `${type} item`,
      Fields: [{ Name: "Label", Value: "Value", Type: 0, FutureField: { Blob: "opaque" } }],
      FutureTopLevel: { Nested: ["opaque"] },
      ...typedPayload,
    };

    const result = await new VaultSyncService(new RecordingSyncApi({ Ciphers: [source], Folders: [] }))
      .sync(sessionWithoutCrypto());
    const item = result.items[0]!;

    expect(item.type).toBe(type);
    expect(item.opaqueServerPayload).toEqual(source);
    expect(item.opaqueServerPayload).not.toBe(source);
    expect(Object.isFrozen(item.opaqueServerPayload)).toBe(true);
    expect(Object.isFrozen(item.opaqueServerPayload?.["Fields"])).toBe(true);
    expect(Object.isFrozen((item.opaqueServerPayload?.["Fields"] as readonly unknown[])[0])).toBe(true);
    expect(Object.isFrozen(item.opaqueServerPayload?.["FutureTopLevel"])).toBe(true);
    expect(item.requiresVaultSyncBeforeEdit).toBeUndefined();

    const store = new PopupStateStore();
    store.setItems([{ ...item, requiresVaultSyncBeforeEdit: true }]);
    expect(store.snapshot().items[0]?.requiresVaultSyncBeforeEdit).toBe(true);
    store.setItems(result.items);
    expect(store.snapshot().items[0]?.requiresVaultSyncBeforeEdit).toBeUndefined();
  });

  it("retains opaque Login server data without exposing it and clears it with the vault cache", async () => {
    const opaqueValue = "2.synthetic-opaque-encrypted-value";
    const source = {
      Id: "opaque-login",
      Type: 1,
      Name: "Visible Login",
      Attachments: [{ Id: "attachment-1", FileName: "visible.txt", Future: opaqueValue }],
      PasswordHistory: [{ Password: "previous", LastUsedDate: "2026-07-01T00:00:00.000Z", Future: opaqueValue }],
      FutureTopLevel: { Blob: opaqueValue },
      Login: {
        Username: "visible-user",
        Password: "visible-password",
        Fido2Credentials: [{ CredentialId: opaqueValue }],
        FutureNestedLogin: { Blob: opaqueValue },
      },
    };
    const result = await new VaultSyncService(new RecordingSyncApi({ Ciphers: [source], Folders: [] }))
      .sync(sessionWithoutCrypto());
    const item = result.items[0];

    expect(item.opaqueServerPayload).toEqual(source);
    expect(item.opaqueServerPayload).not.toBe(source);
    expect(Object.isFrozen(item.opaqueServerPayload)).toBe(true);
    expect(item.requiresVaultSyncBeforeEdit).toBeUndefined();
    expect(JSON.stringify(projectLoginDetail(item))).not.toContain(opaqueValue);
    expect(searchVaultItems(result.items, opaqueValue)).toEqual([]);

    const store = new PopupStateStore();
    store.setItems([{ ...item, requiresVaultSyncBeforeEdit: true }]);
    store.setItems(result.items);
    expect(store.snapshot().items[0]?.requiresVaultSyncBeforeEdit).toBeUndefined();
    store.setStatus("Ready");
    store.setLocked();
    expect(store.snapshot().items).toEqual([]);
    expect(JSON.stringify({
      statusMessage: store.snapshot().statusMessage,
      loginError: store.snapshot().loginError,
      syncError: store.snapshot().syncError,
      vaultSyncMessage: store.snapshot().vaultSyncMessage,
    })).not.toContain(opaqueValue);
  });

  it("maps untrusted sync failures to a fixed local error", async () => {
    const service = new VaultSyncService({
      getSync: async () => { throw new Error("private server response"); },
    });

    const error = await service.sync(sessionWithoutCrypto()).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Unable to synchronize vault");
    expect((error as Error).message).not.toContain("private server response");
  });

  it("loads sync with the active session token and maps login ciphers to vault items", async () => {
    const api = new RecordingSyncApi({
      Ciphers: [
        {
          Id: "login-1",
          Type: 1,
          Name: "Example Login",
          Favorite: true,
          Login: {
            Username: "user@example.com",
            Password: "secret-password",
            Totp: "otpauth://totp/example",
            Uris: [{ Uri: "https://example.com" }],
          },
          Fields: [{ Name: "Workspace", Value: "engineering", Type: 0 }],
        },
        {
          Id: "deleted",
          Type: 1,
          Name: "Deleted Login",
          DeletedDate: "2026-07-01T00:00:00Z",
          Login: { Username: "deleted@example.com" },
        },
        {
          Id: "archived",
          Type: 1,
          Name: "Archived Login",
          ArchivedDate: "2026-07-01T00:00:00Z",
          Login: { Username: "archived@example.com" },
        },
      ],
      Folders: [{ Id: "folder-1", Name: "Engineering" }],
    });
    const service = new VaultSyncService(api);

    const result = await service.sync(session("access-token"));

    expect(api.accessToken).toBe("access-token");
    expect(result.folderCount).toBe(1);
    expect(result.cipherCount).toBe(3);
    expect(result.items.map(withoutOpaqueServerPayload)).toEqual([
      {
        id: "login-1",
        type: "login",
        name: "Example Login",
        subtitle: "user@example.com",
        favorite: true,
        folderId: "",
        folderName: "",
        organizationName: "",
        attachmentCount: 0,
        uris: [{ id: "login-1-uri-0", uri: "https://example.com", matchType: "default" }],
        fields: [
          { id: "username", label: "Username", value: "user@example.com" },
          {
            id: "password",
            label: "Password",
            value: "secret-password",
            concealed: true,
            type: "hidden",
          },
          { id: "otp", label: "OTP", value: "otpauth://totp/example", type: "totp" },
          { id: "custom:0", label: "Workspace", value: "engineering", type: "text" },
        ],
        createdDate: "",
        revisionDate: "",
        notes: "",
        canLaunch: true,
        canFill: true,
        uri: "https://example.com",
      },
    ]);
  });

  it("supports lowercase Vaultwarden sync response field names", async () => {
    const service = new VaultSyncService(
      new RecordingSyncApi({
        ciphers: [
          {
            id: "login-1",
            type: 1,
            name: "Vaultwarden Login",
            login: {
              username: "lowercase@example.com",
              uris: [{ uri: "https://vaultwarden.example.com" }],
            },
          },
        ],
        folders: [],
      }),
    );

    const result = await service.sync(session("token"));

    expect(result.items.map((item) => item.name)).toEqual(["Vaultwarden Login"]);
    expect(result.items[0]?.subtitle).toBe("lowercase@example.com");
  });

  it("decrypts Bitwarden encrypted login ciphers with the session user key", async () => {
    const userKey = sequentialBytes(64);
    const userKeyB64 = bytesToBase64(userKey);
    const service = new VaultSyncService(
      new RecordingSyncApi({
        Ciphers: [
          {
            Id: "encrypted-login",
            Type: 1,
            Name: await encryptString("Encrypted Login", userKey),
            Favorite: true,
            Login: {
              Username: await encryptString("decrypted@example.com", userKey),
              Password: await encryptString("decrypted-password", userKey),
              Totp: await encryptString("otpauth://totp/decrypted", userKey),
              Uris: [{ Uri: await encryptString("https://decrypted.example.com", userKey) }],
            },
            Fields: [
              {
                Name: await encryptString("Workspace", userKey),
                Value: await encryptString("engineering", userKey),
                Type: 0,
              },
            ],
          },
        ],
        Folders: [],
      }),
    );

    const result = await service.sync(session("token", userKeyB64));

    expect(result.encryptedCipherCount).toBe(1);
    expect(result.items.map(withoutOpaqueServerPayload)).toEqual([
      {
        id: "encrypted-login",
        type: "login",
        name: "Encrypted Login",
        subtitle: "decrypted@example.com",
        favorite: true,
        folderId: "",
        folderName: "",
        organizationName: "",
        attachmentCount: 0,
        uris: [
          { id: "encrypted-login-uri-0", uri: "https://decrypted.example.com", matchType: "default" },
        ],
        fields: [
          { id: "username", label: "Username", value: "decrypted@example.com" },
          {
            id: "password",
            label: "Password",
            value: "decrypted-password",
            concealed: true,
            type: "hidden",
          },
          { id: "otp", label: "OTP", value: "otpauth://totp/decrypted", type: "totp" },
          { id: "custom:0", label: "Workspace", value: "engineering", type: "text" },
        ],
        createdDate: "",
        revisionDate: "",
        notes: "",
        canLaunch: true,
        canFill: true,
        uri: "https://decrypted.example.com",
      },
    ]);
  });

  it("decrypts synchronized folder names with the user key", async () => {
    const userKey = sequentialBytes(64);
    const encryptedName = await encryptString("Engineering", userKey);
    const api = new RecordingSyncApi({
      Ciphers: [],
      Folders: [{ Id: "folder-1", Name: encryptedName }],
    });

    const decrypted = await new VaultSyncService(api).sync(
      session("token", bytesToBase64(userKey)),
    );
    const locked = await new VaultSyncService(api).sync(session("token"));

    expect(decrypted.folders).toEqual([{ id: "folder-1", name: "Engineering" }]);
    expect(locked.folders).toEqual([]);
  });

  it("derives organization keys and decrypts organization ciphers and collections", async () => {
    const userKey = sequentialBytes(64);
    const organizationKey = sequentialBytes(64, 70);
    const cipherKey = sequentialBytes(64, 140);
    const privateKey = sequentialBytes(121, 20);
    const sdk = {
      decryptBytes: vi.fn(async (encrypted: string, key: Uint8Array) => {
        expect(encrypted).toBe("2.encrypted-private-key");
        expect(key).toEqual(userKey);
        return privateKey;
      }),
      decapsulateKeyUnsigned: vi.fn(async (encrypted: string, key: Uint8Array) => {
        expect(key).toEqual(privateKey);
        if (encrypted === "4.invalid-organization-key") {
          throw new Error("invalid organization key material must remain hidden");
        }
        expect(encrypted).toBe("4.encapsulated-organization-key");
        return organizationKey;
      }),
    } as unknown as BitwardenSdkCore;
    const service = new VaultSyncService(
      new RecordingSyncApi({
        Profile: {
          PrivateKey: "2.encrypted-private-key",
          Organizations: [
            {
              Id: "org-1",
              Name: "Engineering",
              Key: "4.encapsulated-organization-key",
              Enabled: true,
              Status: 2,
            },
            {
              Id: "org-invalid",
              Name: "Unavailable",
              Key: "4.invalid-organization-key",
              Enabled: true,
              Status: 2,
            },
          ],
        },
        Collections: [
          {
            Id: "collection-1",
            OrganizationId: "org-1",
            Name: await encryptString("Production", organizationKey),
            ReadOnly: false,
            Manage: true,
          },
          {
            Id: "collection-invalid",
            OrganizationId: "org-invalid",
            Name: "2.must-not-be-exposed",
          },
        ],
        Ciphers: [
          {
            Id: "organization-login",
            OrganizationId: "org-1",
            CollectionIds: ["collection-1"],
            Type: 1,
            Key: await encryptBytes(cipherKey, organizationKey),
            Name: await encryptString("Production Console", cipherKey),
            Login: {
              Username: await encryptString("operator@example.com", cipherKey),
              Password: await encryptString("organization-secret", cipherKey),
            },
          },
          {
            Id: "unavailable-login",
            OrganizationId: "org-invalid",
            Type: 1,
            Name: "2.must-not-be-exposed",
            Login: {},
          },
        ],
        Folders: [],
      }),
      sdk,
    );

    const result = await service.sync(session("token", bytesToBase64(userKey)));

    expect(result.organizations).toEqual([
      { id: "org-1", name: "Engineering", enabled: true, status: 2 },
    ]);
    expect(result.collections).toEqual([
      {
        id: "collection-1",
        organizationId: "org-1",
        name: "Production",
        readOnly: false,
        manage: true,
      },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "organization-login",
      name: "Production Console",
      subtitle: "operator@example.com",
      organizationId: "org-1",
      organizationName: "Engineering",
      collectionIds: ["collection-1"],
    });
    expect(result.items[0].fields.find((field) => field.id === "password")?.value).toBe(
      "organization-secret",
    );
    expect(sdk.decryptBytes).toHaveBeenCalledTimes(1);
    expect(sdk.decapsulateKeyUnsigned).toHaveBeenCalledTimes(2);
  });

  it("does not expose encrypted cipher text when the session has no user key", async () => {
    const userKey = sequentialBytes(64);
    const service = new VaultSyncService(
      new RecordingSyncApi({
        Ciphers: [
          {
            Id: "encrypted-login",
            Type: 1,
            Name: await encryptString("Encrypted Login", userKey),
            Login: {
              Username: await encryptString("decrypted@example.com", userKey),
            },
          },
        ],
        Folders: [],
      }),
    );

    const result = await service.sync(session("token"));

    expect(result.encryptedCipherCount).toBe(1);
    expect(result.items).toEqual([]);
  });

  it("maps login ciphers with folders, multiple URIs, timestamps, and fields", async () => {
    const api = {
      getSync: async () => ({
        Folders: [{ Id: "folder-1", Name: "Infrastructure" }],
        Ciphers: [
          {
            Id: "cipher-1",
            Type: 1,
            Key: "wrapped-cipher-key",
            Name: "Router",
            Favorite: true,
            Reprompt: 7,
            FolderId: "folder-1",
            CreationDate: "2026-07-01T10:00:00.000Z",
            RevisionDate: "2026-07-02T10:00:00.000Z",
            Attachments: [{
              Id: "attachment-1",
              FileName: "network-plan.pdf",
              Key: "wrapped-attachment-key",
              Size: "2048",
            }],
            Login: {
              Username: "admin",
              Password: "secret",
              PasswordRevisionDate: "2026-07-01T08:00:00.000Z",
              Totp: "otpauth://totp/router",
              Uris: [
                { Uri: "https://router.local", Match: 1 },
                { Uri: "https://10.0.0.1" },
              ],
            },
            PasswordHistory: [
              { Password: "previous-secret", LastUsedDate: "2026-07-01T09:00:00.000Z" },
            ],
            Fields: [
              { Name: "Region", Value: "lab", Type: 0 },
              { Name: "PIN", Value: "1234", Type: 1 },
              { Name: "Enabled", Value: "unexpected", Type: 2 },
              { Name: "Blank", Value: "", Type: 0 },
              { Name: "Account name", Value: "", Type: 3, LinkedId: 100 },
            ],
          },
        ],
      }),
    };
    const result = await new VaultSyncService(api).sync(sessionWithoutCrypto());
    expect(result.folders).toEqual([{ id: "folder-1", name: "Infrastructure" }]);
    expect(result.items[0]).toMatchObject({
      id: "cipher-1",
      type: "login",
      name: "Router",
      subtitle: "admin",
      favorite: true,
      reprompt: true,
      passwordRevisionDate: "2026-07-01T08:00:00.000Z",
      folderId: "folder-1",
      folderName: "Infrastructure",
      attachmentCount: 1,
      encryptedKey: "wrapped-cipher-key",
      canLaunch: true,
      canFill: true,
    });
    expect(result.items[0].uris.map((uri) => uri.uri)).toEqual([
      "https://router.local",
      "https://10.0.0.1",
    ]);
    expect(result.items[0].uris.map((uri) => uri.matchType)).toEqual(["1", "default"]);
    expect(result.items[0].fields).toEqual([
      { id: "username", label: "Username", value: "admin" },
      { id: "password", label: "Password", value: "secret", concealed: true, type: "hidden" },
      { id: "otp", label: "OTP", value: "otpauth://totp/router", type: "totp" },
      { id: "custom:0", label: "Region", value: "lab", type: "text" },
      { id: "custom:1", label: "PIN", value: "1234", concealed: true, type: "hidden" },
      { id: "custom:2", label: "Enabled", value: "false", type: "boolean" },
      { id: "custom:3", label: "Blank", value: "", type: "text" },
      { id: "custom:4", label: "Account name", value: "", type: "linked", linkedId: 100 },
    ]);
    expect(result.items[0].passwordHistory).toEqual([
      { password: "previous-secret", lastUsedDate: "2026-07-01T09:00:00.000Z" },
    ]);
    expect(result.items[0].attachments).toEqual([
      {
        id: "attachment-1",
        fileName: "network-plan.pdf",
        encryptedKey: "wrapped-attachment-key",
        size: "2048",
      },
    ]);
  });

  it("maps retained non-login types and ignores excluded SSH Key ciphers", async () => {
    const api = {
      getSync: async () => ({
        Folders: [],
        Ciphers: [
          { Id: "note-1", Type: 2, Name: "Recovery note", SecureNote: { Type: 0 }, Notes: "plain" },
          { Id: "card-1", Type: 3, Name: "Travel card", Card: { Brand: "Visa" } },
          { Id: "identity-1", Type: 4, Name: "Personal identity", Identity: { Email: "me@example.com" } },
          { Id: "ssh-1", Type: 5, Name: "Deploy key", SshKey: { PublicKey: "ssh-rsa AAA" } },
        ],
      }),
    };
    const result = await new VaultSyncService(api).sync(sessionWithoutCrypto());
    expect(result.items.map((item) => [item.id, item.type, item.canFill])).toEqual([
      ["note-1", "secure-note", false],
      ["card-1", "card", false],
      ["identity-1", "identity", false],
    ]);
    expect(result.items.find((item) => item.id === "note-1")?.fields).toEqual([
      { id: "notes", label: "Notes", value: "plain" },
    ]);
    expect(result.items.find((item) => item.id === "note-1")?.secureNote).toEqual({ type: 0 });
    const note = result.items.find((item) => item.id === "note-1")!;
    const noteProjection = projectPersonalCipherDetail(note);
    expect(noteProjection.actionFields.get("notes")).toBe(note.fields[0]);
  });

  it("preserves the complete retained typed Card payload from sync", async () => {
    const service = new VaultSyncService(
      new RecordingSyncApi({
        Folders: [],
        Ciphers: [
          {
            Id: "card-complete",
            Type: 3,
            Name: "Travel Card",
            Notes: "Card recovery instructions",
            Favorite: true,
            Reprompt: 1,
            Card: {
              CardholderName: "Travel Ops",
              Brand: "Visa",
              Number: "4111111111111111",
              ExpMonth: "04",
              ExpYear: "2029",
              Code: "123",
            },
          },
        ],
      }),
    );

    const item = (await service.sync(sessionWithoutCrypto())).items[0];

    expect(item).toMatchObject({
      type: "card",
      reprompt: true,
      card: {
        cardholderName: "Travel Ops",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
    });
    expect(item.fields.map((field) => field.id)).toEqual([
      "brand", "cardholder-name", "number", "exp-month", "exp-year", "code", "notes",
    ]);
    const projection = projectPersonalCipherDetail(item);
    for (const field of item.fields) {
      expect(projection.actionFields.get(field.id)).toBe(field);
    }
  });

  it("preserves the complete retained typed Identity payload from sync", async () => {
    const identity = {
      Title: "Dr",
      FirstName: "Ada",
      MiddleName: "Augusta",
      LastName: "Lovelace",
      Username: "ada",
      Company: "Analytical Engines",
      Ssn: "000-00-0000",
      PassportNumber: "P1234567",
      LicenseNumber: "L7654321",
      Email: "ada@example.test",
      Phone: "+44 20 0000",
      Address1: "12 Engine Lane",
      Address2: "Suite 2",
      Address3: "Research Park",
      City: "London",
      State: "Greater London",
      PostalCode: "N1 1AA",
      Country: "United Kingdom",
    };
    const service = new VaultSyncService(
      new RecordingSyncApi({
        Folders: [],
        Ciphers: [{
          Id: "identity-complete",
          Type: 4,
          Name: "Ada Identity",
          Notes: "Identity recovery instructions",
          Reprompt: 1,
          Identity: identity,
          Fields: [
            { Name: "PIN", Value: "first-secret", Type: 1 },
            { Name: "PIN", Value: "second-secret", Type: 1 },
            { Name: "", Value: "blank-label-secret", Type: 1 },
          ],
        }],
      }),
    );

    const item = (await service.sync(sessionWithoutCrypto())).items[0];

    expect(item).toMatchObject({
      type: "identity",
      reprompt: true,
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
        email: "ada@example.test",
        phone: "+44 20 0000",
        address1: "12 Engine Lane",
        address2: "Suite 2",
        address3: "Research Park",
        city: "London",
        state: "Greater London",
        postalCode: "N1 1AA",
        country: "United Kingdom",
      },
    });
    expect(item.fields.map((field) => field.id)).toEqual([
      "title", "first-name", "middle-name", "last-name", "full-name", "username", "company",
      "ssn", "passport-number", "license-number", "email", "phone", "address-1", "address-2",
      "address-3", "city", "state", "postal-code", "country", "address",
      "notes",
      "custom:0", "custom:1", "custom:2",
    ]);
    expect(item.fields.slice(-3)).toEqual([
      { id: "custom:0", label: "PIN", value: "first-secret", concealed: true, type: "hidden" },
      { id: "custom:1", label: "PIN", value: "second-secret", concealed: true, type: "hidden" },
      { id: "custom:2", label: "", value: "blank-label-secret", concealed: true, type: "hidden" },
    ]);
    for (const field of item.fields) {
      if (field.label) {
        expect(field.id).not.toContain(field.label);
      }
      if (field.value) {
        expect(field.id).not.toContain(field.value);
      }
    }

    const projection = projectPersonalCipherDetail(item);
    for (const field of item.fields) {
      expect(projection.actionFields.get(field.id)).toBe(field);
    }
    expect(projection.actionFields.get("custom:0")?.value).toBe("first-secret");
    expect(projection.actionFields.get("custom:1")?.value).toBe("second-secret");
  });

  it("keeps archived and deleted ciphers out of the active vault and maps them to secondary lists", async () => {
    const api = {
      getSync: async () => ({
        Folders: [],
        Ciphers: [
          { Id: "active-1", Type: 1, Name: "Active login", Login: { Username: "active@example.com" } },
          {
            Id: "archived-1",
            Type: 1,
            Name: "Archived login",
            ArchivedDate: "2026-07-03T10:00:00.000Z",
            Login: { Username: "archived@example.com" },
          },
          {
            Id: "deleted-1",
            Type: 1,
            Name: "Deleted login",
            DeletedDate: "2026-07-04T10:00:00.000Z",
            Login: { Username: "deleted@example.com" },
          },
        ],
      }),
    };

    const result = await new VaultSyncService(api).sync(sessionWithoutCrypto());

    expect(result.items.map((item) => item.id)).toEqual(["active-1"]);
    expect(result.archivedItems.map((item) => item.id)).toEqual(["archived-1"]);
    expect(result.deletedItems.map((item) => item.id)).toEqual(["deleted-1"]);
    expect(result.archivedItems[0]?.archivedDate).toBe("2026-07-03T10:00:00.000Z");
    expect(result.deletedItems[0]?.deletedDate).toBe("2026-07-04T10:00:00.000Z");
  });

  it("keeps exact server ids in one active, archived, or deleted projection", async () => {
    const result = await new VaultSyncService({
      getSync: async () => ({
        Folders: [], Sends: [],
        Ciphers: [
          { Id: "active-id", Type: 3, Name: "Active card", Card: {} },
          { Id: "archived-id", Type: 4, Name: "Archived identity", Identity: {}, ArchivedDate: "2026-07-03" },
          { Id: "deleted-id", Type: 2, Name: "Deleted note", SecureNote: {}, DeletedDate: "2026-07-04" },
        ],
      }),
    }).sync(sessionWithoutCrypto());

    expect(result.items.map((item) => item.id)).toEqual(["active-id"]);
    expect(result.archivedItems.map((item) => item.id)).toEqual(["archived-id"]);
    expect(result.deletedItems.map((item) => item.id)).toEqual(["deleted-id"]);
  });

  it("maps Text Send responses and ignores File Send records", async () => {
    const api = new RecordingSyncApi({
      Ciphers: [],
      Folders: [],
      Sends: [
        {
          Id: "send-1",
          AccessId: "access-1",
          Type: 0,
          Name: "Payroll token",
          Notes: "share with finance",
          AuthType: 1,
          Password: "server-password-proof",
          MaxAccessCount: 3,
          AccessCount: 1,
          RevisionDate: "2026-07-09T10:00:00.000Z",
          DeletionDate: "2026-07-16T10:00:00.000Z",
          Disabled: false,
        },
        {
          Id: "send-2",
          AccessId: "access-2",
          Type: 1,
          Name: "Wire file",
          File: { FileName: "wire.pdf" },
          AccessCount: 0,
          RevisionDate: "2026-07-09T11:00:00.000Z",
          DeletionDate: "2026-07-16T11:00:00.000Z",
          Disabled: true,
        },
        {
          Id: "encrypted-send",
          AccessId: "access-3",
          Type: 0,
          Name: await encryptString("Encrypted Send", sequentialBytes(64)),
        },
      ],
    });

    const result = await new VaultSyncService(api).sync(sessionWithoutCrypto());

    expect(result.sendCount).toBe(3);
    expect(result.sends).toEqual([
      {
        id: "send-1",
        accessId: "access-1",
        type: "text",
        name: "Payroll token",
        notes: "share with finance",
        hasPassword: true,
        maxAccessCount: 3,
        accessCount: 1,
        revisionDate: "2026-07-09T10:00:00.000Z",
        deletionDate: "2026-07-16T10:00:00.000Z",
        disabled: false,
      },
    ]);
  });

  it("decrypts encrypted Send names and notes with the Send key from sync", async () => {
    const userKey = sequentialBytes(64);
    const userKeyB64 = bytesToBase64(userKey);
    const sendSeed = sequentialBytes(16, 200);
    const sendKey = await deriveSendKey(sendSeed);
    const service = new VaultSyncService(
      new RecordingSyncApi({
        Ciphers: [],
        Folders: [],
        Sends: [
          {
            Id: "encrypted-send",
            AccessId: "access-1",
            Type: 0,
            Key: await encryptBytes(sendSeed, userKey),
            Name: await encryptString("Encrypted Send", sendKey),
            Notes: await encryptString("private note", sendKey),
            Text: {
              Text: await encryptString("decrypted body", sendKey),
              Hidden: true,
            },
            HideEmail: true,
            AccessCount: 0,
            RevisionDate: "2026-07-09T10:00:00.000Z",
            DeletionDate: "2026-07-16T10:00:00.000Z",
          },
        ],
      }),
    );

    const result = await service.sync(session("token", userKeyB64));

    expect(result.sends).toEqual([
      {
        id: "encrypted-send",
        accessId: "access-1",
        urlB64Key: bytesToBase64(sendSeed),
        type: "text",
        name: "Encrypted Send",
        text: "decrypted body",
        hidden: true,
        hideEmail: true,
        notes: "private note",
        accessCount: 0,
        revisionDate: "2026-07-09T10:00:00.000Z",
        deletionDate: "2026-07-16T10:00:00.000Z",
        disabled: false,
      },
    ]);
  });
});

class RecordingSyncApi implements VaultSyncApi {
  accessToken?: string;

  constructor(private readonly response: unknown) {}

  getSync(accessToken: string): Promise<unknown> {
    this.accessToken = accessToken;
    return Promise.resolve(this.response);
  }
}

function session(accessToken: string, userKeyB64?: string): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    ...(userKeyB64 ? { crypto: { userKeyB64 } } : {}),
  };
}

function sessionWithoutCrypto(): AuthSession {
  return session("token");
}

function withoutOpaqueServerPayload(item: VaultItem): Omit<VaultItem, "opaqueServerPayload"> {
  const { opaqueServerPayload: _opaqueServerPayload, ...renderedItem } = item;
  return renderedItem;
}

async function encryptString(value: string, key: Uint8Array): Promise<string> {
  return encryptBytes(new TextEncoder().encode(value), key);
}

async function encryptBytes(plainValue: Uint8Array, key: Uint8Array): Promise<string> {
  const iv = sequentialBytes(16, 100);
  const cryptoKey = await crypto.subtle.importKey("raw", key.slice(0, 32), "AES-CBC", false, [
    "encrypt",
  ]);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, plainValue),
  );
  const mac = await hmacSha256(key.slice(32, 64), concatBytes(iv, data));

  return `2.${bytesToBase64(iv)}|${bytesToBase64(data)}|${bytesToBase64(mac)}`;
}

async function hmacSha256(key: Uint8Array, value: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, value));
}

function sequentialBytes(length: number, start = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256);
}

async function deriveSendKey(seed: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("bitwarden-send"),
      info: new TextEncoder().encode("send"),
    },
    key,
    64 * 8,
  );

  return new Uint8Array(bits);
}

function concatBytes(...arrays: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, array) => total + array.byteLength, 0));
  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }

  return result;
}
