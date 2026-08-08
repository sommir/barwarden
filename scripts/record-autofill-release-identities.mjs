import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadAutoFillSpikeContract } from "./autofill-spike-contract.mjs";

const fixtureExtensionIds = new Set([
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
]);

const identities = process.argv.slice(2);
assert.equal(identities.length, 3, "exactly three release identities are required");
const [teamId, chromeExtensionId, edgeExtensionId] = identities;

assert.match(teamId, /^[A-Z0-9]{10}$/);
assert.match(chromeExtensionId, /^[a-p]{32}$/);
assert.match(edgeExtensionId, /^[a-p]{32}$/);
assert.ok(!fixtureExtensionIds.has(chromeExtensionId), "fixture Chrome extension IDs cannot be recorded");
assert.ok(!fixtureExtensionIds.has(edgeExtensionId), "fixture Edge extension IDs cannot be recorded");
assert.notEqual(chromeExtensionId, edgeExtensionId);

const signingIdentities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
  encoding: "utf8",
});
assert.match(signingIdentities, new RegExp(`Developer ID Application:.*\\(${teamId}\\)`));

const next = {
  ...loadAutoFillSpikeContract(process.cwd()),
  teamId,
  chromium: { chromeExtensionId, edgeExtensionId },
};
const contractPath = resolve(process.cwd(), "config/autofill-spike-contract.json");
const temporaryPath = `${contractPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
renameSync(temporaryPath, contractPath);
