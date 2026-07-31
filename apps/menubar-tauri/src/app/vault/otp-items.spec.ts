import { describe, expect, it } from "vitest";

import { demoVaultItems } from "../vault-demo";
import { buildOtpEntries } from "./otp-items";

const validTotp = "JBSWY3DPEHPK3PXP";

describe("buildOtpEntries", () => {
  it("returns active login items with non-empty TOTP fields in vault order", () => {
    const loginWithTotp = {
      ...demoVaultItems[0]!,
      fields: demoVaultItems[0]!.fields.map((field) =>
        field.id === "otp" ? { ...field, value: validTotp } : field
      ),
    };
    const secondLogin = {
      ...loginWithTotp,
      id: "calendar",
      name: "Calendar",
      subtitle: "calendar@example.com",
    };

    expect(buildOtpEntries([loginWithTotp, demoVaultItems[1]!, secondLogin], ""))
      .toEqual([
        { item: loginWithTotp, field: loginWithTotp.fields.find((field) => field.id === "otp") },
        { item: secondLogin, field: secondLogin.fields.find((field) => field.id === "otp") },
      ]);
  });

  it("searches public item metadata without making the stored seed searchable", () => {
    const item = {
      ...demoVaultItems[0]!,
      name: "Microsoft 365",
      subtitle: "operator@example.com",
      fields: demoVaultItems[0]!.fields.map((field) =>
        field.id === "otp" ? { ...field, value: validTotp } : field
      ),
    };

    expect(buildOtpEntries([item], "microsoft")).toHaveLength(1);
    expect(buildOtpEntries([item], "operator")).toHaveLength(1);
    expect(buildOtpEntries([item], validTotp)).toEqual([]);
  });
});
