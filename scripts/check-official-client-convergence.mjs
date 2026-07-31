#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = "apps/menubar-tauri/official-client-convergence-manifest.json";
const vendorRoot = "vendor/bitwarden-clients";
const pinnedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const pinnedVendorTrackedIndexSha256 = "1c0512f8316d553f18374010b4cf206ff48a41bde06708ddce74d9c27c28bb84";
const expectedRows = new Map([
  ["environment", {
    localAuthorities: [
      "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.ts",
      "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/abstractions/api.service.ts", sha256: "21063366a56163ebadd1a57e8ab87b6646e04e1198cf51b2af33522fb973a6e8" },
    ],
    decision: "adapter",
    reasonCode: "tauri-environment-storage-boundary",
    proofTests: [
      "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.spec.ts",
      "apps/menubar-tauri/src/app/auth/official-environment.adapter.spec.ts",
    ],
  }],
  ["http-transport", {
    localAuthorities: [
      "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.ts",
      "apps/menubar-tauri/src/host/tauri-host.service.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/abstractions/api.service.ts", sha256: "21063366a56163ebadd1a57e8ab87b6646e04e1198cf51b2af33522fb973a6e8" },
      { path: "libs/common/src/services/api.service.ts", sha256: "6a9591ed637fc189537de5b53d368f5701b808e757d8f642f6138ae796e57c4a" },
    ],
    decision: "adapter",
    reasonCode: "tauri-http-transport-boundary",
    proofTests: [
      "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.spec.ts",
      "apps/menubar-tauri/src/host/tauri-host.service.spec.ts",
    ],
  }],
  ["password-login", {
    localAuthorities: [
      "apps/menubar-tauri/src/auth/password-login.service.ts",
      "apps/menubar-tauri/src/auth/master-password-crypto.ts",
    ],
    officialAuthorities: [
      { path: "libs/auth/src/common/login-strategies/password-login.strategy.ts", sha256: "f8f41a92ea8b55f52c242ea3c1c51956a64e754d9d74003c8ddf2cdb4773b2a0" },
    ],
    decision: "adapter",
    reasonCode: "retained-password-login-orchestration",
    proofTests: [
      "apps/menubar-tauri/src/auth/password-login.service.spec.ts",
      "apps/menubar-tauri/e2e/live/live-auth-contract.spec.ts",
    ],
  }],
  ["token-refresh", {
    localAuthorities: [
      "apps/menubar-tauri/src/auth/auth-token-refresh.service.ts",
      "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/services/api.service.ts", sha256: "6a9591ed637fc189537de5b53d368f5701b808e757d8f642f6138ae796e57c4a" },
    ],
    decision: "adapter",
    reasonCode: "retained-token-refresh-session-boundary",
    proofTests: [
      "apps/menubar-tauri/src/auth/auth-token-refresh.service.spec.ts",
      "apps/menubar-tauri/e2e/live/live-auth-contract.spec.ts",
    ],
  }],
  ["sync-projection", {
    localAuthorities: [
      "apps/menubar-tauri/src/vault/vault-sync.service.ts",
      "apps/menubar-tauri/src/app/vault/vault-session.service.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/platform/sync/sync.response.ts", sha256: "11852b14237bd1397ac85f754522fa700f0acf604022bcbd94ebb465d10491c0" },
      { path: "libs/common/src/platform/sync/default-sync.service.ts", sha256: "5bdb9a85550c9978acb876c11973246e77e93e327c45cbadc164498b67da86d1" },
    ],
    decision: "adapter",
    reasonCode: "retained-narrow-sync-projection",
    proofTests: [
      "apps/menubar-tauri/src/vault/vault-sync.service.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-session.service.spec.ts",
    ],
  }],
  ["folder-write", {
    localAuthorities: [
      "apps/menubar-tauri/src/app/vault/vault-folder.service.ts",
      "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/vault/services/folder/folder-api.service.ts", sha256: "a5cc4177b6b44794f5473fa774c743ce21bd78670fbef883e295941f471b5b54" },
      { path: "libs/common/src/vault/models/request/folder.request.ts", sha256: "c026c6ebd99ab7452eac513df9f86d163db5de4314bdb2e6451d1b0efb14784c" },
    ],
    decision: "adapter",
    reasonCode: "retained-folder-write-ownership",
    proofTests: [
      "apps/menubar-tauri/src/app/vault/vault-folder.service.spec.ts",
      "apps/menubar-tauri/e2e/live/live-vault-scenarios.spec.ts",
    ],
  }],
  ["cipher-write", {
    localAuthorities: [
      "apps/menubar-tauri/src/app/vault/vault-cipher-request.service.ts",
      "apps/menubar-tauri/src/app/vault/vault-cipher-write.service.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/vault/models/request/cipher.request.ts", sha256: "e252c1ca119e2194545b1670898f2f7a2725f5dfb23493849e83b29996269807" },
    ],
    decision: "adapter",
    reasonCode: "retained-lossless-cipher-write",
    proofTests: [
      "apps/menubar-tauri/src/app/vault/vault-cipher-request.service.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-cipher-write.service.spec.ts",
    ],
  }],
  ["cipher-recovery", {
    localAuthorities: [
      "apps/menubar-tauri/src/app/vault/vault-actions.service.ts",
      "apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/platform/sync/default-sync.service.ts", sha256: "5bdb9a85550c9978acb876c11973246e77e93e327c45cbadc164498b67da86d1" },
      { path: "libs/common/src/vault/models/request/cipher.request.ts", sha256: "e252c1ca119e2194545b1670898f2f7a2725f5dfb23493849e83b29996269807" },
    ],
    decision: "adapter",
    reasonCode: "retained-recovery-state-ownership",
    proofTests: [
      "apps/menubar-tauri/e2e/live/live-vault-scenarios.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-actions.service.spec.ts",
    ],
  }],
  ["text-send-request", {
    localAuthorities: [
      "apps/menubar-tauri/src/app/send/send-request.service.ts",
      "apps/menubar-tauri/src/app/send/send-actions.service.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/tools/send/models/request/send.request.ts", sha256: "65cb03bc2e057a8d6477b48c66aa26548f83f236634f8f82768da3cded988580" },
      { path: "libs/common/src/tools/send/services/send-api.service.ts", sha256: "7560565a632b91e7be17b920cc0ab639636620efdfc5d11f614caaa15bb04a7d" },
      { path: "libs/common/src/key-management/sends/services/default-send-password.service.ts", sha256: "badf16fd47efdcaa53d86db31be5a0aeee2df36f19688a129678cc9c996d9609" },
    ],
    decision: "adapter",
    reasonCode: "tauri-text-only-request-boundary",
    proofTests: [
      "apps/menubar-tauri/src/app/send/send-request.service.spec.ts",
      "apps/menubar-tauri/src/app/send/send-actions.service.spec.ts",
    ],
  }],
  ["text-send-password-kdf", {
    localAuthorities: ["apps/menubar-tauri/src/app/send/send-request.service.ts"],
    officialAuthorities: [
      { path: "libs/common/src/tools/send/send-kdf.ts", sha256: "eea1d151ba2ed2567625ad8b4f70d1b5cad9cfd8c3a8a752b9b8b42bb0011ff3" },
    ],
    decision: "replace",
    reasonCode: "official-send-kdf-constant",
    proofTests: [
      "apps/menubar-tauri/src/app/send/send-request.service.spec.ts",
      "scripts/check-official-client-convergence.spec.mjs",
    ],
  }],
  ["official-sdk-crypto", {
    localAuthorities: [
      "apps/menubar-tauri/src/sdk/bitwarden-sdk-core.service.ts",
      "apps/menubar-tauri/src/auth/master-password-crypto.ts",
    ],
    officialAuthorities: [
      { path: "libs/common/src/platform/services/sdk/default-sdk-load.service.ts", sha256: "e435afac70d7510ed1279cda9ad324517f94fdbe617b11c265fde5caf77d5a2b" },
    ],
    decision: "direct",
    reasonCode: "official-sdk-kdf-encryption-path",
    proofTests: [
      "apps/menubar-tauri/src/sdk/bitwarden-sdk-core.service.spec.ts",
      "apps/menubar-tauri/src/auth/master-password-crypto.spec.ts",
      "apps/menubar-tauri/src/app/upstream-import-guard.spec.ts",
    ],
  }],
]);

export function checkOfficialClientConvergence(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const vendorTrackedIndexSha256 = assertPinnedVendor(
    root,
    options.expectedVendorTrackedIndexSha256 ?? pinnedVendorTrackedIndexSha256,
  );
  const manifest = parseJson(readRequiredFile(root, manifestPath), "convergence manifest");
  if (manifest.schema !== "m14-official-client-convergence-v1") {
    throw new Error("Official-client convergence manifest schema drift");
  }
  if (manifest.vendorRevision !== pinnedVendorRevision) {
    throw new Error("Official-client convergence vendor revision drift");
  }
  if (!Array.isArray(manifest.rows)) {
    throw new Error("Official-client convergence row inventory is missing");
  }
  const rowIds = manifest.rows.map(({ id }) => id);
  if (
    rowIds.length !== expectedRows.size ||
    new Set(rowIds).size !== rowIds.length ||
    [...expectedRows.keys()].some((id) => !rowIds.includes(id))
  ) {
    throw new Error("Official-client convergence row inventory drift");
  }

  for (const row of manifest.rows) validateRow(root, row);
  assertProductionExclusions(root);
  assertSendKdfReplacement(root);
  assertDirectSdkBoundary(root);
  return { rows: manifest.rows.length, vendorRevision: pinnedVendorRevision, vendorTrackedIndexSha256 };
}

function validateRow(root, row) {
  const expected = expectedRows.get(row.id);
  if (!expected) throw new Error("Official-client convergence row inventory drift");
  if (
    JSON.stringify(Object.keys(row).sort()) !==
    JSON.stringify(["decision", "id", "localAuthorities", "officialAuthorities", "proofTests", "reasonCode"])
  ) {
    throw new Error(`Official-client convergence exact row field drift: ${row.id}`);
  }
  if (row.decision !== expected.decision) {
    throw new Error(`Official-client convergence decision drift: ${row.id}`);
  }
  if (row.reasonCode !== expected.reasonCode) {
    throw new Error(`Official-client convergence reason code drift: ${row.id}`);
  }
  if (JSON.stringify(row.localAuthorities) !== JSON.stringify(expected.localAuthorities)) {
    throw new Error(`Official-client convergence local authority row drift: ${row.id}`);
  }
  if (!Array.isArray(row.localAuthorities) || row.localAuthorities.length === 0) {
    throw new Error(`Official-client convergence local authority missing: ${row.id}`);
  }
  for (const path of row.localAuthorities) readRequiredFile(root, path);
  if (JSON.stringify(row.proofTests) !== JSON.stringify(expected.proofTests)) {
    throw new Error(`Official-client convergence proof row drift: ${row.id}`);
  }
  if (!Array.isArray(row.proofTests) || row.proofTests.length === 0) {
    throw new Error(`Official-client convergence proof missing: ${row.id}`);
  }
  for (const path of row.proofTests) {
    if (!/\.spec\.(?:ts|mjs)$/.test(path)) {
      throw new Error(`Official-client convergence proof is not a test: ${row.id}`);
    }
    readRequiredFile(root, path);
  }
  if (!Array.isArray(row.officialAuthorities) || row.officialAuthorities.length === 0) {
    throw new Error(`Official-client convergence official authority missing: ${row.id}`);
  }
  for (const authority of row.officialAuthorities) {
    if (authority.path.includes("apps/browser/") || authority.path.includes("browser-state")) {
      throw new Error(`Excluded browser source in convergence authority: ${row.id}`);
    }
    if (!authority.path.startsWith("libs/common/") && !authority.path.startsWith("libs/auth/")) {
      throw new Error(`Official-client convergence authority is outside libs/common or libs/auth: ${row.id}`);
    }
  }
  if (JSON.stringify(row.officialAuthorities) !== JSON.stringify(expected.officialAuthorities)) {
    const expectedByPath = new Map(expected.officialAuthorities.map((authority) => [authority.path, authority.sha256]));
    const hashOnlyDrift = row.officialAuthorities.every(
      (authority) => expectedByPath.has(authority.path) && expectedByPath.get(authority.path) !== authority.sha256,
    );
    throw new Error(
      `Official-client convergence ${hashOnlyDrift ? "authority hash" : "official authority row"} drift: ${row.id}`,
    );
  }
  for (const authority of row.officialAuthorities) {
    const expectedHash = authority.sha256;
    const actualHash = sha256(readRequiredFile(root, join(vendorRoot, authority.path), null));
    if (actualHash !== expectedHash) {
      throw new Error(`Pinned vendor authority hash drift: ${authority.path}`);
    }
  }
}

function assertPinnedVendor(root, expectedTrackedIndexSha256) {
  const revision = readRequiredFile(root, `${vendorRoot}/UI_SOURCE_COMMIT`).trim();
  if (revision !== pinnedVendorRevision) throw new Error("Pinned vendor revision drift");
  let status;
  try {
    status = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "--", vendorRoot],
      { cwd: root, encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error("Pinned vendor Git integrity check failed");
  }
  if (status) throw new Error("Pinned vendor tree drift");
  let trackedIndex;
  let objectFormat;
  try {
    trackedIndex = execFileSync(
      "git",
      ["ls-files", "-s", "-z", "--", vendorRoot],
      { cwd: root },
    );
    objectFormat = execFileSync(
      "git",
      ["rev-parse", "--show-object-format"],
      { cwd: root, encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error("Pinned vendor tracked-index integrity check failed");
  }
  const actualTrackedIndexSha256 = canonicalTrackedIndexSha256(
    trackedIndex,
    objectFormat,
  );
  if (actualTrackedIndexSha256 !== expectedTrackedIndexSha256) {
    throw new Error("Pinned vendor tracked-index integrity drift");
  }
  return actualTrackedIndexSha256;
}

function canonicalTrackedIndexSha256(trackedIndex, objectFormat) {
  const digest = createHash("sha256");
  digest.update("barwarden-vendor-index-v1\0");
  digest.update(objectFormat);
  digest.update("\0");
  for (const record of nullDelimitedRecords(trackedIndex)) {
    const separator = record.indexOf(0x09);
    if (separator < 0) {
      throw new Error("Pinned vendor tracked-index record is malformed");
    }
    const [mode, objectId, stage] = record
      .subarray(0, separator)
      .toString("ascii")
      .split(" ");
    if (!mode || !objectId || stage !== "0") {
      throw new Error("Pinned vendor tracked-index stage drift");
    }
    digest.update(mode);
    digest.update("\0");
    digest.update(record.subarray(separator + 1));
    digest.update("\0");
    digest.update(objectId);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function nullDelimitedRecords(value) {
  const records = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) {
      continue;
    }
    if (index > start) {
      records.push(value.subarray(start, index));
    }
    start = index + 1;
  }
  if (start !== value.length) {
    throw new Error("Pinned vendor tracked-index terminator is missing");
  }
  return records;
}

function assertProductionExclusions(root) {
  const productionFiles = filesBelow(join(root, "apps/menubar-tauri/src")).filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".spec.ts"),
  );
  const forbiddenImport = /(?:from\s+|import\s*\()["'][^"']*(?:common\/(?:abstractions|services)\/api\.service|tools\/send\/services\/send-api\.service|file-upload\.service|send-file|browser-state)[^"']*["']/i;
  for (const path of productionFiles) {
    if (forbiddenImport.test(readFileSync(path, "utf8"))) {
      throw new Error(`Forbidden official client production import: ${relative(root, path)}`);
    }
  }
}

function assertSendKdfReplacement(root) {
  const source = readRequiredFile(root, "apps/menubar-tauri/src/app/send/send-request.service.ts");
  if (
    !/import\s*\{\s*SEND_KDF_ITERATIONS\s*\}\s*from\s*["']@bitwarden\/common\/tools\/send\/send-kdf["']/.test(source) ||
    !/iterations:\s*SEND_KDF_ITERATIONS/.test(source)
  ) {
    throw new Error("Official Send KDF replace import is missing");
  }
  if (
    /iterations:\s*100_?000\b/.test(source) ||
    /(?:const|let|var)\s+(?:LOCAL_)?SEND_KDF_ITERATIONS\s*=/.test(source)
  ) {
    throw new Error("Local numeric Send KDF duplicate remains in production");
  }
}

function assertDirectSdkBoundary(root) {
  const source = readRequiredFile(root, "apps/menubar-tauri/src/sdk/bitwarden-sdk-core.service.ts");
  if (!source.includes("@bitwarden/sdk-internal")) {
    throw new Error("Official SDK direct crypto boundary is missing");
  }
}

function readRequiredFile(root, path, encoding = "utf8") {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${root}/`) || !existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`Missing official-client convergence file: ${path}`);
  }
  return readFileSync(absolute, encoding ?? undefined);
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkOfficialClientConvergence();
  process.stdout.write(`Official-client convergence passed: ${result.rows} rows\n`);
}
