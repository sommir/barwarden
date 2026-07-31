import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { SecureNoteView } from "@bitwarden/common/vault/models/view/secure-note.view";
import { CipherType, FieldType, SecureNoteType } from "@bitwarden/common/vault/enums";
import { describe, expect, it } from "vitest";

import { retainOpaqueCipherPayload } from "./opaque-cipher-payload";
import type { VaultItem } from "./vault-item.model";
import { projectPersonalCipherDetail } from "./personal-cipher-view.adapter";

describe("projectPersonalCipherDetail", () => {
  it("projects a Card into fresh official views without exposing opaque data", () => {
    const opaque = "2.synthetic-opaque-card-value";
    const item = cardItem({
      opaqueServerPayload: retainOpaqueCipherPayload({ Future: opaque }),
      fields: [
        {
          id: "linked-number",
          label: "Number alias",
          value: "",
          type: "linked",
          linkedId: 305,
        },
      ],
    });

    const first = projectPersonalCipherDetail(item);
    const second = projectPersonalCipherDetail(item);

    expect(first.itemId).toBe("card-1");
    expect(first.itemType).toBe("card");
    expect(first.cipher).toBeInstanceOf(CipherView);
    expect(first.cipher.card).toBeInstanceOf(CardView);
    expect(first.cipher.type).toBe(CipherType.Card);
    expect(first.cipher.card).toMatchObject(item.card!);
    expect(first.cipher.fields[0]).toBeInstanceOf(FieldView);
    expect(first.cipher.fields[0]?.type).toBe(FieldType.Linked);
    expect(first.cipher.fields[0]?.linkedId).toBe(305);
    expect(first.actionFields.get("linked-number")).toBe(item.fields[0]);
    expect(first.folder).toBeInstanceOf(FolderView);
    expect(first.cipher).not.toBe(second.cipher);
    expect(first.cipher.card).not.toBe(second.cipher.card);
    expect(first.cipher).not.toHaveProperty("opaqueServerPayload");
    expect(first.cipher).not.toHaveProperty("encryptedKey");
    expect(first.cipher.organizationId).toBeUndefined();
    expect(first.cipher.collectionIds).toEqual([]);
    expect(first.cipher.attachments).toEqual([]);
    expect(JSON.stringify(first)).not.toContain(opaque);
  });

  it("projects every Identity field into an official IdentityView", () => {
    const item = identityItem();
    const projection = projectPersonalCipherDetail(item);

    expect(projection.itemType).toBe("identity");
    expect(projection.cipher.type).toBe(CipherType.Identity);
    expect(projection.cipher.identity).toBeInstanceOf(IdentityView);
    expect(projection.cipher.identity).toMatchObject(item.identity!);
    expect(projection.actionFields.get("identity-email")).toBe(item.fields[0]);
  });

  it("projects only Generic Secure Notes and preserves ordinary custom fields", () => {
    const item = secureNoteItem();
    const projection = projectPersonalCipherDetail(item);

    expect(projection.itemType).toBe("secure-note");
    expect(projection.cipher.type).toBe(CipherType.SecureNote);
    expect(projection.cipher.secureNote).toBeInstanceOf(SecureNoteView);
    expect(projection.cipher.secureNote.type).toBe(SecureNoteType.Generic);
    expect(projection.cipher.fields[0]).toMatchObject({
      name: "Environment",
      value: "production",
      type: FieldType.Text,
    });
  });

  it.each([
    { ...cardItem(), id: "" },
    { ...cardItem(), type: "login" as const },
    { ...cardItem(), type: "ssh-key" as const },
    { ...cardItem(), card: undefined },
    { ...identityItem(), identity: undefined },
    { ...secureNoteItem(), secureNote: undefined },
    { ...secureNoteItem(), secureNote: { type: 1 } },
  ])("rejects unsupported or structurally incomplete items", (item) => {
    expect(() => projectPersonalCipherDetail(item)).toThrow(TypeError);
  });

  it("rejects linked Secure Note fields because the pinned source has no linked options", () => {
    const item = secureNoteItem({
      fields: [
        { id: "linked", label: "Unsupported", value: "", type: "linked", linkedId: 100 },
      ],
    });

    expect(() => projectPersonalCipherDetail(item)).toThrow(TypeError);
  });

  it("rejects Card and Identity linked fields without an integer linked target", () => {
    const invalid = { id: "linked", label: "Broken", value: "", type: "linked" as const };

    expect(() => projectPersonalCipherDetail(cardItem({ fields: [invalid] }))).toThrow(TypeError);
    expect(() => projectPersonalCipherDetail(identityItem({ fields: [invalid] }))).toThrow(TypeError);
  });

  it.each([300, 301, 302, 303, 304, 305])(
    "accepts pinned Card linked ID %i",
    (linkedId) => {
      const item = cardItem({
        fields: [{ id: `custom:${linkedId}`, label: "Card link", value: "", type: "linked", linkedId }],
      });

      expect(projectPersonalCipherDetail(item).cipher.fields[0]?.linkedId).toBe(linkedId);
    },
  );

  it.each([400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418])(
    "accepts pinned Identity linked ID %i",
    (linkedId) => {
      const item = identityItem({
        fields: [{ id: `custom:${linkedId}`, label: "Identity link", value: "", type: "linked", linkedId }],
      });

      expect(projectPersonalCipherDetail(item).cipher.fields[0]?.linkedId).toBe(linkedId);
    },
  );

  it.each([
    ["card", 100], ["card", 101], ["card", 400], ["card", 418],
    ["card", -1], ["card", 299], ["card", 306], ["card", 307], ["card", 999],
    ["card", 300.5],
    ["identity", 100], ["identity", 101], ["identity", 300], ["identity", 305],
    ["identity", -1], ["identity", 399], ["identity", 419], ["identity", 450], ["identity", 999],
    ["identity", 400.5],
  ] as const)("rejects %s linked ID %s outside its pinned enum", (type, linkedId) => {
    const field = { id: "custom:0", label: "Wrong link", value: "", type: "linked" as const, linkedId };
    const item = type === "card" ? cardItem({ fields: [field] }) : identityItem({ fields: [field] });

    expect(() => projectPersonalCipherDetail(item)).toThrow(TypeError);
  });

  it("rejects empty and duplicate action field IDs before Map construction", () => {
    expect(() => projectPersonalCipherDetail(cardItem({
      fields: [{ id: "", label: "Empty ID", value: "value" }],
    }))).toThrow(TypeError);

    const first = { id: "custom:0", label: "PIN", value: "first-secret", type: "hidden" as const };
    const second = { id: "custom:0", label: "PIN", value: "second-secret", type: "hidden" as const };
    expect(() => projectPersonalCipherDetail(identityItem({ fields: [first, second] })))
      .toThrow(TypeError);
  });
});

function baseItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "base-1",
    type: "card",
    name: "Personal item",
    subtitle: "",
    favorite: true,
    reprompt: true,
    folderId: "folder-1",
    folderName: "Personal",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [],
    createdDate: "2026-07-01T01:02:03.000Z",
    revisionDate: "2026-07-02T01:02:03.000Z",
    notes: "Private notes",
    canLaunch: false,
    canFill: false,
    uri: "",
    ...overrides,
  };
}

function cardItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return baseItem({
    id: "card-1",
    type: "card",
    card: {
      cardholderName: "Ada Lovelace",
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "12",
      expYear: "2030",
      code: "123",
    },
    ...overrides,
  });
}

function identityItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return baseItem({
    id: "identity-1",
    type: "identity",
    identity: {
      title: "Dr",
      firstName: "Ada",
      middleName: "Augusta",
      lastName: "Lovelace",
      username: "ada",
      company: "Analytical Engines",
      ssn: "111-22-3333",
      passportNumber: "P123456",
      licenseNumber: "L123456",
      email: "ada@example.test",
      phone: "+1 555 0100",
      address1: "1 Computing Way",
      address2: "Suite 2",
      address3: "",
      city: "London",
      state: "Greater London",
      postalCode: "SW1A 1AA",
      country: "GB",
    },
    fields: [{ id: "identity-email", label: "Alias", value: "ada@example.test" }],
    ...overrides,
  });
}

function secureNoteItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return baseItem({
    id: "note-1",
    type: "secure-note",
    secureNote: { type: SecureNoteType.Generic },
    fields: [{ id: "environment", label: "Environment", value: "production", type: "text" }],
    ...overrides,
  });
}
