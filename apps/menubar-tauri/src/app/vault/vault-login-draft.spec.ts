import { describe, expect, it } from "vitest";

import { normalizeLoginDraft } from "./vault-login-draft";
import * as vaultLoginDraftModule from "./vault-login-draft";

describe("normalizeLoginDraft", () => {
  it("validates the required Login name at the normalized transport boundary", () => {
    const hasRequiredLoginName = (vaultLoginDraftModule as unknown as {
      hasRequiredLoginName?: (name: string) => boolean;
    }).hasRequiredLoginName;
    expect(hasRequiredLoginName).toBeTypeOf("function");
    expect(hasRequiredLoginName!("  ")).toBe(false);
    expect(hasRequiredLoginName!("  Production Login  ")).toBe(true);
  });

  it("normalizes every retained standard Login field without trimming secrets", () => {
    expect(normalizeLoginDraft({
      name: "  Production Login  ",
      username: "  operator@example.test  ",
      password: " secret with spaces ",
      totp: "  otpauth://totp/example  ",
      uris: [
        { uri: " https://one.example.test ", matchType: "default" },
        { uri: "", matchType: "1" },
        { uri: "https://two.example.test", matchType: "1" },
      ],
      fields: [
        { name: " Environment ", value: " Production ", type: "text" },
        { name: " PIN ", value: " 1234 ", type: "hidden" },
        { name: " Enabled ", value: true, type: "boolean" },
      ],
      notes: " operational note ",
      favorite: true,
      folderId: " work ",
      reprompt: true,
    })).toEqual({
      name: "Production Login",
      username: "operator@example.test",
      password: " secret with spaces ",
      totp: "otpauth://totp/example",
      uri: "https://one.example.test",
      uris: [
        { uri: "https://one.example.test", matchType: "default" },
        { uri: "https://two.example.test", matchType: "1" },
      ],
      fields: [
        { name: "Environment", value: " Production ", type: 0 },
        { name: "PIN", value: " 1234 ", type: 1 },
        { name: "Enabled", value: "true", type: 2 },
      ],
      notes: "operational note",
      favorite: true,
      folderId: "work",
      reprompt: true,
    });
  });
});
