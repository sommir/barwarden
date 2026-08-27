import "zone.js";
import "@angular/compiler";

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { OfficialSettingsComponent } from "./official-settings.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

const root = process.cwd();
const overlayRoot = join(root, "apps/menubar-tauri/src/app/upstream-overlays/settings");
const settingsRoot = join(root, "apps/menubar-tauri/src/app/settings");
const overlays = [
  ["official-settings.component.ts", "bw-official-settings"],
  ["official-account-security.component.ts", "bw-official-account-security"],
  ["official-vault-settings.component.ts", "bw-official-vault-settings"],
  ["official-appearance.component.ts", "bw-official-appearance"],
  ["official-about.component.ts", "bw-official-about"],
  ["official-about-dialog.component.ts", "bw-official-about-dialog"],
] as const;
const authorityPaths = [
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
] as const;
const runtimeOutputs = [
  "official-settings.component.ts",
  "official-settings.component.html",
  "official-account-security.component.ts",
  "official-account-security.component.html",
  "official-vault-settings.component.ts",
  "official-vault-settings.component.html",
  "official-appearance.component.ts",
  "official-appearance.component.html",
  "official-about.component.ts",
  "official-about.component.html",
  "official-about-dialog.component.ts",
  "official-about-dialog.component.html",
] as const;
const forbiddenOverlayDependencies = new Set([
  "AuthFacade",
  "EnvironmentHandoffService",
  "PopupStateStore",
  "Router",
  "TauriHostService",
  "VaultSessionService",
]);
const forbiddenResolvedModules = [
  { dependency: "AuthFacade", module: /(?:^|\/)auth\.facade\.[cm]?[jt]s$/ },
  {
    dependency: "EnvironmentHandoffService",
    module: /(?:^|\/)environment-handoff\.service\.[cm]?[jt]s$/,
  },
  { dependency: "PopupStateStore", module: /(?:^|\/)popup-state\.[cm]?[jt]s$/ },
  {
    dependency: "TauriHostService",
    module: /(?:^|\/)tauri-host\.service\.[cm]?[jt]s$/,
  },
  {
    dependency: "VaultSessionService",
    module: /(?:^|\/)vault-session\.service\.[cm]?[jt]s$/,
  },
] as const;
const forbiddenRuntimeModules = new Map([["@angular/router", "Router"]]);

describe("official Settings production overlays", () => {
  it("provides every retained official overlay root", () => {
    expect(
      overlays.filter(([path]) => !existsSync(join(overlayRoot, path))).map(([path]) => path),
    ).toEqual([]);
  });

  it("renders the retained Settings group order as 44px preference rows", async () => {
    const style = installSettingsPreferenceCss();
    try {
      await TestBed.configureTestingModule({
        imports: [OfficialSettingsComponent],
        providers: [
          OfficialI18nService,
          { provide: I18nService, useExisting: OfficialI18nService },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(OfficialSettingsComponent);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const groupTitles = Array.from(
        host.querySelectorAll<HTMLElement>(".settings-group__title"),
        (title) => title.dataset["settingsGroupTitle"],
      );
      const routeOrder = Array.from(
        host.querySelectorAll<HTMLButtonElement>("button.macos-preference-row"),
        (button) => button.dataset["settingsRoute"],
      );
      expect(groupTitles).toEqual(["general", "security", "application", "information"]);
      expect(routeOrder).toEqual([
        "/appearance", "/account-security", "/autofill", "/keyboard-shortcut",
        "/vault-settings", "/about",
      ]);
      for (const item of host.querySelectorAll<HTMLElement>(".macos-preference-row")) {
        expect(getComputedStyle(item).minHeight).toBe("44px");
      }
    } finally {
      style.remove();
    }
  });

  it("projects the stateful Settings header actions into the shared trailing slot", () => {
    const overlaySource = readFileSync(join(overlayRoot, "official-settings.component.ts"), "utf8");
    const overlayTemplate = readFileSync(join(overlayRoot, "official-settings.component.html"), "utf8");
    const hostSource = readFileSync(join(settingsRoot, "settings-page.component.ts"), "utf8");

    expect(overlaySource).not.toContain("PopupHeaderActionsComponent");
    expect(overlayTemplate).toContain('<ng-container slot="end">');
    expect(overlayTemplate).toContain('<ng-content select="[slot=end]" />');
    expect(hostSource).toContain("PopupHeaderActionsComponent");
    expect(hostSource).toContain('<bw-popup-header-actions slot="end" [showNew]="false" />');
  });

  it("binds About product labels from centralized metadata in runtime and guarded sources", () => {
    const aboutTemplate = readFileSync(join(overlayRoot, "official-about.component.html"), "utf8");
    const dialogTemplate = readFileSync(
      join(overlayRoot, "official-about-dialog.component.html"),
      "utf8",
    );
    const aboutPatch = readFileSync(
      join(
        overlayRoot,
        "runtime-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch",
      ),
      "utf8",
    );
    const dialogPatch = readFileSync(
      join(
        overlayRoot,
        "runtime-patches/apps__browser__src__tools__popup__settings__about-dialog__about-dialog.component.html.patch",
      ),
      "utf8",
    );

    expect(aboutTemplate).toContain('"i18nAboutProduct" | i18n: metadata.productName');
    expect(dialogTemplate).toContain('"i18nAboutProduct" | i18n: metadata.productName');
    expect(aboutPatch).toContain('"i18nAboutProduct" | i18n: metadata.productName');
    expect(dialogPatch).toContain('"i18nAboutProduct" | i18n: metadata.productName');
    for (const source of [aboutTemplate, dialogTemplate, aboutPatch, dialogPatch]) {
      expect(source).not.toContain("关于 Barwarden");
    }
  });

  it("rejects forbidden host services from the transitive presentation import closure", () => {
    const violations = overlays.flatMap(([path]) =>
      forbiddenImportsBelow(join(overlayRoot, path)).map(
        ({ dependency, path: violatingPath }) =>
          `${path} -> ${violatingPath.replace(`${root}/`, "")} imports ${dependency}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it("rejects a forbidden dependency accessed through a namespace import", () => {
    withImportFixture(
      {
        "overlay.ts":
          'import * as state from "./popup-state";\nexport const store = state.PopupStateStore;\n',
        "popup-state.ts": "export class PopupStateStore {}\n",
      },
      (entryPath) => {
        expect(forbiddenImportsBelow(entryPath)).toContainEqual({
          dependency: "PopupStateStore",
          path: entryPath,
        });
      },
    );
  });

  it("rejects a forbidden dependency renamed through a re-export barrel", () => {
    withImportFixture(
      {
        "barrel.ts":
          'export { PopupStateStore as Store } from "./popup-state";\n',
        "overlay.ts":
          'import { Store } from "./barrel";\nexport const store = Store;\n',
        "popup-state.ts": "export class PopupStateStore {}\n",
      },
      (entryPath) => {
        expect(forbiddenImportsBelow(entryPath)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ dependency: "PopupStateStore" }),
          ]),
        );
      },
    );
  });

  it.each([
    ["named", 'import { PopupStateStore } from "./popup-state";\n'],
    [
      "renamed named",
      'import { PopupStateStore as Store } from "./popup-state";\n',
    ],
    ["default", 'import Store from "./popup-state";\n'],
  ])(
    "rejects a forbidden dependency through a %s import",
    (_kind, declaration) => {
      withImportFixture(
        {
          "overlay.ts": declaration,
          "popup-state.ts":
            "export default class PopupStateStore {}\nexport { PopupStateStore };\n",
        },
        (entryPath) => {
          expect(forbiddenImportsBelow(entryPath)).toContainEqual({
            dependency: "PopupStateStore",
            path: entryPath,
          });
        },
      );
    },
  );

  it("accepts legitimate transitive presentation dependencies", () => {
    withImportFixture(
      {
        "overlay.ts": 'import { PresentationModel } from "./presentation";\n',
        "presentation.ts": "export class PresentationModel {}\n",
      },
      (entryPath) => {
        expect(forbiddenImportsBelow(entryPath)).toEqual([]);
      },
    );
  });

  it("binds all twelve runtime outputs to exact generated authorities and patches", () => {
    const manifestPath = join(overlayRoot, "official-settings.runtime-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    if (!existsSync(manifestPath)) {
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      authorities?: Array<{
        authority: { path: string; sha256: string };
        output: { path: string; sha256: string };
        patch: { path: string; sha256: string };
      }>;
    };

    expect(manifest.authorities?.map(({ authority }) => authority.path)).toEqual([...authorityPaths]);
    expect(manifest.authorities?.map(({ output }) => output.path)).toEqual(
      runtimeOutputs.map((path) => `apps/menubar-tauri/src/app/upstream-overlays/settings/${path}`),
    );
    for (const entry of manifest.authorities ?? []) {
      expect(entry.authority.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.patch.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.output.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(join(root, entry.patch.path))).toBe(true);
    }
  });

  it("fails closed when a tracked runtime overlay output is mutated", () => {
    const checker = join(root, "scripts/check-official-settings-runtime.mjs");
    expect(existsSync(checker)).toBe(true);
    if (!existsSync(checker)) {
      return;
    }
    const baseline = spawnSync(process.execPath, [checker], {
      cwd: root,
      encoding: "utf8",
    });
    expect(baseline.status, `${baseline.stdout}${baseline.stderr}`).toBe(0);
    expect(baseline.stdout).toContain("provenance check passed for 12 outputs");

    const fixture = mkdtempSync(join(tmpdir(), "official-settings-runtime-"));
    try {
      const fixtureOverlay = join(
        fixture,
        "apps/menubar-tauri/src/app/upstream-overlays/settings",
      );
      cpSync(overlayRoot, fixtureOverlay, { recursive: true });
      appendFileSync(join(fixtureOverlay, "official-about.component.html"), "\n<p>lookalike</p>\n");

      const result = spawnSync(process.execPath, [checker], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, OFFICIAL_SETTINGS_RUNTIME_ROOT: fixture },
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/output (?:hash )?drift/i);
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });

  it("keeps browser autofill Settings out of the native one-field route", () => {
    const source = readFileSync(join(settingsRoot, "autofill-settings-page.component.ts"), "utf8");

    expect(source).toContain("i18nAutofill");
    expect(source).not.toMatch(/vendor\/.*autofill\/popup\/settings/);
    expect(source).toContain("clipboardClearSecondsValues");
    expect(source).toContain("fillModeValues");
  });
});

function installSettingsPreferenceCss(): HTMLStyleElement {
  const source = [
    "apps/menubar-tauri/src/styles/macos-tokens.css",
    "apps/menubar-tauri/src/styles/global.css",
  ]
    .map((path) => readFileSync(join(root, path), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const tokens = new Map(
    [...rootDeclarations.matchAll(/(--(?:mac|bw)-[\w-]+):\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]),
  );
  const style = document.createElement("style");
  style.textContent = source.replace(
    /var\((--(?:mac|bw)-[\w-]+)\)/g,
    (value, name) => tokens.get(name) ?? value,
  );
  document.head.append(style);
  return style;
}

function forbiddenImportsBelow(entryPath: string): Array<{ dependency: string; path: string }> {
  const visited = new Set<string>();
  const violations: Array<{ dependency: string; path: string }> = [];
  const violationKeys = new Set<string>();

  visit(entryPath);
  return violations;

  function visit(path: string): void {
    if (visited.has(path)) {
      return;
    }
    visited.add(path);
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);

    for (const statement of sourceFile.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        hasRuntimeExport(statement)
      ) {
        const specifier = statement.moduleSpecifier.text;
        const forbiddenRuntimeModule = forbiddenRuntimeModules.get(specifier);
        if (forbiddenRuntimeModule) {
          addViolation(forbiddenRuntimeModule, path);
        }
        if (!specifier.startsWith(".")) {
          continue;
        }
        const exportedPath = resolveRuntimeImport(path, specifier);
        if (exportedPath) {
          const forbiddenResolvedModule =
            forbiddenDependencyForResolvedModule(exportedPath);
          if (forbiddenResolvedModule) {
            addViolation(forbiddenResolvedModule, path);
          }
          visit(exportedPath);
        }
        continue;
      }
      if (
        !ts.isImportDeclaration(statement) ||
        statement.importClause?.isTypeOnly ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const importedNames = runtimeImportedNames(statement.importClause);
      if (statement.importClause && importedNames.length === 0) {
        continue;
      }
      for (const dependency of importedNames) {
        if (forbiddenOverlayDependencies.has(dependency)) {
          addViolation(dependency, path);
        }
      }
      const specifier = statement.moduleSpecifier.text;
      const forbiddenRuntimeModule = forbiddenRuntimeModules.get(specifier);
      if (forbiddenRuntimeModule) {
        addViolation(forbiddenRuntimeModule, path);
      }
      if (!specifier.startsWith(".")) {
        continue;
      }
      const importedPath = resolveRuntimeImport(path, specifier);
      if (importedPath) {
        const forbiddenResolvedModule =
          forbiddenDependencyForResolvedModule(importedPath);
        if (forbiddenResolvedModule) {
          addViolation(forbiddenResolvedModule, path);
        }
        visit(importedPath);
      }
    }
  }

  function addViolation(dependency: string, path: string): void {
    const key = `${dependency}:${path}`;
    if (!violationKeys.has(key)) {
      violationKeys.add(key);
      violations.push({ dependency, path });
    }
  }
}

function runtimeImportedNames(importClause: ts.ImportClause | undefined): string[] {
  if (!importClause) {
    return [];
  }
  const names = importClause.name ? [importClause.name.text] : [];
  if (importClause.namedBindings) {
    if (ts.isNamespaceImport(importClause.namedBindings)) {
      names.push(importClause.namedBindings.name.text);
    } else {
      for (const element of importClause.namedBindings.elements) {
        if (!element.isTypeOnly) {
          names.push((element.propertyName ?? element.name).text);
        }
      }
    }
  }
  return names;
}

function hasRuntimeExport(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) {
    return false;
  }
  if (
    !declaration.exportClause ||
    ts.isNamespaceExport(declaration.exportClause)
  ) {
    return true;
  }
  if (ts.isNamedExports(declaration.exportClause)) {
    for (const element of declaration.exportClause.elements) {
      if (!element.isTypeOnly) {
        return true;
      }
    }
  }
  return false;
}

function forbiddenDependencyForResolvedModule(path: string): string | null {
  const normalizedPath = path.replaceAll("\\", "/");
  return (
    forbiddenResolvedModules.find(({ module }) => module.test(normalizedPath))
      ?.dependency ?? null
  );
}

function resolveRuntimeImport(importer: string, specifier: string): string | null {
  const unresolved = resolve(dirname(importer), specifier);
  const candidates = /\.[cm]?[jt]s$/.test(unresolved)
    ? [unresolved]
    : [`${unresolved}.ts`, join(unresolved, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function withImportFixture(
  files: Record<string, string>,
  assertion: (entryPath: string) => void,
): void {
  const fixture = mkdtempSync(join(tmpdir(), "official-settings-imports-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const outputPath = join(fixture, path);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, source);
    }
    assertion(join(fixture, "overlay.ts"));
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
}
