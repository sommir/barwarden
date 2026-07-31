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
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";

import { officialSettingsRuntimeTransforms } from "../apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings-runtime-transforms.ts";

const root = resolve(process.env.OFFICIAL_SETTINGS_RUNTIME_ROOT ?? process.cwd());
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/settings";
const task1ManifestPath = `${overlayRoot}/official-settings.transform-manifest.json`;
const contractPath = `${overlayRoot}/official-settings-runtime-transforms.ts`;
const manifestPath = `${overlayRoot}/official-settings.runtime-manifest.json`;
const patchRoot = `${overlayRoot}/runtime-patches`;
const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";

const manifest = JSON.parse(readFile(manifestPath));
const task1Manifest = JSON.parse(readFile(task1ManifestPath));
assertManifestInventory();
assertPatchInventory();

const workspace = mkdtempSync(resolve(tmpdir(), "official-settings-runtime-check-"));
try {
  for (const [index, contract] of officialSettingsRuntimeTransforms.entries()) {
    checkContract(contract, manifest.authorities[index], task1Manifest, workspace);
  }
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

console.log(
  `Official Settings runtime provenance check passed for ${officialSettingsRuntimeTransforms.length} outputs at ${pinnedRevision}`,
);

function assertManifestInventory() {
  if (manifest.version !== 1 || manifest.upstreamRevision !== pinnedRevision) {
    throw new Error("Official Settings runtime manifest revision drift");
  }
  if (
    manifest.task1TransformManifest?.path !== task1ManifestPath ||
    manifest.task1TransformManifest.sha256 !== hashFile(task1ManifestPath)
  ) {
    throw new Error("Official Settings runtime Task 1 manifest binding drift");
  }
  if (
    manifest.runtimeTransformContract?.path !== contractPath ||
    manifest.runtimeTransformContract.sha256 !== hashFile(contractPath)
  ) {
    throw new Error("Official Settings runtime transform contract drift");
  }
  const expected = officialSettingsRuntimeTransforms.map((contract) => ({
    authority: contract.authority,
    generated: contract.generated,
    patch: contract.patch,
    output: contract.output,
  }));
  const actual = manifest.authorities?.map((entry) => ({
    authority: entry.authority?.path,
    generated: entry.authority?.generatedPath,
    patch: entry.patch?.path,
    output: entry.output?.path,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Official Settings runtime authority inventory drift");
  }
}

function assertPatchInventory() {
  const expected = new Set(officialSettingsRuntimeTransforms.map(({ patch }) => patch));
  const actual = filesBelow(resolve(root, patchRoot)).map((path) => relative(root, path));
  const unexpected = actual.filter((path) => !expected.has(path));
  const missing = [...expected].filter((path) => !actual.includes(path));
  if (unexpected.length || missing.length) {
    throw new Error(
      `Official Settings runtime patch inventory drift\nMissing: ${missing.join(", ")}\nUnexpected: ${unexpected.join(", ")}`,
    );
  }
}

function checkContract(contract, entry, task1, workspace) {
  const task1Authority = task1.authorities?.find(({ path }) => path === contract.authority);
  const generatedHash = hashFile(contract.generated);
  if (
    !task1Authority ||
    task1Authority.output?.path !== contract.generated ||
    task1Authority.output.sha256 !== generatedHash ||
    entry.authority.sha256 !== generatedHash
  ) {
    throw new Error(`Official Settings runtime authority hash drift: ${contract.authority}`);
  }
  if (entry.patch.sha256 !== hashFile(contract.patch)) {
    throw new Error(`Official Settings runtime patch hash drift: ${contract.patch}`);
  }
  if (entry.output.sha256 !== hashFile(contract.output)) {
    throw new Error(`Official Settings runtime output hash drift: ${contract.output}`);
  }

  const temporaryAuthority = resolve(workspace, contract.authority);
  mkdirSync(dirname(temporaryAuthority), { recursive: true });
  copyFileSync(absoluteFile(contract.generated), temporaryAuthority);
  applyPatch("--check", workspace, contract);
  applyPatch(null, workspace, contract);
  if (!readFileSync(temporaryAuthority).equals(readFileSync(absoluteFile(contract.output)))) {
    throw new Error(`Official Settings runtime transformed output drift: ${contract.output}`);
  }
}

function applyPatch(mode, workspace, contract) {
  const args = ["-C", workspace, "apply", "--unidiff-zero"];
  if (mode) {
    args.push(mode);
  }
  args.push(absoluteFile(contract.patch));
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `Official Settings runtime patch does not apply exactly: ${contract.patch}\n${result.stdout}${result.stderr}`,
    );
  }
}

function readFile(path) {
  return readFileSync(absoluteFile(path), "utf8");
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(absoluteFile(path))).digest("hex");
}

function absoluteFile(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`Missing official Settings runtime provenance file: ${path}`);
  }
  return absolute;
}

function filesBelow(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
