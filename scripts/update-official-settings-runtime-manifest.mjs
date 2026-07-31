import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { officialSettingsRuntimeTransforms } from "../apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings-runtime-transforms.ts";

const root = resolve(process.env.OFFICIAL_SETTINGS_RUNTIME_ROOT ?? process.cwd());
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/settings";
const task1ManifestPath = `${overlayRoot}/official-settings.transform-manifest.json`;
const contractPath = `${overlayRoot}/official-settings-runtime-transforms.ts`;
const manifestPath = `${overlayRoot}/official-settings.runtime-manifest.json`;
const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";

const task1Manifest = JSON.parse(readFile(task1ManifestPath));
assertTask1Authorities(task1Manifest);

for (const contract of officialSettingsRuntimeTransforms) {
  const generated = absoluteFile(contract.generated);
  const output = absoluteFile(contract.output);
  const patch = resolve(root, contract.patch);
  mkdirSync(dirname(patch), { recursive: true });

  const result = spawnSync(
    "diff",
    [
      "-U0",
      "--label",
      `a/${contract.authority}`,
      "--label",
      `b/${contract.authority}`,
      generated,
      output,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 1 || !result.stdout.startsWith(`--- a/${contract.authority}\n`)) {
    throw new Error(
      `Unable to create exact runtime Settings patch: ${contract.authority}\n${result.stdout}${result.stderr}`,
    );
  }
  writeFileSync(patch, result.stdout);
}

const manifest = {
  version: 1,
  upstreamRevision: pinnedRevision,
  license: "GPL-3.0-only",
  task1TransformManifest: {
    path: task1ManifestPath,
    sha256: hashFile(task1ManifestPath),
  },
  runtimeTransformContract: {
    path: contractPath,
    sha256: hashFile(contractPath),
  },
  authorities: officialSettingsRuntimeTransforms.map((contract) => ({
    authority: {
      path: contract.authority,
      generatedPath: contract.generated,
      sha256: hashFile(contract.generated),
    },
    patch: {
      path: contract.patch,
      sha256: hashFile(contract.patch),
    },
    output: {
      path: contract.output,
      sha256: hashFile(contract.output),
    },
  })),
};

writeFileSync(resolve(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated official Settings runtime provenance for ${manifest.authorities.length} outputs`);

function assertTask1Authorities(manifest) {
  if (manifest.version !== 1 || manifest.upstreamRevision !== pinnedRevision) {
    throw new Error("Task 1 Settings transform manifest revision drift");
  }
  for (const contract of officialSettingsRuntimeTransforms) {
    const authority = manifest.authorities?.find(({ path }) => path === contract.authority);
    if (
      !authority ||
      authority.output?.path !== contract.generated ||
      authority.output.sha256 !== hashFile(contract.generated)
    ) {
      throw new Error(`Task 1 generated Settings authority drift: ${contract.authority}`);
    }
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
