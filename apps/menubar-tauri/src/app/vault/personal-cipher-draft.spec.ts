import { CardLinkedId, IdentityLinkedId } from "@bitwarden/common/vault/enums/linked-id-type.enum";
import { describe, expect, it } from "vitest";

import { personalCipherFieldInputs } from "./personal-cipher-draft";
import type { VaultField, VaultItem } from "./vault-item.model";

describe("personalCipherFieldInputs", () => {
  it.each([
    ["card", CardLinkedId.Number],
    ["identity", IdentityLinkedId.Email],
  ] as const)("converts typed and linked %s custom fields without linked target values", (type, linkedId) => {
    const fields: readonly VaultField[] = [
      { id: type === "card" ? "number" : "email", label: "Standard", value: "excluded" },
      { id: "custom:text", label: " Text ", value: "value", type: "text" },
      { id: "custom:hidden", label: "Hidden", value: "secret", type: "hidden" },
      { id: "custom:boolean", label: "Enabled", value: "true", type: "boolean" },
      { id: "custom:linked", label: "Alias", value: "must-not-escape", type: "linked", linkedId },
    ];

    expect(personalCipherFieldInputs(personalItem(type, fields))).toEqual([
      { name: "Text", value: "value", type: 0 },
      { name: "Hidden", value: "secret", type: 1 },
      { name: "Enabled", value: true, type: 2 },
      { name: "Alias", value: null, type: 3, linkedId },
    ]);
  });

  it.each([
    ["card", IdentityLinkedId.Email],
    ["identity", CardLinkedId.Number],
    ["secure-note", CardLinkedId.Number],
  ] as const)("rejects invalid %s linked field target %s", (type, linkedId) => {
    expect(() => personalCipherFieldInputs(personalItem(type, [
      { id: "custom:linked", label: "Alias", value: "", type: "linked", linkedId },
    ]))).toThrow("Linked field target is not valid for this personal cipher type");
  });
});

function personalItem(type: "card" | "identity" | "secure-note", fields: readonly VaultField[]): VaultItem {
  return {
    id: `${type}-1`, type, name: "Item", subtitle: "", favorite: false, folderId: "", folderName: "",
    organizationName: "", attachmentCount: 0, uris: [], fields, createdDate: "2026-07-01T00:00:00.000Z",
    revisionDate: "2026-07-18T00:00:00.000Z", notes: "", canLaunch: false, canFill: false, uri: "",
    ...(type === "card" ? { card: { cardholderName: "", brand: "", number: "", expMonth: "", expYear: "", code: "" } } : {}),
    ...(type === "identity" ? { identity: { title: "", firstName: "", middleName: "", lastName: "", username: "", company: "", ssn: "", passportNumber: "", licenseNumber: "", email: "", phone: "", address1: "", address2: "", address3: "", city: "", state: "", postalCode: "", country: "" } } : {}),
    ...(type === "secure-note" ? { secureNote: { type: 0 } } : {}),
  };
}
