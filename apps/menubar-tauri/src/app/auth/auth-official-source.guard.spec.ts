import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { officialSourceMappings } from "../upstream-source-map";

const repositoryRoot = process.cwd();
const vendorRoot = join(repositoryRoot, "vendor/bitwarden-clients");
const expectedRevision = [
  "https://github.com/bitwarden/clients.git",
  "f47b6946e01aed474875789081966d311d5b8289",
  "",
].join("\n");
const expectedAuthorityDigest = "3890e40a3bcb917db3bbc43dc51fb875190109421ff4c27d62ee4b164baf2fcc";
const lockComponentsRoot = "libs/key-management-ui/src/lock/components";
const productionTypeScriptRoots = [
  "apps/menubar-tauri/src",
  "apps/menubar-tauri/official-components-overlay",
] as const;
const expectedLockComponentFiles = [
  "lock.component.html",
  "lock.component.spec.ts",
  "lock.component.ts",
  "master-password-lock/master-password-lock.component.html",
  "master-password-lock/master-password-lock.component.spec.ts",
  "master-password-lock/master-password-lock.component.ts",
  "unlock-via-prf.component.ts",
] as const;

const officialAuthSources = [
  "apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts",
  "apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html",
  "libs/angular/src/auth/environment-selector/environment-selector.component.ts",
  "libs/angular/src/auth/environment-selector/environment-selector.component.html",
  "libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
  "libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
  "libs/auth/src/angular/login/login.component.ts",
  "libs/auth/src/angular/login/login.component.html",
  "libs/auth/src/angular/login/login-component.service.ts",
  "libs/auth/src/angular/password-hint/password-hint.component.ts",
  "libs/auth/src/angular/password-hint/password-hint.component.html",
  "libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
  "libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html",
  "libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
  "libs/auth/src/angular/two-factor-auth/two-factor-options.component.html",
  "libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts",
  "libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.html",
  "libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts",
  "libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.html",
  "libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
  "libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
  "libs/key-management-ui/src/lock/components/lock.component.ts",
  "libs/key-management-ui/src/lock/components/lock.component.html",
  "libs/key-management-ui/src/lock/components/lock.component.spec.ts",
  "libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
  "libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html",
  "libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.spec.ts",
  "libs/key-management-ui/src/lock/components/unlock-via-prf.component.ts",
  "apps/browser/src/auth/popup/account-switching/current-account.component.ts",
  "apps/browser/src/auth/popup/account-switching/current-account.component.html",
  "apps/browser/src/auth/popup/account-switching/account-switcher.component.ts",
  "apps/browser/src/auth/popup/account-switching/account-switcher.component.html",
  "apps/browser/src/auth/popup/account-switching/account.component.ts",
  "apps/browser/src/auth/popup/account-switching/account.component.html",
  "apps/browser/src/auth/popup/account-switching/services/account-switcher.service.ts",
] as const;

const exactAliases = [
  [
    "@bitwarden/official-auth-popup/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component",
    "apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts",
  ],
  [
    "@bitwarden/angular/auth/environment-selector/environment-selector.component",
    "libs/angular/src/auth/environment-selector/environment-selector.component.ts",
  ],
  [
    "@bitwarden/angular/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component",
    "libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
  ],
  [
    "@bitwarden/auth/angular/login/login.component",
    "libs/auth/src/angular/login/login.component.ts",
  ],
  [
    "@bitwarden/auth/angular/login/login-component.service",
    "libs/auth/src/angular/login/login-component.service.ts",
  ],
  [
    "@bitwarden/auth/angular/password-hint/password-hint.component",
    "libs/auth/src/angular/password-hint/password-hint.component.ts",
  ],
  [
    "@bitwarden/auth/angular/two-factor-auth/two-factor-auth.component",
    "libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
  ],
  [
    "@bitwarden/auth/angular/two-factor-auth/two-factor-options.component",
    "libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
  ],
  [
    "@bitwarden/auth/angular/two-factor-auth/two-factor-auth-email.component",
    "libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts",
  ],
  [
    "@bitwarden/auth/angular/two-factor-auth/two-factor-auth-authenticator.component",
    "libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts",
  ],
  [
    "@bitwarden/auth/angular/new-device-verification/new-device-verification.component",
    "libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
  ],
  [
    "@bitwarden/key-management-ui/lock/components/lock.component",
    "libs/key-management-ui/src/lock/components/lock.component.ts",
  ],
  [
    "@bitwarden/key-management-ui/lock/components/master-password-lock/master-password-lock.component",
    "libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
  ],
  [
    "@bitwarden/official-auth-popup/account-switching/current-account.component",
    "apps/browser/src/auth/popup/account-switching/current-account.component.ts",
  ],
] as const;

type ViteAlias = {
  find: string | RegExp;
  replacement: string;
};

type ViteConfig = {
  resolve?: {
    alias?: ViteAlias[];
  };
};

type SerializedViteAlias = Omit<ViteAlias, "find"> & {
  find: string | { source: string; flags: string };
};

type TypeScriptSource = {
  path: string;
  source: string;
};

type DormantAuthorityImport = {
  importer: string;
  specifier: string;
  target: string;
};

function activeTypeScriptPaths(): Record<string, readonly string[]> {
  const configPath = join(repositoryRoot, "tsconfig.json");
  const result = ts.readConfigFile(configPath, ts.sys.readFile);
  if (result.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(result.error.messageText, "\n"),
    );
  }

  return (
    ts.parseJsonConfigFileContent(result.config, ts.sys, repositoryRoot).options
      .paths ?? {}
  );
}

function activeViteConfig(configPath: string): ViteConfig {
  const absoluteConfigPath = join(repositoryRoot, configPath);
  const script = `
    import { loadConfigFromFile } from "vite";
    const result = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      ${JSON.stringify(absoluteConfigPath)},
    );
    if (!result) throw new Error("Unable to load config");
    console.log(JSON.stringify({
      resolve: {
        alias: (result.config.resolve?.alias ?? []).map((alias) => ({
          ...alias,
          find: alias.find instanceof RegExp
            ? { source: alias.find.source, flags: alias.find.flags }
            : alias.find,
        })),
      },
    }));
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
  const config = JSON.parse(output) as {
    resolve?: { alias?: SerializedViteAlias[] };
  };

  return {
    resolve: {
      alias: config.resolve?.alias?.map((alias) => ({
        ...alias,
        find:
          typeof alias.find === "string"
            ? alias.find
            : new RegExp(alias.find.source, alias.find.flags),
      })),
    },
  };
}

function aliasMatches(alias: ViteAlias, importPath: string): boolean {
  if (typeof alias.find === "string") {
    return alias.find === importPath;
  }

  alias.find.lastIndex = 0;
  const matches = alias.find.test(importPath);
  alias.find.lastIndex = 0;
  return matches;
}

function manifestHashes(): Map<string, string> {
  const manifest = readFileSync(
    join(vendorRoot, "UI_SOURCE_SHA256SUMS"),
    "utf8",
  );
  return new Map(
    manifest
      .trim()
      .split("\n")
      .map((line) => line.match(/^([a-f0-9]{64})  (.+)$/))
      .filter((entry): entry is RegExpMatchArray => entry !== null)
      .map(([, hash, source]) => [source, hash]),
  );
}

function sourceHash(source: string): string {
  return createHash("sha256")
    .update(readFileSync(join(vendorRoot, source)))
    .digest("hex");
}

function authorityDigest(hashForSource: (source: string) => string): string {
  const digest = createHash("sha256");
  for (const source of officialAuthSources) {
    digest.update(source).update("\0").update(hashForSource(source)).update("\n");
  }
  return digest.digest("hex");
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function listRuntimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listRuntimeTypeScriptFiles(path);
    }
    if (entry.isSymbolicLink()) {
      return isRuntimeTypeScriptPath(path) && statSync(path).isFile() ? [path] : [];
    }
    return entry.isFile() && isRuntimeTypeScriptPath(path) ? [path] : [];
  });
}

function isRuntimeTypeScriptPath(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".spec.ts");
}

function importedSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "production-source.ts",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function recordSpecifier(expression: ts.Expression | undefined): void {
    if (expression && ts.isStringLiteralLike(expression)) {
      specifiers.push(expression.text);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      recordSpecifier(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      recordSpecifier(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      recordSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function modulePathCandidates(path: string): string[] {
  const extension = extname(path);
  const candidates = [path];
  const substitutions: Readonly<Record<string, readonly string[]>> = {
    ".js": [".ts", ".tsx"],
    ".jsx": [".tsx", ".ts"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
  };

  if (substitutions[extension]) {
    const stem = path.slice(0, -extension.length);
    candidates.push(...substitutions[extension].map((candidate) => `${stem}${candidate}`));
  } else if (![".ts", ".tsx", ".mts", ".cts"].includes(extension)) {
    candidates.push(
      `${path}.ts`,
      `${path}.tsx`,
      `${path}.mts`,
      `${path}.cts`,
      join(path, "index.ts"),
      join(path, "index.tsx"),
      join(path, "index.mts"),
      join(path, "index.cts"),
    );
  }

  return candidates;
}

function canonicalExistingModule(path: string): string | undefined {
  for (const candidate of modulePathCandidates(path)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return realpathSync.native(candidate);
    }
  }
  return undefined;
}

function canonicalAuthorityTargets(): Set<string> {
  const directCurrentAccount = realpathSync.native(
    join(vendorRoot, "apps/browser/src/auth/popup/account-switching/current-account.component.ts"),
  );
  return new Set(
    officialAuthSources
      .map((source) => realpathSync.native(join(vendorRoot, source)))
      .filter((source) => source !== directCurrentAccount),
  );
}

function exactAliasTargets(): Map<string, string> {
  return new Map(
    exactAliases.map(([specifier, source]) => [
      specifier,
      realpathSync.native(join(vendorRoot, source)),
    ]),
  );
}

function resolveCanonicalImportTarget(
  importer: string,
  specifier: string,
  aliasTargets: ReadonlyMap<string, string>,
): string | undefined {
  const aliasTarget = aliasTargets.get(specifier);
  if (aliasTarget) {
    return aliasTarget;
  }

  const pathSpecifier = specifier.replace(/[?#].*$/, "");
  let unresolvedPath: string | undefined;
  if (pathSpecifier.startsWith(".")) {
    const canonicalImporter = existsSync(importer) ? realpathSync.native(importer) : importer;
    unresolvedPath = resolve(dirname(canonicalImporter), pathSpecifier);
  } else if (isAbsolute(pathSpecifier)) {
    unresolvedPath = pathSpecifier;
  } else if (pathSpecifier.startsWith("apps/") || pathSpecifier.startsWith("vendor/")) {
    unresolvedPath = resolve(repositoryRoot, pathSpecifier);
  }

  return unresolvedPath ? canonicalExistingModule(unresolvedPath) : undefined;
}

function findDormantAuthorityImports(sources: readonly TypeScriptSource[]): DormantAuthorityImport[] {
  const dormantTargets = canonicalAuthorityTargets();
  const aliasTargets = exactAliasTargets();
  return sources.flatMap(({ path, source }) =>
    importedSpecifiers(source).flatMap((specifier) => {
      const target = resolveCanonicalImportTarget(path, specifier, aliasTargets);
      return target && dormantTargets.has(target)
        ? [{ importer: path, specifier, target }]
        : [];
    }),
  );
}

function exactAliasPattern(importPath: string): RegExp {
  const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`);
}

describe("official authentication source guard", () => {
  it("requires guarded anonymous and environment overlays with only retained source branches", () => {
    const overlays = [
      "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
    ];
    const forbidden = [
      "api url",
      "identity url",
      "icons url",
      "web vault url",
      "notifications url",
      "send url",
      "signup",
      "sso",
      "passkey",
      "device login",
      "history",
      "addeventlistener",
      "chrome.runtime",
      "browser.runtime",
      "sendmessage",
      "postmessage",
    ];

    for (const overlay of overlays) {
      const path = join(repositoryRoot, overlay);
      expect(existsSync(path), overlay).toBe(true);
      const source = readFileSync(path, "utf8");
      for (const token of forbidden) {
        expect(source.toLowerCase(), `${overlay} contains ${token}`).not.toContain(token);
      }
    }
  });

  it("pins every approved authentication authority and lock source", () => {
    expect(readFileSync(join(vendorRoot, ".source-revision"), "utf8")).toBe(
      expectedRevision,
    );
    expect(
      existsSync(
        join(vendorRoot, "libs/key-management-ui/src/lock/components"),
      ),
    ).toBe(true);

    const hashes = manifestHashes();
    for (const source of officialAuthSources) {
      expect(existsSync(join(vendorRoot, source)), source).toBe(true);
    }
    expect(authorityDigest(sourceHash), "authority file-byte digest").toBe(
      expectedAuthorityDigest,
    );
    expect(
      authorityDigest((source) => hashes.get(source) ?? "missing"),
      "authority manifest-entry digest",
    ).toBe(expectedAuthorityDigest);
  });

  it("pins the complete seven-file lock component subtree", () => {
    const root = join(vendorRoot, lockComponentsRoot);
    expect(
      listFiles(root).map((path) => relative(root, path)).sort(),
    ).toEqual([...expectedLockComponentFiles].sort());
  });

  it("resolves only exact approved authentication entry points", () => {
    const typeScriptPaths = activeTypeScriptPaths();
    const configs = [
      ["Vite", activeViteConfig("apps/menubar-tauri/vite.config.ts")],
      ["Vitest", activeViteConfig("vitest.config.ts")],
    ] as const;

    const authAliases = Object.keys(typeScriptPaths).filter((key) =>
      key.startsWith("@bitwarden/auth/angular"),
    );
    expect(authAliases).not.toContain("@bitwarden/auth/angular");
    expect(authAliases).not.toContain("@bitwarden/auth/angular/*");

    for (const [importPath, source] of exactAliases) {
      expect(
        typeScriptPaths[importPath],
        `TypeScript alias: ${importPath}`,
      ).toEqual([`vendor/bitwarden-clients/${source}`]);

      for (const [configName, config] of configs) {
        const stringAlias = config.resolve?.alias?.find(
          (alias) => typeof alias.find === "string" && alias.find === importPath,
        );
        expect(stringAlias, `${configName} string alias: ${importPath}`).toBeUndefined();

        const activeAliases = config.resolve?.alias?.filter((alias) =>
          alias.find instanceof RegExp && aliasMatches(alias, importPath),
        );
        expect(activeAliases, `${configName} exact alias: ${importPath}`).toHaveLength(1);
        const activeAlias = activeAliases?.[0];
        expect(activeAlias?.find, `${configName} alias: ${importPath}`).toBeInstanceOf(RegExp);
        expect((activeAlias?.find as RegExp).source).toBe(
          exactAliasPattern(importPath).source,
        );
        expect(
          activeAlias?.replacement,
          `${configName} source: ${importPath}`,
        ).toBe(resolve(repositoryRoot, "vendor/bitwarden-clients", source));

        for (const rejectedImport of [
          `${importPath}/child`,
          `${importPath}/../app-routing.module`,
          `${importPath}/../../unlock-via-prf.component`,
        ]) {
          expect(
            config.resolve?.alias?.filter((alias) => aliasMatches(alias, rejectedImport)),
            `${configName} rejected alias: ${rejectedImport}`,
          ).toEqual([]);
        }
      }
    }

    const browserRoutingSource = "apps/browser/src/popup/app-routing.module.ts";
    expect(Object.values(typeScriptPaths).flat()).not.toContain(
      `vendor/bitwarden-clients/${browserRoutingSource}`,
    );
    for (const [, config] of configs) {
      for (const rejectedImport of [
        "@bitwarden/official-auth-popup/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component/../../app-routing.module",
        "@bitwarden/key-management-ui/lock/components/lock.component/../unlock-via-prf.component",
      ]) {
        expect(
          config.resolve?.alias?.filter((alias) => aliasMatches(alias, rejectedImport)),
          rejectedImport,
        ).toEqual([]);
      }
    }
  });

  it("records raw excluded transitive branches as dormant source-only authorities", () => {
    const authorityMapping = officialSourceMappings.find(
      (mapping) => mapping.localModule === "apps/menubar-tauri/src/app/auth/auth-official-source.guard.spec.ts",
    ) as { excludedDependencies: readonly string[]; staticDependencyDecision?: readonly string[] } | undefined;

    expect(authorityMapping?.excludedDependencies).toEqual([]);
    expect(authorityMapping?.staticDependencyDecision).toEqual([
      "only CurrentAccountComponent is a direct production import; all other authentication authorities remain source-only until guarded overlays transform them",
      "raw login authorities retain SSO, passkey, and device-login transitive branches that guarded overlays must delete before production use",
      "raw lock authorities retain unlock-via-prf and PRF transitive branches that guarded overlays must delete before production use",
    ]);
  });

  it("recognizes static, re-exported, and dynamic authority imports", () => {
    expect(
      importedSpecifiers(`
        import "static-authority";
        export { component } from "re-exported-authority";
        const component = import("dynamic-authority");
      `),
    ).toEqual(["static-authority", "re-exported-authority", "dynamic-authority"]);
  });

  it("detects dormant authority targets through aliases and canonical direct paths", () => {
    const target = "apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts";
    const extensionlessTarget = target.slice(0, -3);
    const fixtures = [
      {
        path: join(repositoryRoot, "apps/menubar-tauri/src/fixtures/alias-import.ts"),
        source: `import "@bitwarden/official-auth-popup/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component";`,
      },
      {
        path: join(repositoryRoot, "apps/menubar-tauri/src/fixtures/direct-import.ts"),
        source: `export { component } from "vendor/bitwarden-clients/${extensionlessTarget}";`,
      },
      {
        path: join(repositoryRoot, "apps/menubar-tauri/src/fixtures/relative-import.ts"),
        source: `import component = require("../../../../vendor/bitwarden-clients/${extensionlessTarget}.js");`,
      },
      {
        path: join(repositoryRoot, "apps/menubar-tauri/official-components-overlay/overlay-import.ts"),
        source: `const component = import("../../../vendor/bitwarden-clients/${extensionlessTarget}");`,
      },
    ];

    expect(findDormantAuthorityImports(fixtures).map((violation) => violation.specifier)).toEqual([
      "@bitwarden/official-auth-popup/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component",
      `vendor/bitwarden-clients/${extensionlessTarget}`,
      `../../../../vendor/bitwarden-clients/${extensionlessTarget}.js`,
      `../../../vendor/bitwarden-clients/${extensionlessTarget}`,
    ]);
    expect(
      findDormantAuthorityImports([
        {
          path: join(repositoryRoot, "apps/menubar-tauri/src/fixtures/unrelated.ts"),
          source: `import { inject } from "@angular/core"; export * from "../auth/auth.facade";`,
        },
      ]),
    ).toEqual([]);
  });

  it("normalizes symlinked importers without traversing symlinked directories", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "bitwarden-auth-source-guard-"));
    const productionRoot = join(fixtureRoot, "production");
    const canonicalRoot = join(fixtureRoot, "canonical");
    const productionImporter = join(productionRoot, "importer.ts");
    const canonicalImporter = join(canonicalRoot, "importer.ts");
    const authorityTarget = join(
      vendorRoot,
      "libs/auth/src/angular/login/login.component.ts",
    );

    try {
      mkdirSync(productionRoot);
      mkdirSync(canonicalRoot);
      writeFileSync(canonicalImporter, `import "./authority";`);
      symlinkSync(authorityTarget, join(canonicalRoot, "authority.ts"));
      symlinkSync(canonicalImporter, productionImporter);
      symlinkSync(vendorRoot, join(productionRoot, "vendor-tree"), "dir");

      expect(listRuntimeTypeScriptFiles(productionRoot)).toEqual([productionImporter]);
      expect(
        findDormantAuthorityImports([
          { path: productionImporter, source: readFileSync(productionImporter, "utf8") },
        ]).map((violation) => violation.target),
      ).toEqual([realpathSync.native(authorityTarget)]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("keeps dormant authority aliases absent from production imports", () => {
    const productionSources = productionTypeScriptRoots.flatMap((root) =>
      listRuntimeTypeScriptFiles(join(repositoryRoot, root)).map((path) => ({
        path,
        source: readFileSync(path, "utf8"),
      })),
    );
    const violations = findDormantAuthorityImports(productionSources).map(
      ({ importer, specifier, target }) =>
        `${relative(repositoryRoot, importer)} imports ${specifier} -> ${relative(repositoryRoot, target)}`,
    );

    expect(violations).toEqual([]);
  });
});
