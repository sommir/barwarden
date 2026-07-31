import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { officialGeneratorAliasSources } from "../../../../official-generator-aliases";
import {
  applyExactContinuousBlockTransforms,
  generatorTemplateContracts,
  validateOfficialGeneratorMemberTransforms,
} from "./official-generator-member-transforms";

const root = process.cwd();
const overlay = join(root, "apps/menubar-tauri/src/app/upstream-overlays/generator");

describe("M11 Generator source-direct correction", () => {
  it("uses the pinned popup wrapper and a separately transformed official core", () => {
    const wrapper = source("official-credential-generator.component.ts");
    const template = source("official-credential-generator.component.html");

    expect(wrapper).toContain("export class OfficialCredentialGeneratorComponent {}");
    expect(wrapper).toContain("OfficialGeneratorCoreComponent");
    expect(template).toContain("<bw-official-generator-core />");
    expect(template).not.toContain("updateUsernameBoolean");
  });

  it("compiles password and passphrase settings directly from pinned vendor source", () => {
    const aliases = Object.fromEntries(officialGeneratorAliasSources);
    expect(aliases["@bitwarden/generator-overlay/password-settings"]).toBe(
      "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
    );
    expect(aliases["@bitwarden/generator-overlay/passphrase-settings"]).toBe(
      "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
    );
    expect(existsSync(join(overlay, "official-password-settings.component.ts"))).toBe(false);
    expect(existsSync(join(overlay, "official-passphrase-settings.component.ts"))).toBe(false);
  });

  it("restores official provider-free username members and templates in the same core", () => {
    const core = source("official-generator-core.component.ts");
    const template = source("official-generator-core.component.html");
    const wrapper = source("official-credential-generator.component.html");

    for (const member of ["username", "usernameOptions$", "showAlgorithm$"]) {
      expect(core, member).toContain(member);
    }
    for (const selector of [
      "tools-username-settings",
      "tools-subaddress-settings",
      "tools-catchall-settings",
    ]) {
      expect(template, selector).toContain(selector);
    }
    expect(template).not.toMatch(/forwarder|email-forwarding-service/i);
    expect(wrapper).not.toContain("bw-generator-username-compatibility-host");
  });

  it("resolves real vendor settings without Generator ambient-module declarations", () => {
    expect(existsSync(join(root, "apps/menubar-tauri/official-generator-typecheck-boundaries.d.ts")))
      .toBe(false);

    const configPath = join(root, "tsconfig.json");
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(configFile.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      root,
      undefined,
      configPath,
    );
    const containingFile = join(overlay, "official-generator-core.component.ts");
    for (const [specifier, suffix] of [
      [
        "@bitwarden/generator-overlay/password-settings",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
      ],
      [
        "@bitwarden/generator-overlay/passphrase-settings",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
      ],
    ] as const) {
      const resolved = ts.resolveModuleName(
        specifier,
        containingFile,
        parsed.options,
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      expect(resolved?.replaceAll("\\\\", "/"), specifier).toMatch(suffix);
      expect(resolved, specifier).not.toMatch(/\.d\.ts$/);
    }
  });

  it("has no token-span recipe or arbitrary insert validator", () => {
    expect(existsSync(join(overlay, "official-generator.transform-recipe.json"))).toBe(false);
    expect(existsSync(join(overlay, "official-generator.closure.lock.json"))).toBe(false);
    expect(existsSync(join(root, "scripts/lib/official-generator-transform-recipe.mjs"))).toBe(false);
  });

  it("keeps every root strict option enabled in the isolated typecheck", () => {
    const config = JSON.parse(
      readFileSync(join(root, "apps/menubar-tauri/tsconfig.official-generator.json"), "utf8"),
    ) as { compilerOptions?: Record<string, unknown> };
    for (const option of [
      "isolatedModules",
      "noImplicitAny",
      "noImplicitOverride",
      "noImplicitReturns",
      "noPropertyAccessFromIndexSignature",
      "strictNullChecks",
      "strictPropertyInitialization",
    ]) {
      expect(config.compilerOptions?.[option], option).not.toBe(false);
    }
  });

  it("splits local strict and pinned-upstream settings checks honestly", () => {
    const localConfig = JSON.parse(
      readFileSync(join(root, "apps/menubar-tauri/tsconfig.official-generator.json"), "utf8"),
    ) as { files?: string[] };
    expect(localConfig.files ?? []).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/vendor\/bitwarden-clients|(?:password|passphrase|username|subaddress|catchall)-settings|\.d\.ts$/),
      ]),
    );
    expect(localConfig.files).toEqual(expect.arrayContaining([
      "src/app/generator/generator-clipboard.directive.ts",
      "src/app/generator/official-generator-toast.adapter.ts",
      "src/app/generator/official-generator-log.adapter.ts",
      "src/app/generator/official-credential-generator-service.adapter.ts",
      "src/app/generator/official-generator-account.adapter.ts",
      "src/app/generator/official-generator-history.adapter.ts",
      "src/app/generator/generator-history-runtime.port.ts",
      "src/app/generator/generator-history-route.owner.ts",
      "src/app/generator/official-generator-history-view.adapter.ts",
      "src/app/upstream-overlays/generator/official-generator-history.component.ts",
      "src/app/upstream-overlays/generator/official-generator-history-rows.component.ts",
      "src/app/upstream-overlays/generator/official-empty-generator-history.component.ts",
    ]));

    const upstreamConfigPath = join(
      root,
      "apps/menubar-tauri/tsconfig.official-generator-upstream.json",
    );
    expect(existsSync(upstreamConfigPath)).toBe(true);
    const upstreamConfig = JSON.parse(readFileSync(upstreamConfigPath, "utf8")) as {
      extends?: string;
      files?: string[];
    };
    expect(upstreamConfig.extends).toBe(
      "../../vendor/bitwarden-clients/libs/tools/generator/components/tsconfig.json",
    );
    expect(upstreamConfig.files).toEqual(expect.arrayContaining([
      "../../vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
      "../../vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
      "../../vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
      "../../vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
      "../../vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
      "src/app/generator/official-generator-vendor-runtime.boundary.ts",
    ]));

    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["typecheck:official-generator"]).toContain(
      "typecheck:official-generator:local",
    );
    expect(packageJson.scripts?.["typecheck:official-generator"]).toContain(
      "check:official-generator:upstream",
    );

    const pinChecker = readFileSync(
      join(root, "scripts/check-official-generator-upstream.mjs"),
      "utf8",
    );
    for (const sourceFile of [
      "username-settings.component.ts",
      "username-settings.component.html",
      "subaddress-settings.component.ts",
      "subaddress-settings.component.html",
      "catchall-settings.component.ts",
      "catchall-settings.component.html",
      "credential-generator-history.component.ts",
      "credential-generator-history.component.html",
      "empty-credential-history.component.ts",
      "empty-credential-history.component.html",
    ]) {
      expect(pinChecker, sourceFile).toContain(sourceFile);
    }
  });

  it("uses AST member and continuous template-block contracts", () => {
    const contracts = source("official-generator-member-transforms.ts");
    expect(contracts).toContain("validatePinnedMemberTransforms");
    expect(contracts).toContain("enforceCompleteRuntimeMembers: true");
    expect(contracts).toContain("generatorTemplateContracts");
    expect(contracts).not.toContain("retainedMembers:");
  });

  it("validates the pinned core and rejects whole-member and retained-statement mutations", () => {
    const authority = readFileSync(
      join(
        root,
        "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.ts",
      ),
      "utf8",
    );
    const runtime = source("official-generator-core.component.ts");

    expect(validateOfficialGeneratorMemberTransforms(authority, runtime)).toEqual([]);

    const memberMutation = runtime.replace(
      "protected rootOptions$ = new BehaviorSubject<Option<string>[]>([]);",
      "protected rootOptions$ = new ReplaySubject<Option<string>[]>(1);",
    );
    expect(validateOfficialGeneratorMemberTransforms(authority, memberMutation)).not.toEqual([]);

    const statementMutation = runtime.replace(
      "this.credentialTypeHint$.next(hint);",
      'this.credentialTypeHint$.next("");',
    );
    expect(validateOfficialGeneratorMemberTransforms(authority, statementMutation)).not.toEqual([]);
  });

  it("exact-applies official template blocks and rejects a whole-block mutation", () => {
    for (const contract of generatorTemplateContracts) {
      const authority = readFileSync(
        join(root, "vendor/bitwarden-clients", contract.authority),
        "utf8",
      );
      const runtime = readFileSync(join(root, contract.runtime), "utf8");
      const expected = applyExactContinuousBlockTransforms(authority, contract);
      expect(expected, contract.runtime).toBe(runtime);

      const retainedBlock = contract.transforms.find(({ replacement }) => replacement.length > 0);
      if (retainedBlock) {
        const blockMutation = runtime.replace(
          retainedBlock.replacement,
          '<div data-mutated-template-block="true"></div>',
        );
        expect(expected, contract.runtime).not.toBe(blockMutation);
      } else {
        expect(contract.transforms, contract.runtime).toEqual([]);
      }
    }
  });
});

function source(file: string): string {
  return readFileSync(join(overlay, file), "utf8");
}
