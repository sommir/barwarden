import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function validatedVersion(value) {
  if (typeof value !== "string" || !SEMVER.test(value)) {
    throw new Error("invalid release version");
  }
  return value;
}

export function readReleaseVersion(root = DEFAULT_ROOT) {
  return validatedVersion(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
}

export function releaseDmgName(version) {
  return `Barwarden-${validatedVersion(version)}.dmg`;
}

function packageVersionFromToml(source, packageName) {
  const packages = source.split(/^\[\[?package\]?\]\s*$/mu).slice(1);
  for (const block of packages) {
    const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/mu)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"\s*$/mu)?.[1];
    if (name === packageName && version) return version;
  }
  throw new Error(`missing ${packageName} package version`);
}

function valueFromXcconfig(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*([^\\s#]+)\\s*$`, "mu"));
  if (!match) throw new Error(`missing ${key} in xcconfig`);
  return match[1];
}

export function assertReleaseVersionSync(root = DEFAULT_ROOT) {
  const expected = readReleaseVersion(root);
  const tauri = JSON.parse(
    readFileSync(join(root, "apps/menubar-tauri/src-tauri/tauri.conf.json"), "utf8"),
  ).version;
  const cargo = packageVersionFromToml(
    readFileSync(join(root, "apps/menubar-tauri/src-tauri/Cargo.toml"), "utf8"),
    "barwarden",
  );
  const lock = packageVersionFromToml(
    readFileSync(join(root, "apps/menubar-tauri/src-tauri/Cargo.lock"), "utf8"),
    "barwarden",
  );
  const nativeAutoFill = valueFromXcconfig(
    readFileSync(join(root, "apps/macos-autofill/Config/Native.xcconfig"), "utf8"),
    "MARKETING_VERSION",
  );
  for (const actual of [tauri, cargo, lock, nativeAutoFill]) {
    if (actual !== expected) throw new Error("release version mismatch");
  }
  return expected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(assertReleaseVersionSync());
  } catch {
    console.error("RELEASE_VERSION_INVALID");
    process.exitCode = 1;
  }
}
