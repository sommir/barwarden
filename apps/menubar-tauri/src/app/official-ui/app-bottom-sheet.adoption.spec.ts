import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const app = (path: string) => join(root, "apps/menubar-tauri/src/app", path);

const nativeDialogOwners = [
  "settings/pin-setup-dialog.component.ts",
  "upstream-overlays/auth/environment/official-self-hosted-dialog.component.html",
  "upstream-overlays/auth/two-factor/official-two-factor-options.component.html",
  "upstream-overlays/generator/official-generator-history.component.html",
  "upstream-overlays/settings/official-about-dialog.component.html",
  "vault/archive-page.component.ts",
  "vault/trash-page.component.ts",
  "vault/vault-folder-dialog.component.ts",
  "vault/vault-reprompt-dialog.component.ts",
] as const;

describe("application bottom-sheet adoption", () => {
  it("routes every application-owned native dialog through the shared sheet component", () => {
    for (const path of nativeDialogOwners) {
      const source = readFileSync(app(path), "utf8");
      expect(source, path).toContain("<bw-app-bottom-sheet");
      expect(source, path).not.toContain("<dialog");
    }
  });

  it("keeps the shared sheet as the only application-owned native dialog shell", () => {
    const offenders = productionSources()
      .filter((path) => path !== "official-ui/app-bottom-sheet.component.ts")
      .filter((path) => readFileSync(app(path), "utf8").includes("<dialog"));

    expect(offenders).toEqual([]);
  });

  it("does not bypass the shared sheet with browser confirmation APIs", () => {
    const offenders = productionSources().filter((path) =>
      /\b(?:globalThis|window)\.(?:confirm|alert|prompt)\s*\(/.test(
        readFileSync(app(path), "utf8"),
      )
    );

    expect(offenders).toEqual([]);
  });

  it("routes Bitwarden dialog-service calls through the application sheet host", () => {
    const config = readFileSync(app("app.config.ts"), "utf8");
    const root = readFileSync(app("app.component.ts"), "utf8");

    expect(config).toContain("provide: DialogService");
    expect(config).toContain("useExisting: AppBottomSheetDialogService");
    expect(root).toContain("AppBottomSheetDialogHostComponent");
    expect(root).toContain("<bw-app-bottom-sheet-dialog-host");
  });

  it("does not install a component-local Bitwarden dialog service that bypasses the host", () => {
    const offenders = productionSources()
      .filter((path) => path !== "app.config.ts")
      .filter((path) =>
        /import\s+\{[^}]*\bDialogModule\b[^}]*\}\s+from\s+["']@bitwarden\/components(?:\/dialog\/dialog\.module)?["']/.test(
          readFileSync(app(path), "utf8"),
        )
      );

    expect(offenders).toEqual([]);
  });
});

function productionSources(directory = app("")): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    const relativePath = absolutePath.slice(app("").length + 1);
    if (entry.isDirectory()) {
      if (
        entry.name === "generated"
        || entry.name === "runtime-patches"
        || entry.name === "source-patches"
      ) {
        return [];
      }
      return productionSources(absolutePath);
    }
    if (
      !/\.(?:ts|html)$/.test(entry.name)
      || entry.name.endsWith(".spec.ts")
      || entry.name.endsWith("-transforms.ts")
      || entry.name === "upstream-source-map.ts"
    ) {
      return [];
    }
    return [relativePath];
  });
}
