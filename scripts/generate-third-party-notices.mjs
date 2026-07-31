import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateThirdPartyArtifacts,
  selectCargoRuntimePackages,
  selectNpmRuntimePackages,
  synchronizeArtifactFiles,
} from "./third-party-license-artifacts.mjs";

export * from "./third-party-license-artifacts.mjs";

function loadCargoMetadata(root) {
  return JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--locked",
        "--offline",
        "--format-version",
        "1",
        "--manifest-path",
        "apps/menubar-tauri/src-tauri/Cargo.toml",
      ],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  );
}

function loadCargoTree(root) {
  return execFileSync(
    "cargo",
    [
      "tree",
      "--locked",
      "--offline",
      "--target",
      "aarch64-apple-darwin",
      "--edges",
      "normal,no-proc-macro",
      "--prefix",
      "none",
      "--format",
      "{p}",
      "--manifest-path",
      "apps/menubar-tauri/src-tauri/Cargo.toml",
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

function runCli() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const npmLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const cargoMetadata = loadCargoMetadata(root);
  const cargoTree = loadCargoTree(root);
  const overrideRoot = join(root, "third_party_licenses", "overrides");
  const overrides = JSON.parse(
    readFileSync(join(overrideRoot, "manifest.json"), "utf8"),
  );
  const packages = [
    ...selectNpmRuntimePackages(npmLock, { root }),
    ...selectCargoRuntimePackages(cargoMetadata, cargoTree),
  ];
  const artifacts = generateThirdPartyArtifacts({
    packages,
    overrides,
    overrideRoot,
  });
  const checkOnly = process.argv.includes("--check");
  const filenames = synchronizeArtifactFiles(artifacts, { root, checkOnly });
  console.log(
    checkOnly
      ? `Third-party disclosure artifacts are current: ${filenames.join(", ")}.`
      : `Generated third-party disclosure artifacts: ${filenames.join(", ")}.`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
