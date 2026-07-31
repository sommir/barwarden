import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript";

import { describe, expect, it } from "vitest";

import { officialSourceMappings } from "./upstream-source-map";

const requiredDirectRuntime = [
  {
    localModule: "apps/menubar-tauri/src/app/app.component.ts",
    symbol: "PopupFocusWrapDirective",
    importPath: "@bitwarden/browser-popup/components/popup-focus-wrap.directive",
    upstreamSource:
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/components/popup-focus-wrap.directive.ts",
  },
  {
    localModule: "apps/menubar-tauri/src/app/layout/popup-page.component.ts",
    symbol: "PopupPageComponent",
    importPath: "@bitwarden/browser-popup/layout/popup-page.component",
    upstreamSource:
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-page.component.ts",
  },
  {
    localModule: "apps/menubar-tauri/src/app/layout/popup-footer.component.ts",
    symbol: "PopupFooterComponent",
    importPath: "@bitwarden/browser-popup/layout/popup-footer.component",
    upstreamSource:
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-footer.component.ts",
  },
] as const;

const popupRuntimeImportRoot = "@bitwarden/browser-popup";
const popupRuntimeSourceRoot = "vendor/bitwarden-clients/apps/browser/src/platform/popup";
const officialComponentsOverlayLayout = "apps/menubar-tauri/official-components-overlay/layout";
const officialComponentsLayoutSource = "vendor/bitwarden-clients/libs/components/src/layout";
const popupHeaderOverlayImport = "@bitwarden/browser-popup/layout/popup-header.component";
const popupHeaderOverlaySource =
  "apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-header.component.ts";
const popupHeaderReExport = "apps/menubar-tauri/src/app/layout/popup-header.component.ts";
const popOutOverlayImport = "@bitwarden/browser-popup/components/pop-out.component";
const popOutOverlaySource =
  "apps/menubar-tauri/src/app/upstream-overlays/pop-out/pop-out.component.ts";
const popOutConsumer = "apps/menubar-tauri/src/app/popup-header-actions.component.ts";
const i18nPipeAlias = "@bitwarden/ui-common";
const i18nPipeAdapter = "apps/menubar-tauri/src/app/official-ui/official-ui-common.ts";
const currentAccountImport = "@bitwarden/official-auth-popup/account-switching/current-account.component";
const currentAccountSource =
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts";
const currentAccountConsumers = [
  "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
] as const;
const vaultHeaderImport = "@bitwarden/official-vault-popup/vault-header.component";
const vaultHeaderOverlaySource =
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts";
const vaultHeaderUpstreamSource =
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-header/vault-header.component.ts";
const vaultHeaderConsumer = "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts";
const newItemDropdownImport = "@bitwarden/official-vault-popup/new-item-dropdown.component";
const newItemDropdownOverlaySource =
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts";
const newItemDropdownUpstreamSource =
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts";
const newItemDropdownConsumer =
  "apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts";

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

type SerializedViteConfig = {
  resolve?: {
    alias?: SerializedViteAlias[];
  };
};

type DirectRuntimeDeclaration = {
  declaration: ts.ImportDeclaration | ts.ExportDeclaration;
  specifier: string;
};

function activeTypeScriptOptions() {
  const configPath = join(process.cwd(), "tsconfig.json");
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);

  if (readResult.error) {
    throw new Error(ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n"));
  }

  return ts.parseJsonConfigFileContent(readResult.config, ts.sys, process.cwd()).options;
}

function namedDirectRuntimeDeclaration(
  sourceText: string,
  importPath: string,
  symbol: string,
): DirectRuntimeDeclaration | undefined {
  const sourceFile = ts.createSourceFile(
    "direct-upstream-runtime.ts",
    sourceText,
    ts.ScriptTarget.Latest,
  );

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      !statement.importClause?.isTypeOnly &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === importPath &&
      namedBindingIncludesSymbol(statement.importClause?.namedBindings, symbol)
    ) {
      return { declaration: statement, specifier: statement.moduleSpecifier.text };
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === importPath &&
      namedBindingIncludesSymbol(statement.exportClause, symbol)
    ) {
      return { declaration: statement, specifier: statement.moduleSpecifier.text };
    }
  }

  return undefined;
}

function namedBindingIncludesSymbol(
  bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined,
  symbol: string,
): boolean {
  if (!bindings || (!ts.isNamedImports(bindings) && !ts.isNamedExports(bindings))) {
    return false;
  }

  return bindings.elements.some(
    (element) =>
      !element.isTypeOnly &&
      element.name.text === symbol &&
      (element.propertyName === undefined || element.propertyName.text === symbol),
  );
}

function aliasMatches(alias: ViteAlias, importPath: string): boolean {
  if (typeof alias.find === "string") {
    return alias.find === importPath || importPath.startsWith(`${alias.find}/`);
  }

  alias.find.lastIndex = 0;
  const matches = alias.find.test(importPath);
  alias.find.lastIndex = 0;
  return matches;
}

function firstMatchingAlias(config: ViteConfig, importPath: string): ViteAlias | undefined {
  return config.resolve?.alias?.find((alias) => aliasMatches(alias, importPath));
}

function popupRuntimeAliasPaths(config: ViteConfig): string[] {
  return (config.resolve?.alias ?? [])
    .map((alias) => alias.find)
    .filter(
      (find): find is string =>
        typeof find === "string" &&
        popupRuntimeNamespaceSpecifiers().some(
          (specifier) => find === specifier || specifier.startsWith(`${find}/`),
        ),
    );
}

function popupRuntimeNamespaceSpecifiers(): string[] {
  const sourceRoot = join(process.cwd(), popupRuntimeSourceRoot);
  const sources = listTypeScriptSources(sourceRoot);

  return [
    popupRuntimeImportRoot,
    ...sources.map(
      (source) =>
        `${popupRuntimeImportRoot}/${relative(sourceRoot, source)
          .replace(/\.ts$/, "")
          .split("\\").join("/")}`,
    ),
  ];
}

function listTypeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listTypeScriptSources(path);
    }

    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function activeViteConfig(configPath: string): ViteConfig {
  const absoluteConfigPath = join(process.cwd(), configPath);
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

  const config = JSON.parse(output) as SerializedViteConfig;

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

function assertPinnedRuntimeAlias(
  config: ViteConfig,
  configName: string,
  importPath: string,
  expectedSource: string,
) {
  const aliases = config.resolve?.alias ?? [];
  const matchingRegExp = aliases.find(
    (alias) =>
      alias.find instanceof RegExp &&
      popupRuntimeNamespaceSpecifiers().some((specifier) => aliasMatches(alias, specifier)),
  );

  expect(matchingRegExp, `${configName} RegExp alias: ${importPath}`).toBeUndefined();

  const activeAlias = firstMatchingAlias(config, importPath);
  expect(activeAlias?.find, `${configName} active alias: ${importPath}`).toBe(importPath);
  expect(activeAlias?.replacement, `${configName} alias: ${importPath}`).toBe(expectedSource);
}

function assertPinnedComponentsLayoutOverlay(overlayPath: string): void {
  const expectedSource = resolve(process.cwd(), officialComponentsLayoutSource);

  expect(lstatSync(overlayPath).isSymbolicLink(), `overlay symlink: ${overlayPath}`).toBe(true);
  expect(realpathSync(overlayPath), `overlay target: ${overlayPath}`).toBe(expectedSource);
}

describe("direct pinned upstream runtime guard", () => {
  it("keeps the retired VaultHeaderComponent out of the redesigned route while pinning its audit alias", () => {
    const expectedSource = resolve(process.cwd(), vaultHeaderOverlaySource);
    const compilerOptions = activeTypeScriptOptions();
    const viteConfig = activeViteConfig("apps/menubar-tauri/vite.config.ts");
    const vitestConfig = activeViteConfig("vitest.config.ts");
    const containingFile = resolve(process.cwd(), vaultHeaderConsumer);
    const declaration = namedDirectRuntimeDeclaration(
      readFileSync(containingFile, "utf8"),
      vaultHeaderImport,
      "VaultHeaderComponent",
    );
    const mapping = officialSourceMappings.find(
      (candidate) => candidate.localModule === vaultHeaderConsumer,
    );

    expect(mapping?.mode).toBe("direct");
    expect(mapping?.upstreamSources).not.toContain(vaultHeaderUpstreamSource);
    expect(mapping?.excludedDependencies).toContain(
      "official VaultHeaderComponent replaced by the in-flow VaultRootHeaderComponent",
    );
    expect(declaration).toBeUndefined();
    expect(compilerOptions.paths?.[vaultHeaderImport]).toEqual([vaultHeaderOverlaySource]);
    expect(
      Object.keys(compilerOptions.paths ?? {}).filter((path) =>
        path.startsWith("@bitwarden/official-vault-popup"),
      ),
    ).toEqual([vaultHeaderImport, newItemDropdownImport]);
    expect(
      ts.resolveModuleName(
        vaultHeaderImport,
        containingFile,
        compilerOptions,
        ts.sys,
      ).resolvedModule?.resolvedFileName,
    ).toBe(expectedSource);

    for (const [name, config] of [["Vite", viteConfig], ["Vitest", vitestConfig]] as const) {
      const aliases = config.resolve?.alias?.filter((alias) => aliasMatches(alias, vaultHeaderImport));
      expect(aliases, `${name} exact Vault header alias`).toHaveLength(1);
      expect(aliases?.[0]?.find).toBeInstanceOf(RegExp);
      expect(aliases?.[0]?.replacement).toBe(expectedSource);
      expect(firstMatchingAlias(config, `${vaultHeaderImport}/child`)).toBeUndefined();
    }
  });

  it("direct-imports the retained NewItemDropdownComponent through one exact overlay alias", () => {
    const expectedSource = resolve(process.cwd(), newItemDropdownOverlaySource);
    const compilerOptions = activeTypeScriptOptions();
    const containingFile = resolve(process.cwd(), newItemDropdownConsumer);
    const declaration = namedDirectRuntimeDeclaration(
      readFileSync(containingFile, "utf8"),
      newItemDropdownImport,
      "NewItemDropdownComponent",
    );

    expect(declaration).toBeDefined();
    expect(compilerOptions.paths?.[newItemDropdownImport]).toEqual([
      newItemDropdownOverlaySource,
    ]);
    expect(
      ts.resolveModuleName(
        declaration!.specifier,
        containingFile,
        compilerOptions,
        ts.sys,
      ).resolvedModule?.resolvedFileName,
    ).toBe(expectedSource);
    expect(officialSourceMappings).toContainEqual(
      expect.objectContaining({
        localModule: newItemDropdownConsumer,
        mode: "direct",
        upstreamSources: expect.arrayContaining([newItemDropdownUpstreamSource]),
      }),
    );

    for (const [name, config] of [
      ["Vite", activeViteConfig("apps/menubar-tauri/vite.config.ts")],
      ["Vitest", activeViteConfig("vitest.config.ts")],
    ] as const) {
      const aliases = config.resolve?.alias?.filter((alias) =>
        aliasMatches(alias, newItemDropdownImport),
      );
      expect(aliases, `${name} exact New item alias`).toHaveLength(1);
      expect(aliases?.[0]?.find).toBeInstanceOf(RegExp);
      expect(aliases?.[0]?.replacement).toBe(expectedSource);
      expect(firstMatchingAlias(config, `${newItemDropdownImport}/child`)).toBeUndefined();
    }
  });

  it("direct-imports the pinned CurrentAccountComponent through its only exact alias", () => {
    const expectedSource = resolve(process.cwd(), currentAccountSource);
    const compilerOptions = activeTypeScriptOptions();
    const viteConfig = activeViteConfig("apps/menubar-tauri/vite.config.ts");
    const vitestConfig = activeViteConfig("vitest.config.ts");
    const mapping = officialSourceMappings.find(
      (candidate) => candidate.localModule === currentAccountConsumers[0],
    );

    expect(mapping?.mode).toBe("direct");
    expect(mapping?.upstreamSources).toContain(currentAccountSource);
    expect(compilerOptions.paths?.[currentAccountImport]).toEqual([currentAccountSource]);

    for (const consumer of currentAccountConsumers) {
      const containingFile = resolve(process.cwd(), consumer);
      const declaration = namedDirectRuntimeDeclaration(
        readFileSync(containingFile, "utf8"),
        currentAccountImport,
        "CurrentAccountComponent",
      );
      expect(declaration, consumer).toBeDefined();
      expect(
        ts.resolveModuleName(
          declaration!.specifier,
          containingFile,
          compilerOptions,
          ts.sys,
        ).resolvedModule?.resolvedFileName,
      ).toBe(expectedSource);
    }

    for (const [name, config] of [["Vite", viteConfig], ["Vitest", vitestConfig]] as const) {
      const aliases = config.resolve?.alias?.filter((alias) => aliasMatches(alias, currentAccountImport));
      expect(aliases, `${name} exact CurrentAccount alias`).toHaveLength(1);
      expect(aliases?.[0]?.find).toBeInstanceOf(RegExp);
      expect(aliases?.[0]?.replacement).toBe(expectedSource);
      expect(firstMatchingAlias(config, `${currentAccountImport}/child`)).toBeUndefined();
    }
  });

  it("requires the components layout overlay to be an exact pinned symlink", () => {
    const overlayPath = join(process.cwd(), officialComponentsOverlayLayout);
    assertPinnedComponentsLayoutOverlay(overlayPath);

    expect(() =>
      assertPinnedComponentsLayoutOverlay(
        join(process.cwd(), "apps/menubar-tauri/official-components-overlay"),
      ),
    ).toThrow("overlay symlink");
    expect(() =>
      assertPinnedComponentsLayoutOverlay(
        join(process.cwd(), "apps/menubar-tauri/official-components-overlay/icon"),
      ),
    ).toThrow("overlay target");
  });

  it("requires a non-empty named set of official popup components in production", () => {
    const directMappings = officialSourceMappings.filter((mapping) => mapping.mode === "direct");
    expect(directMappings.length).toBeGreaterThan(0);

    for (const expected of requiredDirectRuntime) {
      const mapping = directMappings.find(
        (candidate) => candidate.localModule === expected.localModule,
      );
      expect(mapping, expected.localModule).toBeDefined();
      expect(mapping?.upstreamSources).toContain(expected.upstreamSource);
      expect(existsSync(join(process.cwd(), expected.upstreamSource))).toBe(true);

      const localSource = readFileSync(join(process.cwd(), expected.localModule), "utf8");
      expect(
        namedDirectRuntimeDeclaration(localSource, expected.importPath, expected.symbol),
      ).toBeDefined();
    }
  });

  it("does not accept template mappings as direct runtime evidence", () => {
    for (const expected of requiredDirectRuntime) {
      const mapping = officialSourceMappings.find(
        (candidate) => candidate.localModule === expected.localModule,
      );
      expect(mapping?.mode, expected.localModule).toBe("direct");
    }
  });

  it("does not accept comment-only direct import evidence", () => {
    const expected = requiredDirectRuntime[1];
    const commentOnlySource = `// export { ${expected.symbol} } from "${expected.importPath}";`;

    expect(
      namedDirectRuntimeDeclaration(commentOnlySource, expected.importPath, expected.symbol),
    ).toBeUndefined();

    const unrelatedString =
      `const fake = 'export { ${expected.symbol} } from "${expected.importPath}"';`;
    expect(
      namedDirectRuntimeDeclaration(unrelatedString, expected.importPath, expected.symbol),
    ).toBeUndefined();
  });

  it("does not accept type-only direct import or export evidence", () => {
    const expected = requiredDirectRuntime[1];
    const typeOnlySources = [
      `import type { ${expected.symbol} } from "${expected.importPath}";`,
      `import { type ${expected.symbol} } from "${expected.importPath}";`,
      `export type { ${expected.symbol} } from "${expected.importPath}";`,
      `export { type ${expected.symbol} } from "${expected.importPath}";`,
    ];

    for (const sourceText of typeOnlySources) {
      expect(
        namedDirectRuntimeDeclaration(sourceText, expected.importPath, expected.symbol),
      ).toBeUndefined();
    }
  });

  it("recognizes a preceding broad RegExp alias as the active redirect", () => {
    const expected = requiredDirectRuntime[1];
    const redirect: ViteAlias = {
      find: /^@bitwarden\/browser-popup\/layout/,
      replacement: "/local/redirect.ts",
    };
    const pinned: ViteAlias = {
      find: expected.importPath,
      replacement: resolve(process.cwd(), expected.upstreamSource),
    };

    expect(
      firstMatchingAlias({ resolve: { alias: [redirect, pinned] } }, expected.importPath),
    ).toBe(redirect);
    expect(() =>
      assertPinnedRuntimeAlias(
        { resolve: { alias: [redirect, pinned] } },
        "fixture",
        expected.importPath,
        pinned.replacement,
      ),
    ).toThrow(`fixture RegExp alias: ${expected.importPath}`);
  });

  it("requires the header overlay to be the exact first-match TypeScript, Vite, and Vitest target", () => {
    const expectedSource = resolve(process.cwd(), popupHeaderOverlaySource);
    const compilerOptions = activeTypeScriptOptions();
    const viteConfig = activeViteConfig("apps/menubar-tauri/vite.config.ts");
    const vitestConfig = activeViteConfig("vitest.config.ts");
    const containingFile = resolve(process.cwd(), popupHeaderReExport);
    const sourceText = readFileSync(containingFile, "utf8");
    const declaration = namedDirectRuntimeDeclaration(
      sourceText,
      popupHeaderOverlayImport,
      "PopupHeaderComponent",
    );

    expect(declaration).toBeDefined();
    expect(
      ts.resolveModuleName(
        declaration!.specifier,
        containingFile,
        compilerOptions,
        ts.sys,
      ).resolvedModule?.resolvedFileName,
    ).toBe(expectedSource);
    expect(compilerOptions.paths?.[popupHeaderOverlayImport]).toEqual([popupHeaderOverlaySource]);
    assertPinnedRuntimeAlias(viteConfig, "Vite", popupHeaderOverlayImport, expectedSource);
    assertPinnedRuntimeAlias(vitestConfig, "Vitest", popupHeaderOverlayImport, expectedSource);

    const exact: ViteAlias = { find: popupHeaderOverlayImport, replacement: expectedSource };
    const localRedirect: ViteAlias = {
      find: popupHeaderOverlayImport,
      replacement: "/local/popup-header.component.ts",
    };
    const broadRedirect: ViteAlias = {
      find: /^@bitwarden\/browser-popup\/layout/,
      replacement: "/local/popup-layout",
    };

    expect(
      firstMatchingAlias({ resolve: { alias: [localRedirect, exact] } }, popupHeaderOverlayImport),
    ).toBe(localRedirect);
    expect(() =>
      assertPinnedRuntimeAlias(
        { resolve: { alias: [localRedirect, exact] } },
        "fixture local redirect",
        popupHeaderOverlayImport,
        expectedSource,
      ),
    ).toThrow(`fixture local redirect alias: ${popupHeaderOverlayImport}`);
    expect(() =>
      assertPinnedRuntimeAlias(
        { resolve: { alias: [broadRedirect, exact] } },
        "fixture broad redirect",
        popupHeaderOverlayImport,
        expectedSource,
      ),
    ).toThrow(`fixture broad redirect RegExp alias: ${popupHeaderOverlayImport}`);
  });

  it("requires the PopOut overlay to be the exact first-match TypeScript, Vite, and Vitest target", () => {
    const expectedSource = resolve(process.cwd(), popOutOverlaySource);
    const compilerOptions = activeTypeScriptOptions();
    const viteConfig = activeViteConfig("apps/menubar-tauri/vite.config.ts");
    const vitestConfig = activeViteConfig("vitest.config.ts");
    const containingFile = resolve(process.cwd(), popOutConsumer);
    const declaration = namedDirectRuntimeDeclaration(
      readFileSync(containingFile, "utf8"),
      popOutOverlayImport,
      "PopOutComponent",
    );

    expect(declaration).toBeDefined();
    expect(
      ts.resolveModuleName(declaration!.specifier, containingFile, compilerOptions, ts.sys).resolvedModule
        ?.resolvedFileName,
    ).toBe(expectedSource);
    expect(compilerOptions.paths?.[popOutOverlayImport]).toEqual([popOutOverlaySource]);
    assertPinnedRuntimeAlias(viteConfig, "Vite", popOutOverlayImport, expectedSource);
    assertPinnedRuntimeAlias(vitestConfig, "Vitest", popOutOverlayImport, expectedSource);
  });

  it("requires the official I18nPipe adapter to be the exact TypeScript, Vite, and Vitest target", () => {
    const expectedSource = resolve(process.cwd(), i18nPipeAdapter);
    const compilerOptions = activeTypeScriptOptions();
    const viteConfig = activeViteConfig("apps/menubar-tauri/vite.config.ts");
    const vitestConfig = activeViteConfig("vitest.config.ts");

    expect(compilerOptions.paths?.[i18nPipeAlias]).toEqual([i18nPipeAdapter]);
    assertPinnedRuntimeAlias(viteConfig, "Vite", i18nPipeAlias, expectedSource);
    assertPinnedRuntimeAlias(vitestConfig, "Vitest", i18nPipeAlias, expectedSource);
  });

  it("rejects RegExp aliases for popup page and header descendants", () => {
    const expected = requiredDirectRuntime[1];
    const pinned: ViteAlias = {
      find: expected.importPath,
      replacement: resolve(process.cwd(), expected.upstreamSource),
    };
    const redirects: ViteAlias[] = [
      {
        find: /^@bitwarden\/browser-popup\/layout\/popup-page\.component$/,
        replacement: "/local/popup-page.component.ts",
      },
      {
        find: /^@bitwarden\/browser-popup\/layout\/popup-header\.component$/,
        replacement: "/local/popup-header.component.ts",
      },
    ];

    for (const redirect of redirects) {
      expect(() =>
        assertPinnedRuntimeAlias(
          { resolve: { alias: [redirect, pinned] } },
          "fixture",
          expected.importPath,
          pinned.replacement,
        ),
      ).toThrow(`fixture RegExp alias: ${expected.importPath}`);
    }
  });

  it("resolves each production import to its exact vendored TypeScript source", () => {
    const compilerOptions = activeTypeScriptOptions();
    const viteConfig = activeViteConfig("apps/menubar-tauri/vite.config.ts");
    const vitestConfig = activeViteConfig("vitest.config.ts");
    const expectedImportPaths = [
      requiredDirectRuntime[0].importPath,
      popOutOverlayImport,
      requiredDirectRuntime[1].importPath,
      popupHeaderOverlayImport,
      ...requiredDirectRuntime.slice(2).map(({ importPath }) => importPath),
    ];

    expect(
      Object.keys(compilerOptions.paths ?? {}).filter((path) =>
        path.startsWith("@bitwarden/browser-popup"),
      ),
    ).toEqual(expectedImportPaths);
    expect(popupRuntimeAliasPaths(viteConfig)).toEqual(expectedImportPaths);
    expect(popupRuntimeAliasPaths(vitestConfig)).toEqual(expectedImportPaths);

    for (const expected of requiredDirectRuntime) {
      const expectedSource = resolve(process.cwd(), expected.upstreamSource);
      const containingFile = resolve(process.cwd(), expected.localModule);
      const sourceText = readFileSync(containingFile, "utf8");
      const directDeclaration = namedDirectRuntimeDeclaration(
        sourceText,
        expected.importPath,
        expected.symbol,
      );
      expect(directDeclaration, `production declaration: ${expected.localModule}`).toBeDefined();
      const resolvedModule = ts.resolveModuleName(
        directDeclaration!.specifier,
        containingFile,
        compilerOptions,
        ts.sys,
      ).resolvedModule;

      expect(resolvedModule?.resolvedFileName, `TypeScript: ${expected.importPath}`).toBe(
        expectedSource,
      );
      const typeScriptAlias = compilerOptions.paths?.[expected.importPath];
      expect(typeScriptAlias, `TypeScript alias: ${expected.importPath}`).toEqual([
        expected.upstreamSource,
      ]);
      assertPinnedRuntimeAlias(viteConfig, "Vite", expected.importPath, expectedSource);
      assertPinnedRuntimeAlias(vitestConfig, "Vitest", expected.importPath, expectedSource);
    }
  });
});
