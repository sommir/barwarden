import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { officialGeneratorAliasSources } from "../../../../official-generator-aliases";

const root = process.cwd();
const componentRoot = "vendor/bitwarden-clients/libs/tools/generator/components/src";

describe("official provider-free username settings", () => {
  it.each([
    ["username-settings.component.ts", "8b5ba31f3e52f6a9409097c00447065380249770f132c3732984c052d7868390"],
    ["username-settings.component.html", "e6d46ae6bec11d24844a63e01b0d3c5a156e3697035ee66aa57a2c45c9a152f0"],
    ["subaddress-settings.component.ts", "135430d6b059d3e4300b0f44be3c4d10c824670c493e001939cfc3e0bea0093a"],
    ["subaddress-settings.component.html", "3e01ed31420c4ca5c77da8ca94a1cb314b1c3f211e04e28ff97246ca71ba8ad2"],
    ["catchall-settings.component.ts", "7e2e0b41daa1386f9e14ff0b8f337a15224bd3f0636585d1037f7d5206546939"],
    ["catchall-settings.component.html", "1efd6cf34202e02872f62ee18e957a84a5a3f8bd1892bbf01118c3bd48f67aac"],
  ] as const)("pins %s", (file, expected) => {
    expect(sha(`${componentRoot}/${file}`)).toBe(expected);
  });

  it("maps exact aliases directly to all three pinned vendor components", () => {
    const aliases = new Map(officialGeneratorAliasSources);
    expect(aliases.get("@bitwarden/generator-overlay/username-settings")).toBe(
      `${componentRoot}/username-settings.component.ts`,
    );
    expect(aliases.get("@bitwarden/generator-overlay/subaddress-settings")).toBe(
      `${componentRoot}/subaddress-settings.component.ts`,
    );
    expect(aliases.get("@bitwarden/generator-overlay/catchall-settings")).toBe(
      `${componentRoot}/catchall-settings.component.ts`,
    );
  });

  it("removes the Task 1 compatibility sibling instead of redrawing vendor forms", () => {
    const overlay = join(root, "apps/menubar-tauri/src/app/upstream-overlays/generator");
    for (const file of [
      "generator-username-compatibility.component.ts",
      "generator-username-compatibility.component.html",
      "generator-username-compatibility-host.component.ts",
      "generator-username-compatibility-host.component.html",
    ]) {
      expect(existsSync(join(overlay, file)), file).toBe(false);
    }
    expect(existsSync(join(overlay, "official-username-settings.component.ts"))).toBe(false);
    expect(existsSync(join(overlay, "official-username-settings.component.html"))).toBe(false);
  });
});

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}
