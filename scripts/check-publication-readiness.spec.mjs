import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { checkPublicationReadiness } from "./check-publication-readiness.mjs";

const fixtureRoots = [];

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function createValidFixture() {
  const root = mkdtempSync(join(tmpdir(), "barwarden-publication-"));
  fixtureRoots.push(root);
  write(root, ".gitignore", "node_modules/\ndocs/superpowers/\n");
  write(root, "LICENSE", "GPL-3.0-only test fixture\n");
  write(root, "NOTICE.md", "# Notices\n");
  write(root, "PRIVACY.md", "# Privacy\n");
  write(root, "THIRD_PARTY_LICENSES.txt", "Complete third-party legal text\n");
  write(root, "THIRD_PARTY_NOTICES.md", "# Third-Party Notices\n");
  write(root, "src/app.ts", "export const safe = true;\n");
  return root;
}

test.after(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts a complete public-source fixture", () => {
  const result = checkPublicationReadiness(createValidFixture());

  assert.deepEqual(result.errors, []);
  assert.ok(result.scannedFiles >= 6);
});

test("reports a macOS user-home path without echoing its content", () => {
  const root = createValidFixture();
  const privatePath = "/" + "Users/alice/private/vault.json";
  write(root, "src/private.ts", `export const path = ${JSON.stringify(privatePath)};\n`);

  const result = checkPublicationReadiness(root);

  assert.deepEqual(result.errors, [
    "src/private.ts: contains a macOS home-directory path",
  ]);
  assert.doesNotMatch(result.errors.join("\n"), /alice|vault\.json/);
});

test("reports a private-key header assembled in a source file", () => {
  const root = createValidFixture();
  const privateKeyHeader = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
  write(root, "src/demo.ts", `export const value = ${JSON.stringify(privateKeyHeader)};\n`);

  const result = checkPublicationReadiness(root);

  assert.deepEqual(result.errors, [
    "src/demo.ts: contains a private-key header",
  ]);
});

test("reports a prohibited legacy keyword assembled in source content", () => {
  const root = createValidFixture();
  const prohibited = ["wha", "le"].join("");
  write(root, "src/demo.ts", `export const value = ${JSON.stringify(prohibited)};\n`);

  const result = checkPublicationReadiness(root);

  assert.deepEqual(result.errors, [
    "src/demo.ts: contains a prohibited legacy keyword",
  ]);
});

test("does not reject longer words that merely contain the legacy token", () => {
  const root = createValidFixture();
  write(root, "src/domain-rules.json", JSON.stringify(["saves-the-whales.com"]));

  assert.deepEqual(checkPublicationReadiness(root).errors, []);
});

test("reports credential file extensions even when their contents are empty", () => {
  const root = createValidFixture();
  write(root, "certificates/release.p8", "");

  const result = checkPublicationReadiness(root);

  assert.deepEqual(result.errors, [
    "certificates/release.p8: credential files must not be published",
  ]);
});

test("requires public disclosure files and the local-evidence ignore rule", () => {
  const root = createValidFixture();
  rmSync(join(root, "PRIVACY.md"));
  write(root, ".gitignore", "node_modules/\n");

  const result = checkPublicationReadiness(root);

  assert.deepEqual(result.errors, [
    ".gitignore: must ignore docs/superpowers/",
    "PRIVACY.md: required public disclosure is missing",
  ]);
});

test("requires complete third-party legal text", () => {
  const root = createValidFixture();
  rmSync(join(root, "THIRD_PARTY_LICENSES.txt"));

  const result = checkPublicationReadiness(root);

  assert.deepEqual(result.errors, [
    "THIRD_PARTY_LICENSES.txt: required public disclosure is missing",
  ]);
});

test("does not scan ignored local evidence but does scan vendored upstream source", () => {
  const root = createValidFixture();
  const privateKeyHeader = "-----BEGIN " + "PRIVATE KEY-----";
  write(root, "docs/superpowers/local.md", "/" + "Users/alice/private\n");
  write(root, ".playwright-cli/console.log", "/" + "Users/alice/private\n");
  write(root, "vendor/bitwarden-clients/example.ts", privateKeyHeader);
  write(root, "output/playwright/console.log", "/" + "Users/alice/private\n");
  write(root, "test-results/trace.log", privateKeyHeader);

  assert.deepEqual(checkPublicationReadiness(root).errors, [
    "vendor/bitwarden-clients/example.ts: contains a private-key header",
  ]);
});
