import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const vendorRoot = resolve(process.cwd(), "vendor/bitwarden-clients");
const completeManifestRoots = ["libs/assets", "libs/components", "libs/ui/common"];

describe("pinned official UI source", () => {
  it("records the exact upstream commit", () => {
    expect(readFileSync(resolve(vendorRoot, "UI_SOURCE_COMMIT"), "utf8").trim()).toBe(
      "f47b6946e01aed474875789081966d311d5b8289",
    );
  });

  it.each([
    [
      "libs/components/src/button/button.component.ts",
      "8e1b5fd1653a49b0973ff37af8d25032ea8cdfa112d705c1ae1c2ea3062c0e34",
    ],
    [
      "libs/components/src/avatar/avatar.component.ts",
      "3b2d102533e89d1c57c94fecbb2522b2fee55893f3cb2b8c973b6ff409893f1a",
    ],
    [
      "libs/components/src/tw-theme.css",
      "ac7c9260f11fb987c6c25f049958eff9b53e5270eef6fbd60334adc782d352e4",
    ],
    [
      "libs/ui/common/src/i18n.pipe.ts",
      "162dd777bc2ad6abcd19e7ce8c6c78463ebabf63a73bd22ecf6cf8a9558f5286",
    ],
    [
      "libs/assets/src/svg/index.ts",
      "78f3395e83f5ba71e750ee2e9ad15224beb6983dd39ba6f3d4f0af9ead5958a8",
    ],
    [
      "libs/ui/common/src/index.ts",
      "2f4d30ac63750df92937f31479076b815cdc7c82c9f8c0d5cf83915cf04ea4b7",
    ],
    [
      "libs/components/src/select/select.component.ts",
      "cec3ef8fe2c79088cd25bc8bc3ebf361b1d4fcc5e6c18d8ea9b41a41a7843b66",
    ],
    [
      "libs/components/src/select/select.component.html",
      "7925fc4d3be25ca3c8ae3293ae437c73e96c7559a279b11c4c12bef1300b8dd5",
    ],
    [
      "libs/components/src/select/option.component.ts",
      "b8127b89f01d28f8e46d3554f39ad7256c47fc919b2dd77c55e510c18208a8c4",
    ],
    [
      "libs/components/src/form-control/form-control.component.ts",
      "6baa9d9aa58edf98f0270f4aa7dad482238644942472ce8bb45b4584ea60a1f7",
    ],
    [
      "libs/components/src/form-control/form-control.component.html",
      "a7eb25bc5484c06c36b2b0cbcc6be6b65229bef8c2ac9487b1102aadc00f50ae",
    ],
    [
      "libs/components/src/form-control/form-control-base.directive.ts",
      "b785b6143ebdfd2ba8b04122f014e819cd0d34047b8be1d8ce4e741cab096741",
    ],
  ])("byte-matches %s", (relativePath, expectedHash) => {
    const sourcePath = resolve(vendorRoot, relativePath);
    expect(existsSync(sourcePath)).toBe(true);
    expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(expectedHash);
  });

  it("byte-matches the complete pinned UI source manifest", () => {
    const manifest = readFileSync(resolve(vendorRoot, "UI_SOURCE_SHA256SUMS"), "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})  (.+)$/);
        expect(match).not.toBeNull();
        return { hash: match![1], path: match![2] };
      });
    const expectedPaths = manifest.map((entry) => entry.path).sort();
    const completeRootPaths = completeManifestRoots
      .flatMap((directory) => filesBelow(resolve(vendorRoot, directory)))
      .map((path) => relative(vendorRoot, path))
      .sort();
    const authorityPaths = expectedPaths.filter(
      (path) => !completeManifestRoots.some((root) => path === root || path.startsWith(`${root}/`)),
    );
    const actualPaths = [...completeRootPaths, ...authorityPaths].sort();

    expect(actualPaths).toEqual(expectedPaths);
    for (const entry of manifest) {
      expect(createHash("sha256").update(readFileSync(resolve(vendorRoot, entry.path))).digest("hex"))
        .toBe(entry.hash);
    }
  });

  it("imports the pinned official theme token source into the popup runtime stylesheet", () => {
    const themeEntryPoint = readFileSync(
      resolve(process.cwd(), "apps/menubar-tauri/src/styles/official-theme.css"),
      "utf8",
    );

    expect(themeEntryPoint).toContain(
      '@import "../../../../vendor/bitwarden-clients/libs/components/src/tw-theme.css";',
    );
  });
});

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
