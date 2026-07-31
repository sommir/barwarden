import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import {
  existsSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  canonicalMemberFromSource,
  validatePinnedMemberTransforms,
  type PinnedMemberTransformContract,
} from "../official-source-body-contract";

const root = process.cwd();
const overlayRoot = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form",
);
const vendorRoot = resolve(root, "vendor/bitwarden-clients");
const expectedRevision = "f47b6946e01aed474875789081966d311d5b8289";

const authorities = {
  "libs/vault/src/cipher-form/components/cipher-form.component.ts":
    "b29250c6046fc1f72513a2b5dcc599c79c8ee98d12504d168b012cc12f36dd82",
  "libs/vault/src/cipher-form/components/cipher-form.component.html":
    "bb8a1b11bd51aa5e276839719516c2d0614c01a9ede1c27bd6439e6533efbb1b",
  "libs/vault/src/cipher-form/cipher-form-container.ts":
    "d6a7f77b321237c86ebcc70b4f28bbe09b40cd878f5d4df9341091441b664afe",
  "libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts":
    "acc521629a3bef92da2c71e6c8314f1ba0dff25a4e89e4d673fd70a92ee88f1a",
  "libs/vault/src/cipher-form/components/item-details/item-details-section.component.html":
    "8aea816b84ef06189353994cc4c4c848d94c332e964c6e46f7cfa0139f2ad148",
  "libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.ts":
    "f1c1e10a7e8538e90e9286f121057cda1acf449da791c06437daff03c9b21304",
  "libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.html":
    "26e90802acb56aa42d6f8ce8fc1fdc2309fa030ea7b23a864a004741bef5887a",
  "libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.ts":
    "0c71900226564c615a60248bd56445bef351a19d2a9dbf00ae5d3af5c5f14034",
  "libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.html":
    "a288180b48c08f125fdc32f9331558b7fb778809419acbeae59a04b97dbdfd66",
  "libs/vault/src/cipher-form/components/autofill-options/uri-option.component.ts":
    "1080b380b2046f81815d605dc7410ecae2d0ad2e9c6d31ec4d1c3519421f76e4",
  "libs/vault/src/cipher-form/components/autofill-options/uri-option.component.html":
    "7a244769f128cc0f65b183510115e6b0d86ab0be2fbe0a089fffed6d342607b1",
  "libs/vault/src/cipher-form/components/autofill-options/advanced-uri-option-dialog.component.ts":
    "e2c2b826c3d9ec093d043062fd9a55090ad8f76cdcadf376f28e2c54abd0743e",
  "libs/vault/src/cipher-form/components/autofill-options/advanced-uri-option-dialog.component.html":
    "e2c2d54cd832db861ff7048842849922f1fa161f9fe9b2619810cd216be75ae9",
  "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts":
    "4a2c8f34f00349fc7da6702620090134a034825b7855f2d5899876abfc87d06f",
  "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html":
    "f0993bc3ad6ad1654668c59db8094b877025648378a239d47d3ab91074345f24",
  "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts":
    "950793d4f897d21efaa81ede2c6bdaf1ee37bd1f99b1654c5092609f9ec8482c",
  "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.html":
    "6de181d09eea2484f5f34b8e8ed5ca5e9d308b33562095e7ad0e466b6edc4ead",
  "libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts":
    "76e8fddd3f50b19427677aa33f30c93d6e430c6f251a6524135fb1b7e6d04f2b",
  "libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.html":
    "1b088b9962a9fd2eed3c1cd31979c531c1157e8f0a5cebde96a5ff6cde439de7",
} as const;

const runtimeFiles = [
  "official-login-cipher-form.component.ts",
  "official-login-cipher-form.component.html",
  "official-login-form-container.ts",
  "official-login-item-details.component.ts",
  "official-login-item-details.component.html",
  "official-login-details.component.ts",
  "official-login-details.component.html",
  "official-autofill-options.component.ts",
  "official-autofill-options.component.html",
  "official-uri-option.component.ts",
  "official-uri-option.component.html",
  "official-advanced-uri-option-dialog.component.ts",
  "official-advanced-uri-option-dialog.component.html",
  "official-additional-options.component.ts",
  "official-additional-options.component.html",
  "official-custom-fields.component.ts",
  "official-custom-fields.component.html",
  "official-add-edit-custom-field-dialog.component.ts",
  "official-add-edit-custom-field-dialog.component.html",
] as const;

type Manifest = {
  readonly revision: string;
  readonly authorities: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly license: Readonly<Record<string, string>>;
  readonly runtimes: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly aliases: Readonly<Record<string, string>>;
  readonly closure: {
    readonly roots: readonly string[];
    readonly edges: readonly string[];
    readonly sha256: string;
  };
  readonly i18nKeys: readonly string[];
  readonly excludedTokens: readonly string[];
};

describe("official Login form source boundary", () => {
  it("extends canonical member proof to constructors, getters, setters, and property initializers", () => {
    const authority = `
      class Authority {
        value = createValue(1);
        constructor(private dependency: Dependency) { this.value = dependency.value; }
        get current(): number { return this.value; }
        set current(value: number) { this.value = value; }
        method(): number { return this.current; }
      }
    `;
    const runtime = authority.replaceAll("Authority", "Runtime");
    const contract: PinnedMemberTransformContract = {
      authorityClass: "Authority",
      authoritySha256: hash(authority),
      runtimeClass: "Runtime",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        "value",
        "constructor",
        "current:get",
        "current:set",
        "method",
      ].map((member) => ({
        authorityMember: member,
        runtimeMember: member,
        operations: [],
        retainedAuthorityFragments: ["[[member-skeleton]]"],
        retainedAuthorityStatements: [],
        allowUnchanged: true,
      })),
    };

    expect(
      canonicalMemberFromSource(authority, "Authority", "constructor"),
    ).toContain("this.value = dependency.value");
    expect(
      canonicalMemberFromSource(authority, "Authority", "value"),
    ).toContain("createValue(1)");
    expect(
      canonicalMemberFromSource(authority, "Authority", "current:get"),
    ).toContain("return this.value");
    expect(
      validatePinnedMemberTransforms(authority, runtime, contract),
    ).toEqual([]);
    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime.replace("createValue(1)", "createValue(2)"),
        contract,
      ),
    ).toContain("Runtime.value derived body mismatch");
  });

  it("rejects every unlisted, duplicated, or drifted runtime-only member", () => {
    const authority = `class Authority { method(): number { return 1; } }`;
    const runtime = `
      class Runtime {
        method(): number { return 1; }
        helper = () => { return 2; };
      }
    `;
    const baseContract: PinnedMemberTransformContract = {
      authorityClass: "Authority",
      authoritySha256: hash(authority),
      runtimeClass: "Runtime",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        {
          authorityMember: "method",
          runtimeMember: "method",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
      ],
    };

    expect(
      validatePinnedMemberTransforms(authority, runtime, baseContract),
    ).toContain("Runtime.helper is an unlisted runtime member");

    const contract = {
      ...baseContract,
      runtimeOnlyMembers: [
        {
          runtimeMember: "helper",
          justification: "Retained application boundary helper.",
          canonicalSha256: hash(
            canonicalMemberFromSource(runtime, "Runtime", "helper"),
          ),
        },
      ],
    };
    expect(
      validatePinnedMemberTransforms(authority, runtime, contract),
    ).toEqual([]);
    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime.replace("return 2", "return 3"),
        contract,
      ),
    ).toContain("Runtime.helper runtime-only member drift");
    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime.replace(
          "helper = () => { return 2; };",
          "helper = () => { return 2; }; helper = () => { return 2; };",
        ),
        contract,
      ),
    ).toContain("Runtime.helper must resolve exactly once; received 2");
  });

  it("pins the exact revision, GPL authorities, and every generated runtime byte", () => {
    const manifest = readManifest();
    expect(manifest.revision).toBe(expectedRevision);
    expect(
      readFileSync(resolve(vendorRoot, ".source-revision"), "utf8"),
    ).toContain(expectedRevision);
    expect(
      Object.fromEntries(
        manifest.authorities.map((entry) => [entry.path, entry.sha256]),
      ),
    ).toEqual(authorities);
    for (const [path, digest] of Object.entries(authorities)) {
      expect(fileHash(resolve(vendorRoot, path)), path).toBe(digest);
    }
    expect(
      JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).license,
    ).toBe("GPL-3.0-only");
    expect(manifest.license).toEqual({
      rootPackageSha256: fileHash(resolve(root, "package.json")),
      rootLicenseSha256: fileHash(resolve(root, "LICENSE")),
      upstreamPackageSha256: fileHash(resolve(vendorRoot, "package.json")),
      upstreamGplSha256: fileHash(resolve(vendorRoot, "LICENSE_GPL.txt")),
    });
    expect(manifest.runtimes.map(({ path }) => path)).toEqual(runtimeFiles);
    for (const runtime of manifest.runtimes) {
      expect(fileHash(resolve(overlayRoot, runtime.path)), runtime.path).toBe(
        runtime.sha256,
      );
    }
  });

  it("derives every retained class member through exact named canonical transforms", async () => {
    const { loginFormMemberContracts } =
      await import("./official-login-form-member-transforms");
    expect(loginFormMemberContracts).toHaveLength(10);
    expect(
      loginFormMemberContracts
        .find((entry) => entry.runtime === "official-login-form-container.ts")
        ?.contract.transforms.map((transform) => transform.authorityMember),
    ).toEqual([
      "config",
      "originalCipherView",
      "registerChildForm",
      "website:get",
      "patchCipher",
      "getInitialCipherView",
      "initializedWithCachedCipher",
      "disableFormFields",
      "enableFormFields",
      "formStatusChange$",
    ]);
    for (const entry of loginFormMemberContracts) {
      expect(
        (
          entry.contract as PinnedMemberTransformContract & {
            enforceCompleteRuntimeMembers?: boolean;
          }
        ).enforceCompleteRuntimeMembers,
        entry.runtime,
      ).toBe(true);
      const failures = validatePinnedMemberTransforms(
        readFileSync(resolve(vendorRoot, entry.authority), "utf8"),
        readFileSync(resolve(overlayRoot, entry.runtime), "utf8"),
        entry.contract,
      );
      expect(failures, entry.runtime).toEqual([]);
      expect(
        new Set(
          entry.contract.transforms.map(
            (transform) => transform.authorityMember,
          ),
        ).size,
      ).toBe(entry.contract.transforms.length);
      for (const transform of entry.contract.transforms) {
        if (!transform.allowUnchanged) {
          expect(
            transform.operations.length,
            `${entry.runtime}:${transform.runtimeMember}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("replays exact-once template fragment transforms and compares every generated HTML byte", async () => {
    const { loginFormTemplateContracts, applyExactTemplateTransforms } =
      await import("./official-login-form-member-transforms");
    expect(loginFormTemplateContracts).toHaveLength(9);
    for (const contract of loginFormTemplateContracts) {
      const authority = readFileSync(
        resolve(vendorRoot, contract.authority),
        "utf8",
      );
      const runtime = readFileSync(
        resolve(overlayRoot, contract.runtime),
        "utf8",
      );
      expect(
        applyExactTemplateTransforms(authority, contract.operations),
        contract.runtime,
      ).toBe(runtime);
      for (const operation of contract.operations) {
        expect(occurrences(authority, operation.search), operation.search).toBe(
          1,
        );
      }
    }
    const additional = loginFormTemplateContracts.find(
      (entry) => entry.runtime === "official-additional-options.component.html",
    );
    expect(additional?.operations).toEqual([]);
  });

  it("uses anchored first-match aliases while keeping every raw alias dormant in production", async () => {
    const manifest = readManifest();
    const { buildOfficialLoginFormAliases, officialLoginFormAliasSources } =
      await import("../../../../official-login-form-aliases");
    const aliases = buildOfficialLoginFormAliases(root);
    expect(Object.fromEntries(officialLoginFormAliasSources)).toEqual(
      manifest.aliases,
    );
    for (const [specifier, source] of Object.entries(manifest.aliases)) {
      const first = aliases.find(({ find }) => find.test(specifier));
      expect(first?.replacement).toBe(resolve(root, source));
      expect(first?.find.test(`${specifier}/nested`)).toBe(false);
      expect(aliases.filter(({ find }) => find.test(specifier))).toHaveLength(
        1,
      );
    }

    const consumers = [
      ...productionFiles(resolve(root, "apps/menubar-tauri/src")),
      ...productionFiles(
        resolve(root, "apps/menubar-tauri/official-components-overlay"),
      ),
    ].flatMap((path) =>
      moduleSpecifiers(path)
        .filter((specifier) => specifier in manifest.aliases)
        .map((specifier) => `${relative(root, path)} -> ${specifier}`),
    );
    expect(consumers).toEqual([]);

    const vite = readFileSync(
      resolve(root, "apps/menubar-tauri/vite.config.ts"),
      "utf8",
    );
    expect(vite.match(/buildOfficialLoginFormAliases\(/g)).toHaveLength(1);
  });

  it("follows symlinked production directories by realpath without skipping their files", () => {
    expect(
      productionFiles(
        resolve(root, "apps/menubar-tauri/official-components-overlay"),
      ).some((path) =>
        path.endsWith(
          "/official-components-overlay/checkbox/checkbox.component.ts",
        ),
      ),
    ).toBe(true);
  });

  it("traverses only value-bearing static edges plus dynamic imports", () => {
    expect(
      valueModuleSpecifiers(
        "closure-fixture.ts",
        `
          import type { TypeImport } from "type-import";
          import { type NamedType } from "named-type-import";
          import "side-effect";
          import { RuntimeValue } from "value-import";
          export type { TypeExport } from "type-export";
          export { type NamedTypeExport } from "named-type-export";
          export { type MixedType, MixedValue } from "mixed-export";
          export * from "star-export";
          void import("dynamic-import");
        `,
      ),
    ).toEqual([
      "side-effect",
      "value-import",
      "mixed-export",
      "star-export",
      "dynamic-import",
    ]);
  });

  it("reports missing local specifiers unresolved before installed-package classification", () => {
    for (const specifier of [
      "../missing",
      "./missing",
      "/absolute/missing",
      "file:///local/missing",
    ]) {
      expect(isInstalledExternal(specifier), specifier).toBe(false);
      expect(classifyUnresolvedImport("fixture.ts", specifier)).toEqual({
        error: `unresolved fixture.ts -> ${specifier}`,
      });
    }

    expect(classifyUnresolvedImport("fixture.ts", "path")).toEqual({
      edge: "fixture.ts -> external:path",
    });
    expect(classifyUnresolvedImport("fixture.ts", "rxjs/operators")).toEqual({
      edge: "fixture.ts -> external:rxjs/operators",
    });
  });

  it("rejects local package-root barrels while allowing exact leaf modules", () => {
    expect(isBroadLocalBarrel("@bitwarden/components")).toBe(true);
    expect(isBroadLocalBarrel("@bitwarden/vault")).toBe(true);
    expect(isBroadLocalBarrel("@bitwarden/storage-core")).toBe(false);
    expect(isBroadLocalBarrel("@bitwarden/common/vault/enums")).toBe(false);
    expect(
      isBroadLocalBarrel("@bitwarden/components/button/button.component"),
    ).toBe(false);
  });

  it("pins the complete resolved production value-import closure and rejects unresolved, barrel, and excluded edges", () => {
    const manifest = readManifest();
    const closure = productionClosure(manifest.closure.roots);
    expect(closure.errors).toEqual([]);
    expect(
      closure.edges.some((edge) =>
        edge.startsWith(
          "vendor/bitwarden-clients/libs/common/src/vault/enums/index.ts ->",
        ),
      ),
    ).toBe(true);
    expect(closure.edges).toEqual(manifest.closure.edges);
    expect(hash(`${closure.edges.join("\n")}\n`)).toBe(manifest.closure.sha256);
    expect(manifest.closure.edges).toEqual([...manifest.closure.edges].sort());
    for (const token of manifest.excludedTokens) {
      expect(manifest.closure.edges.join("\n"), token).not.toContain(token);
    }
  });

  it("uses exact static zh_CN messages and placeholder metadata without synthetic placeholders", async () => {
    const manifest = readManifest();
    const upstream = JSON.parse(
      readFileSync(
        resolve(vendorRoot, "apps/browser/src/_locales/zh_CN/messages.json"),
        "utf8",
      ),
    ) as Record<
      string,
      { message: string; placeholders?: Record<string, unknown> }
    >;
    const { officialFormZhCnMessages } =
      await import("../../official-ui/official-i18n.service");

    expect(Object.keys(officialFormZhCnMessages).sort()).toEqual(
      [...manifest.i18nKeys].sort(),
    );
    for (const key of manifest.i18nKeys) {
      expect(officialFormZhCnMessages[key], key).toEqual(upstream[key]);
      expect(officialFormZhCnMessages[key].message, key).not.toMatch(/\{\d+\}/);
    }
  });

  it("does not adapt browser, ownership, archive, audit, event, platform, FIDO, or TOTP capture services", () => {
    const source = [
      ...runtimeFiles
        .filter((path) => path.endsWith(".ts"))
        .map((path) => readFileSync(resolve(overlayRoot, path), "utf8")),
      readFileSync(
        resolve(
          root,
          "apps/menubar-tauri/src/app/vault/retained-login-form.adapter.ts",
        ),
        "utf8",
      ),
    ].join("\n");
    const excluded = [
      "AccountService",
      "CipherArchiveService",
      "AuditService",
      "EventCollectionService",
      "PlatformUtilsService",
      "TotpCaptureService",
      "AutofillSettingsServiceAbstraction",
      "DomainSettingsService",
      "ConfigService",
      "PolicyService",
      "Organization",
      "CollectionView",
      "Fido2CredentialView",
    ];
    for (const token of excluded) {
      expect(source, token).not.toContain(token);
    }
    expect(source).toContain(
      "RetainedCipherFormService extends CipherFormService",
    );
    expect(source).toContain("WeakMap<Cipher, CipherView>");
    expect(source).toContain("canViewSecrets");
    expect(
      readFileSync(
        resolve(root, "apps/menubar-tauri/src/app/app.config.ts"),
        "utf8",
      ),
    ).toContain(
      "{ provide: RETAINED_LOGIN_FORM_GENERATOR, useExisting: GeneratorService }",
    );
    expect(
      readFileSync(
        resolve(root, "apps/menubar-tauri/src/app/app.config.ts"),
        "utf8",
      ),
    ).toContain(
      "{ provide: RETAINED_LOGIN_FORM_STATUS_STORE, useExisting: PopupStateStore }",
    );
  });
});

function readManifest(): Manifest {
  const path = resolve(
    overlayRoot,
    "official-login-form.transform-manifest.json",
  );
  expect(existsSync(path), path).toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function fileHash(path: string): string {
  return hash(readFileSync(path));
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(source: string, search: string): number {
  return search.length === 0 ? 0 : source.split(search).length - 1;
}

function files(
  directory: string,
  visitedDirectories = new Set<string>(),
  visitedFiles = new Set<string>(),
): string[] {
  const realDirectory = safeRealpath(directory);
  if (!realDirectory || visitedDirectories.has(realDirectory)) {
    return [];
  }
  visitedDirectories.add(realDirectory);

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    const real = safeRealpath(path);
    if (!real) return [];
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return files(path, visitedDirectories, visitedFiles);
    }
    if (!stats.isFile() || visitedFiles.has(real)) {
      return [];
    }
    visitedFiles.add(real);
    return [path];
  });
}

function productionFiles(directory: string): string[] {
  return files(directory).filter(
    (path) =>
      path.endsWith(".ts") &&
      !path.endsWith(".spec.ts") &&
      !path.endsWith("upstream-source-map.ts"),
  );
}

function moduleSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
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
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return modules;
}

function valueModuleSpecifiers(path: string, sourceText?: string): string[] {
  const source = ts.createSourceFile(
    path,
    sourceText ?? readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const modules: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      const hasValue =
        !clause ||
        (!clause.isTypeOnly &&
          (clause.name !== undefined ||
            !clause.namedBindings ||
            ts.isNamespaceImport(clause.namedBindings) ||
            clause.namedBindings.elements.some(
              (element) => !element.isTypeOnly,
            )));
      if (hasValue) modules.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.exportClause;
      const hasValue =
        !clause ||
        ts.isNamespaceExport(clause) ||
        clause.elements.some((element) => !element.isTypeOnly);
      if (hasValue) modules.push(statement.moduleSpecifier.text);
    }
  }
  const visitDynamic = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visitDynamic);
  };
  visitDynamic(source);
  return modules;
}

function productionClosure(rootPaths: readonly string[]): {
  edges: string[];
  errors: string[];
} {
  const tsconfig = JSON.parse(
    readFileSync(resolve(root, "tsconfig.json"), "utf8"),
  ) as {
    compilerOptions: { paths: Record<string, readonly string[]> };
  };
  const queue = rootPaths.map((path) => resolve(root, path));
  const visited = new Set<string>();
  const edges = new Set<string>();
  const errors: string[] = [];
  while (queue.length > 0) {
    const requested = queue.shift()!;
    const real = safeRealpath(requested);
    if (!real) {
      errors.push(`unresolved root ${relative(root, requested)}`);
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);
    const sourceLabel = relative(root, real);
    for (const specifier of valueModuleSpecifiers(real)) {
      const resolved = resolveModule(
        requested,
        specifier,
        tsconfig.compilerOptions.paths,
      );
      if (!resolved) {
        const classification = classifyUnresolvedImport(sourceLabel, specifier);
        if ("edge" in classification) {
          edges.add(classification.edge);
        } else {
          errors.push(classification.error);
        }
        continue;
      }
      if (isBroadLocalBarrel(specifier, tsconfig.compilerOptions.paths)) {
        errors.push(`barrel ${sourceLabel} -> ${specifier}`);
        continue;
      }
      const resolvedReal = safeRealpath(resolved);
      if (!resolvedReal) {
        errors.push(`unresolved ${sourceLabel} -> ${specifier}`);
        continue;
      }
      const targetLabel = relative(root, resolvedReal);
      edges.add(`${sourceLabel} -> ${specifier} => ${targetLabel}`);
      queue.push(resolvedReal);
    }
  }

  return { edges: [...edges].sort(), errors: errors.sort() };
}

function isBroadLocalBarrel(
  specifier: string,
  paths = compilerPaths(),
): boolean {
  if (`${specifier}/*` in paths) {
    return true;
  }
  const targets = paths[specifier];
  if (!targets) return false;

  return targets.some((target) => {
    const resolved = resolveFile(resolve(root, target));
    return resolved !== null && /(?:^|\/)[^/]*boundary\.tsx?$/.test(resolved);
  });
}

function compilerPaths(): Record<string, readonly string[]> {
  return (
    JSON.parse(readFileSync(resolve(root, "tsconfig.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, readonly string[]> };
    }
  ).compilerOptions.paths;
}

function isInstalledExternal(specifier: string): boolean {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("file:")
  ) {
    return false;
  }
  const packageName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return (
    builtinModules.includes(packageName) ||
    builtinModules.includes(specifier) ||
    existsSync(resolve(root, "node_modules", packageName, "package.json"))
  );
}

function classifyUnresolvedImport(
  sourceLabel: string,
  specifier: string,
): { readonly edge: string } | { readonly error: string } {
  return isInstalledExternal(specifier)
    ? { edge: `${sourceLabel} -> external:${specifier}` }
    : { error: `unresolved ${sourceLabel} -> ${specifier}` };
}

function resolveModule(
  importer: string,
  specifier: string,
  paths: Record<string, readonly string[]>,
): string | null {
  if (specifier.startsWith(".")) {
    return resolveFile(resolve(dirname(importer), specifier));
  }
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf("*");
    const matches =
      star < 0
        ? specifier === pattern
        : specifier.startsWith(pattern.slice(0, star)) &&
          specifier.endsWith(pattern.slice(star + 1));
    if (!matches) continue;
    const wildcard =
      star < 0
        ? ""
        : specifier.slice(
            pattern.slice(0, star).length,
            specifier.length - pattern.slice(star + 1).length,
          );
    for (const target of targets) {
      const resolved = resolveFile(
        resolve(root, target.replace("*", wildcard)),
      );
      if (resolved) return resolved;
    }
  }
  return null;
}

function resolveFile(candidate: string): string | null {
  const sourceCandidate = candidate.replace(/\.(?:c|m)?js$/, "");
  const candidates = [
    candidate,
    `${sourceCandidate}.ts`,
    `${sourceCandidate}.tsx`,
    `${sourceCandidate}.mts`,
    `${sourceCandidate}.cts`,
    `${sourceCandidate}.json`,
    resolve(candidate, "index.ts"),
    resolve(candidate, "index.tsx"),
  ];
  for (const path of candidates) {
    if (existsSync(path) && statSync(path).isFile()) {
      return path;
    }
  }
  return null;
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
