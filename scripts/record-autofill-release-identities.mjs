import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadAutoFillSpikeContract } from "./autofill-spike-contract.mjs";
import { assertBrowserReleaseIdentities } from "./autofill-spike-release-identities.mjs";

const extensionIds = process.argv.slice(2);
assert.equal(extensionIds.length, 2, "exactly two browser extension IDs are required");
const [chromeExtensionId, edgeExtensionId] = extensionIds;

assertBrowserReleaseIdentities({ chromeExtensionId, edgeExtensionId });

const contract = loadAutoFillSpikeContract(process.cwd(), { requireTeamIdentity: true });

const signingIdentities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
  encoding: "utf8",
});
assert.match(signingIdentities, new RegExp(`Developer ID Application:.*\\(${contract.teamId}\\)`));

const next = {
  ...contract,
  chromium: { chromeExtensionId, edgeExtensionId },
};
const contractPath = resolve(process.cwd(), "config/autofill-spike-contract.json");
const temporaryPath = `${contractPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
renameSync(temporaryPath, contractPath);
