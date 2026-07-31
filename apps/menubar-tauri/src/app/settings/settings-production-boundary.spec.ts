import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  closureExclusionViolations,
  deriveTypeScriptRuntimeClosure,
} from "../../../../../scripts/lib/typescript-runtime-closure.mjs";

const excludedSettingsSurfaces = [
  "admin-settings", "extension-device-management", "blocked-domains", "excluded-domains",
  "premium-v2", "billing", "reports", "import-browser", "export-browser",
  "await-desktop-dialog", "nativeMessaging", "clickItemsToAutofillVaultView",
  "enableBadgeCounter", "extensionWidth", "rateExtension", "singleSignOn",
] as const;

const settingsRuntimeRoots = [
  "apps/menubar-tauri/src/app/app.routes.ts",
  "apps/menubar-tauri/src/app/settings/settings-page.component.ts",
  "apps/menubar-tauri/src/app/settings/account-security-page.component.ts",
  "apps/menubar-tauri/src/app/settings/vault-settings-page.component.ts",
  "apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts",
  "apps/menubar-tauri/src/app/settings/appearance-page.component.ts",
  "apps/menubar-tauri/src/app/settings/about-page.component.ts",
  "apps/menubar-tauri/src/app/settings/settings-password-page.component.ts",
] as const;

const officialOverlayHosts = [
  "settings-page.component.ts",
  "account-security-page.component.ts",
  "vault-settings-page.component.ts",
  "appearance-page.component.ts",
  "about-page.component.ts",
] as const;

describe("retained Settings production boundary", () => {
  it("keeps every excluded Settings surface out of the runtime TypeScript import closure", () => {
    const closure = settingsProductionClosure();

    expect(closure.roots).toContain("apps/menubar-tauri/src/app/app.routes.ts");

    expect(settingsClosureViolations(closure)).toEqual([]);
  });

  it("keeps official overlay hosts free of duplicate local Settings page markup", () => {
    for (const host of officialOverlayHosts) {
      const source = read(`apps/menubar-tauri/src/app/settings/${host}`);
      expect(source, host).not.toMatch(duplicateOverlayMarkup);
      expect(source, host).toMatch(/<bw-official-[a-z-]+/);
    }
  });

  it.each(["<popup-page>", "<popup-header>", "<bit-card>", "<bit-section>", "<bit-item-group>", "<bit-item>"])(
    "rejects duplicate local overlay markup %s in a host mutation",
    (markup) => {
      const source = `${read("apps/menubar-tauri/src/app/settings/settings-page.component.ts")}\n${markup}`;

      expect(source).toMatch(duplicateOverlayMarkup);
    },
  );

  it("rejects excluded Settings modules reached through renamed, lazy, and barrel route declarations", () => {
    const directory = mkdtempSync(join(tmpdir(), "settings-production-boundary-"));
    try {
      writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
        compilerOptions: { module: "ES2022", moduleResolution: "Bundler", target: "ES2022" },
      }));
      writeFileSync(join(directory, "app.routes.ts"), `
        import { ExcludedSettingsPage as PreferencesPage } from "./blocked-domains";
        import { PreferencesPage as AdvancedPage } from "./settings-barrel";
        export const routes = [
          { path: "preferences", component: PreferencesPage },
          { path: "advanced", component: AdvancedPage },
          { path: "appearance", loadComponent: () => import("./excluded-domains") },
        ];
      `);
      writeFileSync(join(directory, "blocked-domains.ts"), "export class ExcludedSettingsPage {}");
      writeFileSync(join(directory, "excluded-domains.ts"), "export class LazySettingsPage {}");
      writeFileSync(join(directory, "settings-barrel.ts"), 'export { PremiumSettingsPage as PreferencesPage } from "./premium-v2";');
      writeFileSync(join(directory, "premium-v2.ts"), "export class PremiumSettingsPage {}");

      const closure = settingsProductionClosure(directory, ["app.routes.ts"]);
      expect(settingsClosureViolations(closure)).toEqual(expect.arrayContaining([
        "blocked-domains:path:blocked-domains.ts",
        "blocked-domains:edge:app.routes.ts->./blocked-domains",
        "excluded-domains:path:excluded-domains.ts",
        "excluded-domains:edge:app.routes.ts->./excluded-domains",
        "premium-v2:path:premium-v2.ts",
        "premium-v2:edge:settings-barrel.ts->./premium-v2",
      ]));
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps the retained Settings manifest inputs free of excluded surface markers", () => {
    const manifestInputs = [
      "apps/menubar-tauri/official-settings-source-manifest.json",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json",
    ];

    for (const input of manifestInputs) {
      const source = read(input);
      for (const surface of excludedSettingsSurfaces) {
        expect(source, `${input}: ${surface}`).not.toContain(surface);
      }
    }
  });
});

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const duplicateOverlayMarkup = /<(?:popup-page|popup-header|bit-card|bit-section|bit-item-group|bit-item)\b/i;

function settingsProductionClosure(root = process.cwd(), roots: readonly string[] = settingsRuntimeRoots) {
  return deriveTypeScriptRuntimeClosure({ root, roots });
}

function settingsClosureViolations(closure: ReturnType<typeof deriveTypeScriptRuntimeClosure>) {
  return closureExclusionViolations(
    closure,
    excludedSettingsSurfaces.map((surface) => ({
      id: surface,
      pattern: surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      flags: "i",
      ignoredContentPaths: closure.paths.filter((path) => path.startsWith("vendor/")),
    })),
  );
}
