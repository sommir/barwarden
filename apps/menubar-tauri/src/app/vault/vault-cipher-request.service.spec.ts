import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bytesToBase64,
  decryptEncStringToUtf8,
  encryptBytesToEncString,
} from "../../auth/bitwarden-crypto";
import {
  buildCardCipherCreateRequest,
  buildCardCipherUpdateRequest,
  buildIdentityCipherCreateRequest,
  buildIdentityCipherUpdateRequest,
  buildLoginCipherCreateRequest,
  buildLoginCipherUpdateRequest,
  buildSecureNoteCipherCreateRequest,
  buildSecureNoteCipherUpdateRequest,
} from "./vault-cipher-request.service";
import { retainOpaqueCipherPayload } from "./opaque-cipher-payload";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("buildLoginCipherCreateRequest", () => {
  it("encrypts the official SHA-256 checksum for every Login URI", async () => {
    const userKey = sequentialBytes(64, 211);
    const userKeyB64 = bytesToBase64(userKey);
    const uri = "https://login.example.test/path";

    const result = await buildLoginCipherCreateRequest({
      userKeyB64,
      name: "Checksum Login",
      username: "",
      password: "",
      totp: "",
      uri,
      notes: "",
      randomBytes: (length) => sequentialBytes(length, 31),
    });

    expect(result.login.uris[0].uriChecksum).toBeTruthy();
    await expect(
      decryptEncStringToUtf8(result.login.uris[0].uriChecksum!, userKeyB64),
    ).resolves.toBe(
      bytesToBase64(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uri))),
      ),
    );
  });

  it("requires explicit ownership whenever a preserved Login payload is merged", async () => {
    const userKey = sequentialBytes(64, 181);

    await expect(buildLoginCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Edited Login",
      username: "edited-user",
      password: "edited-password",
      totp: "",
      uri: "",
      notes: "",
      lastKnownRevisionDate: "2026-07-14T00:00:00.000Z",
      preserved: retainOpaqueCipherPayload({
        Id: "organization-login",
        OrganizationId: "org-1",
        CollectionIds: ["collection-1"],
        Type: 1,
        Name: "2.synthetic-old-name",
        Login: { Password: "2.synthetic-old-password" },
      }),
      randomBytes: (length) => sequentialBytes(length, 80),
    })).rejects.toThrow("Preserved Login updates require explicit ownership");
  });

  it("merges a preserved personal Login payload without losing opaque server values", async () => {
    const userKey = sequentialBytes(64, 191);
    const opaqueValue = "2.synthetic-request-opaque-value";
    const result = await buildLoginCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Edited Login",
      username: "edited-user",
      password: "edited-password",
      totp: "",
      uri: "",
      notes: "",
      lastKnownRevisionDate: "2026-07-14T00:00:00.000Z",
      preserved: retainOpaqueCipherPayload({
        Id: "login-1",
        Type: 1,
        Name: "2.synthetic-old-name",
        Attachments: [{ Id: "attachment-1", Key: opaqueValue }],
        FutureTopLevel: opaqueValue,
        Login: {
          Username: "2.synthetic-old-username",
          Password: "2.synthetic-old-password",
          Fido2Credentials: [{ CredentialId: opaqueValue }],
          FutureNested: opaqueValue,
        },
      }),
      ownership: { organizationId: null, collectionIds: [] },
      randomBytes: (length) => sequentialBytes(length, 90),
    });

    expect(result).toMatchObject({
      organizationId: null,
      collectionIds: [],
      Attachments: [{ Id: "attachment-1", Key: opaqueValue }],
      FutureTopLevel: opaqueValue,
      login: {
        fido2Credentials: [{ CredentialId: opaqueValue }],
        FutureNested: opaqueValue,
      },
    });
    expect(Object.keys(result).filter((key) => key.toLowerCase() === "name")).toEqual(["name"]);
    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe("Edited Login");
    await expect(decryptEncStringToUtf8(result.login.password!, bytesToBase64(userKey))).resolves.toBe("edited-password");
  });

  it("encrypts every retained standard Login value", async () => {
    const userKey = sequentialBytes(64, 201);
    const userKeyB64 = bytesToBase64(userKey);
    const result = await buildLoginCipherCreateRequest({
      userKeyB64,
      name: "Operations",
      username: "operator",
      password: "local-secret",
      totp: "synthetic-totp-seed",
      uri: "",
      uris: [
        { uri: "https://one.example.test", matchType: "1" },
        { uri: "https://two.example.test", matchType: "default" },
      ],
      fields: [
        { name: "Region", value: "Production", type: 0 },
        { name: "PIN", value: "1234", type: 1 },
        { name: "Enabled", value: "true", type: 2 },
      ],
      notes: "retained note",
      favorite: true,
      folderId: "folder-1",
      reprompt: true,
      randomBytes: (length) => sequentialBytes(length, 50),
    });

    expect(result).toMatchObject({
      folderId: "folder-1",
      favorite: true,
      reprompt: 1,
      login: { uris: [{ match: 1 }, { match: null }] },
    });
    expect(result.fields).toHaveLength(3);
    await expect(decryptEncStringToUtf8(result.login.uris[0].uri, userKeyB64)).resolves.toBe(
      "https://one.example.test",
    );
    await expect(decryptEncStringToUtf8(result.login.uris[1].uri, userKeyB64)).resolves.toBe(
      "https://two.example.test",
    );
    await expect(decryptEncStringToUtf8(result.fields[1].name, userKeyB64)).resolves.toBe("PIN");
    await expect(decryptEncStringToUtf8(result.fields[1].value, userKeyB64)).resolves.toBe("1234");
    expect(result.fields.map((field) => field.type)).toEqual([0, 1, 2]);
  });

  it("builds an official encrypted personal Login cipher create request", async () => {
    const userKey = sequentialBytes(64, 1);
    const result = await buildLoginCipherCreateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Stripe Dashboard",
      username: "finance@example.com",
      password: "local-secret",
      totp: "otpauth://totp/demo",
      uri: "https://dashboard.stripe.com",
      notes: "private note",
      randomBytes: (length) => sequentialBytes(length, 100),
    });

    expect(JSON.stringify(result)).not.toContain("Stripe Dashboard");
    expect(JSON.stringify(result)).not.toContain("finance@example.com");
    expect(JSON.stringify(result)).not.toContain("local-secret");
    expect(result).toMatchObject({
      type: 1,
      folderId: null,
      organizationId: null,
      favorite: false,
      reprompt: 0,
      login: {
        passwordRevisionDate: null,
        autofillOnPageLoad: null,
        uris: [{ match: null }],
      },
      fields: [],
      passwordHistory: [],
    });

    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "Stripe Dashboard",
    );
    await expect(decryptEncStringToUtf8(result.login.username, bytesToBase64(userKey))).resolves.toBe(
      "finance@example.com",
    );
    await expect(decryptEncStringToUtf8(result.login.password, bytesToBase64(userKey))).resolves.toBe(
      "local-secret",
    );
    await expect(decryptEncStringToUtf8(result.login.totp, bytesToBase64(userKey))).resolves.toBe(
      "otpauth://totp/demo",
    );
    await expect(decryptEncStringToUtf8(result.login.uris[0].uri, bytesToBase64(userKey))).resolves.toBe(
      "https://dashboard.stripe.com",
    );
    await expect(decryptEncStringToUtf8(result.notes, bytesToBase64(userKey))).resolves.toBe(
      "private note",
    );
  });

  it("builds an official encrypted personal Login cipher update request", async () => {
    const userKey = sequentialBytes(64, 11);
    const result = await buildLoginCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "GitHub Enterprise",
      username: "admin@example.com",
      password: "updated-secret",
      totp: "otpauth://totp/update",
      uri: "https://github.example.com",
      notes: "updated note",
      favorite: true,
      folderId: "work",
      lastKnownRevisionDate: "2026-07-04T09:00:00.000Z",
      randomBytes: (length) => sequentialBytes(length, 140),
    });

    expect(JSON.stringify(result)).not.toContain("GitHub Enterprise");
    expect(JSON.stringify(result)).not.toContain("updated-secret");
    expect(result).toMatchObject({
      type: 1,
      folderId: "work",
      organizationId: null,
      favorite: true,
      reprompt: 0,
      lastKnownRevisionDate: "2026-07-04T09:00:00.000Z",
      login: {
        passwordRevisionDate: null,
        autofillOnPageLoad: null,
        uris: [{ match: null }],
      },
      fields: [],
      passwordHistory: [],
    });
    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "GitHub Enterprise",
    );
    await expect(decryptEncStringToUtf8(result.login.username, bytesToBase64(userKey))).resolves.toBe(
      "admin@example.com",
    );
    await expect(decryptEncStringToUtf8(result.login.password, bytesToBase64(userKey))).resolves.toBe(
      "updated-secret",
    );
  });

  it("updates a keyed Login with its cipher key and preserves password history", async () => {
    const userKey = sequentialBytes(64, 21);
    const cipherKey = sequentialBytes(64, 91);
    const encryptedKey = await encryptBytesToEncString(
      cipherKey,
      userKey,
      (length) => sequentialBytes(length, 171),
    );
    const result = await buildLoginCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      encryptedKey,
      name: "Keyed Login",
      username: "operator",
      currentPassword: "old-secret",
      password: "new-secret",
      passwordRevisionDate: "2026-07-01T08:00:00.000Z",
      passwordHistory: [
        { password: "older-secret", lastUsedDate: "2026-06-01T08:00:00.000Z" },
      ],
      revisionDateNow: "2026-07-12T09:00:00.000Z",
      totp: "",
      uri: "https://keyed.example.test",
      notes: "",
      lastKnownRevisionDate: "2026-07-11T09:00:00.000Z",
      randomBytes: (length) => sequentialBytes(length, 31),
    });

    expect(result.key).toBe(encryptedKey);
    expect(result.login.passwordRevisionDate).toBe("2026-07-12T09:00:00.000Z");
    await expect(
      decryptEncStringToUtf8(result.name, bytesToBase64(cipherKey)),
    ).resolves.toBe("Keyed Login");
    await expect(
      decryptEncStringToUtf8(result.passwordHistory[0].password, bytesToBase64(cipherKey)),
    ).resolves.toBe("old-secret");
    expect(result.passwordHistory[0].lastUsedDate).toBe("2026-07-12T09:00:00.000Z");
    await expect(
      decryptEncStringToUtf8(result.passwordHistory[1].password, bytesToBase64(cipherKey)),
    ).resolves.toBe("older-secret");
  });
});

describe("buildCardCipherCreateRequest", () => {
  it("preserves encrypted Card brand, reprompt, and custom fields", async () => {
    const userKey = sequentialBytes(64, 31);
    const input = {
      userKeyB64: bytesToBase64(userKey),
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
      fields: [{ name: "Region", value: "APAC", type: 0 }],
      randomBytes: (length: number) => sequentialBytes(length, 210),
    } as Parameters<typeof buildCardCipherCreateRequest>[0];

    const result = await buildCardCipherCreateRequest(input);

    expect(result.reprompt).toBe(1);
    expect(result.fields).toHaveLength(1);
    await expect(decryptEncStringToUtf8(result.card.brand!, bytesToBase64(userKey))).resolves.toBe(
      "Visa",
    );
    await expect(
      decryptEncStringToUtf8(result.fields[0].name!, bytesToBase64(userKey)),
    ).resolves.toBe("Region");
    await expect(
      decryptEncStringToUtf8(result.fields[0].value!, bytesToBase64(userKey)),
    ).resolves.toBe("APAC");
  });

  it("builds an official encrypted personal Card cipher create request", async () => {
    const userKey = sequentialBytes(64, 41);
    const result = await buildCardCipherCreateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Travel card",
      cardholderName: "Travel Ops",
      number: "4111 1111 1111 1111",
      expMonth: "04",
      expYear: "2029",
      code: "123",
      notes: "card note",
      randomBytes: (length) => sequentialBytes(length, 220),
    });

    expect(JSON.stringify(result)).not.toContain("Travel card");
    expect(JSON.stringify(result)).not.toContain("4111 1111 1111 1111");
    expect(JSON.stringify(result)).not.toContain("123");
    expect(result).toMatchObject({
      type: 3,
      folderId: null,
      organizationId: null,
      favorite: false,
      reprompt: 0,
      fields: [],
      passwordHistory: [],
    });

    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "Travel card",
    );
    await expect(decryptEncStringToUtf8(result.notes, bytesToBase64(userKey))).resolves.toBe(
      "card note",
    );
    await expect(
      decryptEncStringToUtf8(result.card.cardholderName, bytesToBase64(userKey)),
    ).resolves.toBe("Travel Ops");
    await expect(decryptEncStringToUtf8(result.card.number, bytesToBase64(userKey))).resolves.toBe(
      "4111 1111 1111 1111",
    );
    await expect(decryptEncStringToUtf8(result.card.expMonth, bytesToBase64(userKey))).resolves.toBe(
      "04",
    );
    await expect(decryptEncStringToUtf8(result.card.expYear, bytesToBase64(userKey))).resolves.toBe(
      "2029",
    );
    await expect(decryptEncStringToUtf8(result.card.code, bytesToBase64(userKey))).resolves.toBe(
      "123",
    );
    expect(result.card.brand).toBeNull();
  });

  it("builds an official encrypted personal Card cipher update request", async () => {
    const userKey = sequentialBytes(64, 51);
    const result = await buildCardCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Updated travel card",
      cardholderName: "Ops Team",
      number: "5555 5555 5555 4444",
      expMonth: "08",
      expYear: "2031",
      code: "987",
      notes: "updated card note",
      favorite: true,
      folderId: "personal",
      lastKnownRevisionDate: "2026-07-05T09:00:00.000Z",
      randomBytes: (length) => sequentialBytes(length, 240),
    });

    expect(JSON.stringify(result)).not.toContain("Updated travel card");
    expect(JSON.stringify(result)).not.toContain("5555 5555 5555 4444");
    expect(result).toMatchObject({
      type: 3,
      folderId: "personal",
      organizationId: null,
      favorite: true,
      reprompt: 0,
      fields: [],
      passwordHistory: [],
      lastKnownRevisionDate: "2026-07-05T09:00:00.000Z",
    });

    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "Updated travel card",
    );
    await expect(decryptEncStringToUtf8(result.card.number, bytesToBase64(userKey))).resolves.toBe(
      "5555 5555 5555 4444",
    );
    await expect(decryptEncStringToUtf8(result.card.code, bytesToBase64(userKey))).resolves.toBe(
      "987",
    );
  });
});

describe("buildIdentityCipherCreateRequest complete contract", () => {
  it("encrypts every retained Identity field and common option", async () => {
    const userKey = sequentialBytes(64, 61);
    const values = {
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
    };
    const input = {
      userKeyB64: bytesToBase64(userKey),
      name: "Complete Identity",
      ...values,
      notes: "identity note",
      favorite: true,
      folderId: "personal",
      reprompt: true,
      fields: [{ name: "Region", value: "EU", type: 0 }],
      randomBytes: (length: number) => sequentialBytes(length, 170),
    } as Parameters<typeof buildIdentityCipherCreateRequest>[0];

    const result = await buildIdentityCipherCreateRequest(input);

    expect(result).toMatchObject({ favorite: true, folderId: "personal", reprompt: 1 });
    expect(result.fields).toHaveLength(1);
    for (const [key, value] of Object.entries(values)) {
      await expect(
        decryptEncStringToUtf8(
          result.identity[key as keyof typeof result.identity]!,
          bytesToBase64(userKey),
        ),
      ).resolves.toBe(value);
    }
  });
});

describe("buildIdentityCipherCreateRequest", () => {
  it("builds an official encrypted personal Identity cipher create request", async () => {
    const userKey = sequentialBytes(64, 61);
    const result = await buildIdentityCipherCreateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Personal identity",
      firstName: "Example",
      lastName: "Person",
      email: "me@example.com",
      phone: "+1 555 0100",
      address1: "1 Market Street",
      notes: "identity note",
      randomBytes: (length) => sequentialBytes(length, 10),
    });

    expect(JSON.stringify(result)).not.toContain("Personal identity");
    expect(JSON.stringify(result)).not.toContain("me@example.com");
    expect(JSON.stringify(result)).not.toContain("1 Market Street");
    expect(result).toMatchObject({
      type: 4,
      folderId: null,
      organizationId: null,
      favorite: false,
      reprompt: 0,
      fields: [],
      passwordHistory: [],
    });

    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "Personal identity",
    );
    await expect(decryptEncStringToUtf8(result.notes, bytesToBase64(userKey))).resolves.toBe(
      "identity note",
    );
    await expect(decryptEncStringToUtf8(result.identity.firstName, bytesToBase64(userKey))).resolves.toBe(
      "Example",
    );
    await expect(decryptEncStringToUtf8(result.identity.lastName, bytesToBase64(userKey))).resolves.toBe(
      "Person",
    );
    await expect(decryptEncStringToUtf8(result.identity.email, bytesToBase64(userKey))).resolves.toBe(
      "me@example.com",
    );
    await expect(decryptEncStringToUtf8(result.identity.phone, bytesToBase64(userKey))).resolves.toBe(
      "+1 555 0100",
    );
    await expect(decryptEncStringToUtf8(result.identity.address1, bytesToBase64(userKey))).resolves.toBe(
      "1 Market Street",
    );
    expect(result.identity.title).toBeNull();
    expect(result.identity.address2).toBeNull();
    expect(result.identity.company).toBeNull();
  });

  it("builds an official encrypted personal Identity cipher update request", async () => {
    const userKey = sequentialBytes(64, 71);
    const result = await buildIdentityCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Updated identity",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "+44 20 0000",
      address1: "12 Engine Lane",
      notes: "updated identity note",
      favorite: true,
      folderId: "personal",
      lastKnownRevisionDate: "2026-07-06T09:00:00.000Z",
      randomBytes: (length) => sequentialBytes(length, 80),
    });

    expect(JSON.stringify(result)).not.toContain("Updated identity");
    expect(JSON.stringify(result)).not.toContain("ada@example.com");
    expect(result).toMatchObject({
      type: 4,
      folderId: "personal",
      organizationId: null,
      favorite: true,
      reprompt: 0,
      fields: [],
      passwordHistory: [],
      lastKnownRevisionDate: "2026-07-06T09:00:00.000Z",
    });

    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "Updated identity",
    );
    await expect(decryptEncStringToUtf8(result.identity.firstName, bytesToBase64(userKey))).resolves.toBe(
      "Ada",
    );
    await expect(decryptEncStringToUtf8(result.identity.lastName, bytesToBase64(userKey))).resolves.toBe(
      "Lovelace",
    );
  });
});

describe("buildSecureNoteCipherCreateRequest", () => {
  it("builds an official encrypted personal Secure Note cipher create request", async () => {
    const userKey = sequentialBytes(64, 21);
    const result = await buildSecureNoteCipherCreateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Recovery note",
      notes: "private recovery phrase",
      randomBytes: (length) => sequentialBytes(length, 180),
    });

    expect(JSON.stringify(result)).not.toContain("Recovery note");
    expect(JSON.stringify(result)).not.toContain("private recovery phrase");
    expect(result).toMatchObject({
      type: 2,
      folderId: null,
      organizationId: null,
      favorite: false,
      reprompt: 0,
      secureNote: { type: 0 },
      fields: [],
      passwordHistory: [],
    });

    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "Recovery note",
    );
    await expect(decryptEncStringToUtf8(result.notes, bytesToBase64(userKey))).resolves.toBe(
      "private recovery phrase",
    );
  });

  it("builds an official encrypted personal Secure Note cipher update request", async () => {
    const userKey = sequentialBytes(64, 31);
    const result = await buildSecureNoteCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Updated recovery note",
      notes: "updated private note",
      favorite: true,
      folderId: "work",
      reprompt: true,
      fields: [{ name: "Region", value: "EU", type: 0 }],
      lastKnownRevisionDate: "2026-07-07T09:00:00.000Z",
      randomBytes: (length) => sequentialBytes(length, 200),
    });

    expect(JSON.stringify(result)).not.toContain("Updated recovery note");
    expect(result).toMatchObject({
      type: 2,
      folderId: "work",
      organizationId: null,
      favorite: true,
      reprompt: 1,
      secureNote: { type: 0 },
      fields: [{ type: 0 }],
      passwordHistory: [],
      lastKnownRevisionDate: "2026-07-07T09:00:00.000Z",
    });

    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(userKey))).resolves.toBe(
      "Updated recovery note",
    );
    await expect(decryptEncStringToUtf8(result.notes, bytesToBase64(userKey))).resolves.toBe(
      "updated private note",
    );
    await expect(
      decryptEncStringToUtf8(result.fields[0]!.name!, bytesToBase64(userKey)),
    ).resolves.toBe("Region");
  });
});

describe("personal cipher preservation requests", () => {
  it("rejects an invalid preserved graph before personal encryption", async () => {
    const randomBytes = vi.fn((length: number) => sequentialBytes(length, 13));

    await expect(buildCardCipherUpdateRequest({
      userKeyB64: bytesToBase64(sequentialBytes(64, 31)),
      name: "Invalid card",
      cardholderName: "Ada",
      number: "4111",
      expMonth: "04",
      expYear: "2029",
      code: "123",
      notes: "",
      lastKnownRevisionDate: "2026-07-18T00:00:00.000Z",
      preserved: retainOpaqueCipherPayload({ Type: 3, Card: [], Fields: [] }),
      ownership: { organizationId: null, collectionIds: [] },
      randomBytes,
    })).rejects.toThrow(/safely preserve opaque personal cipher data/);
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it("rejects a missing rendered key before unwrapping or personal encryption", async () => {
    const randomBytes = vi.fn((length: number) => sequentialBytes(length, 23));

    await expect(buildCardCipherUpdateRequest({
      userKeyB64: bytesToBase64(sequentialBytes(64, 41)),
      name: "Keyed card",
      cardholderName: "Ada",
      number: "4111",
      expMonth: "04",
      expYear: "2029",
      code: "123",
      notes: "",
      lastKnownRevisionDate: "2026-07-18T00:00:00.000Z",
      preserved: retainOpaqueCipherPayload({
        Type: 3,
        Card: {},
        Fields: [],
        Key: "2.synthetic-preserved-key",
      }),
      ownership: { organizationId: null, collectionIds: [] },
      randomBytes,
    })).rejects.toThrow(/safely preserve opaque personal cipher data/);
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it("encrypts a keyed personal update with the unwrapped cipher key", async () => {
    const userKey = sequentialBytes(64, 131);
    const cipherKey = sequentialBytes(64, 191);
    const encryptedKey = await encryptBytesToEncString(
      cipherKey,
      userKey,
      (length) => sequentialBytes(length, 11),
    );
    const result = await buildCardCipherUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      encryptedKey,
      name: "Keyed card",
      cardholderName: "Ada",
      number: "4111",
      expMonth: "04",
      expYear: "2029",
      code: "123",
      notes: "",
      lastKnownRevisionDate: "2026-07-18T00:00:00.000Z",
      randomBytes: (length) => sequentialBytes(length, 50),
    });

    expect((result as unknown as { key: string }).key).toBe(encryptedKey);
    await expect(decryptEncStringToUtf8(result.name, bytesToBase64(cipherKey))).resolves.toBe(
      "Keyed card",
    );
  });

  it("serializes a linked field as an encrypted label with a null value", async () => {
    const userKey = sequentialBytes(64, 91);
    const userKeyB64 = bytesToBase64(userKey);
    const result = await buildCardCipherCreateRequest({
      userKeyB64,
      name: "Linked card",
      cardholderName: "",
      number: "",
      expMonth: "",
      expYear: "",
      code: "",
      notes: "",
      fields: [{ name: "Number alias", value: null, type: 3, linkedId: 305 }],
      randomBytes: (length) => sequentialBytes(length, 30),
    });
    const field = result.fields[0] as {
      readonly name: string;
      readonly value: null;
      readonly type: number;
      readonly linkedId: number;
    };

    expect(field).toMatchObject({ value: null, type: 3, linkedId: 305 });
    expect(JSON.stringify(result)).not.toContain("Number alias");
    await expect(decryptEncStringToUtf8(field.name, userKeyB64)).resolves.toBe("Number alias");
  });

  it.each([
    ["Card", buildCardCipherCreateRequest, 410],
    ["Identity", buildIdentityCipherCreateRequest, 305],
    ["Secure Note", buildSecureNoteCipherCreateRequest, 305],
  ] as const)("rejects an invalid %s linked target", async (_label, build, linkedId) => {
    const common = {
      userKeyB64: bytesToBase64(sequentialBytes(64, 171)),
      name: "Invalid linked field",
      notes: "",
      fields: [{ name: "Alias", value: null, type: 3 as const, linkedId }],
      randomBytes: (length: number) => sequentialBytes(length, 90),
    };
    const input = build === buildCardCipherCreateRequest
      ? { ...common, cardholderName: "", number: "", expMonth: "", expYear: "", code: "" }
      : build === buildIdentityCipherCreateRequest
        ? { ...common, firstName: "Ada", lastName: "Lovelace", email: "", phone: "", address1: "" }
        : common;

    await expect((build as (value: Record<string, unknown>) => Promise<unknown>)(input))
      .rejects.toThrow("Linked field target is not valid for this personal cipher type");
  });

  it.each([
    ["card", buildCardCipherUpdateRequest, {
      name: "Edited card", cardholderName: "Ada", number: "4111", expMonth: "04", expYear: "2029", code: "123", notes: "",
    }, { Card: { Number: "2.old", FutureCard: "opaque-card" } }],
    ["identity", buildIdentityCipherUpdateRequest, {
      name: "Edited identity", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "", address1: "", notes: "",
    }, { Identity: { FirstName: "2.old", FutureIdentity: "opaque-identity" } }],
    ["secure-note", buildSecureNoteCipherUpdateRequest, {
      name: "Edited note", notes: "private", noteType: 0,
    }, { SecureNote: { Type: 0, FutureNote: "opaque-note" } }],
  ] as const)("preserves opaque %s update data", async (type, build, editable, typedPayload) => {
    const preserved = retainOpaqueCipherPayload({
      Id: `${type}-1`,
      Type: type === "card" ? 3 : type === "identity" ? 4 : 2,
      Attachments: [{ Id: "attachment-1", FutureAttachment: "opaque-attachment" }],
      Fields: [{ Name: "2.old-name", Value: "2.old-value", Type: 0, FutureField: "opaque-field" }],
      DeletedDate: null,
      ArchivedDate: "2026-07-01T00:00:00.000Z",
      FutureTopLevel: "opaque-top",
      ...typedPayload,
    });
    const result = await (build as (input: Record<string, unknown>) => Promise<Record<string, unknown>>)({
      userKeyB64: bytesToBase64(sequentialBytes(64, 111)),
      ...editable,
      fields: [{ name: "Label", value: "Value", type: 0 }],
      lastKnownRevisionDate: "2026-07-18T00:00:00.000Z",
      preserved,
      ownership: { organizationId: null, collectionIds: [] },
      associations: [{ path: ["Fields"], editedToSource: [0] }],
      randomBytes: (length: number) => sequentialBytes(length, 70),
    });

    expect(result).toMatchObject({
      Attachments: [{ FutureAttachment: "opaque-attachment" }],
      fields: [{ FutureField: "opaque-field" }],
      DeletedDate: null,
      ArchivedDate: "2026-07-01T00:00:00.000Z",
      FutureTopLevel: "opaque-top",
      organizationId: null,
      collectionIds: [],
    });
  });
});

function sequentialBytes(length: number, start: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256);
}
