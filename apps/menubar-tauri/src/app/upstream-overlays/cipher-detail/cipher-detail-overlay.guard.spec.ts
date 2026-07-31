import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  buildOfficialLoginDetailAliases,
  officialLoginDetailAliasSources,
} from "../../../../official-login-detail-aliases";

type DetailManifest = {
  readonly revision: string;
  readonly license: Readonly<Record<string, string>>;
  readonly authorities: readonly { readonly path: string; readonly sha256: string }[];
  readonly transforms: readonly {
    readonly authority: string;
    readonly runtime: string;
    readonly allowedDifferences: readonly string[];
  }[];
  readonly restoredLibraries: readonly {
    readonly path: string;
    readonly fileCount: number;
    readonly treeSha256: string;
  }[];
  readonly localRuntimes: readonly { readonly path: string; readonly sha256: string }[];
  readonly aliases: Readonly<Record<string, string>>;
  readonly dependencyAliases: Readonly<Record<string, string>>;
  readonly excludedTokens: readonly string[];
};

const root = process.cwd();
const manifestPath = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json",
);
const expectedRevision = "f47b6946e01aed474875789081966d311d5b8289";
const expectedAliases = {
  "@bitwarden/official-login-detail/item-details":
    "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts",
  "@bitwarden/official-login-detail/login-credentials":
    "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.ts",
  "@bitwarden/official-login-detail/uri-options":
    "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.ts",
  "@bitwarden/official-login-detail/additional-options":
    "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts",
  "@bitwarden/official-login-detail/custom-fields":
    "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts",
  "@bitwarden/official-login-detail/item-history":
    "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts",
} as const;
const expectedTransformRuntimes = [
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-color-password.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-details.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-totp-countdown.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-uri-options.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-additional-options.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-custom-fields.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.ts",
] as const;

describe("official Login detail source boundary", () => {
  it("pins every model and retained detail authority to the vendored revision", () => {
    const manifest = readManifest();

    expect(manifest.revision).toBe(expectedRevision);
    expect(readFileSync(resolve(root, "vendor/bitwarden-clients/.source-revision"), "utf8")).toContain(
      expectedRevision,
    );
    expect(manifest.authorities.length).toBe(23);
    expect(manifest.authorities.map(({ path }) => path)).toContain(
      "libs/common/src/vault/services/totp.service.ts",
    );
    for (const authority of manifest.authorities) {
      expect(sha256(resolve(root, "vendor/bitwarden-clients", authority.path)), authority.path).toBe(
        authority.sha256,
      );
    }
  });

  it("pins GPL metadata, every restored official dependency tree, and local boundary bytes", () => {
    const manifest = readManifest();

    expect(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).license).toBe(
      "GPL-3.0-only",
    );
    expect(JSON.parse(readFileSync(resolve(root, "vendor/bitwarden-clients/package.json"), "utf8")).license)
      .toBe("GPL-3.0");
    expect(manifest.license).toEqual({
      rootPackageSha256: sha256(resolve(root, "package.json")),
      rootLicenseSha256: sha256(resolve(root, "LICENSE")),
      upstreamPackageSha256: sha256(resolve(root, "vendor/bitwarden-clients/package.json")),
      upstreamGplSha256: sha256(resolve(root, "vendor/bitwarden-clients/LICENSE_GPL.txt")),
    });
    for (const library of manifest.restoredLibraries) {
      const directory = resolve(root, "vendor/bitwarden-clients", library.path);
      expect(files(directory)).toHaveLength(library.fileCount);
      expect(treeSha256(directory), library.path).toBe(library.treeSha256);
    }
    for (const runtime of manifest.localRuntimes) {
      expect(sha256(resolve(root, runtime.path)), runtime.path).toBe(runtime.sha256);
    }
    expect(manifest.transforms.map(({ runtime }) => runtime)).toEqual(expectedTransformRuntimes);
    for (const transform of manifest.transforms) {
      expect(manifest.authorities.some(({ path }) => path === transform.authority)).toBe(true);
      expect(manifest.localRuntimes.some(({ path }) => path === transform.runtime)).toBe(true);
      expect(transform.allowedDifferences.length).toBeGreaterThan(0);
    }
  });

  it("declares exact dormant aliases in TypeScript and Vite", () => {
    const manifest = readManifest();
    const tsconfig = JSON.parse(readFileSync(resolve(root, "tsconfig.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, readonly string[]> };
    };

    expect(manifest.aliases).toEqual(expectedAliases);
    expect(Object.fromEntries(officialLoginDetailAliasSources)).toEqual({
      ...manifest.dependencyAliases,
      ...manifest.aliases,
    });
    const runtimeAliases = buildOfficialLoginDetailAliases(root);
    for (const [specifier, source] of Object.entries(expectedAliases)) {
      expect(tsconfig.compilerOptions.paths[specifier]).toEqual([source]);
      expect(resolvedAlias(runtimeAliases, specifier)).toBe(resolve(root, source));
    }
    for (const [specifier, source] of Object.entries(manifest.dependencyAliases)) {
      expect(tsconfig.compilerOptions.paths[specifier]).toEqual([source]);
      expect(resolvedAlias(runtimeAliases, specifier)).toBe(resolve(root, source));
    }
    expect(usesAliasBuilder(resolve(root, "apps/menubar-tauri/vite.config.ts"))).toBe(1);
    expect(usesAliasBuilder(resolve(root, "vitest.config.ts"))).toBe(1);
  });

  it("keeps every raw official Login detail alias dormant in production", () => {
    const imports = productionFiles(resolve(root, "apps/menubar-tauri/src"))
      .flatMap((path) => {
        return moduleSpecifiers(path)
          .filter((specifier) => specifier in expectedAliases)
          .map((specifier) => ({ path: relative(root, path), specifier }));
      });

    expect(imports).toEqual([]);
  });

  it("proves the KeyService compatibility alias is type-only in its pinned authority", () => {
    const utilsPath = resolve(
      root,
      "vendor/bitwarden-clients/libs/common/src/platform/misc/utils.ts",
    );
    const source = ts.createSourceFile(
      utilsPath,
      readFileSync(utilsPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const references: ts.Identifier[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "KeyService") {
        references.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    expect(references).toHaveLength(2);
    expect(references.filter((reference) => ts.isImportSpecifier(reference.parent))).toHaveLength(1);
    expect(references.filter((reference) => ts.isTypeReferenceNode(reference.parent))).toHaveLength(1);
    expect(readFileSync(
      resolve(root, "apps/menubar-tauri/src/app/official-ui/official-key-management.adapter.ts"),
      "utf8",
    )).not.toMatch(/constructor|new |inject\(|extends |implements /);

    const runtimeKeyImports = productionFiles(resolve(root, "apps/menubar-tauri/src"))
      .flatMap((path) => moduleSpecifiers(path).map((specifier) => ({ path, specifier })))
      .filter(({ specifier }) => specifier === "@bitwarden/key-management");
    expect(runtimeKeyImports).toEqual([]);

    const adapterPath = resolve(
      root,
      "apps/menubar-tauri/src/app/official-ui/official-key-management.adapter.ts",
    );
    const runtimeKeyServiceUses = productionFiles(resolve(root, "apps/menubar-tauri/src"))
      .filter((path) => path !== adapterPath)
      .flatMap((path) => identifiers(path, "KeyService").map(() => relative(root, path)));
    expect(runtimeKeyServiceUses).toEqual([]);
  });

  it("keeps excluded browser and unsupported feature tokens out of the production detail graph", () => {
    const manifest = readManifest();
    const detailGraph = [
      resolve(root, "apps/menubar-tauri/src/app/vault/login-cipher-view.adapter.ts"),
      ...productionFiles(resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail")),
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(manifest.excludedTokens).toEqual([
      "autofill/content",
      "autofill/background",
      "BrowserApi",
      "chrome.",
      "nativeMessaging",
      "AttachmentView",
      "Fido2CredentialView",
      "SshKeyView",
      "PremiumBadge",
      "AccountService",
      "BillingAccountProfileStateService",
      "CipherService",
      "PlatformUtilsService",
      "EventCollectionService",
      "CollectionView",
      "Organization",
    ]);
    for (const token of manifest.excludedTokens) {
      expect(detailGraph, token).not.toContain(token);
    }
  });

  it("uses a guarded color-password transform that blocks browser clipboard ownership", () => {
    const runtime = resolve(
      root,
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-color-password.component.ts",
    );
    const source = readFileSync(runtime, "utf8");
    const credentials = readFileSync(
      resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.ts"),
      "utf8",
    );
    const customFields = readFileSync(
      resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-custom-fields.component.ts"),
      "utf8",
    );

    expect(source).toContain('HostListener("copy"');
    expect(source).toContain("preventDefault()");
    expect(source).not.toContain("PlatformUtilsService");
    expect(source).not.toContain("copyToClipboard");
    expect(credentials).toContain('from "./official-color-password.component"');
    expect(customFields).toContain('from "./official-color-password.component"');
  });

  it("runs the pinned official countdown through the narrow deterministic TotpService adapter", () => {
    const manifest = readManifest();
    const credentials = readFileSync(
      resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.ts"),
      "utf8",
    );
    const template = readFileSync(
      resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.html"),
      "utf8",
    );

    expect(credentials).toContain("BitTotpCountdownComponent");
    expect(credentials).not.toContain("VaultTotpCodeComponent");
    expect(template).toContain("bitTotpCountdown");
    expect(template).not.toContain("bw-vault-totp-code");
    expect(credentials).toContain('from "./official-totp-countdown.component"');
    expect(manifest.localRuntimes.map(({ path }) => path)).toContain(
      "apps/menubar-tauri/src/app/vault/official-totp.service.adapter.ts",
    );
  });

  it("preserves the pinned countdown behavior and template with only exact typography imports", () => {
    const upstreamTs = readFileSync(
      resolve(root, "vendor/bitwarden-clients/libs/vault/src/components/totp-countdown/totp-countdown.component.ts"),
      "utf8",
    );
    const upstreamHtml = readFileSync(
      resolve(root, "vendor/bitwarden-clients/libs/vault/src/components/totp-countdown/totp-countdown.component.html"),
      "utf8",
    );
    const runtimeTsPath = resolve(
      root,
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-totp-countdown.component.ts",
    );
    const runtimeHtmlPath = resolve(
      root,
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/totp-countdown.component.html",
    );
    const runtimeTs = readFileSync(runtimeTsPath, "utf8");
    const runtimeHtml = readFileSync(runtimeHtmlPath, "utf8");
    const normalizedRuntimeTs = runtimeTs
      .replace(
        'import { TypographyDirective } from "@bitwarden/components/typography/typography.directive";',
        'import { TypographyModule } from "@bitwarden/components";',
      )
      .replaceAll("TypographyDirective", "TypographyModule");

    expect(runtimeHtml).toBe(upstreamHtml);
    expect(normalizedRuntimeTs).toBe(upstreamTs);
    expect(moduleSpecifiers(runtimeTsPath)).toContain(
      "@bitwarden/components/typography/typography.directive",
    );
    expect(moduleSpecifiers(runtimeTsPath)).not.toContain("@bitwarden/components");
  });

  it("keeps the detail closure off the broad component barrel", () => {
    const detailSources = productionFiles(
      resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail"),
    );
    const broadBarrelImports = detailSources.flatMap((path) =>
      moduleSpecifiers(path)
        .filter((specifier) =>
          specifier === "../../official-ui/official-components" ||
          specifier === "@bitwarden/components"
        )
        .map(() => relative(root, path)),
    );

    expect(broadBarrelImports).toEqual([]);
  });
});

function readManifest(): DetailManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as DetailManifest;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : statSync(path).isFile() ? [path] : [];
  }).sort();
}

function treeSha256(directory: string): string {
  const inventory = files(directory)
    .map((path) => `${sha256(path)}  ${relative(directory, path)}`)
    .join("\n") + "\n";
  return createHash("sha256").update(inventory).digest("hex");
}

function productionFiles(directory: string): string[] {
  return files(directory).filter(
    (path) =>
      path.endsWith(".ts") &&
      !path.endsWith(".spec.ts") &&
      !path.endsWith("upstream-source-map.ts"),
  );
}

function resolvedAlias(
  aliases: readonly { readonly find: RegExp; readonly replacement: string }[],
  specifier: string,
): string | undefined {
  const entry = aliases.find(({ find }) => find.test(specifier));
  expect(entry?.find.test(`${specifier}/nested`)).toBe(false);
  return entry?.replacement;
}

function usesAliasBuilder(configPath: string): number {
  const source = ts.createSourceFile(
    configPath,
    readFileSync(configPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let uses = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isSpreadElement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "buildOfficialLoginDetailAliases"
    ) {
      uses += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

function moduleSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const modules: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      modules.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return modules;
}

function identifiers(path: string, name: string): ts.Identifier[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const result: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) {
      result.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
