import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";

const root = process.cwd();
const cipherFormRoot = "apps/menubar-tauri/src/app/upstream-overlays/cipher-form";
const recoveryRoot = "apps/menubar-tauri/src/app/upstream-overlays/recovery";

const formManifestPaths = [
  `${cipherFormRoot}/official-login-form.transform-manifest.json`,
  `${cipherFormRoot}/official-personal-form.transform-manifest.json`,
];
const i18nEdges = [
  "apps/menubar-tauri/src/app/popup-state.ts -> ./official-ui/official-i18n.service => apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts",
  "apps/menubar-tauri/src/app/vault/retained-login-form.adapter.ts -> ../official-ui/official-i18n.service => apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts",
];

for (const path of formManifestPaths) {
  const manifest = readJson(path);
  for (const runtime of manifest.runtimes) {
    runtime.sha256 = hashFile(`${cipherFormRoot}/${runtime.path}`);
  }
  manifest.closure.edges = manifest.closure.edges.filter(
    (edge) => !i18nEdges.includes(edge),
  );
  const retainedEdges = path.includes("official-login-form")
    ? i18nEdges
    : i18nEdges.slice(0, 1);
  for (const edge of retainedEdges) {
    if (!manifest.closure.edges.includes(edge)) {
      manifest.closure.edges.push(edge);
    }
  }
  manifest.closure.edges.sort();
  manifest.closure.sha256 = hashText(`${manifest.closure.edges.join("\n")}\n`);
  manifest.license.rootPackageSha256 = hashFile("package.json");
  manifest.license.rootLicenseSha256 = hashFile("LICENSE");
  writeJson(path, manifest);
}

for (const path of [
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json",
]) {
  const manifest = readJson(path);
  for (const runtime of manifest.localRuntimes ?? manifest.runtimes ?? []) {
    runtime.sha256 = hashFile(runtime.path);
  }
  manifest.license.rootPackageSha256 = hashFile("package.json");
  manifest.license.rootLicenseSha256 = hashFile("LICENSE");
  writeJson(path, manifest);
}

for (const path of [
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.transform-manifest.json",
]) {
  const manifest = readJson(path);
  for (const runtime of manifest.localRuntimes ?? []) {
    runtime.sha256 = hashFile(runtime.path);
  }
  manifest.license.rootPackageSha256 = hashFile("package.json");
  manifest.license.rootLicenseSha256 = hashFile("LICENSE");
  writeJson(path, manifest);
}

const recoveryManifestPath = `${recoveryRoot}/official-recovery.transform-manifest.json`;
const recoveryManifest = readJson(recoveryManifestPath);
const recoveryEntrypoints = [
  `${recoveryRoot}/password-history/official-password-history-view.component.ts`,
  `${recoveryRoot}/folders/official-folders.component.ts`,
  `${recoveryRoot}/folders/official-add-edit-folder-dialog.component.ts`,
  `${recoveryRoot}/archive/official-archive.component.ts`,
  `${recoveryRoot}/trash/official-trash.component.ts`,
  `${recoveryRoot}/trash/official-trash-list-items-container.component.ts`,
];
const recoveryClosure = localImportClosure(recoveryEntrypoints);
recoveryManifest.importClosure = recoveryClosure;
recoveryManifest.importEdges = localImportEdges(recoveryClosure);

const localRuntimes = new Map(
  recoveryManifest.localRuntimes.map((runtime) => [runtime.path, runtime]),
);
for (const path of recoveryClosure) {
  if (!localRuntimes.has(path)) {
    localRuntimes.set(path, { path, sha256: "" });
  }
}
recoveryManifest.localRuntimes = [...localRuntimes.values()]
  .map((runtime) => ({ ...runtime, sha256: hashFile(runtime.path) }))
  .sort((left, right) => left.path.localeCompare(right.path));
writeJson(recoveryManifestPath, recoveryManifest);

function localImportClosure(entrypoints) {
  const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  const pending = entrypoints.map((path) => resolve(root, path));
  const seen = new Set();

  while (pending.length > 0) {
    const importer = pending.pop();
    const importerRelative = relative(root, importer);
    if (seen.has(importerRelative)) {
      continue;
    }
    seen.add(importerRelative);
    const source = readFileSync(importer, "utf8");
    for (const specifier of moduleSpecifiers(importer, source)) {
      const target = ts.resolveModuleName(specifier, importer, options, ts.sys)
        .resolvedModule?.resolvedFileName;
      if (!target) {
        continue;
      }
      const targetRelative = relative(root, target);
      if (
        targetRelative.startsWith("apps/menubar-tauri/src/") &&
        targetRelative.endsWith(".ts")
      ) {
        pending.push(target);
      }
    }
  }

  return [...seen].sort();
}

function localImportEdges(closure) {
  const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;

  return closure.flatMap((importer) => {
    const importerPath = resolve(root, importer);
    return moduleSpecifiers(importerPath, readFileSync(importerPath, "utf8")).flatMap(
      (specifier) => {
        const targetPath = ts.resolveModuleName(specifier, importerPath, options, ts.sys)
          .resolvedModule?.resolvedFileName;
        if (!targetPath) {
          return [];
        }
        const target = relative(root, targetPath);
        return closure.includes(target) ? [{ importer, specifier, target }] : [];
      },
    );
  }).sort((left, right) =>
    `${left.importer}:${left.specifier}`.localeCompare(`${right.importer}:${right.specifier}`),
  );
}

function moduleSpecifiers(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return file.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

function hashFile(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) {
    throw new Error(`Missing retained manifest runtime: ${path}`);
  }
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function writeJson(path, value) {
  writeFileSync(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`);
}
