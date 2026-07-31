import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { officialSettingsClosureExclusions } from "../apps/menubar-tauri/official-settings-aliases.ts";

const root = resolve(process.env.OFFICIAL_SETTINGS_ROOT ?? process.cwd());
const vendorRoot = resolve(root, "vendor/bitwarden-clients");
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/settings";
const sourceManifestPath = "apps/menubar-tauri/official-settings-source-manifest.json";
const transformContractPath = `${overlayRoot}/official-settings-member-transforms.ts`;
const transformManifestPath = `${overlayRoot}/official-settings.transform-manifest.json`;
const generatedRoot = `${overlayRoot}/generated`;
const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";

const authorityPaths = [
  "apps/browser/src/tools/popup/settings/settings-v2.component.ts",
  "apps/browser/src/tools/popup/settings/settings-v2.component.html",
  "apps/browser/src/auth/popup/settings/account-security.component.ts",
  "apps/browser/src/auth/popup/settings/account-security.component.html",
  "apps/browser/src/vault/popup/settings/vault-settings.component.ts",
  "apps/browser/src/vault/popup/settings/vault-settings.component.html",
  "apps/browser/src/vault/popup/settings/appearance.component.ts",
  "apps/browser/src/vault/popup/settings/appearance.component.html",
  "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts",
  "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html",
  "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts",
  "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html",
];

const contracts = authorityPaths.map((authority) => ({
  authority,
  runtime: `${generatedRoot}/${authority}`,
  patch: `${overlayRoot}/source-patches/${authority.replaceAll("/", "__")}.patch`,
}));

assertPinnedAuthorities();
assertDeclaredMembers();
assertGeneratedInventory();

const workspace = mkdtempSync(join(tmpdir(), "official-settings-transform-"));
try {
  for (const contract of contracts) generate(contract, workspace);
  writeTransformManifest();
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

function assertPinnedAuthorities() {
  const revision = readFile("vendor/bitwarden-clients/UI_SOURCE_COMMIT").trim();
  if (revision !== pinnedRevision) throw new Error(`Pinned Bitwarden revision drift: ${revision}`);

  const sourceManifest = JSON.parse(readFile(sourceManifestPath));
  if (sourceManifest.version !== 1 || sourceManifest.upstreamRevision !== pinnedRevision) {
    throw new Error("Settings source manifest revision drift");
  }
  const entries = sourceManifest.authorities;
  if (!Array.isArray(entries) || JSON.stringify(entries.map(({ path }) => path)) !== JSON.stringify(authorityPaths)) {
    throw new Error("Settings source manifest authority inventory drift");
  }
  for (const { path, sha256 } of entries) {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid Settings source manifest hash: ${path}`);
    const upstream = `vendor/bitwarden-clients/${path}`;
    if (!existsSync(resolve(root, upstream))) throw new Error(`Missing pinned Settings authority: ${path}`);
    if (hashFile(upstream) !== sha256) throw new Error(`Pinned Settings authority hash drift: ${path}`);
  }
}

function assertDeclaredMembers() {
  const source = readFile(transformContractPath);
  const declaredAuthorities = [...source.matchAll(/^\s+"(apps\/browser\/src\/.+\.(?:ts|html))",$/gm)].map(([, path]) => path);
  if (JSON.stringify(declaredAuthorities) !== JSON.stringify(authorityPaths)) {
    throw new Error("Settings transform contract has missing or undeclared members");
  }
}

function assertGeneratedInventory() {
  const directory = resolve(root, generatedRoot);
  if (!existsSync(directory)) return;
  const expected = new Set(contracts.map(({ runtime }) => runtime));
  const unexpected = filesBelow(directory)
    .map((path) => relative(root, path))
    .filter((path) => !expected.has(path));
  if (unexpected.length > 0) {
    throw new Error(`Settings transform contract has undeclared generated members:\n${unexpected.join("\n")}`);
  }
}

function generate(contract, workspace) {
  const temporaryAuthority = resolve(workspace, contract.authority);
  mkdirSync(dirname(temporaryAuthority), { recursive: true });
  copyFileSync(resolve(vendorRoot, contract.authority), temporaryAuthority);

  const patch = resolve(root, contract.patch);
  if (!existsSync(patch)) throw new Error(`Missing Settings transform patch: ${contract.patch}`);
  applyExactPatch("check", workspace, patch, contract.authority);
  applyExactPatch("apply", workspace, patch, contract.authority);

  const output = resolve(root, contract.runtime);
  const transformed = readFileSync(temporaryAuthority);
  assertExcludedClosure(contract.runtime, transformed.toString("utf8"));
  if (existsSync(output) && !readFileSync(output).equals(transformed)) {
    throw new Error(`Settings transform contract output drift: ${contract.runtime}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, transformed);
}

function assertExcludedClosure(runtime, transformed) {
  for (const exclusion of officialSettingsClosureExclusions) {
    if (new RegExp(exclusion.pattern, exclusion.flags).test(transformed)) {
      throw new Error(`Settings closure exclusion ${exclusion.id} survived transform: ${runtime}`);
    }
  }
}

function applyExactPatch(mode, workspace, patch, authority) {
  const args = ["-C", workspace, "apply"];
  if (mode === "check") args.push("--check");
  args.push(patch);
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `Settings transform contract failed for ${authority}: patch does not apply exactly\n${result.stdout}${result.stderr}`,
    );
  }
}

function writeTransformManifest() {
  const manifest = {
    version: 1,
    upstreamRevision: pinnedRevision,
    license: "GPL-3.0-only",
    sourceManifest: { path: sourceManifestPath, sha256: hashFile(sourceManifestPath) },
    transformContract: { path: transformContractPath, sha256: hashFile(transformContractPath) },
    authorities: contracts.map((contract) => ({
      path: contract.authority,
      upstreamSha256: hashFile(`vendor/bitwarden-clients/${contract.authority}`),
      patch: { path: contract.patch, sha256: hashFile(contract.patch) },
      output: { path: contract.runtime, sha256: hashFile(contract.runtime) },
    })),
  };
  writeFileSync(resolve(root, transformManifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
}

function readFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function hashFile(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`Missing Settings transform file: ${path}`);
  }
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
