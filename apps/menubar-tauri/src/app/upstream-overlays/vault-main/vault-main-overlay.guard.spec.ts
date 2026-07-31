import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { officialSourceMappings } from "../../upstream-source-map";

const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";
const sourceMarker = resolve(process.cwd(), "vendor/bitwarden-clients/.source-revision");
const pinnedBrowserSource = resolve(
  process.cwd(),
  "vendor/bitwarden-clients/apps/browser/src",
);
const overlayRoot = resolve(
  process.cwd(),
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src",
);
const vaultHeaderAlias = "@bitwarden/official-vault-popup/vault-header.component";
const newItemDropdownAlias = "@bitwarden/official-vault-popup/new-item-dropdown.component";
const vaultBoundaryAlias = "@bitwarden/vault";
const restrictedItemTypesAlias =
  "@bitwarden/common/vault/services/restricted-item-types.service";
const vaultHeaderEntry =
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts";
const newItemDropdownEntry =
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts";
const vaultBoundaryEntry =
  "apps/menubar-tauri/src/app/vault/official-vault-boundary.ts";
const restrictedItemTypesEntry =
  "apps/menubar-tauri/src/app/vault/retained-restricted-item-types.service.ts";
const searchServiceAlias = "@bitwarden/common/vault/services/search.service";
const itemsAdapterEntry =
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts";
const searchConstantShimEntry =
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/common/vault/services/search.service.ts";
const vaultSearchEntry =
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-search/vault-search.component.ts";

const directSources = [
  {
    relativePath:
      "vault/popup/components/vault/vault-header/vault-header.component.ts",
    sha256: "59af7be33712986e5b5f37345dd27b95b0b0063d01e2877a802d13bf040e49b7",
  },
  {
    relativePath:
      "vault/popup/components/vault/vault-header/vault-header.component.html",
    sha256: "3f11124f676732908295dbc671e634c35b995b4b4b3f948ebb11be4eb4f77b8a",
  },
  {
    relativePath:
      "vault/popup/components/vault/vault-search/vault-search.component.ts",
    sha256: "7f7f2e3d92db13ff583d9cbc4b71730ffdebd0845c6d191075fc792542b50c13",
  },
  {
    relativePath:
      "vault/popup/components/vault/vault-search/vault-search.component.html",
    sha256: "b54d27f6d914c6aebf6353235022c08f007ceea786a558bb86716207067f3310",
  },
  {
    relativePath:
      "vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
    sha256: "f3e3ddf5da303b5b07fdc9b290d01588b9705f4363a9464a033dbac5d4d11b12",
  },
  {
    relativePath:
      "vault/popup/components/vault/vault-list-filters/vault-list-filters.component.html",
    sha256: "b025d64c1577db0416ecccb7329753ddda995c86b617c3db8ab6bccc7049c204",
  },
  {
    relativePath: "platform/browser/run-inside-angular.operator.ts",
    sha256: "0f9edd8b3ad1325ef8aa9434812d515dcbe076bfb1d6ae229f600603b30999a4",
  },
  {
    relativePath:
      "vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
    sha256: "552cd77fa8ece5e46f4ec9183a2925e097af979c40ec97c0d05ae0f770c18cc8",
  },
  {
    relativePath:
      "vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.html",
    sha256: "a6c3526a0b9c9661935884e6500305c822c8d2066809c102fa5cdfabc35d4187",
  },
] as const;

const localServicesRoot = resolve(overlayRoot, "vault/popup/services");
const adapterPaths = [
  resolve(localServicesRoot, "vault-popup-items.service.ts"),
  resolve(localServicesRoot, "vault-popup-list-filters.service.ts"),
  resolve(overlayRoot, "platform/browser/browser-api.ts"),
  resolve(overlayRoot, "platform/browser/browser-popup-utils.ts"),
] as const;
const addEditBoundary = resolve(
  overlayRoot,
  "vault/popup/components/vault/add-edit/add-edit.component.ts",
);
const loadingShim = resolve(localServicesRoot, "vault-popup-loading.service.ts");
const expectedLoadingShim =
  'export { VaultPopupItemsService as VaultPopupLoadingService } from "./vault-popup-items.service";\n';
const searchConstantShim = resolve(process.cwd(), searchConstantShimEntry);
const expectedSearchConstantShim = "export const SearchTextDebounceInterval = 100;\n";

type ViteAlias = {
  readonly find: string | RegExp;
  readonly replacement: string;
};

type ViteConfig = {
  readonly resolve?: {
    readonly alias?: readonly ViteAlias[];
  };
};

type SerializedViteAlias = {
  readonly find: string | { readonly source: string; readonly flags: string };
  readonly replacement: string;
};

type SerializedViteConfig = {
  readonly resolve?: {
    readonly alias?: readonly SerializedViteAlias[];
  };
};

function sha256(contents: Buffer | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function assertPinnedRevision(marker: string): void {
  expect(marker).toBe(
    `https://github.com/bitwarden/clients.git\n${pinnedRevision}\n`,
  );
}

function assertDirectSymlink(
  overlayPath: string,
  pinnedPath: string,
  expectedSha256: string,
): void {
  expect(existsSync(overlayPath), `overlay source: ${overlayPath}`).toBe(true);
  expect(lstatSync(overlayPath).isSymbolicLink(), `direct symlink: ${overlayPath}`).toBe(true);
  expect(isAbsolute(readlinkSync(overlayPath)), `relative symlink: ${overlayPath}`).toBe(false);
  expect(realpathSync(overlayPath), `symlink target: ${overlayPath}`).toBe(pinnedPath);

  const pinnedContents = readFileSync(pinnedPath);
  expect(sha256(pinnedContents), `pinned hash: ${pinnedPath}`).toBe(expectedSha256);
  expect(readFileSync(overlayPath), `byte-identical source: ${overlayPath}`).toEqual(
    pinnedContents,
  );
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(path);
    }
    return [relative(overlayRoot, path).split("\\").join("/")];
  });
}

function productionSearchServiceImporters(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return productionSearchServiceImporters(path);
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) {
      return [];
    }

    const sourceFile = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const importsSearchService = sourceFile.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === searchServiceAlias,
    );
    return importsSearchService
      ? [relative(process.cwd(), path).split("\\").join("/")]
      : [];
  });
}

function activeViteConfig(configPath: string): ViteConfig {
  const absoluteConfigPath = resolve(process.cwd(), configPath);
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
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const serialized = JSON.parse(output) as SerializedViteConfig;

  return {
    resolve: {
      alias: serialized.resolve?.alias?.map((alias) => ({
        ...alias,
        find:
          typeof alias.find === "string"
            ? alias.find
            : new RegExp(alias.find.source, alias.find.flags),
      })),
    },
  };
}

function aliasMatches(alias: ViteAlias, specifier: string): boolean {
  if (typeof alias.find === "string") {
    return alias.find === specifier || specifier.startsWith(`${alias.find}/`);
  }
  alias.find.lastIndex = 0;
  const matches = alias.find.test(specifier);
  alias.find.lastIndex = 0;
  return matches;
}

function exactAliasSource(specifier: string): string {
  return new RegExp(
    `^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
  ).source;
}

function assertFirstMatchingViteAliasIsExact(
  config: ViteConfig,
  configName: string,
  specifier: string,
  target: string,
): void {
  const aliases = config.resolve?.alias ?? [];
  const matchingAliases = aliases.filter((alias) => aliasMatches(alias, specifier));
  expect(matchingAliases.length, `${configName} aliases for ${specifier}`).toBeGreaterThan(0);

  const alias = matchingAliases[0];
  expect(alias?.find, `${configName} exact alias`).toBeInstanceOf(RegExp);
  expect((alias?.find as RegExp).source, `${configName} anchored alias`).toBe(
    exactAliasSource(specifier),
  );
  expect(alias?.replacement, `${configName} target`).toBe(resolve(process.cwd(), target));
}

function assertExactViteAliases(config: ViteConfig, configName: string): void {
  const aliases = config.resolve?.alias ?? [];
  assertFirstMatchingViteAliasIsExact(
    config,
    configName,
    vaultHeaderAlias,
    vaultHeaderEntry,
  );
  assertFirstMatchingViteAliasIsExact(
    config,
    configName,
    newItemDropdownAlias,
    newItemDropdownEntry,
  );
  assertFirstMatchingViteAliasIsExact(
    config,
    configName,
    vaultBoundaryAlias,
    vaultBoundaryEntry,
  );
  assertFirstMatchingViteAliasIsExact(
    config,
    configName,
    restrictedItemTypesAlias,
    restrictedItemTypesEntry,
  );
  assertFirstMatchingViteAliasIsExact(
    config,
    configName,
    searchServiceAlias,
    searchConstantShimEntry,
  );
  expect(
    aliases.some((candidate) => aliasMatches(candidate, `${vaultHeaderAlias}/copied-child`)),
    `${configName} wildcard descendant`,
  ).toBe(false);
}

function assertExactTypeScriptAlias(paths: Record<string, readonly string[]>): void {
  const namespaceAliases = Object.keys(paths).filter((key) =>
    key.startsWith("@bitwarden/official-vault-popup"),
  );
  expect(namespaceAliases).toEqual([vaultHeaderAlias, newItemDropdownAlias]);
  expect(paths[vaultHeaderAlias]).toEqual([vaultHeaderEntry]);
  expect(paths[newItemDropdownAlias]).toEqual([newItemDropdownEntry]);
  expect(paths[vaultBoundaryAlias]).toEqual([vaultBoundaryEntry]);
  expect(paths[restrictedItemTypesAlias]).toEqual([restrictedItemTypesEntry]);
  expect(paths[searchServiceAlias]).toEqual([searchConstantShimEntry]);
  expect(namespaceAliases.some((key) => key.includes("*"))).toBe(false);
}

function adapterImportViolations(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const forbiddenBindings = /^(?:StateProvider|ViewCacheService|PolicyService|OrganizationService|CollectionService|BrowserApi|BrowserPopupUtils)$/;
  const forbiddenModules = /(?:platform\/state|view-cache|admin-console|organization|collection|autofill|content-script|background|webextension)/i;
  const violations: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    if (forbiddenModules.test(specifier)) {
      violations.push(`forbidden module ${specifier}`);
    }

    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if (forbiddenBindings.test(binding.name.text)) {
          violations.push(`forbidden binding ${binding.name.text}`);
        }
      }
    }
  }

  for (const token of [
    /\b(?:chrome|browser)\./,
    /\b(?:currentTab|currentUrl|tabUrl|contentScript|autofill)\b/i,
    /\b(?:window|document)\.location\b/,
  ]) {
    if (token.test(source)) {
      violations.push(`forbidden runtime token ${token.source}`);
    }
  }

  return violations;
}

describe("official Vault header overlay guard", () => {
  it("pins the vendor revision and every retained TypeScript/HTML file by direct symlink and hash", () => {
    assertPinnedRevision(readFileSync(sourceMarker, "utf8"));

    for (const source of directSources) {
      assertDirectSymlink(
        resolve(overlayRoot, source.relativePath),
        resolve(pinnedBrowserSource, source.relativePath),
        source.sha256,
      );
    }
  });

  it("rejects copies, drifted targets, and changed vendor revisions", () => {
    const source = directSources[0];
    const pinnedPath = resolve(pinnedBrowserSource, source.relativePath);

    expect(() => assertDirectSymlink(pinnedPath, pinnedPath, source.sha256)).toThrow(
      "direct symlink",
    );
    expect(() =>
      assertDirectSymlink(
        resolve(overlayRoot, source.relativePath),
        resolve(pinnedBrowserSource, directSources[1].relativePath),
        source.sha256,
      ),
    ).toThrow();
    expect(() =>
      assertPinnedRevision(
        "https://github.com/bitwarden/clients.git\n0000000000000000000000000000000000000000\n",
      ),
    ).toThrow();
  });

  it("contains only the approved direct sources, bounded adapters, and type shims", () => {
    expect(listFiles(overlayRoot).sort()).toEqual(
      [
        ...directSources.map(({ relativePath }) => relativePath),
        "common/vault/services/search.service.ts",
        "platform/browser/browser-api.ts",
        "platform/browser/browser-popup-utils.ts",
        "vault/popup/components/vault/add-edit/add-edit.component.ts",
        "vault/popup/services/vault-popup-items.service.ts",
        "vault/popup/services/vault-popup-list-filters.service.ts",
        "vault/popup/services/vault-popup-loading.service.ts",
      ].sort(),
    );

    for (const adapterPath of adapterPaths) {
      expect(lstatSync(adapterPath).isSymbolicLink(), adapterPath).toBe(false);
      expect(adapterImportViolations(adapterPath, readFileSync(adapterPath, "utf8"))).toEqual([]);
    }
    expect(readFileSync(loadingShim, "utf8")).toBe(expectedLoadingShim);
    expect(readFileSync(searchConstantShim, "utf8")).toBe(expectedSearchConstantShim);
    expect(readFileSync(addEditBoundary, "utf8")).toContain("export type AddEditQueryParams");
  });

  it("rejects browser and global-state imports in either behavioral adapter", () => {
    expect(
      adapterImportViolations(
        "fixture.ts",
        'import { StateProvider } from "@bitwarden/common/platform/state";\n',
      ),
    ).toEqual([
      "forbidden module @bitwarden/common/platform/state",
      "forbidden binding StateProvider",
    ]);
    expect(
      adapterImportViolations(
        "fixture.ts",
        'import { BrowserApi } from "../../platform/browser/browser-api";\nconst tab = browser.tabs;\n',
      ),
    ).toEqual([
      "forbidden binding BrowserApi",
      "forbidden runtime token \\b(?:chrome|browser)\\.",
    ]);
  });

  it("uses exact TypeScript, Vite, and Vitest aliases for the retained entry and debounce constant", () => {
    const tsconfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "tsconfig.json"), "utf8"),
    ) as { compilerOptions: { paths: Record<string, readonly string[]> } };

    assertExactTypeScriptAlias(tsconfig.compilerOptions.paths);
    assertExactViteAliases(activeViteConfig("apps/menubar-tauri/vite.config.ts"), "Vite");
    assertExactViteAliases(activeViteConfig("vitest.config.ts"), "Vitest");
    expect(readFileSync(adapterPaths[0], "utf8")).not.toContain("SearchTextDebounceInterval");
    expect(productionSearchServiceImporters(resolve(process.cwd(), "apps/menubar-tauri/src"))).toEqual([
      vaultSearchEntry,
    ]);
  });

  it("rejects a wildcard TypeScript alias even when an exact alias is also present", () => {
    expect(() =>
      assertExactTypeScriptAlias({
        [vaultHeaderAlias]: [vaultHeaderEntry],
        [searchServiceAlias]: [searchConstantShimEntry],
        [newItemDropdownAlias]: [newItemDropdownEntry],
        [vaultBoundaryAlias]: [vaultBoundaryEntry],
        [restrictedItemTypesAlias]: [restrictedItemTypesEntry],
        "@bitwarden/official-vault-popup/*": [
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/*",
        ],
      }),
    ).toThrow();
  });

  it("records direct symlink and adapter provenance without the vendor loading graph", () => {
    const expectedMappings = [
      {
        localModule: vaultHeaderEntry,
        mode: "direct",
      },
      {
        localModule:
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-search/vault-search.component.ts",
        mode: "direct",
      },
      {
        localModule:
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
        mode: "direct",
      },
      {
        localModule:
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/run-inside-angular.operator.ts",
        mode: "direct",
      },
      {
        localModule:
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts",
        mode: "adapter",
      },
      {
        localModule:
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-list-filters.service.ts",
        mode: "adapter",
      },
    ] as const;

    for (const expected of expectedMappings) {
      expect(officialSourceMappings).toContainEqual(
        expect.objectContaining(expected),
      );
    }

    expect(
      officialSourceMappings.find(
        (mapping) => mapping.localModule.endsWith("vault-popup-loading.service.ts"),
      ),
    ).toBeUndefined();

    const itemsMapping = officialSourceMappings.find(
      (mapping) => mapping.localModule === itemsAdapterEntry,
    );
    expect(itemsMapping?.upstreamSources).not.toContain(
      "vendor/bitwarden-clients/libs/common/src/vault/services/search.service.ts",
    );
    const pinnedSearchService = readFileSync(resolve(
      process.cwd(),
      "vendor/bitwarden-clients/libs/common/src/vault/services/search.service.ts",
    ));
    expect(sha256(pinnedSearchService)).toBe(
      "c1fb820d7224047b2040163323b5f54b0952d47d9822d96aa8ee5b74a3980c6f",
    );
    expect(pinnedSearchService.toString("utf8")).toContain(
      "export const SearchTextDebounceInterval = 100;",
    );
  });
});
