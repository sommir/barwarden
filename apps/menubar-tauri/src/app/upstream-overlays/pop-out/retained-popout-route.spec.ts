import { describe, expect, it } from "vitest";

import { normalizeRetainedPopoutRoute } from "./retained-popout-route";

describe("retained pop-out route matcher", () => {
  it.each([
    "/tabs/vault",
    "/tabs/otp",
    "/tabs/generator",
    "/tabs/send",
    "/tabs/settings",
    "/account-switcher",
    "/vault-settings",
    "/account-security",
    "/settings-password",
    "/autofill",
    "/appearance",
    "/new-item",
    "/new-item?folderId=work_1",
    "/folders",
    "/archive",
    "/trash",
    "/generator-history",
    "/add-send?type=text",
    "/about",
    "/view-cipher/cipher_1",
    "/add-cipher?type=1&folderId=work_1",
    "/edit-cipher?cipherId=cipher_1&type=1",
    "/clone-cipher?cipherId=cipher_1&type=4",
    "/cipher-password-history?cipherId=cipher_1",
    "/edit-send?sendId=send_1&type=text",
    "/send-created?sendId=send_1",
  ])("retains supported route %s", (route) => {
    expect(normalizeRetainedPopoutRoute(route)).toBe(route);
  });

  it.each([
    "/tabs/current",
    "/attachments",
    "/import",
    "/notifications",
    "//host/path",
    "/%2F%2Fhost/path",
    "/view-cipher/%2Fsecret",
    "/edit-cipher?cipherId=cipher_1&type=1&token=secret",
    "/add-cipher?type=9",
    "/new-item?folderId=work&token=secret",
    "/send-created?sendId=send_1&password=secret",
    "/unknown",
    "https://example.com",
  ])("falls back for non-retained route %s", (route) => {
    expect(normalizeRetainedPopoutRoute(route)).toBe("/tabs/vault");
  });
});
