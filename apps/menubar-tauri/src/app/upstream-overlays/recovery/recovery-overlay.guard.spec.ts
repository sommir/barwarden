import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { buildOfficialRecoveryAliases } from "../../../../official-recovery-aliases";
import { officialSourceMappings } from "../../upstream-source-map";
import { officialTrashWarningZhCn } from "../../official-ui/official-i18n.service";

const root = process.cwd();
const recoveryRoot = "apps/menubar-tauri/src/app/upstream-overlays/recovery";
const manifestPath = join(root, recoveryRoot, "official-recovery.transform-manifest.json");
const historyRuntime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts";
const foldersRuntime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.ts";
const folderDialogRuntime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts";
const archiveRuntime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts";
const trashRuntime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.ts";
const trashListRuntime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts";
const colorPasswordRuntime = "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-color-password.component.ts";
const commonUtilsRuntime = "apps/menubar-tauri/src/app/official-ui/official-common-utils.adapter.ts";
const colorPasswordAuthority = "vendor/bitwarden-clients/libs/components/src/color-password/color-password.component.ts";
const zhCnMessagesAuthority = "vendor/bitwarden-clients/apps/browser/src/_locales/zh_CN/messages.json";
const folderAuthorities = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.html",
  "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.html",
] as const;
const archiveAuthorities = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.html",
  "vendor/bitwarden-clients/libs/vault/src/services/archive-cipher-utilities.service.ts",
] as const;
const trashAuthorities = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.html",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.html",
] as const;
const forbiddenRecoveryTokens = [
  "BrowserApi",
  "currentTab",
  "currentUrl",
  "autofill/content",
  "autofill/background",
  "contentScript",
  "OrganizationService",
  "CollectionService",
  "AttachmentView",
  "SshKeyView",
  "Fido2",
  "PasskeyService",
  "passkeyNotCopied",
  "hasFido2Credentials",
  "PremiumBadge",
  "importCipher",
  "exportCipher",
  "nativeMessaging",
  "copyToClipboard",
  "navigator.clipboard",
] as const;

interface RecoveryManifest {
  readonly upstreamRevision: string;
  readonly sources: readonly { path: string; sha256: string; className?: string; members?: readonly string[] }[];
  readonly localRuntimes: readonly { path: string; sha256: string }[];
  readonly aliases: readonly string[];
  readonly importClosure: readonly string[];
  readonly importEdges: readonly RecoveryImportEdge[];
  readonly sourceRuntimeEdges: readonly RecoverySourceRuntimeEdge[];
  readonly excludedDependencies: readonly string[];
}

interface RecoveryImportEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly target: string;
}

interface RecoverySourceRuntimeEdge {
  readonly authority: string;
  readonly runtime: string;
}

interface OfficialMessages {
  readonly trashWarning?: { readonly message?: string };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}

function classMembers(path: string, className: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  return declaration?.members.map((member) => member.name?.getText(source) ?? ts.SyntaxKind[member.kind]) ?? [];
}

describe("official recovery overlay guard", () => {
  it("pins the retained recovery transforms to the vendored source and exact aliases", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = readManifest();
    const mapping = officialSourceMappings.find(
      ({ localModule }) => localModule === "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts",
    );
    const foldersMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === "apps/menubar-tauri/src/app/vault/folders-page.component.ts",
    );
    const foldersOverlayMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === foldersRuntime,
    );
    const folderDialogOverlayMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === folderDialogRuntime,
    );
    const manifestMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
    );
    const newItemMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === "apps/menubar-tauri/src/app/vault/new-item-page.component.ts",
    );
    const archiveMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === "apps/menubar-tauri/src/app/vault/archive-page.component.ts",
    );
    const archiveOverlayMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === archiveRuntime,
    );
    const trashMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === "apps/menubar-tauri/src/app/vault/trash-page.component.ts",
    );
    const trashOverlayMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === trashRuntime,
    );
    const trashListOverlayMapping = officialSourceMappings.find(
      ({ localModule }) => localModule === trashListRuntime,
    );

    expect(manifest.upstreamRevision).toBe("f47b6946e01aed474875789081966d311d5b8289");
    expect(mapping?.mode).toBe("overlay");
    expect(foldersMapping?.mode).toBe("overlay");
    expect(foldersMapping?.upstreamSources).toEqual(expect.arrayContaining(folderAuthorities));
    expect(foldersOverlayMapping?.upstreamSources).toEqual(folderAuthorities.slice(0, 2));
    expect(folderDialogOverlayMapping?.upstreamSources).toEqual(folderAuthorities.slice(2));
    expect(manifestMapping?.upstreamSources).toEqual(expect.arrayContaining(folderAuthorities));
    expect(newItemMapping?.upstreamSources).toEqual(expect.arrayContaining(folderAuthorities.slice(2)));
    expect(newItemMapping?.excludedDependencies).not.toEqual(expect.arrayContaining([
      "official folder creation dialog",
      "official initial-value handoff",
    ]));
    expect(archiveMapping?.mode).toBe("overlay");
    expect(archiveMapping?.upstreamSources).toEqual(expect.arrayContaining(archiveAuthorities));
    expect(archiveOverlayMapping?.upstreamSources).toEqual(archiveAuthorities);
    expect(trashMapping?.mode).toBe("overlay");
    expect(trashMapping?.upstreamSources).toEqual([...trashAuthorities, zhCnMessagesAuthority]);
    expect(trashOverlayMapping?.upstreamSources).toEqual([
      ...trashAuthorities.slice(0, 2),
      zhCnMessagesAuthority,
    ]);
    expect(trashListOverlayMapping?.upstreamSources).toEqual(trashAuthorities.slice(2));
    expect(manifestMapping?.upstreamSources).toEqual(expect.arrayContaining([
      ...archiveAuthorities,
      ...trashAuthorities,
      zhCnMessagesAuthority,
    ]));
    for (const source of manifest.sources) {
      expect(sha256(source.path)).toBe(source.sha256);
      if (source.className) {
        expect(classMembers(source.path, source.className)).toEqual(source.members);
      }
    }
    for (const runtime of manifest.localRuntimes) {
      expect(sha256(runtime.path)).toBe(runtime.sha256);
    }
    expect(manifest.sources.map(({ path }) => path)).toContain(colorPasswordAuthority);
    expect(manifest.sources.map(({ path }) => path)).toContain(zhCnMessagesAuthority);
    expect(manifest.localRuntimes.map(({ path }) => path)).toEqual(expect.arrayContaining([
      colorPasswordRuntime,
      commonUtilsRuntime,
    ]));
    expect(manifest.sourceRuntimeEdges).toEqual(expect.arrayContaining([
      {
        authority: colorPasswordAuthority,
        runtime: colorPasswordRuntime,
      },
      { authority: archiveAuthorities[0], runtime: archiveRuntime },
      { authority: trashAuthorities[0], runtime: trashRuntime },
      { authority: zhCnMessagesAuthority, runtime: trashRuntime },
      { authority: trashAuthorities[2], runtime: trashListRuntime },
    ]));
    for (const edge of manifest.sourceRuntimeEdges) {
      expect(manifest.sources.some(({ path }) => path === edge.authority)).toBe(true);
      expect(manifest.localRuntimes.some(({ path }) => path === edge.runtime)).toBe(true);
    }

    const aliases = buildOfficialRecoveryAliases(root);
    const cipherAlias = aliases.find((alias) => alias.find.test("@bitwarden/common/vault/models/view/cipher.view"));
    const folderAlias = aliases.find((alias) => alias.find.test("@bitwarden/common/vault/models/view/folder.view"));
    expect(cipherAlias?.find.test("@bitwarden/common/vault/models/view/cipher.view")).toBe(true);
    expect(cipherAlias?.find.test("@bitwarden/common/vault/models/view/cipher.view/sibling")).toBe(false);
    expect(folderAlias?.find.test("@bitwarden/common/vault/models/view/folder.view")).toBe(true);
    expect(folderAlias?.find.test("@bitwarden/common/vault/models/view/folder.view/sibling")).toBe(false);
    expect(manifest.aliases).toEqual(aliases.map(({ replacement }) => replacement.slice(root.length + 1)));
    expect(manifest.excludedDependencies.join(" ")).toMatch(
      /BrowserApi|current tab|current URL|autofill|content|background|organization|collection|attachment|SSH|FIDO|passkey|premium|import|export|native messaging|clipboard/i,
    );
  });

  it("pins the retained Trash warning to the official zh_CN trashWarning message", () => {
    const messages = JSON.parse(readFileSync(join(root, zhCnMessagesAuthority), "utf8")) as OfficialMessages;
    expect(messages.trashWarning?.message).toBe("回收站中超过 30 天的项目将被自动删除");
    expect(officialTrashWarningZhCn).toBe(`${messages.trashWarning!.message!}。`);
  });

  it("derives and enforces every transitive local runtime in the recovery import closure", () => {
    const manifest = readManifest();
    const actualClosure = recoveryLocalImportClosure([
      historyRuntime,
      foldersRuntime,
      folderDialogRuntime,
      archiveRuntime,
      trashRuntime,
      trashListRuntime,
    ]);

    expect(actualClosure).toContain(colorPasswordRuntime);
    expect(actualClosure).toContain(commonUtilsRuntime);
    expect(actualClosure).toContain(foldersRuntime);
    expect(actualClosure).toContain(folderDialogRuntime);
    expect(actualClosure).toContain(archiveRuntime);
    expect(actualClosure).toContain(trashRuntime);
    expect(actualClosure).toContain(trashListRuntime);
    expect(closureDeclarationViolations(actualClosure, manifest.importClosure)).toEqual([]);
    expect(actualClosure.every((path) => manifest.localRuntimes.some((runtime) => runtime.path === path))).toBe(true);
    expect(manifest.importEdges).toEqual(recoveryLocalImportEdges(actualClosure));
    expect(recoveryExclusionViolations(actualClosure)).toEqual([]);
  });

  it("fails when a direct local recovery dependency is omitted from the declared closure", () => {
    const actualClosure = recoveryLocalImportClosure([
      historyRuntime,
      foldersRuntime,
      folderDialogRuntime,
      archiveRuntime,
      trashRuntime,
      trashListRuntime,
    ]);
    const omittedColorRuntime = actualClosure.filter((path) => path !== colorPasswordRuntime);

    expect(closureDeclarationViolations(actualClosure, omittedColorRuntime)).toEqual([
      `missing local runtime: ${colorPasswordRuntime}`,
    ]);
  });

  it("follows runtime imports across app into the complete menubar src tree", () => {
    const closure = recoveryLocalImportClosure([
      "apps/menubar-tauri/src/app/vault-demo.ts",
    ]);

    expect(closure).toContain("apps/menubar-tauri/src/host/host-api.ts");
  });

  it("rejects a forbidden token injected into any transitive closure member in memory", () => {
    const actualClosure = recoveryLocalImportClosure([
      historyRuntime,
      foldersRuntime,
      folderDialogRuntime,
      archiveRuntime,
      trashRuntime,
      trashListRuntime,
    ]);
    const injectedSource = `${readFileSync(resolve(root, colorPasswordRuntime), "utf8")}\nvoid navigator.clipboard;\n`;

    expect(recoveryExclusionViolations(
      actualClosure,
      new Map([[colorPasswordRuntime, injectedSource]]),
    )).toEqual([`${colorPasswordRuntime}: navigator.clipboard`]);
  });
});

function readManifest(): RecoveryManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as RecoveryManifest;
}

function recoveryLocalImportClosure(
  entrypoints: readonly string[],
  sourceOverrides: ReadonlyMap<string, string> = new Map(),
): string[] {
  const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  const pending = entrypoints.map((path) => resolve(root, path));
  const seen = new Set<string>();

  while (pending.length > 0) {
    const importer = pending.pop()!;
    const importerRelative = relative(root, importer);
    if (seen.has(importerRelative)) {
      continue;
    }
    seen.add(importerRelative);
    const source = sourceOverrides.get(importerRelative) ?? readFileSync(importer, "utf8");
    for (const specifier of moduleSpecifiers(importer, source)) {
      const resolved = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved) {
        continue;
      }
      const resolvedRelative = relative(root, resolved);
      if (resolvedRelative.startsWith("apps/menubar-tauri/src/") && resolvedRelative.endsWith(".ts")) {
        pending.push(resolved);
      }
    }
  }

  return [...seen].sort();
}

function moduleSpecifiers(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

function recoveryLocalImportEdges(closure: readonly string[]): RecoveryImportEdge[] {
  const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;

  return closure.flatMap((importer) => {
    const importerPath = resolve(root, importer);
    const source = readFileSync(importerPath, "utf8");
    return moduleSpecifiers(importerPath, source).flatMap((specifier) => {
      const resolved = ts.resolveModuleName(specifier, importerPath, options, ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved) {
        return [];
      }
      const target = relative(root, resolved);
      return closure.includes(target) ? [{ importer, specifier, target }] : [];
    });
  }).sort((left, right) => `${left.importer}:${left.specifier}`.localeCompare(`${right.importer}:${right.specifier}`));
}

function closureDeclarationViolations(
  actualClosure: readonly string[],
  declaredClosure: readonly string[],
): string[] {
  return [
    ...actualClosure.filter((path) => !declaredClosure.includes(path)).map((path) => `missing local runtime: ${path}`),
    ...declaredClosure.filter((path) => !actualClosure.includes(path)).map((path) => `unexpected local runtime: ${path}`),
  ];
}

function recoveryExclusionViolations(
  closure: readonly string[],
  sourceOverrides: ReadonlyMap<string, string> = new Map(),
): string[] {
  return closure.flatMap((path) => {
    const source = sourceOverrides.get(path) ?? readFileSync(resolve(root, path), "utf8");
    return forbiddenRecoveryTokens
      .filter((token) => source.includes(token))
      .map((token) => `${path}: ${token}`);
  });
}
