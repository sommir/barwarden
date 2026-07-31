import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BARWARDEN_BRAND } from "./brand";

describe("BARWARDEN_BRAND", () => {
  it("uses the exact frontend Barwarden identity", () => {
    expect(BARWARDEN_BRAND).toEqual({
      productName: "Barwarden",
      deviceName: "Barwarden macOS",
      storageNamespace: "barwarden",
    });
  });

  it("injects the package version through the active Barwarden Vitest contract", () => {
    const config = readFileSync(resolve(process.cwd(), "vitest.config.ts"), "utf8");

    expect(config).toContain("__BARWARDEN_VERSION__");
  });
});
