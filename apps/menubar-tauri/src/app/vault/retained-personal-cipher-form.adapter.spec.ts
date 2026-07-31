import { describe, expect, it } from "vitest";

import {
  CardLinkedId,
  CipherType,
  FieldType,
  IdentityLinkedId,
  SecureNoteType,
} from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import {
  RetainedPersonalCipherFormService,
  buildOfficialPersonalCipherFormConfig,
  freshPersonalCipherView,
  retainedPersonalSubmitToDraft,
} from "./retained-personal-cipher-form.adapter";

describe("retained personal cipher form adapter", () => {
  it.each([
    CipherType.Card,
    CipherType.Identity,
    CipherType.SecureNote,
  ] as const)("builds a fresh personal-only %s carrier", async (cipherType) => {
    const initial = personalView(cipherType);
    const config = buildOfficialPersonalCipherFormConfig({
      mode: "edit",
      cipherType,
      initial,
      folders: [FolderView.fromJSON({ id: "folder-1", name: "Work" })],
      canViewSecrets: false,
    });
    const service = new RetainedPersonalCipherFormService();

    expect(config.cipherType).toBe(cipherType);
    expect(config.organizationDataOwnershipDisabled).toBe(true);
    expect(config.collections).toEqual([]);
    expect(config.organizations).toEqual([]);
    expect(config.canViewSecrets).toBe(false);
    expect(config.originalCipher).toEqual({});

    const first = await service.decryptCipher(config.originalCipher!);
    const second = await service.decryptCipher(config.originalCipher!);
    expect(first).not.toBe(initial);
    expect(second).not.toBe(first);
    expect(first.fields).not.toBe(second.fields);
    expect(first.type).toBe(cipherType);
    first.name = "mutated";
    expect((await service.decryptCipher(config.originalCipher!)).name).toBe(
      `${personalTypeName(cipherType)} item`,
    );
  });

  it("keeps official linked fields for Card and Identity and rejects them for Secure Note", () => {
    const card = freshPersonalCipherView(personalView(CipherType.Card));
    const identity = freshPersonalCipherView(personalView(CipherType.Identity));
    const note = personalView(CipherType.SecureNote);

    expect(card.fields.at(-1)).toEqual(
      expect.objectContaining({
        type: FieldType.Linked,
        linkedId: CardLinkedId.Number,
      }),
    );
    expect(identity.fields.at(-1)).toEqual(
      expect.objectContaining({
        type: FieldType.Linked,
        linkedId: IdentityLinkedId.Email,
      }),
    );
    note.fields.push(
      Object.assign(new FieldView(), {
        name: "Forbidden linked field",
        value: null,
        type: FieldType.Linked,
        linkedId: CardLinkedId.Number,
      }),
    );

    expect(() => freshPersonalCipherView(note)).toThrow(/Secure Note.*linked/i);
  });

  it.each([
    CipherType.Card,
    CipherType.Identity,
    CipherType.SecureNote,
  ] as const)(
    "projects only known editable nested properties for personal type %s",
    (cipherType) => {
      const initial = personalView(cipherType);
      addNestedOpaqueState(initial);

      const projected = freshPersonalCipherView(initial);

      expect(projected.card).not.toBe(initial.card);
      expect(projected.identity).not.toBe(initial.identity);
      expect(projected.secureNote).not.toBe(initial.secureNote);
      expect(projected.fields).not.toBe(initial.fields);
      expect(projected.attachments).toEqual([]);
      expect(projected.passwordHistory).toEqual([]);
      for (const nested of [
        projected.card,
        projected.identity,
        projected.secureNote,
        ...projected.fields,
      ]) {
        expect(Reflect.get(nested, "opaqueNestedState")).toBeUndefined();
      }
      expect(projected.card.cardholderName).toBe(
        cipherType === CipherType.Card ? "Ada Lovelace" : undefined,
      );
      expect(projected.card.number).toBe(
        cipherType === CipherType.Card ? "4111 1111 1111 1111" : undefined,
      );
      expect(projected.identity.firstName).toBe(
        cipherType === CipherType.Identity ? "Ada" : undefined,
      );
      expect(projected.identity.passportNumber).toBe(
        cipherType === CipherType.Identity ? "P1234567" : undefined,
      );
      expect(projected.secureNote.type).toBe(SecureNoteType.Generic);
      expect(
        projected.fields.map(({ name, value, type, linkedId }) => ({
          name,
          value,
          type,
          linkedId,
        })),
      ).toEqual(
        initial.fields.map(({ name, value, type, linkedId }) => ({
          name,
          value,
          type,
          linkedId,
        })),
      );
    },
  );

  it.each([
    [CipherType.Card, FieldType.Linked, 9999, /linked field target/i],
    [CipherType.Identity, FieldType.Linked, 9999, /linked field target/i],
    [CipherType.Card, 99, undefined, /unsupported field type/i],
    [CipherType.Identity, 99, undefined, /unsupported field type/i],
    [CipherType.SecureNote, 99, undefined, /unsupported field type/i],
  ] as const)(
    "rejects invalid or unsupported field %s/%s/%s",
    (cipherType, type, linkedId, message) => {
      const view = personalView(cipherType);
      view.fields.push(
        Object.assign(new FieldView(), {
          name: "Rejected field",
          value: "opaque",
          type,
          linkedId,
        }),
      );

      expect(() => freshPersonalCipherView(view)).toThrow(message);
    },
  );

  it.each(["add", "edit", "clone"] as const)(
    "initializes complete official Card values in %s mode without config secret leakage when denied",
    async (mode) => {
      const initial = personalView(CipherType.Card);
      const config = buildOfficialPersonalCipherFormConfig({
        mode,
        cipherType: CipherType.Card,
        initial,
        folders: [],
        canViewSecrets: false,
      });

      expect(config.initialValues).toEqual(
        expect.objectContaining({
          name: "Card item",
          folderId: "folder-1",
          cardholderName: "Ada Lovelace",
          brand: "Visa",
          expMonth: "4",
          expYear: "29",
        }),
      );
      expect(config.initialValues).not.toHaveProperty("number");
      expect(config.initialValues).not.toHaveProperty("code");
      expect(JSON.stringify(config)).not.toContain("4111 1111 1111 1111");
      expect(JSON.stringify(config)).not.toContain("123");
      if (mode === "add") {
        expect(config.originalCipher).toBeUndefined();
      } else {
        expect(
          (
            await new RetainedPersonalCipherFormService().decryptCipher(
              config.originalCipher!,
            )
          ).card.cardholderName,
        ).toBe("Ada Lovelace");
      }
    },
  );

  it("strips clone server ownership and opaque state while retaining allowed plaintext", async () => {
    const initial = personalView(CipherType.Identity);
    Object.assign(initial, {
      organizationId: "org-1",
      collectionIds: ["collection-1"],
      archivedDate: new Date("2026-01-01T00:00:00.000Z"),
      deletedDate: new Date("2026-01-02T00:00:00.000Z"),
      edit: true,
      viewPassword: true,
      opaqueSentinel: "must-not-survive",
    });
    const config = buildOfficialPersonalCipherFormConfig({
      mode: "clone",
      cipherType: CipherType.Identity,
      initial,
      folders: [],
      canViewSecrets: true,
    });
    const clone = await new RetainedPersonalCipherFormService().decryptCipher(
      config.originalCipher!,
    );

    expect(clone.identity.firstName).toBe("Ada");
    expect(clone.identity.ssn).toBe("111-22-3333");
    expect(clone.id).toBe("cipher-1");
    expect(Reflect.get(clone, "opaqueSentinel")).toBeUndefined();
  });

  it("normalizes official Card, Identity, and Secure Note submits through Task 3 drafts", () => {
    expect(
      retainedPersonalSubmitToDraft({
        mode: "edit",
        cipherType: CipherType.Card,
        value: personalView(CipherType.Card),
      }),
    ).toEqual(
      expect.objectContaining({
        name: "Card item",
        cardholderName: "Ada Lovelace",
        number: "4111 1111 1111 1111",
        expMonth: "04",
        expYear: "29",
        code: "123",
      }),
    );
    expect(
      retainedPersonalSubmitToDraft({
        mode: "edit",
        cipherType: CipherType.Identity,
        value: personalView(CipherType.Identity),
      }),
    ).toEqual(
      expect.objectContaining({
        name: "Identity item",
        title: "Dr",
        firstName: "Ada",
        middleName: "Byron",
        lastName: "Lovelace",
        username: "ada",
        company: "Analytical Engines",
        ssn: "111-22-3333",
        passportNumber: "P1234567",
        licenseNumber: "DL-42",
        email: "ada@example.test",
        phone: "+44 20 0000 0000",
        address1: "1 Engine Way",
        address2: "Suite 2",
        address3: "North Wing",
        city: "London",
        state: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      }),
    );
    expect(
      retainedPersonalSubmitToDraft({
        mode: "add",
        cipherType: CipherType.SecureNote,
        value: personalView(CipherType.SecureNote),
      }),
    ).toEqual(
      expect.objectContaining({
        name: "SecureNote item",
        notes: "Private notes",
        noteType: SecureNoteType.Generic,
      }),
    );
  });

  it("rejects a submit whose declared type does not match its CipherView", () => {
    expect(() =>
      retainedPersonalSubmitToDraft({
        mode: "edit",
        cipherType: CipherType.Card,
        value: personalView(CipherType.Identity),
      }),
    ).toThrow(/cipher type/i);
  });
});

function personalView(
  cipherType: CipherType.Card | CipherType.Identity | CipherType.SecureNote,
): CipherView {
  const linked =
    cipherType === CipherType.Card
      ? CardLinkedId.Number
      : IdentityLinkedId.Email;
  return CipherView.fromJSON({
    id: "cipher-1",
    type: cipherType,
    name: `${personalTypeName(cipherType)} item`,
    folderId: "folder-1",
    favorite: true,
    reprompt: 1,
    key: "2.key|mac",
    attachments: [{ id: "attachment-1", fileName: "opaque.txt" }],
    fields: [
      { name: "Environment", value: "staging", type: FieldType.Text },
      { name: "PIN", value: "9876", type: FieldType.Hidden },
      { name: "Enabled", value: "true", type: FieldType.Boolean },
      ...(cipherType === CipherType.SecureNote
        ? []
        : [
            {
              name: "Official linked field",
              value: null,
              type: FieldType.Linked,
              linkedId: linked,
            },
          ]),
    ],
    card: {
      cardholderName: "Ada Lovelace",
      brand: "Visa",
      number: "4111 1111 1111 1111",
      expMonth: "4",
      expYear: "29",
      code: "123",
    },
    identity: {
      title: "Dr",
      firstName: "Ada",
      middleName: "Byron",
      lastName: "Lovelace",
      username: "ada",
      company: "Analytical Engines",
      ssn: "111-22-3333",
      passportNumber: "P1234567",
      licenseNumber: "DL-42",
      email: "ada@example.test",
      phone: "+44 20 0000 0000",
      address1: "1 Engine Way",
      address2: "Suite 2",
      address3: "North Wing",
      city: "London",
      state: "London",
      postalCode: "SW1A 1AA",
      country: "GB",
    },
    secureNote: { type: SecureNoteType.Generic },
    notes: "Private notes",
  })!;
}

function addNestedOpaqueState(view: CipherView): void {
  Reflect.set(view.card, "opaqueNestedState", "card-sentinel");
  Reflect.set(view.identity, "opaqueNestedState", "identity-sentinel");
  Reflect.set(view.secureNote, "opaqueNestedState", "secure-note-sentinel");
  for (const field of view.fields) {
    Reflect.set(field, "opaqueNestedState", `field-${field.name}`);
  }
  Reflect.set(view.attachments[0], "opaqueNestedState", "attachment-sentinel");
  view.passwordHistory = [
    Object.assign(
      {
        password: "old-secret",
        lastUsedDate: new Date("2025-01-01T00:00:00.000Z"),
      },
      { opaqueNestedState: "history-sentinel" },
    ),
  ];
}

function personalTypeName(cipherType: number): string {
  if (cipherType === CipherType.Card) return "Card";
  if (cipherType === CipherType.Identity) return "Identity";
  return "SecureNote";
}
