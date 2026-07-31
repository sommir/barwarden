import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDefaultHostService,
  isTauriRuntime,
} from "./default-host.service";

const legacyKdfSymbols = [
  "derive_pbkdf2_master_password_authentication_hash",
  "derivePbkdf2MasterPasswordAuthenticationHash",
  "MasterPasswordHashDeriver",
] as const;

const productionCallGraphFiles = [
  "apps/menubar-tauri/src/host/browser-host.service.ts",
  "apps/menubar-tauri/src/host/default-host.service.ts",
  "apps/menubar-tauri/src/host/tauri-host.service.ts",
  "apps/menubar-tauri/src/auth/master-password-crypto.ts",
  "apps/menubar-tauri/src-tauri/src/main.rs",
  "apps/menubar-tauri/src-tauri/src/http.rs",
] as const;

describe("createDefaultHostService", () => {
  it("recognizes every supported Tauri v2 bootstrap surface before globals are injected", () => {
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isTauriRuntime({ location: { protocol: "tauri:" } })).toBe(true);
    expect(
      isTauriRuntime({
        location: { protocol: "https:", hostname: "tauri.localhost" },
      }),
    ).toBe(true);
    expect(
      isTauriRuntime({
        location: { protocol: "https:", hostname: "example.test" },
      }),
    ).toBe(false);
  });

  it("keeps password KDF derivation outside the runtime host contract", () => {
    const host = createDefaultHostService();

    expect("deriveMasterPasswordAuthenticationHash" in host).toBe(false);
  });

  it("contains no production references to the retired PBKDF2 host branch", () => {
    const productionSources = productionCallGraphFiles
      .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
      .join("\n");

    for (const symbol of legacyKdfSymbols) {
      expect(productionSources, symbol).not.toContain(symbol);
    }
  });
});
