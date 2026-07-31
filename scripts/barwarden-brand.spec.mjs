import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BARWARDEN_RELEASE_BRAND } from "./barwarden-brand.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scanRoots = [
  "apps/menubar-tauri/src",
  "apps/menubar-tauri/src-tauri",
  "apps/menubar-tauri/e2e",
  "scripts",
];
const scanFiles = [
  "apps/menubar-tauri/index.html",
];
const formerOwnedTokens = [
  ["Bitwarden", "Menubar"].join(" "),
  ["bitwarden", "menubar"].join("-"),
  ["BW", "MENUBAR"].join("_"),
  ["bw", "menubar"].join("-"),
  `__${["BITWARDEN", "MENUBAR"].join("_")}_VERSION__`,
];
const prohibitedLegacyDomain = `${["i", "wha", "le", "cloud"].join("")}\\.com`;
const excludedDirectories = new Set([
  ".generated", "dist", "generated", "gen", "node_modules", "target", "vendor",
]);
const sourceTextExtensions = new Set([
  ".applescript",
  ".c",
  ".cargo-lock",
  ".css",
  ".h",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".patch",
  ".plist",
  ".rs",
  ".scss",
  ".sh",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const scannerRelativePath = "scripts/barwarden-brand.spec.mjs";
test("uses the exact Barwarden package and release identity", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.name, "barwarden");
  assert.deepEqual(BARWARDEN_RELEASE_BRAND, {
    productName: "Barwarden",
    packageName: "barwarden",
    executableName: "barwarden",
    bundleIdentifier: "com.sommir.barwarden",
  });
});

test("publishes Barwarden-only repository metadata with a complete GPL license", () => {
  const readRepositoryText = (path) => readFileSync(join(repositoryRoot, path), "utf8");
  const publicFiles = ["README.md", "NOTICE.md", "CONTRIBUTING.md", "SECURITY.md"];

  for (const path of publicFiles) {
    const content = readRepositoryText(path);
    assert.match(content, /Barwarden/);
    assert.doesNotMatch(
      content,
      new RegExp([...formerOwnedTokens.slice(0, 2), prohibitedLegacyDomain].join("|"), "i"),
    );
  }

  const license = readRepositoryText("LICENSE");
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/i);
  assert.match(license, /Version 3, 29 June 2007/);
  assert.match(readRepositoryText(".gitignore"), /^\.env$/m);
  assert.match(readRepositoryText(".gitignore"), /^\.superpowers\/$/m);
  assert.match(readRepositoryText(".gitignore"), /^\.agents\/$/m);
});

test("contains no former application-owned identity outside exact non-migration fixtures", () => {
  const walkPolicy = {
    repositoryRoot,
    scanRoots: scanRoots.map((path) => join(repositoryRoot, path)),
  };
  const files = [];

  for (const scanRoot of scanRoots) {
    for (const absolutePath of walkFiles(join(repositoryRoot, scanRoot), walkPolicy)) {
      const relativePath = relative(repositoryRoot, absolutePath);
      if (relativePath === scannerRelativePath || isBinaryAsset(relativePath)) continue;
      files.push(absolutePath);
    }
  }
  files.push(...scanFiles.map((path) => join(repositoryRoot, path)));

  const violations = findFormerIdentityViolations(files, repositoryRoot);

  assert.deepEqual(
    violations.sort(),
    [],
    `former application-owned identity remains:\n${violations.sort().join("\n")}`,
  );
});

test("follows source symlinks within the scan roots so former tokens cannot bypass the scan", (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "barwarden-brand-symlink-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const firstRoot = join(fixtureRoot, "first");
  const secondRoot = join(fixtureRoot, "second");
  mkdirSync(firstRoot);
  mkdirSync(secondRoot);
  writeFileSync(join(secondRoot, "linked.ts"), `export const former = "${formerOwnedTokens[0]}";\n`);
  symlinkSync("../second/linked.ts", join(firstRoot, "linked.ts"));

  const files = walkFiles(firstRoot, {
    repositoryRoot: fixtureRoot,
    scanRoots: [firstRoot, secondRoot],
  });

  assert.deepEqual(files.map((path) => relative(firstRoot, path)), ["linked.ts"]);
  assert.match(readFileSync(files[0], "utf8"), new RegExp(formerOwnedTokens[0]));
});

test("rejects escaping and cyclic source symlinks but permits explicit vendor targets", (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "barwarden-brand-links-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const sourceRoot = join(fixtureRoot, "source");
  const vendorRoot = join(fixtureRoot, "vendor");
  const escapingRoot = mkdtempSync(join(tmpdir(), "barwarden-brand-escape-"));
  t.after(() => rmSync(escapingRoot, { recursive: true, force: true }));
  mkdirSync(sourceRoot);
  mkdirSync(vendorRoot);
  writeFileSync(join(vendorRoot, "upstream.ts"), "export const upstream = true;\n");
  writeFileSync(join(escapingRoot, "escape.ts"), "export const escape = true;\n");
  symlinkSync("../vendor/upstream.ts", join(sourceRoot, "vendor.ts"));

  assert.deepEqual(walkFiles(sourceRoot, {
    repositoryRoot: fixtureRoot,
    scanRoots: [sourceRoot],
  }), []);

  symlinkSync(join(escapingRoot, "escape.ts"), join(sourceRoot, "escape.ts"));
  assert.throws(
    () => walkFiles(sourceRoot, {
      repositoryRoot: fixtureRoot,
      scanRoots: [sourceRoot],
    }),
    /symbolic link.*escapes/i,
  );
  rmSync(join(sourceRoot, "escape.ts"));

  mkdirSync(join(sourceRoot, "cycle"));
  symlinkSync("..", join(sourceRoot, "cycle/back"));
  assert.throws(
    () => walkFiles(sourceRoot, {
      repositoryRoot: fixtureRoot,
      scanRoots: [sourceRoot],
    }),
    /cyclic symbolic link/i,
  );
});

test("uses a fail-closed source-text allowlist that skips fonts and scans source text", (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "barwarden-brand-text-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  writeFileSync(join(fixtureRoot, "font.woff"), Buffer.from(formerOwnedTokens[0]));
  writeFileSync(join(fixtureRoot, "font.woff2"), Buffer.from(formerOwnedTokens[0]));
  writeFileSync(join(fixtureRoot, "payload.bin"), Buffer.from(formerOwnedTokens[0]));
  writeFileSync(join(fixtureRoot, "source.ts"), `export const former = "${formerOwnedTokens[0]}";\n`);

  const scanned = walkFiles(fixtureRoot)
    .filter((path) => !isBinaryAsset(path))
    .sort((left, right) => left.localeCompare(right));

  assert.deepEqual(scanned.map((path) => relative(fixtureRoot, path)), ["source.ts"]);
  assert.deepEqual(
    findFormerIdentityViolations(scanned, fixtureRoot),
    [`source.ts:${formerOwnedTokens[0]} (found 1)`],
  );
});

function findFormerIdentityViolations(files, relativeRoot) {
  const occurrences = new Map();
  for (const absolutePath of files) {
    const relativePath = relative(relativeRoot, absolutePath);
    const content = readFileSync(absolutePath, "utf8");
    for (const token of formerOwnedTokens) {
      const count = content.split(token).length - 1;
      if (count > 0) occurrences.set(`${relativePath}\0${token}`, count);
    }
  }

  const violations = [];
  for (const [key, count] of occurrences) {
    const [path, token] = key.split("\0");
    violations.push(`${path}:${token} (found ${count})`);
  }
  return violations.sort();
}

function walkFiles(root, options = {}) {
  const policyRepositoryRoot = realpathSync(resolve(options.repositoryRoot ?? root));
  const canonicalScanRoots = (options.scanRoots ?? [root])
    .map((path) => realpathSync(resolve(path)));
  const activeDirectories = new Set();

  return walkDirectory(resolve(root), realpathSync(resolve(root)));

  function walkDirectory(logicalDirectory, canonicalDirectory) {
    if (activeDirectories.has(canonicalDirectory)) {
      throw new Error(`cyclic symbolic link encountered at ${logicalDirectory}`);
    }
    activeDirectories.add(canonicalDirectory);
    try {
      return readdirSync(logicalDirectory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((entry) => {
          const path = join(logicalDirectory, entry.name);
          if (entry.isDirectory()) {
            if (excludedDirectories.has(entry.name)) return [];
            return walkDirectory(path, realpathSync(path));
          }
          if (entry.isFile()) return [path];
          if (!entry.isSymbolicLink()) {
            throw new Error(`unsupported source entry at ${path}`);
          }

          let target;
          try {
            target = realpathSync(path);
          } catch {
            throw new Error(`unsupported symbolic link at ${path}`);
          }
          if (isExplicitlyExcludedTarget(policyRepositoryRoot, target)) return [];
          if (!canonicalScanRoots.some((scanRoot) => isWithin(scanRoot, target))) {
            throw new Error(`symbolic link escapes the current scan roots: ${path}`);
          }
          const targetStat = lstatSync(target);
          if (targetStat.isDirectory()) return walkDirectory(path, target);
          if (targetStat.isFile()) return [path];
          throw new Error(`unsupported symbolic link target at ${path}`);
        });
    } finally {
      activeDirectories.delete(canonicalDirectory);
    }
  }
}

function isExplicitlyExcludedTarget(canonicalRepositoryRoot, target) {
  if (!isWithin(canonicalRepositoryRoot, target)) return false;
  return relative(canonicalRepositoryRoot, target)
    .split(sep)
    .some((segment) => excludedDirectories.has(segment));
}

function isWithin(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`));
}

function isBinaryAsset(path) {
  return !sourceTextExtensions.has(extname(path).toLowerCase());
}
