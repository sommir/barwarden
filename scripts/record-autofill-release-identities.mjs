import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadAutoFillSpikeContract } from "./autofill-spike-contract.mjs";
import { assertBrowserReleaseIdentities } from "./autofill-spike-release-identities.mjs";
import { writeJsonAtomically } from "./autofill-spike-atomic-write.mjs";

function runSecurity(command, arguments_) {
  return execFileSync(command, arguments_, { encoding: "utf8" });
}

const defaultFileSystem = { renameSync, rmSync, writeFileSync };

export function recordAutoFillBrowserIdentities(
  root,
  extensionIds,
  runner = runSecurity,
  fileSystem = defaultFileSystem,
) {
  assert.equal(extensionIds.length, 2, "exactly two browser extension IDs are required");
  const [chromeExtensionId, edgeExtensionId] = extensionIds;
  const chromium = { chromeExtensionId, edgeExtensionId };
  assertBrowserReleaseIdentities(chromium);

  const contract = loadAutoFillSpikeContract(root, { requireTeamIdentity: true });
  const signingIdentities = runner("security", ["find-identity", "-v", "-p", "codesigning"]);
  assert.match(signingIdentities, new RegExp(`Developer ID Application:.*\\(${contract.teamId}\\)`));

  const next = { ...contract, chromium };
  writeJsonAtomically(resolve(root, "config/autofill-spike-contract.json"), next, fileSystem);
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recordAutoFillBrowserIdentities(process.cwd(), process.argv.slice(2));
}
