import { createRequire } from "node:module";

import type { Kdf } from "@bitwarden/sdk-internal";
import { describe, expect, it } from "vitest";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const toBase64 = (value: Uint8Array): string =>
  btoa(String.fromCharCode(...value));

const nodeSdk = createRequire(import.meta.url)("@bitwarden/sdk-internal") as typeof import("@bitwarden/sdk-internal");

describe("Official SDK KDF integration", () => {
  it.each([
    [{ pBKDF2: { iterations: 600_000 } }, "HJI9bxiJ9wmROnaXddR4yNw1BbCExWM+pf4tCufj584="],
    [{ argon2id: { iterations: 3, memory: 64, parallelism: 4 } }, "ZduKRvezs8F8103A1ZUk/1ZN+rk3Kv+D1sFgvpnaAG0="],
  ] as const)("matches the installed official SDK KDF vector", async (kdf, expected) => {
    const result = nodeSdk.PureCrypto.derive_kdf_material(
      bytes("test-password"),
      bytes("user@example.com"),
      kdf as Kdf,
    );

    expect(toBase64(result)).toBe(expected);
  });
});
