import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  buildOfficialPersonalFormAliases,
  officialPersonalFormAliasSources,
} from "../../../../official-personal-form-aliases";
import {
  canonicalMemberFromSource,
  validatePinnedMemberTransforms,
} from "../official-source-body-contract";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";

const root = process.cwd();
const overlayRoot = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form",
);
const vendorRoot = resolve(root, "vendor/bitwarden-clients");
const revision = "f47b6946e01aed474875789081966d311d5b8289";
const manifestPath = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json",
);
const expectedAuthorities = [
  "apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.ts",
  "apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.html",
  "libs/vault/src/cipher-form/components/cipher-form.component.ts",
  "libs/vault/src/cipher-form/components/cipher-form.component.html",
  "libs/vault/src/cipher-form/cipher-form-container.ts",
  "libs/vault/src/cipher-form/abstractions/cipher-form-config.service.ts",
  "libs/vault/src/cipher-form/abstractions/cipher-form.service.ts",
  "libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts",
  "libs/vault/src/cipher-form/components/item-details/item-details-section.component.html",
  "libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts",
  "libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.html",
  "libs/vault/src/cipher-form/components/identity/identity.component.ts",
  "libs/vault/src/cipher-form/components/identity/identity.component.html",
  "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
  "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
  "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts",
  "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.html",
  "libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts",
  "libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.html",
] as const;
const excludedTokens = [
  "BrowserApi",
  "chrome.",
  "VaultPopupAutofillService",
  "BrowserPopupUtils",
  "AttachmentsV2ViewComponent",
  "CipherAttachmentsComponent",
  "Fido2CredentialView",
  "SshKeyView",
  "BankAccountView",
  "DriversLicenseViewComponent",
  "PassportView",
  "PremiumUpgradePromptService",
  "BillingAccountProfileStateService",
  "EventCollectionService",
  "CollectionService",
  "PolicyService",
  "nativeMessaging",
] as const;
const expectedRuntimes = [
  "official-personal-cipher-form.component.ts",
  "official-personal-cipher-form.component.html",
  "official-personal-form-container.ts",
  "official-personal-item-details.component.ts",
  "official-personal-item-details.component.html",
  "official-card-details-section.component.ts",
  "official-card-details-section.component.html",
  "official-identity-section.component.ts",
  "official-identity-section.component.html",
  "official-personal-additional-options.component.ts",
  "official-personal-additional-options.component.html",
  "official-personal-custom-fields.component.ts",
  "official-personal-custom-fields.component.html",
  "official-personal-add-edit-custom-field-dialog.component.ts",
  "official-personal-add-edit-custom-field-dialog.component.html",
] as const;

describe("official personal form source foundation", () => {
  it("pins the complete retained Card, Identity, and Secure Note form authority set", () => {
    const manifest = readManifest();

    expect(manifest.revision).toBe(revision);
    expect(manifest.authorities.map(({ path }) => path)).toEqual(
      expectedAuthorities,
    );
    for (const authority of manifest.authorities) {
      expect(
        sha256(resolve(root, "vendor/bitwarden-clients", authority.path)),
      ).toBe(authority.sha256);
    }
    expect(manifest.license).toEqual({
      rootPackageSha256: sha256(resolve(root, "package.json")),
      rootLicenseSha256: sha256(resolve(root, "LICENSE")),
      upstreamPackageSha256: sha256(
        resolve(root, "vendor/bitwarden-clients/package.json"),
      ),
      upstreamGplSha256: sha256(
        resolve(root, "vendor/bitwarden-clients/LICENSE_GPL.txt"),
      ),
    });
  });

  it("uses anchored dormant form aliases without sibling capture", () => {
    const manifest = readManifest();
    const aliases = buildOfficialPersonalFormAliases(root);

    expect(Object.fromEntries(officialPersonalFormAliasSources)).toEqual(
      manifest.aliases,
    );
    for (const [specifier, source] of Object.entries(manifest.aliases)) {
      const matches = aliases.filter(({ find }) => find.test(specifier));
      expect(matches).toHaveLength(1);
      expect(matches[0]?.replacement).toBe(resolve(root, source));
      expect(matches[0]?.find.test(`${specifier}/sibling`)).toBe(false);
    }
  });

  it("pins every retained runtime and complete production closure", () => {
    const manifest = readManifest();

    expect(manifest.runtimes.map(({ path }) => path)).toEqual(expectedRuntimes);
    for (const runtime of manifest.runtimes) {
      expect(sha256(resolve(manifestPath, "..", runtime.path))).toBe(
        runtime.sha256,
      );
    }
    expect(manifest.transforms).toHaveLength(15);
    expect(manifest.i18nKeys.length).toBeGreaterThan(0);
    expect(manifest.closure.roots).toContain(
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.ts",
    );
    expect(manifest.closure.roots).toContain(
      "apps/menubar-tauri/src/app/vault/retained-personal-cipher-form.adapter.ts",
    );
    expect(manifest.closure.edges.length).toBeGreaterThan(0);
    expect(manifest.closure.sha256).toBe(
      sha256Text(`${manifest.closure.edges.join("\n")}\n`),
    );
  });

  it("derives every runtime member from a pinned authority or canonical runtime-only member", async () => {
    const { personalFormMemberContracts } =
      await import("./official-personal-form-member-transforms");
    const manifest = readManifest();

    expect(personalFormMemberContracts).toHaveLength(8);
    const allowedRuntimeOnly: Readonly<Record<string, readonly string[]>> = {
      "official-personal-cipher-form.component.ts": [
        "formElement",
        "protectedOriginalCipherView",
        "canViewSecrets:get",
        "focusFirstInvalidControl",
        "cipherForSubmit",
        "stripServerState",
        "restoreDeniedControlState",
      ],
      "official-personal-form-container.ts": ["canViewSecrets"],
      "official-personal-item-details.component.ts": [],
      "official-card-details-section.component.ts": [
        "canViewSecrets:get",
        "normalizeExpirationMonth",
      ],
      "official-identity-section.component.ts": [
        "canViewSecrets:get",
        "localizedTitle",
        "canonicalTitle",
      ],
      "official-personal-additional-options.component.ts": [],
      "official-personal-custom-fields.component.ts": [],
      "official-personal-add-edit-custom-field-dialog.component.ts": [],
    };
    for (const entry of personalFormMemberContracts) {
      expect(entry.contract.enforceCompleteRuntimeMembers, entry.runtime).toBe(
        true,
      );
      const authority = readFileSync(
        resolve(vendorRoot, entry.authority),
        "utf8",
      );
      const runtime = readFileSync(resolve(overlayRoot, entry.runtime), "utf8");
      expect(
        validatePinnedMemberTransforms(authority, runtime, entry.contract),
        entry.runtime,
      ).toEqual([]);
      expect(
        new Set(
          entry.contract.transforms.map(({ runtimeMember }) => runtimeMember),
        ).size,
        entry.runtime,
      ).toBe(entry.contract.transforms.length);
      expect(
        (entry.contract.runtimeOnlyMembers ?? []).map(({ runtimeMember }) => runtimeMember),
        entry.runtime,
      ).toEqual(allowedRuntimeOnly[entry.runtime]);
      const authorityMembers = classMemberNames(
        authority,
        entry.contract.authorityClass,
      );
      for (const member of entry.contract.runtimeOnlyMembers ?? []) {
        expect(authorityMembers, member.runtimeMember).not.toContain(member.runtimeMember);
        expect(member.justification, member.runtimeMember).not.toBe(
          "Retained Tauri personal-form behavior required by the scoped adapter boundary.",
        );
        expect(member.justification.length, member.runtimeMember).toBeGreaterThan(24);
      }
    }

    expect(
      manifest.transforms.filter(({ kind }) => kind === "members"),
    ).toEqual(
      personalFormMemberContracts.map((entry) => {
        const runtime = readFileSync(
          resolve(overlayRoot, entry.runtime),
          "utf8",
        );
        return {
          kind: "members" as const,
          authority: entry.authority,
          authoritySha256: entry.contract.authoritySha256,
          runtime: entry.runtime,
          runtimeSha256: sha256Text(runtime),
          members: [
            ...entry.contract.transforms.map((transform) => ({
              authorityMember: transform.authorityMember,
              runtimeMember: transform.runtimeMember,
              canonicalSha256: sha256Text(
                canonicalMemberFromSource(
                  runtime,
                  entry.contract.runtimeClass,
                  transform.runtimeMember,
                ),
              ),
              operationsSha256: sha256Text(
                JSON.stringify(transform.operations),
              ),
            })),
            ...(entry.contract.runtimeOnlyMembers ?? []).map((member) => ({
              runtimeMember: member.runtimeMember,
              canonicalSha256: member.canonicalSha256,
              justification: member.justification,
            })),
          ],
        };
      }),
    );
  });

  it("replays every template transform exactly once and pins all template bytes", async () => {
    const { applyExactTemplateTransforms, personalFormTemplateContracts } =
      await import("./official-personal-form-member-transforms");
    const manifest = readManifest();

    expect(personalFormTemplateContracts).toHaveLength(7);
    for (const contract of personalFormTemplateContracts) {
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
        expect(occurrences(authority, operation.search), contract.runtime).toBe(
          1,
        );
      }
    }

    expect(
      manifest.transforms.filter(({ kind }) => kind === "template"),
    ).toEqual(
      personalFormTemplateContracts.map((contract) => {
        const runtime = readFileSync(
          resolve(overlayRoot, contract.runtime),
          "utf8",
        );
        return {
          kind: "template" as const,
          authority: contract.authority,
          runtime: contract.runtime,
          runtimeSha256: sha256Text(runtime),
          operationsSha256: sha256Text(JSON.stringify(contract.operations)),
        };
      }),
    );
  });

  it("pins the sorted production value-import closure without unresolved or broad-barrel edges", () => {
    const manifest = readManifest();
    const closure = productionClosure(manifest.closure.roots);

    expect(closure.errors).toEqual([]);
    expect(closure.edges).toEqual(manifest.closure.edges);
    expect(manifest.closure.edges).toEqual([...manifest.closure.edges].sort());
    expect(sha256Text(`${closure.edges.join("\n")}\n`)).toBe(
      manifest.closure.sha256,
    );

    const closureEvidence = [
      ...closure.files.map((path) => relative(root, path)),
      ...closure.edges,
      ...closure.files
        .filter((path) => path.endsWith(".ts"))
        .map((path) => readFileSync(path, "utf8")),
    ]
      .join("\n")
      .replaceAll("\\", "/")
      .toLocaleLowerCase("en-US");
    for (const token of manifest.excludedTokens) {
      expect(closureEvidence, token).not.toContain(token.toLocaleLowerCase("en-US"));
    }
  });

  it("derives and pins every personal-form zh_CN key used by templates and runtime members", async () => {
    const manifest = readManifest();
    const upstream = JSON.parse(
      readFileSync(
        resolve(vendorRoot, "apps/browser/src/_locales/zh_CN/messages.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const { officialPersonalFormZhCnMessages } =
      await import("../../official-ui/official-i18n.service");
    const usedKeys = usedPersonalI18nKeys();

    expect(usedKeys.dynamicCalls).toEqual([]);
    expect(Object.keys(officialPersonalFormZhCnMessages).sort()).toEqual(usedKeys.keys);
    expect([...manifest.i18nKeys].sort()).toEqual(usedKeys.keys);
    for (const key of manifest.i18nKeys) {
      expect(officialPersonalFormZhCnMessages[key], key).toEqual(upstream[key]);
    }
  });

  it("statically excludes every unsupported form owner from the complete runtime closure", () => {
    const manifest = readManifest();
    const source = [
      readFileSync(
        resolve(root, "apps/menubar-tauri/official-personal-form-aliases.ts"),
        "utf8",
      ),
      ...manifest.runtimes
        .filter(({ path }) => path.endsWith(".ts"))
        .map(({ path }) =>
          readFileSync(resolve(manifestPath, "..", path), "utf8"),
        ),
      readFileSync(
        resolve(
          root,
          "apps/menubar-tauri/src/app/vault/retained-personal-cipher-form.adapter.ts",
        ),
        "utf8",
      ),
    ].join("\n");

    expect(manifest.excludedTokens).toEqual(excludedTokens);
    const normalizedSource = source.replaceAll("\\\\", "/").toLowerCase();
    for (const token of excludedTokens) {
      expect(normalizedSource).not.toContain(
        token.replaceAll("\\\\", "/").toLowerCase(),
      );
    }
    expect(source).not.toContain('from "@bitwarden/components"');
    expect(source).not.toContain("vault-login-details-section");
    expect(source).not.toContain("vault-sshkey-section");
    expect(source).not.toContain("vault-bank-account-section");
  });

  it("requires beforeSubmit at the Angular input and template boundary", () => {
    const source = readFileSync(
      resolve(overlayRoot, "official-personal-cipher-form.component.ts"),
      "utf8",
    );
    const template = readFileSync(
      resolve(overlayRoot, "official-personal-cipher-form.component.html"),
      "utf8",
    );

    expect(source).toContain(
      "@Input({ required: true }) beforeSubmit: (cipher: CipherView) => Promise<boolean>;",
    );
    expect(template).toContain('[bitSubmit]="submit"');
  });

  it("installs the exact form alias builder before broad Vite aliases", () => {
    const vite = readFileSync(
      resolve(root, "apps/menubar-tauri/vite.config.ts"),
      "utf8",
    );

    expect(vite).toContain("buildOfficialPersonalFormAliases");
    expect(vite.indexOf("...buildOfficialPersonalFormAliases")).toBeLessThan(
      vite.indexOf('find: "@bitwarden/common"'),
    );
  });
});

type ManifestTransform =
  | {
      kind: "members";
      authority: string;
      authoritySha256: string;
      runtime: string;
      runtimeSha256: string;
      members: unknown[];
    }
  | {
      kind: "template";
      authority: string;
      runtime: string;
      runtimeSha256: string;
      operationsSha256: string;
    };

type Manifest = {
  revision: string;
  license: Record<string, string>;
  authorities: { path: string; sha256: string }[];
  aliases: Record<string, string>;
  runtimes: { path: string; sha256: string }[];
  transforms: ManifestTransform[];
  i18nKeys: string[];
  closure: { roots: string[]; edges: string[]; sha256: string };
  excludedTokens: string[];
};

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(source: string, search: string): number {
  return search.length === 0 ? 0 : source.split(search).length - 1;
}

function classMemberNames(sourceText: string, className: string): string[] {
  const source = ts.createSourceFile(
    `${className}.ts`,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  if (!declaration) throw new Error(`Missing class ${className}`);
  return declaration.members.flatMap((member) => {
    if (ts.isConstructorDeclaration(member)) return ["constructor"];
    const name = member.name?.getText(source);
    if (!name) return [];
    if (ts.isGetAccessorDeclaration(member)) return [`${name}:get`];
    if (ts.isSetAccessorDeclaration(member)) return [`${name}:set`];
    return [name];
  });
}

function usedPersonalI18nKeys(): { keys: string[]; dynamicCalls: string[] } {
  const keys = new Set<string>();
  const dynamicCalls: string[] = [];
  const upstreamKeys = new Set(
    Object.keys(
      JSON.parse(
        readFileSync(
          resolve(vendorRoot, "apps/browser/src/_locales/zh_CN/messages.json"),
          "utf8",
        ),
      ) as Record<string, unknown>,
    ),
  );
  for (const runtime of expectedRuntimes) {
    const path = resolve(overlayRoot, runtime);
    const sourceText = readFileSync(path, "utf8");
    if (runtime.endsWith(".html")) {
      for (const line of sourceText.split("\n").filter((line) => line.includes("| i18n"))) {
        for (const match of line.matchAll(/["']([A-Za-z][A-Za-z0-9]*)["']/g)) {
          if (upstreamKeys.has(match[1])) keys.add(match[1]);
        }
      }
      continue;
    }
    const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "t"
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) {
          keys.add(argument.text);
        } else if (argument?.getText(source) !== "option.i18nKey") {
          dynamicCalls.push(`${runtime}:${argument?.getText(source) ?? "missing"}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const option of [
    ...new CardView().linkedFieldOptions.values(),
    ...new IdentityView().linkedFieldOptions.values(),
  ]) {
    keys.add(option.i18nKey);
  }
  return { keys: [...keys].sort(), dynamicCalls: dynamicCalls.sort() };
}

function valueModuleSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
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
  files: string[];
} {
  const paths = compilerPaths();
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
      const resolved = resolveModule(requested, specifier, paths);
      if (!resolved) {
        const classification = classifyUnresolvedImport(sourceLabel, specifier);
        if ("edge" in classification) edges.add(classification.edge);
        else errors.push(classification.error);
        continue;
      }
      if (isBroadLocalBarrel(specifier, paths)) {
        errors.push(`barrel ${sourceLabel} -> ${specifier}`);
        continue;
      }
      const resolvedReal = safeRealpath(resolved);
      if (!resolvedReal) {
        errors.push(`unresolved ${sourceLabel} -> ${specifier}`);
        continue;
      }
      edges.add(
        `${sourceLabel} -> ${specifier} => ${relative(root, resolvedReal)}`,
      );
      queue.push(resolvedReal);
    }
  }
  return {
    edges: [...edges].sort(),
    errors: errors.sort(),
    files: [...visited].sort(),
  };
}

function compilerPaths(): Record<string, readonly string[]> {
  return (
    JSON.parse(readFileSync(resolve(root, "tsconfig.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, readonly string[]> };
    }
  ).compilerOptions.paths;
}

function isBroadLocalBarrel(
  specifier: string,
  paths: Record<string, readonly string[]>,
): boolean {
  if (`${specifier}/*` in paths) return true;
  return (paths[specifier] ?? []).some((target) => {
    const resolved = resolveFile(resolve(root, target));
    return resolved !== null && /(?:^|\/)[^/]*boundary\.tsx?$/.test(resolved);
  });
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
        resolve(root, target.replaceAll("*", wildcard)),
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
  return (
    candidates.find((path) => existsSync(path) && statSync(path).isFile()) ??
    null
  );
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
