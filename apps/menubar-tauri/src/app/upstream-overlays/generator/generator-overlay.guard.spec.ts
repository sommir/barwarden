import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  closureExclusionViolations,
  deriveTypeScriptRuntimeClosure,
} from "../../../../../../scripts/lib/typescript-runtime-closure.mjs";
import {
  buildOfficialGeneratorAliases,
  officialGeneratorClosureExclusions,
  officialGeneratorHistoryClosureExclusions,
  officialGeneratorAliasSources,
  resolveOfficialGeneratorInternalBoundary,
} from "../../../../official-generator-aliases";
import { officialSourceMappings } from "../../upstream-source-map";
import {
  applyExactContinuousBlockTransforms,
  generatorTemplateContracts,
  validateOfficialGeneratorMemberTransforms,
  validateOfficialEmptyGeneratorHistoryMemberTransforms,
  validateOfficialGeneratorHistoryParentMemberTransforms,
  validateOfficialGeneratorHistoryRowsMemberTransforms,
} from "./official-generator-member-transforms";

const root = process.cwd();
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/generator";
const vendorRoot = join(root, "vendor/bitwarden-clients");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("guarded official Generator overlay", () => {
  it("pins the official revision and direct source authorities", () => {
    expect(read("vendor/bitwarden-clients/UI_SOURCE_COMMIT").trim()).toBe(
      "f47b6946e01aed474875789081966d311d5b8289",
    );
    expect(sha("vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.ts"))
      .toBe("060a0e00d686c3a9a2cb422880fe171e7dccd7d4b0691a0783bee86b53c56e0b");
    expect(sha("vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts"))
      .toBe("c9d704e498be571efda2559c2b45b5aafe0702a309d8dbec2cb3cde8b94ba292");
    expect(sha("vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts"))
      .toBe("a7fabe8bd6b3ad15c89bc8eb466149cbd772ff2f373f36bf412d55113ee89fac");
    expect(sha("vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts"))
      .toBe("8b5ba31f3e52f6a9409097c00447065380249770f132c3732984c052d7868390");
    expect(sha("vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts"))
      .toBe("135430d6b059d3e4300b0f44be3c4d10c824670c493e001939cfc3e0bea0093a");
    expect(sha("vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts"))
      .toBe("7e2e0b41daa1386f9e14ff0b8f337a15224bd3f0636585d1037f7d5206546939");
  });

  it("maps exact aliases to the local wrapper and real vendor settings", () => {
    const expected = new Map([
      [
        "@bitwarden/generator-overlay/credential-generator",
        `${overlayRoot}/official-credential-generator.component.ts`,
      ],
      [
        "@bitwarden/generator-overlay/password-settings",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
      ],
      [
        "@bitwarden/generator-overlay/passphrase-settings",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
      ],
      [
        "@bitwarden/generator-overlay/username-settings",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
      ],
      [
        "@bitwarden/generator-overlay/subaddress-settings",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
      ],
      [
        "@bitwarden/generator-overlay/catchall-settings",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
      ],
    ]);
    expect(new Map(officialGeneratorAliasSources)).toEqual(expect.objectContaining({}));
    for (const [specifier, source] of expected) {
      expect(new Map(officialGeneratorAliasSources).get(specifier)).toBe(source);
    }
    for (const alias of buildOfficialGeneratorAliases(root)) {
      const specifier = officialGeneratorAliasSources.find(([, source]) =>
        resolve(root, source) === alias.replacement)?.[0];
      expect(specifier).toBeDefined();
      expect(alias.find.test(specifier!)).toBe(true);
      expect(alias.find.test(`${specifier!}/sibling`)).toBe(false);
    }
  });

  it("executes complete AST member transforms and rejects mutations", () => {
    const authority = read(
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.ts",
    );
    const runtimePath = `${overlayRoot}/official-generator-core.component.ts`;
    const runtime = read(runtimePath);
    expect(validateOfficialGeneratorMemberTransforms(authority, runtime)).toEqual([]);

    const wholeMemberMutation = runtime.replace(
      "protected rootOptions$ = new BehaviorSubject<Option<string>[]>([]);",
      "protected rootOptions$ = new ReplaySubject<Option<string>[]>(1);",
    );
    expect(validateOfficialGeneratorMemberTransforms(authority, wholeMemberMutation)).not.toEqual([]);

    const retainedStatementMutation = runtime.replace(
      "this.credentialTypeHint$.next(hint);",
      'this.credentialTypeHint$.next("");',
    );
    expect(validateOfficialGeneratorMemberTransforms(authority, retainedStatementMutation))
      .not.toEqual([]);
  });

  it("executes complete official history parent, row, and empty member contracts", () => {
    const cases = [
      [
        "apps/browser/src/tools/popup/generator/credential-generator-history.component.ts",
        `${overlayRoot}/official-generator-history.component.ts`,
        validateOfficialGeneratorHistoryParentMemberTransforms,
      ],
      [
        "libs/tools/generator/components/src/credential-generator-history.component.ts",
        `${overlayRoot}/official-generator-history-rows.component.ts`,
        validateOfficialGeneratorHistoryRowsMemberTransforms,
      ],
      [
        "libs/tools/generator/components/src/empty-credential-history.component.ts",
        `${overlayRoot}/official-empty-generator-history.component.ts`,
        validateOfficialEmptyGeneratorHistoryMemberTransforms,
      ],
    ] as const;
    for (const [authorityPath, runtimePath, validate] of cases) {
      const authority = read(`vendor/bitwarden-clients/${authorityPath}`);
      const runtime = read(runtimePath);
      expect(validate(authority, runtime), runtimePath).toEqual([]);
      expect(validate(authority, `${runtime}\nclass UnrelatedMutation {}`), runtimePath).toEqual([]);
    }
  });

  it("exact-applies every continuous official template transform", () => {
    for (const contract of generatorTemplateContracts) {
      const authority = read(`vendor/bitwarden-clients/${contract.authority}`);
      const runtime = read(contract.runtime);
      const expected = applyExactContinuousBlockTransforms(authority, contract);
      expect(expected, contract.runtime).toBe(runtime);

      const transformedBlock = contract.transforms.find(({ replacement }) => replacement.length > 0);
      if (transformedBlock) {
        expect(runtime.replace(transformedBlock.replacement, "mutated-template-block"))
          .not.toBe(expected);
      } else {
        expect(contract.transforms, contract.runtime).toEqual([]);
      }
    }
  });

  it("resolves static, dynamic, require, Angular lazy, and templateUrl edges", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "entry.ts"), `
      import "./static";
      export { exported } from "./exported";
      require("./required");
      void import("./dynamic");
      const routes = [
        { loadComponent: () => import("./component") },
        { loadChildren: () => import("./children") },
      ];
      @Component({ templateUrl: "./entry.html" }) class Entry {}
    `);
    for (const file of ["static", "exported", "required", "dynamic", "component", "children"]) {
      writeFileSync(join(directory, `${file}.ts`), `export const ${file} = true;`);
    }
    writeFileSync(join(directory, "entry.html"), "<p>pinned template</p>");

    const closure = deriveTypeScriptRuntimeClosure({ root: directory, roots: ["entry.ts"] });
    expect(closure.edges.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      "import", "export", "require", "dynamicImport", "loadComponent", "loadChildren", "templateUrl",
    ]));
    expect(closure.paths).toEqual(expect.arrayContaining([
      "entry.ts", "static.ts", "exported.ts", "required.ts", "dynamic.ts", "component.ts",
      "children.ts", "entry.html",
    ]));
  });

  it("propagates requested bindings through export-star barrels", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "entry.ts"), `
      import { retained } from "./barrel";
      export const result = retained;
    `);
    writeFileSync(join(directory, "barrel.ts"), `
      export * from "./retained";
      export * from "./excluded";
    `);
    writeFileSync(join(directory, "retained.ts"), "export const retained = true;");
    writeFileSync(join(directory, "excluded.ts"), "export const excluded = true;");

    const closure = deriveTypeScriptRuntimeClosure({ root: directory, roots: ["entry.ts"] });
    expect(closure.paths).toContain("retained.ts");
    expect(closure.paths).not.toContain("excluded.ts");
  });

  it("rejects a real transitive dynamic adapter edge by package, path, and content", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "entry.ts"), 'void import("./adapter");');
    writeFileSync(join(directory, "adapter.ts"), `
      require("@bitwarden/browser/autofill/background");
      export const forbiddenMarker = "nativeMessaging";
    `);
    const closure = deriveTypeScriptRuntimeClosure({ root: directory, roots: ["entry.ts"] });
    const violations = closureExclusionViolations(closure, [
      { id: "browser-provider", pattern: "@bitwarden/browser|autofill/background", flags: "i" },
      { id: "native-messaging", pattern: "nativeMessaging", flags: "i" },
    ]);
    expect(violations).toEqual(expect.arrayContaining([
      expect.stringContaining("browser-provider:edge"),
      expect.stringContaining("native-messaging:content"),
    ]));
  });

  it("rejects generic browser, provider, and SSO package edges with the production rules", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "entry.ts"), `
      require("@bitwarden/browser/runtime");
      void import("@bitwarden/generator/providers");
      void import("@bitwarden/auth/sso");
    `);
    const closure = deriveTypeScriptRuntimeClosure({ root: directory, roots: ["entry.ts"] });
    const violations = closureExclusionViolations(closure, officialGeneratorClosureExclusions);

    expect(violations).toEqual(expect.arrayContaining([
      expect.stringContaining("browser-package:edge"),
      expect.stringContaining("provider-package:edge"),
      expect.stringContaining("sso-package:edge"),
    ]));
  });

  it("limits the internal barrel boundary to exact retained vendor importers", () => {
    const passwordImporter = join(
      vendorRoot,
      "libs/tools/generator/core/src/engine/sdk-password-randomizer.ts",
    );
    const usernameImporter = join(
      vendorRoot,
      "libs/tools/generator/core/src/metadata/username/eff-word-list.ts",
    );
    const unrelatedImporter = join(
      vendorRoot,
      "libs/tools/generator/core/src/strategies/eff-username-generator-strategy.ts",
    );

    expect(resolveOfficialGeneratorInternalBoundary(root, "../types", passwordImporter))
      .toContain("official-generator-vendor-runtime.boundary.ts");
    expect(resolveOfficialGeneratorInternalBoundary(root, "../../engine", usernameImporter))
      .toContain("official-generator-vendor-runtime.boundary.ts");
    expect(resolveOfficialGeneratorInternalBoundary(root, "../types", unrelatedImporter)).toBeNull();
  });

  it("allows exact provider-free username sources and rejects real provider/browser/SSO mutations", () => {
    const allowed = {
      paths: [
        "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/username/eff-word-list.ts",
        "vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/email/plus-address.ts",
        "vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/email/catchall.ts",
      ],
      edges: [],
      sources: new Map(),
    };
    expect(closureExclusionViolations(allowed, officialGeneratorClosureExclusions)).toEqual([]);

    const directory = temporaryDirectory();
    writeFileSync(join(directory, "entry.ts"), 'void import("./forwarder-adapter");');
    writeFileSync(join(directory, "forwarder-adapter.ts"), `
      require("@bitwarden/browser/background");
      void import("@bitwarden/generator/integrations");
      void import("@bitwarden/auth/sso");
      export const provider = "ForwarderSettingsComponent";
    `);
    const mutated = deriveTypeScriptRuntimeClosure({ root: directory, roots: ["entry.ts"] });
    expect(closureExclusionViolations(mutated, officialGeneratorClosureExclusions)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("browser-package:edge"),
        expect.stringContaining("provider-package:edge"),
        expect.stringContaining("sso-package:edge"),
        expect.stringContaining("forbidden-provider-api:content"),
      ]),
    );
  });

  it("accepts the source-direct Generator and history runtimes while excluding browser graphs", () => {
    const aliases = Object.fromEntries(
      officialGeneratorAliasSources.map(([specifier, source]) => [specifier, [source]]),
    );
    const closure = deriveTypeScriptRuntimeClosure({
      root,
      roots: [
        "apps/menubar-tauri/src/app/generator/generator-page.component.ts",
        "apps/menubar-tauri/src/app/generator/generator.service.ts",
        "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts",
      ],
      aliases,
      resolveOverride: ({ importer, specifier }) =>
        resolveOfficialGeneratorInternalBoundary(root, specifier, importer),
    });
    expect(closureExclusionViolations(closure, officialGeneratorClosureExclusions)).toEqual([]);
    expect(closure.paths).toEqual(expect.arrayContaining([
      "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
      `${overlayRoot}/official-generator-history.component.ts`,
      `${overlayRoot}/official-generator-history-rows.component.ts`,
      `${overlayRoot}/official-empty-generator-history.component.ts`,
      "apps/menubar-tauri/src/app/generator/official-generator-history-view.adapter.ts",
      "apps/menubar-tauri/src/app/generator/generator-history-route.owner.ts",
    ]));
    expect(closure.paths).not.toContain(
      "vendor/bitwarden-clients/libs/common/src/tools/generator/services/local-generator-history.service.ts",
    );

    const historyClosure = deriveTypeScriptRuntimeClosure({
      root,
      roots: ["apps/menubar-tauri/src/app/generator/generator-history-page.component.ts"],
      aliases,
      resolveOverride: ({ importer, specifier }) =>
        resolveOfficialGeneratorInternalBoundary(root, specifier, importer),
    });
    expect(closureExclusionViolations(
      historyClosure,
      [...officialGeneratorClosureExclusions, ...officialGeneratorHistoryClosureExclusions],
    )).toEqual([]);
  });

  it("rejects history state, logging, dialog, copy, native-messaging, and SSO mutations", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "entry.ts"), `
      import "./history-state-provider";
      import "./history-dialog.service";
      require("@bitwarden/browser/native-messaging");
      void import("@bitwarden/auth/sso");
      export const copyDirective = "appCopyClick";
      export const semanticLog = "loading credential history";
      export class OfficialGeneratorHistoryMutation {
        state!: StateProvider;
        dialog!: DialogService;
        logger!: SemanticLogger;
      }
    `);
    writeFileSync(join(directory, "history-state-provider.ts"), `
      export const storage = "LocalGeneratorHistoryService SecretState";
    `);
    writeFileSync(join(directory, "history-dialog.service.ts"), "export const dialog = true;");

    const mutated = deriveTypeScriptRuntimeClosure({ root: directory, roots: ["entry.ts"] });
    expect(closureExclusionViolations(
      mutated,
      [...officialGeneratorClosureExclusions, ...officialGeneratorHistoryClosureExclusions],
    )).toEqual(
      expect.arrayContaining([
        expect.stringContaining("official-history-storage:path"),
        expect.stringContaining("browser-package:edge"),
        expect.stringContaining("sso-package:edge"),
        expect.stringContaining("forbidden-provider-api:content"),
        expect.stringContaining("forbidden-history-state-provider:content"),
        expect.stringContaining("forbidden-history-dialog-service:content"),
        expect.stringContaining("forbidden-history-semantic-logger:content"),
      ]),
    );
  });

  it("rejects SemanticLogger from a transitive history helper without a local history marker", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "entry.ts"), 'import "./generic-helper";');
    writeFileSync(join(directory, "generic-helper.ts"), `
      import { SemanticLogger } from "@bitwarden/common/tools/logging";
      export const logger: SemanticLogger | null = null;
    `);
    const historyClosure = deriveTypeScriptRuntimeClosure({
      root: directory,
      roots: ["entry.ts"],
    });
    expect(closureExclusionViolations(
      historyClosure,
      officialGeneratorHistoryClosureExclusions,
    )).toEqual([
      expect.stringContaining("forbidden-history-semantic-logger:content:generic-helper.ts"),
    ]);
  });

  it("keeps the route thin and records the source-direct overlay", () => {
    const route = read("apps/menubar-tauri/src/app/generator/generator-page.component.ts");
    expect(route).toContain('template: "<bw-official-credential-generator />"');
    expect(route).not.toMatch(/bit-card|bit-toggle|operationEpoch|settings\s*=|value\s*=/);
    const mapping = officialSourceMappings.find(({ localModule }) =>
      localModule === `${overlayRoot}/official-credential-generator.component.ts`);
    expect(mapping?.mode).toBe("overlay");
    expect(mapping?.upstreamSources).toEqual(expect.arrayContaining([
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.ts",
    ]));
  });

  it("contains no token recipe, closure lock, or Generator ambient declaration", () => {
    for (const path of [
      `${overlayRoot}/official-generator.transform-recipe.json`,
      `${overlayRoot}/official-generator.closure.lock.json`,
      "scripts/lib/official-generator-transform-recipe.mjs",
      "apps/menubar-tauri/official-generator-typecheck-boundaries.d.ts",
    ]) {
      expect(() => read(path), path).toThrow();
    }
  });
});

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}


function sha(path: string): string {
  return createHash("sha256").update(read(path)).digest("hex");
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "bitwarden-generator-closure-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "ES2022", moduleResolution: "Bundler", target: "ES2022" },
  }));
  return directory;
}
