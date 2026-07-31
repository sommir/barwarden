#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { assertSafeMachineReport } from "./run-m16-verification.mjs";
import {
  validateM16Replay,
  validateM16ReplayMarkdown,
} from "./m16-live-native-replay-validator.mjs";
import { BARWARDEN_RELEASE_BRAND } from "./barwarden-brand.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultReportPath = "docs/superpowers/specs/2026-07-22-m16-machine-verification.json";
const defaultChecksumsPath = "docs/superpowers/specs/2026-07-22-v1-release-checksums.txt";
const expectedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const product = Object.freeze({
  name: BARWARDEN_RELEASE_BRAND.productName,
  identifier: BARWARDEN_RELEASE_BRAND.bundleIdentifier,
  version: "0.1.0",
  minimumMacosVersion: "13.0",
});
const sourceArchivePrefix = `${BARWARDEN_RELEASE_BRAND.packageName}-${product.version}/`;
const distPaths = Object.freeze([
  `dist/${BARWARDEN_RELEASE_BRAND.productName}.app.tar.gz`,
  `dist/${BARWARDEN_RELEASE_BRAND.productName}_${product.version}_aarch64.dmg`,
  `dist/${BARWARDEN_RELEASE_BRAND.packageName}-${product.version}-source.tar.gz`,
]);
const evidencePaths = Object.freeze([
  defaultReportPath,
  "docs/superpowers/specs/2026-07-22-m16-live-native-replay.json",
  "docs/superpowers/specs/2026-07-22-m16-live-native-result.md",
  "docs/superpowers/screenshots/m16-release-candidate-2026-07-22/manifest.json",
  "docs/superpowers/specs/2026-07-22-v1-release-evidence-index.md",
  "docs/superpowers/specs/2026-07-22-v1-supported-excluded-features.md",
  "docs/superpowers/specs/2026-07-22-v1-installation.md",
  "docs/superpowers/specs/2026-07-22-v1-overlay-inventory.md",
]);
const postCandidateEvidencePaths = new Set([
  defaultReportPath,
  "docs/superpowers/specs/2026-07-22-m16-live-native-replay.json",
  "docs/superpowers/specs/2026-07-22-m16-live-native-result.md",
]);
const replayPath = "docs/superpowers/specs/2026-07-22-m16-live-native-replay.json";
const replayResultPath = "docs/superpowers/specs/2026-07-22-m16-live-native-result.md";
export function generateV1Handoff(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const reportPath = options.reportPath ?? defaultReportPath;
  const checksumsPath = options.checksumsPath ?? defaultChecksumsPath;
  const report = readJson(join(root, reportPath), "M16 machine report");
  assertHandoffMachineReport(report);
  assertRequiredEvidence(root);
  assertCandidateSource(root, report.sourceRevision, reportPath, checksumsPath);
  assertCandidateArtifacts(root, report);
  const replay = readJson(join(root, replayPath), "M16 replay");
  assertHandoffReplay(replay, report, readFileSync(join(root, replayResultPath), "utf8"));

  const outputDirectory = join(root, "dist");
  mkdirSync(outputDirectory, { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), `${BARWARDEN_RELEASE_BRAND.packageName}-handoff-`));
  try {
    writeSourceArchive(root, report.sourceRevision, join(root, distPaths[2]), temporary);
    writeAppArchive(root, report, join(root, distPaths[0]), temporary);
    copyFileSync(join(root, report.artifacts.dmg.path), join(root, distPaths[1]));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (sha256File(join(root, distPaths[1])) !== report.artifacts.dmg.sha256) {
    throw new Error("V1 handoff DMG identity changed during copy");
  }

  const checksumInventory = [...distPaths, ...evidencePaths]
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort((left, right) => left.localeCompare(right));
  mkdirSync(dirname(join(root, checksumsPath)), { recursive: true });
  writeFileSync(
    join(root, checksumsPath),
    `${checksumInventory.map((path) => `${sha256File(join(root, path))}  ${path}`).join("\n")}\n`,
    { mode: 0o644 },
  );
  return { sourceRevision: report.sourceRevision, paths: [...distPaths], checksumInventory };
}

export function assertHandoffMachineReport(report) {
  try {
    assertSafeMachineReport(report);
  } catch (error) {
    throw new Error(`V1 handoff M16 report contract is invalid: ${error.message}`);
  }
  if (JSON.stringify(report.product) !== JSON.stringify(product)) {
    throw new Error("V1 handoff M16 report product is invalid");
  }
}

export function assertHandoffReplay(replay, report, markdown = undefined) {
  try {
    validateM16Replay(replay, report);
    if (markdown !== undefined) validateM16ReplayMarkdown(markdown, replay);
  } catch (error) {
    throw new Error(`V1 handoff replay contract is invalid: ${error.message}`);
  }
}

function assertRequiredEvidence(root) {
  for (const path of evidencePaths) {
    if (!existsSync(join(root, path)) || !lstatSync(join(root, path)).isFile()) {
      throw new Error(`V1 handoff required evidence is absent: ${path}`);
    }
  }
}

function assertCandidateSource(root, sourceRevision, reportPath, checksumsPath) {
  command(root, "git", ["cat-file", "-e", `${sourceRevision}^{commit}`]);
  const postCandidate = command(root, "git", ["diff", "--name-only", `${sourceRevision}..HEAD`])
    .split("\n")
    .filter(Boolean);
  const allowedPostCandidatePaths = new Set(postCandidateEvidencePaths);
  allowedPostCandidatePaths.add(reportPath);
  if (postCandidate.some((path) => !allowedPostCandidatePaths.has(path))) {
    throw new Error("V1 handoff post-candidate source drift");
  }
  const allowedWorktreePaths = new Set([
    ...evidencePaths,
    reportPath,
    checksumsPath,
  ]);
  const worktreeStatus = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  ).trimEnd();
  const worktreePaths = worktreeStatus
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => line.slice(3).split(" -> "));
  const unexpectedWorktreePaths = worktreePaths.filter((path) => !allowedWorktreePaths.has(path));
  if (unexpectedWorktreePaths.length > 0) {
    throw new Error(`V1 handoff worktree source drift: ${unexpectedWorktreePaths.join(", ")}`);
  }
  const vendorAtRevision = command(root, "git", [
    "show", `${sourceRevision}:vendor/bitwarden-clients/UI_SOURCE_COMMIT`,
  ]);
  if (vendorAtRevision !== expectedVendorRevision) {
    throw new Error("V1 handoff vendor revision drift");
  }
  const packageAtRevision = execFileSync("git", ["show", `${sourceRevision}:package.json`], {
    cwd: root,
  });
  const report = readJson(join(root, reportPath), "M16 machine report");
  if (createHash("sha256").update(packageAtRevision).digest("hex") !== report.packageJsonSha256) {
    throw new Error("V1 handoff package identity drift");
  }
}

function assertCandidateArtifacts(root, report) {
  const artifacts = report.artifacts ?? {};
  for (const name of ["app", "executable", "infoPlist", "dmg"]) {
    const artifact = artifacts[name];
    if (!artifact || typeof artifact.path !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error(`V1 handoff ${name} artifact contract is invalid`);
    }
    const path = join(root, artifact.path);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new Error(`V1 handoff ${name} artifact is absent`);
    }
    if (stat.isSymbolicLink() || (name === "app" ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`V1 handoff ${name} artifact type is invalid`);
    }
    const actual = name === "app" ? sha256Tree(path) : sha256File(path);
    if (actual !== artifact.sha256) throw new Error(`V1 handoff ${name} identity changed`);
  }
  const executableDirectory = join(root, artifacts.app.path, "Contents/MacOS");
  let executableEntries;
  try {
    executableEntries = readdirSync(executableDirectory).sort();
  } catch {
    throw new Error("V1 handoff app contains unexpected executable payload");
  }
  if (
    executableEntries.length !== 1 ||
    executableEntries[0] !== BARWARDEN_RELEASE_BRAND.executableName
  ) {
    throw new Error("V1 handoff app contains unexpected executable payload");
  }
}

function writeSourceArchive(root, sourceRevision, destination, temporary) {
  const tarPath = join(temporary, "source.tar");
  execFileSync("git", [
    "archive", "--format=tar", `--prefix=${sourceArchivePrefix}`, "-o", tarPath,
    sourceRevision, "--", ".", ":(exclude)dist",
  ], { cwd: root, stdio: "ignore" });
  writeFileSync(destination, gzipSync(readFileSync(tarPath), { level: 9, mtime: 0 }));
  const inventory = execFileSync("tar", ["-tzf", destination], { encoding: "utf8" });
  for (const required of ["package.json", "LICENSE", "NOTICE.md", "vendor/bitwarden-clients/UI_SOURCE_COMMIT"]) {
    if (!inventory.includes(`${sourceArchivePrefix}${required}`)) {
      throw new Error(`V1 handoff source archive is missing ${required}`);
    }
  }
  if (/(?:^|\/)\.git(?:\/|$)|node_modules|\/target\/|\/dist\//m.test(inventory)) {
    throw new Error("V1 handoff source archive contains excluded paths");
  }
}

function writeAppArchive(root, report, destination, temporary) {
  const stagingRoot = join(temporary, "app");
  const stagedApp = join(stagingRoot, `${BARWARDEN_RELEASE_BRAND.productName}.app`);
  copyTree(join(root, report.artifacts.app.path), stagedApp);
  const timestamp = Number(command(root, "git", ["show", "-s", "--format=%ct", report.sourceRevision]));
  normalizeTimes(stagedApp, timestamp);
  const entries = [stagedApp, ...walkEntries(stagedApp)]
    .map((path) => relative(stagingRoot, path))
    .sort((left, right) => left.localeCompare(right));
  const listPath = join(temporary, "app-files.txt");
  const tarPath = join(temporary, "app.tar");
  writeFileSync(listPath, `${entries.join("\n")}\n`);
  execFileSync("tar", [
    "-cf", tarPath,
    "--format", "ustar",
    "--uid", "0",
    "--gid", "0",
    "--uname", "root",
    "--gname", "root",
    "--no-recursion",
    "-C", stagingRoot,
    "-T", listPath,
  ], { env: { ...process.env, COPYFILE_DISABLE: "1" }, stdio: "ignore" });
  writeFileSync(destination, gzipSync(readFileSync(tarPath), { level: 9, mtime: 0 }));
}

function copyTree(source, destination) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error("V1 handoff app contains a symbolic link");
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: stat.mode & 0o7777 });
    chmodSync(destination, stat.mode & 0o7777);
    for (const entry of readdirSync(source).sort()) copyTree(join(source, entry), join(destination, entry));
    return;
  }
  if (!stat.isFile()) throw new Error("V1 handoff app contains an unsupported file type");
  copyFileSync(source, destination);
  chmodSync(destination, stat.mode & 0o7777);
}

function normalizeTimes(root, timestamp) {
  const date = new Date(timestamp * 1000);
  for (const path of [...walkEntries(root)].reverse()) utimesSync(path, date, date);
  utimesSync(root, date, date);
}

function sha256Tree(root) {
  const hash = createHash("sha256");
  for (const path of walkEntries(root)) {
    const stat = lstatSync(path);
    hash.update(stat.isDirectory() ? "D\0" : "F\0");
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update((stat.mode & 0o7777).toString(8));
    hash.update("\0");
    if (stat.isFile()) hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function walkEntries(root) {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isSymbolicLink()) throw new Error("V1 handoff tree contains a symbolic link");
      return entry.isDirectory() ? [path, ...walkEntries(path)] : [path];
    });
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`V1 handoff ${label} is invalid`);
  }
}

function command(root, file, args) {
  try {
    return execFileSync(file, args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    throw new Error(`V1 handoff command failed: ${file}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateV1Handoff();
  process.stdout.write(`V1 handoff generated for ${result.sourceRevision}\n`);
}
