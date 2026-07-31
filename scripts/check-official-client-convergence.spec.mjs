import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { checkOfficialClientConvergence } from "./check-official-client-convergence.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestRelativePath = "apps/menubar-tauri/official-client-convergence-manifest.json";
const fixtureVendorHashes = new Map();

test("accepts the pinned official-client convergence inventory", (t) => {
  const fixture = createFixture(t);

  const result = checkFixture(fixture);

  assert.equal(result.rows, 11);
  assert.equal(result.vendorRevision, "f47b6946e01aed474875789081966d311d5b8289");
});

for (const mutant of [
  {
    name: "stale official hash",
    mutate(manifest) {
      manifest.rows[0].officialAuthorities[0].sha256 = "0".repeat(64);
    },
    expected: /hash/i,
  },
  {
    name: "missing required row",
    mutate(manifest) {
      manifest.rows = manifest.rows.filter(({ id }) => id !== "cipher-recovery");
    },
    expected: /inventory/i,
  },
  {
    name: "unknown decision",
    mutate(manifest) {
      manifest.rows[0].decision = "retain";
    },
    expected: /decision/i,
  },
  {
    name: "absent proof",
    mutate(manifest) {
      manifest.rows[0].proofTests = [];
    },
    expected: /proof/i,
  },
  {
    name: "excluded browser authority",
    mutate(manifest) {
      manifest.rows[0].officialAuthorities[0].path =
        "apps/browser/src/platform/services/browser-state.service.ts";
    },
    expected: /browser/i,
  },
]) {
  test(`rejects ${mutant.name}`, (t) => {
    const fixture = createFixture(t);
    mutateManifest(fixture, mutant.mutate);

    assert.throws(() => checkFixture(fixture), mutant.expected);
  });
}

test("rejects authorities and proof tests swapped between otherwise valid rows", (t) => {
  const fixture = createFixture(t);
  mutateManifest(fixture, (manifest) => {
    const first = manifest.rows[0];
    const second = manifest.rows[1];
    for (const field of ["localAuthorities", "officialAuthorities", "proofTests"]) {
      [first[field], second[field]] = [second[field], first[field]];
    }
  });

  assert.throws(() => checkFixture(fixture), /row|authorit|proof/i);
});

test("rejects byte drift anywhere in the pinned vendor tree", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const authority = manifest.rows[0].officialAuthorities[0].path;
  writeFileSync(join(fixture, "vendor/bitwarden-clients", authority), "vendor drift\n", {
    flag: "a",
  });

  assert.throws(() => checkFixture(fixture), /vendor|hash/i);
});

test("rejects committed drift in a non-authority vendor file", (t) => {
  const fixture = createFixture(t);
  const driftPath = join(fixture, "vendor/bitwarden-clients/non-authority.txt");
  writeFileSync(driftPath, "committed vendor drift\n");
  execFileSync("git", ["add", "."], { cwd: fixture });
  execFileSync("git", ["commit", "-qm", "vendor drift"], { cwd: fixture });

  assert.throws(() => checkFixture(fixture), /tracked.index|vendor.*integrity/i);
});

test("vendor tracked-set verification is invariant to Git path quoting", (t) => {
  const fixture = createFixture(t);
  const unicodePath = join(fixture, "vendor/bitwarden-clients/可移植证明.txt");
  writeFileSync(unicodePath, "portable vendor proof\n");
  execFileSync("git", ["add", "."], { cwd: fixture });
  execFileSync("git", ["commit", "-qm", "unicode vendor path"], { cwd: fixture });
  fixtureVendorHashes.set(fixture, trackedIndexSha256(fixture));

  execFileSync("git", ["config", "core.quotePath", "true"], { cwd: fixture });
  assert.doesNotThrow(() => checkFixture(fixture));
  execFileSync("git", ["config", "core.quotePath", "false"], { cwd: fixture });
  assert.doesNotThrow(() => checkFixture(fixture));
});

test("rejects a replace row while the local Send KDF duplicate remains in production", (t) => {
  const fixture = createFixture(t);
  const sourcePath = join(
    fixture,
    "apps/menubar-tauri/src/app/send/send-request.service.ts",
  );
  const source = readFileSync(sourcePath, "utf8")
    .replace(
      'import { SEND_KDF_ITERATIONS } from "@bitwarden/common/tools/send/send-kdf";\n',
      "const LOCAL_SEND_KDF_ITERATIONS = 100000;\n",
    )
    .replace("iterations: SEND_KDF_ITERATIONS", "iterations: LOCAL_SEND_KDF_ITERATIONS");
  writeFileSync(sourcePath, source);

  assert.throws(() => checkFixture(fixture), /Send KDF|replace/i);
});

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "m14-convergence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, manifestRelativePath), "utf8"));
  const paths = new Set([
    manifestRelativePath,
    "vendor/bitwarden-clients/UI_SOURCE_COMMIT",
    ...manifest.rows.flatMap(({ localAuthorities, officialAuthorities, proofTests }) => [
      ...localAuthorities,
      ...officialAuthorities.map(({ path }) => `vendor/bitwarden-clients/${path}`),
      ...proofTests,
    ]),
  ]);
  for (const path of paths) {
    mkdirSync(resolve(root, path, ".."), { recursive: true });
    cpSync(join(repositoryRoot, path), join(root, path), { recursive: true });
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  fixtureVendorHashes.set(root, trackedIndexSha256(root));
  return root;
}

function checkFixture(fixture) {
  return checkOfficialClientConvergence({
    root: fixture,
    expectedVendorTrackedIndexSha256: fixtureVendorHashes.get(fixture),
  });
}

function trackedIndexSha256(root) {
  const records = execFileSync(
    "git",
    ["ls-files", "-s", "-z", "--", "vendor/bitwarden-clients"],
    { cwd: root },
  ).toString("utf8").split("\0").filter(Boolean);
  const digest = createHash("sha256");
  digest.update("barwarden-vendor-index-v1\0");
  digest.update(execFileSync("git", ["rev-parse", "--show-object-format"], {
    cwd: root,
    encoding: "utf8",
  }).trim());
  digest.update("\0");
  for (const record of records) {
    const separator = record.indexOf("\t");
    const [mode, objectId, stage] = record.slice(0, separator).split(" ");
    const path = record.slice(separator + 1);
    assert.equal(stage, "0");
    digest.update(mode);
    digest.update("\0");
    digest.update(path);
    digest.update("\0");
    digest.update(objectId);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function readManifest(fixture) {
  return JSON.parse(readFileSync(join(fixture, manifestRelativePath), "utf8"));
}

function mutateManifest(fixture, mutate) {
  const manifest = readManifest(fixture);
  mutate(manifest);
  writeFileSync(join(fixture, manifestRelativePath), `${JSON.stringify(manifest, null, 2)}\n`);
}
