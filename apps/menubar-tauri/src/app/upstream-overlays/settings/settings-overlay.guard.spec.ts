import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOfficialSettingsAliases,
  officialSettingsAliasSources,
  officialSettingsAuthorityPaths,
  officialSettingsClosureExclusions,
} from "../../../../official-settings-aliases";
import {
  officialAccountSecurityLocalAdaptations,
  officialSettingsTransformContracts,
  settingsExcludedTemplateContract,
} from "./official-settings-member-transforms";

const root = process.cwd();
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/settings";
const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";

describe("guarded official Settings source", () => {
  it("pins all twelve retained Settings authorities in the app-local manifest", () => {
    expect(read("vendor/bitwarden-clients/UI_SOURCE_COMMIT").trim()).toBe(pinnedRevision);
    expect(officialSettingsAuthorityPaths).toEqual([
      "apps/browser/src/tools/popup/settings/settings-v2.component.ts",
      "apps/browser/src/tools/popup/settings/settings-v2.component.html",
      "apps/browser/src/auth/popup/settings/account-security.component.ts",
      "apps/browser/src/auth/popup/settings/account-security.component.html",
      "apps/browser/src/vault/popup/settings/vault-settings.component.ts",
      "apps/browser/src/vault/popup/settings/vault-settings.component.html",
      "apps/browser/src/vault/popup/settings/appearance.component.ts",
      "apps/browser/src/vault/popup/settings/appearance.component.html",
      "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts",
      "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html",
      "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts",
      "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html",
    ]);

    const sourceManifest = JSON.parse(read("apps/menubar-tauri/official-settings-source-manifest.json")) as {
      upstreamRevision: string;
      authorities: Array<{ path: string; sha256: string }>;
    };
    expect(sourceManifest.upstreamRevision).toBe(pinnedRevision);
    expect(sourceManifest.authorities.map(({ path }) => path)).toEqual(officialSettingsAuthorityPaths);
    for (const authority of sourceManifest.authorities) {
      expect(sha(`vendor/bitwarden-clients/${authority.path}`), authority.path).toBe(authority.sha256);
    }
  });

  it("declares only the six retained aliases and exact closure exclusions", () => {
    expect(officialSettingsAliasSources).toEqual([
      ["@bitwarden/settings-overlay/settings-v2", `${overlayRoot}/generated/apps/browser/src/tools/popup/settings/settings-v2.component.ts`],
      ["@bitwarden/settings-overlay/account-security", `${overlayRoot}/generated/apps/browser/src/auth/popup/settings/account-security.component.ts`],
      ["@bitwarden/settings-overlay/vault-settings", `${overlayRoot}/generated/apps/browser/src/vault/popup/settings/vault-settings.component.ts`],
      ["@bitwarden/settings-overlay/appearance", `${overlayRoot}/generated/apps/browser/src/vault/popup/settings/appearance.component.ts`],
      ["@bitwarden/settings-overlay/about-page", `${overlayRoot}/generated/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts`],
      ["@bitwarden/settings-overlay/about-dialog", `${overlayRoot}/generated/apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts`],
    ]);
    expect(officialSettingsClosureExclusions).toEqual([
      { id: "browser-autofill", pattern: "autofill/popup/settings|blocked-domains|excluded-domains|clickItemsToAutofill|badgeCounter", flags: "i" },
      { id: "browser-runtime", pattern: "BrowserApi|nativeMessaging|background|webRequest|webNavigation|contentScript|chrome\\.tabs|browser\\.tabs", flags: "i" },
      { id: "admin", pattern: "admin-settings|device-management|domain.*management|reports", flags: "i" },
      { id: "premium-billing", pattern: "premium-v2|billing|PremiumBadge|hasPremiumFromAnySource", flags: "i" },
      { id: "import-export", pattern: "export-browser|import-browser|exportNoun|importNoun", flags: "i" },
      { id: "official-desktop", pattern: "await-desktop|desktopIntegration|sharedUnlock|biometrics", flags: "i" },
      { id: "sso", pattern: "singleSignOn|@bitwarden/auth/sso", flags: "i" },
      { id: "unsupported-navigation", pattern: "/notifications|/download-bitwarden|/more-from-bitwarden", flags: "i" },
      { id: "extension-rating", pattern: "rateExtension|RateUrls|\\brate\\s*\\(", flags: "i" },
      { id: "pin-unlock", pattern: "PinService|SetPin|pinLockWithMasterPassword|unlockWithPin", flags: "i" },
      { id: "phishing-detection", pattern: "phishingDetection|phishingBlocker", flags: "i" },
      { id: "extension-width", pattern: "extensionWidth|PopupWidthOption|PopupSizeService", flags: "i" },
    ]);
    for (const [specifier, source] of officialSettingsAliasSources) {
      const alias = buildOfficialSettingsAliases(root).find(({ replacement }) => replacement === resolve(root, source));
      expect(alias).toBeDefined();
      expect(alias!.find.test(specifier)).toBe(true);
      expect(alias!.find.test(`${specifier}/sibling`)).toBe(false);
      expect(existsSync(alias!.replacement), alias!.replacement).toBe(true);
    }
  });

  it("declares the complete transform contract and excluded template block", () => {
    expect(officialSettingsTransformContracts.map(({ authority }) => authority)).toEqual(officialSettingsAuthorityPaths);
    expect(officialSettingsTransformContracts.map(({ runtime }) => runtime)).toEqual(
      officialSettingsAuthorityPaths.map((authority) => `${overlayRoot}/generated/${authority}`),
    );
    expect(settingsExcludedTemplateContract).toEqual({
      authority: "apps/browser/src/tools/popup/settings/settings-v2.component.html",
      marker: 'routerLink="/autofill"',
    });
    expect(officialAccountSecurityLocalAdaptations).toEqual([
      {
        id: "runtime-pin",
        sourceFeature: "unlockWithPin",
        runtimeMembers: ["pinEnabled", "pinEnabledChange"],
        securityBoundary: "account-session-envelope-in-memory",
      },
      {
        id: "macos-touch-id",
        sourceFeature: "biometrics",
        runtimeMembers: [
          "biometricEnabled",
          "biometricAvailable",
          "biometricUnavailableReason",
          "biometricEnabledChange",
        ],
        securityBoundary: "tauri-local-authentication-keychain",
      },
    ]);
  });

  it("names local unlock adaptations without restoring browser unlock providers", () => {
    const authority = [
      read("vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.ts"),
      read("vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.html"),
    ].join("\n");
    const source = read(`${overlayRoot}/official-account-security.component.ts`);
    const template = read(`${overlayRoot}/official-account-security.component.html`);
    const runtime = `${source}\n${template}`;

    for (const adaptation of officialAccountSecurityLocalAdaptations) {
      expect(authority, adaptation.id).toContain(adaptation.sourceFeature);
      for (const member of adaptation.runtimeMembers) {
        expect(runtime, `${adaptation.id}:${member}`).toContain(member);
      }
    }
    for (const exclusion of officialSettingsClosureExclusions) {
      const inspectedRuntime = exclusion.id === "pin-unlock"
        ? runtime.replaceAll("setPinEnabledValue", "")
        : runtime;
      expect(inspectedRuntime, exclusion.id).not.toMatch(
        new RegExp(exclusion.pattern, exclusion.flags),
      );
    }
    expect(runtime).not.toMatch(
      /nativeMessaging|sharedUnlock|BrowserApi|PinService|SetPin|pinLockWithMasterPassword|AwaitDesktop|BiometricsService|BiometricStateService/,
    );
  });

  it("does not skip complete desktop and PIN closure exclusions", () => {
    const guard = read(
      "apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts",
    );

    expect(guard).not.toContain(
      `!["official-${"desktop"}", "pin-unlock"].includes(id)`,
    );
  });

  it("generates byte-identical outputs and records upstream, patch, and output hashes", () => {
    expect(runGenerator().status).toBe(0);
    const before = read(`${overlayRoot}/official-settings.transform-manifest.json`);
    expect(runGenerator().status).toBe(0);
    expect(read(`${overlayRoot}/official-settings.transform-manifest.json`)).toBe(before);

    const manifest = JSON.parse(before) as {
      authorities: Array<{ path: string; upstreamSha256: string; patch: { path: string; sha256: string }; output: { path: string; sha256: string } }>;
    };
    expect(manifest.authorities.map(({ path }) => path)).toEqual(officialSettingsAuthorityPaths);
    for (const authority of manifest.authorities) {
      expect(authority.upstreamSha256).toBe(sha(`vendor/bitwarden-clients/${authority.path}`));
      expect(authority.patch.sha256).toBe(sha(authority.patch.path));
      expect(authority.output.sha256).toBe(sha(authority.output.path));
    }
  });

  it("retains only the M13 Settings routes and controls with no excluded closure", () => {
    const generated = officialSettingsTransformContracts.map(({ runtime }) => read(runtime)).join("\n");
    for (const exclusion of officialSettingsClosureExclusions) {
      expect(generated, exclusion.id).not.toMatch(new RegExp(exclusion.pattern, exclusion.flags));
    }

    expect(routeLinks(read(`${overlayRoot}/generated/apps/browser/src/tools/popup/settings/settings-v2.component.html`))).toEqual([
      "/appearance",
      "/account-security",
      "/vault-settings",
      "/about",
    ]);
    expect(routeLinks(read(`${overlayRoot}/generated/apps/browser/src/vault/popup/settings/vault-settings.component.html`))).toEqual([
      "/folders",
      "/archive",
      "/trash",
    ]);
    const appearanceTemplate = read(
      `${overlayRoot}/generated/apps/browser/src/vault/popup/settings/appearance.component.html`,
    );
    expect(formControls(appearanceTemplate)).toEqual([
      "theme",
      "enableCompactMode",
      "enableAnimations",
      "enableFavicon",
      "showQuickCopyActions",
    ]);
    const expectedSwitchBindings = [
      { setting: "compactMode", read: "enableCompactMode", write: "enableCompactMode", toggled: "enableCompactMode" },
      { setting: "animations", read: "enableAnimations", write: "enableAnimations", toggled: "enableAnimations" },
      { setting: "showFavicons", read: "enableFavicon", write: "enableFavicon", toggled: "enableFavicon" },
      { setting: "showQuickCopyActions", read: "showQuickCopyActions", write: "showQuickCopyActions", toggled: "showQuickCopyActions" },
    ];
    expect(appearanceSwitchBindings(appearanceTemplate)).toEqual(expectedSwitchBindings);
    const appearanceSourcePatch = read(
      `${overlayRoot}/source-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch`,
    );
    const addedAppearanceSource = appearanceSourcePatch
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");
    expect(appearanceSwitchBindings(addedAppearanceSource)).toEqual(expectedSwitchBindings);
    expect(
      classMethods(read(`${overlayRoot}/generated/apps/browser/src/vault/popup/settings/appearance.component.ts`)),
    ).toEqual([
      "constructor",
      "ngOnInit",
      "updateFavicon",
      "saveTheme",
      "updateAnimations",
      "updateCompactMode",
      "updateQuickCopyActions",
    ]);
    expect(() =>
      read(`${overlayRoot}/upstream-edge-types/apps/browser/src/platform/browser/browser-popup-utils.d.ts`),
    ).toThrow();
    expect(() =>
      read(`${overlayRoot}/upstream-edge-types/apps/browser/src/platform/popup/layout/popup-size.service.d.ts`),
    ).toThrow();
  });

  it("rejects cross-wired appearance switch reads and writes even when the inventory is unchanged", () => {
    const template = read(
      `${overlayRoot}/generated/apps/browser/src/vault/popup/settings/appearance.component.html`,
    );
    const crossWiredRead = template.replace(
      '[attr.aria-checked]="appearanceForm.controls.enableCompactMode.value"',
      '[attr.aria-checked]="appearanceForm.controls.enableAnimations.value"',
    );
    const crossWiredWrite = template.replace(
      '(click)="appearanceForm.controls.enableCompactMode.setValue(!appearanceForm.controls.enableCompactMode.value)"',
      '(click)="appearanceForm.controls.enableAnimations.setValue(!appearanceForm.controls.enableAnimations.value)"',
    );

    expect(crossWiredRead).not.toBe(template);
    expect(crossWiredWrite).not.toBe(template);
    const expected = appearanceSwitchBindings(template);
    expect(appearanceSwitchBindings(crossWiredRead)).not.toEqual(expected);
    expect(appearanceSwitchBindings(crossWiredWrite)).not.toEqual(expected);
  });

  it("rejects retained source and excluded template mutations with the transform contract", () => {
    const sourceAuthority = "apps/browser/src/tools/popup/settings/settings-v2.component.ts";
    const source = read(`vendor/bitwarden-clients/${sourceAuthority}`);
    const sourceResult = runGenerator({
      [sourceAuthority]: source.replace(
        'import { CommonModule } from "@angular/common";',
        'import { CommonModule as DriftedCommonModule } from "@angular/common";',
      ),
    });
    expect(sourceResult.status).not.toBe(0);
    expect(sourceResult.output).toContain("Settings transform contract");

    const templateAuthority = settingsExcludedTemplateContract.authority;
    const template = read(`vendor/bitwarden-clients/${templateAuthority}`);
    const templateResult = runGenerator({
      [templateAuthority]: template.replace(settingsExcludedTemplateContract.marker, 'routerLink="/autofill-drift"'),
    });
    expect(templateResult.status).not.toBe(0);
    expect(templateResult.output).toContain("Settings transform contract");

    const aboutAuthority = "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html";
    const excludedClosureResult = runGenerator({
      [aboutAuthority]: `${read(`vendor/bitwarden-clients/${aboutAuthority}`)}\n<a routerLink="/notifications">Notifications</a>\n`,
    });
    expect(excludedClosureResult.status).not.toBe(0);
    expect(excludedClosureResult.output).toContain("Settings closure exclusion unsupported-navigation");

    for (const prohibitedWidthSymbol of ["extensionWidth", "PopupWidthOption", "PopupSizeService"]) {
      const extensionWidthResult = runGenerator({
        [aboutAuthority]: `${read(`vendor/bitwarden-clients/${aboutAuthority}`)}\n<!-- ${prohibitedWidthSymbol} -->\n`,
      });
      expect(extensionWidthResult.status, prohibitedWidthSymbol).not.toBe(0);
      expect(extensionWidthResult.output, prohibitedWidthSymbol).toContain(
        "Settings closure exclusion extension-width",
      );
    }
  });

  it("keeps the source boundary out of runtime pages and typechecks it in isolation", () => {
    expect(read("apps/menubar-tauri/src/app/settings/settings-page.component.ts")).not.toContain("settings-overlay");
    expect(read("apps/menubar-tauri/vite.config.ts")).toContain('import { buildOfficialSettingsAliases } from "./official-settings-aliases";');
    expect(read("apps/menubar-tauri/vite.config.ts")).toContain("...buildOfficialSettingsAliases(fileURLToPath(new URL(\"../..\", import.meta.url))),");

    const upstream = JSON.parse(read("apps/menubar-tauri/tsconfig.official-settings-upstream.json"));
    expect(upstream.compilerOptions.noCheck).not.toBe(true);
    expect(upstream.extends).toBe("../../tsconfig.json");
    expect(upstream.compilerOptions.noResolve).not.toBe(true);
    expect(upstream.files).toEqual([
      ...officialSettingsAuthorityPaths
        .filter((path) => path.endsWith(".ts"))
        .map((path) => `src/app/upstream-overlays/settings/generated/${path}`),
      "official-settings-upstream.edges.ts",
    ]);
    expect(() => read("apps/menubar-tauri/official-settings-upstream.compatibility.d.ts")).toThrow();
    const edgeShims = read("apps/menubar-tauri/official-settings-upstream.edges.ts");
    expect(edgeShims).not.toMatch(/\bany\b/);
    expect(edgeShims).not.toContain('declare module "*"');

    const local = JSON.parse(read("apps/menubar-tauri/tsconfig.official-settings.json"));
    expect(local.compilerOptions.strict).toBe(true);
    expect(local.compilerOptions.noImplicitAny).toBe(true);
    expect(local.compilerOptions.noImplicitReturns).toBe(true);
    expect(local.angularCompilerOptions).toMatchObject({
      strictInjectionParameters: true,
      strictInputAccessModifiers: true,
      strictTemplates: true,
    });
    expect(local.files).toEqual([
      "official-settings-aliases.ts",
      "src/app/upstream-overlays/settings/official-settings-member-transforms.ts",
      "src/app/upstream-overlays/settings/official-settings.component.ts",
      "src/app/upstream-overlays/settings/official-account-security.component.ts",
      "src/app/upstream-overlays/settings/official-vault-settings.component.ts",
      "src/app/upstream-overlays/settings/official-appearance.component.ts",
      "src/app/upstream-overlays/settings/official-about.component.ts",
      "src/app/upstream-overlays/settings/official-about-dialog.component.ts",
      "src/app/settings/settings-page.component.ts",
      "src/app/settings/global-shortcut-settings.service.ts",
      "src/app/settings/keyboard-shortcut-page.component.ts",
      "src/app/settings/account-security-page.component.ts",
      "src/app/settings/vault-settings-page.component.ts",
      "src/app/settings/autofill-settings-page.component.ts",
      "src/app/settings/appearance-page.component.ts",
      "src/app/settings/about-page.component.ts",
      "src/app/settings/settings-password-page.component.ts",
      "src/app/settings/settings.service.ts",
      "src/app/settings/environment-handoff.service.ts",
      "src/build-metadata.d.ts",
    ]);
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts["typecheck:official-settings:local"]).toBe(
      "node scripts/run-official-settings-local-typecheck.mjs",
    );
    const localRunner = read("scripts/run-official-settings-local-typecheck.mjs");
    expect(localRunner).toContain("NgtscProgram");
    expect(localRunner).toContain("getNgSemanticDiagnostics");
    expect(localRunner).toContain("ownedDiagnostics");
  });

  it("rejects a strict Angular Settings template type mismatch", () => {
    const directory = mkdtempSync(resolve(root, ".official-settings-template-typecheck-"));
    const probe = resolve(directory, "settings-template-probe.component.ts");
    const config = resolve(directory, "tsconfig.json");
    try {
      writeFileSync(
        probe,
        `import { Component } from "@angular/core";\n` +
        `@Component({ standalone: true, template: \`{{ missingSettingsProperty }}\` })\n` +
        `export class SettingsTemplateProbeComponent {}\n`,
      );
      writeFileSync(
        config,
        JSON.stringify({
          extends: resolve(root, "apps/menubar-tauri/tsconfig.official-settings.json"),
          files: [probe],
          include: [],
        }),
      );

      const result = spawnSync(process.execPath, [
        resolve(root, "scripts/run-official-settings-local-typecheck.mjs"),
        config,
      ], { cwd: root, encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        "Property 'missingSettingsProperty' does not exist",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("catches a real authority dependency member type mismatch", () => {
    const directory = mkdtempSync(resolve(root, ".official-settings-typecheck-"));
    const authority = resolve(
      root,
      `${overlayRoot}/generated/apps/browser/src/vault/popup/settings/vault-settings.component.ts`,
    );
    const probe = resolve(
      directory,
      "generated/apps/browser/src/vault/popup/settings/vault-settings.component.ts",
    );
    const config = resolve(directory, "tsconfig.json");
    try {
      mkdirSync(dirname(probe), { recursive: true });
      writeFileSync(
        probe,
        readFileSync(authority, "utf8").replace(
          "this.syncService.fullSync(true)",
          'this.syncService.fullSync("force")',
        ),
      );
      const upstream = JSON.parse(read("apps/menubar-tauri/tsconfig.official-settings-upstream.json")) as {
        files: string[];
      };
      writeFileSync(
        config,
        JSON.stringify({
          extends: resolve(root, "apps/menubar-tauri/tsconfig.official-settings-upstream.json"),
          compilerOptions: {
            types: [],
            rootDirs: [
              resolve(directory, "generated"),
              resolve(root, `${overlayRoot}/upstream-edge-types`),
            ],
          },
          files: [probe, resolve(root, "apps/menubar-tauri", upstream.files.at(-1)!)],
          include: [],
        }),
      );
      const result = spawnSync(resolve(root, "node_modules/.bin/tsc"), ["-p", config, "--pretty", "false"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toContain("error TS2345");
      expect(`${result.stdout}${result.stderr}`).toContain("Argument of type 'string'");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

function runGenerator(overrides: Record<string, string> = {}) {
  if (Object.keys(overrides).length === 0) {
    const result = spawnSync("node", ["scripts/update-official-settings-manifest.mjs"], { cwd: root, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  const fixture = mkdtempSync(resolve(tmpdir(), "official-settings-guard-"));
  try {
    const sourceManifest = {
      version: 1,
      upstreamRevision: pinnedRevision,
      authorities: officialSettingsAuthorityPaths.map((authority) => {
        const content = overrides[authority] ?? read(`vendor/bitwarden-clients/${authority}`);
        return { path: authority, sha256: shaText(content) };
      }),
    };
    write(fixture, "vendor/bitwarden-clients/UI_SOURCE_COMMIT", `${pinnedRevision}\n`);
    write(fixture, "apps/menubar-tauri/official-settings-source-manifest.json", `${JSON.stringify(sourceManifest, null, 2)}\n`);
    write(fixture, `${overlayRoot}/official-settings-member-transforms.ts`, read(`${overlayRoot}/official-settings-member-transforms.ts`));
    for (const contract of officialSettingsTransformContracts) {
      write(fixture, `vendor/bitwarden-clients/${contract.authority}`, overrides[contract.authority] ?? read(`vendor/bitwarden-clients/${contract.authority}`));
      write(fixture, contract.patch, read(contract.patch));
    }
    const result = spawnSync("node", [resolve(root, "scripts/update-official-settings-manifest.mjs")], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, OFFICIAL_SETTINGS_ROOT: fixture },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
}

function write(rootPath: string, path: string, content: string) {
  const target = resolve(rootPath, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
}

function shaText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function routeLinks(template: string): string[] {
  return [...template.matchAll(/routerLink="([^"]+)"/g)].map(([, route]) => route);
}

function formControls(template: string): string[] {
  return [...new Set(
    [...template.matchAll(
      /formControlName="([^"]+)"|appearanceForm\.controls\.([A-Za-z][A-Za-z0-9]*)/g,
    )].map(([, namedControl, referencedControl]) => namedControl ?? referencedControl),
  )];
}

function appearanceSwitchBindings(template: string): Array<{
  setting: string;
  read: string | undefined;
  write: string | undefined;
  toggled: string | undefined;
}> {
  return [...template.matchAll(/<button\b[\s\S]*?data-setting="([^"]+)"[\s\S]*?<\/button>/g)]
    .map(([button, setting]) => {
      const read = button.match(
        /\[attr\.aria-checked\]="appearanceForm\.controls\.([A-Za-z][A-Za-z0-9]*)\.value"/,
      )?.[1];
      const write = button.match(
        /\(click\)="appearanceForm\.controls\.([A-Za-z][A-Za-z0-9]*)\.setValue/,
      )?.[1];
      const toggled = button.match(
        /\.setValue\(!appearanceForm\.controls\.([A-Za-z][A-Za-z0-9]*)\.value\)"/,
      )?.[1];
      return { setting, read, write, toggled };
    });
}

function classMethods(source: string): string[] {
  return [...source.matchAll(/^\s{2}(?:async\s+)?(constructor|[A-Za-z][A-Za-z0-9]*)\s*\(/gm)].map(
    ([, method]) => method,
  );
}
