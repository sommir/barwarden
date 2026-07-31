import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatTotpCode, generateTotpCode, parseTotpSeed } from "./totp.service";

const RFC6238_SHA1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC6238_SHA256_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("local TOTP adapter", () => {
  it("generates the RFC 6238 SHA-1 code and official countdown values", async () => {
    const seed = `otpauth://totp/Example:alice?secret=${RFC6238_SHA1_SECRET}&digits=8`;

    await expect(generateTotpCode(seed, 59)).resolves.toEqual({
      code: "94287082",
      formattedCode: "9428 7082",
      period: 30,
      secondsRemaining: 1,
      isExpiring: true,
    });
  });

  it("parses otpauth URI algorithm, digit and period overrides", async () => {
    const seed = `otpauth://totp/Example:alice?secret=${RFC6238_SHA256_SECRET}&algorithm=SHA256&digits=8&period=60`;

    expect(parseTotpSeed(seed)).toMatchObject({
      algorithm: "SHA-256",
      digits: 8,
      period: 60,
    });
    await expect(generateTotpCode(seed, 59)).resolves.toMatchObject({
      code: expect.stringMatching(/^\d{8}$/),
      period: 60,
      secondsRemaining: 1,
      isExpiring: true,
    });
  });

  it("formats standard six-digit codes into official grouped display text", () => {
    expect(formatTotpCode("123456")).toBe("123 456");
    expect(formatTotpCode("12345678")).toBe("1234 5678");
  });

  it("fails closed for malformed secrets and unsupported digit counts", async () => {
    expect(parseTotpSeed("not-a-valid*base32-secret")).toBeNull();
    expect(parseTotpSeed("otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&digits=7")).toBeNull();
    await expect(generateTotpCode("not-a-valid*base32-secret", 59)).rejects.toThrow(
      "Unsupported TOTP seed",
    );
  });
});
