import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { barwardenTeamId } from "./autofill-spike-release-identities.mjs";
import { writeJsonAtomically } from "./autofill-spike-atomic-write.mjs";

export { barwardenTeamId };

function runOpenSsl(command, arguments_) {
  return execFileSync(command, arguments_, { encoding: "utf8" });
}

export function inspectDeveloperIdCertificate(certificatePath, runner = runOpenSsl) {
  const output = runner("openssl", [
    "x509",
    "-inform",
    "DER",
    "-in",
    certificatePath,
    "-noout",
    "-subject",
    "-dates",
  ]);
  const subject = output.match(/^subject=(.+)$/m)?.[1];
  assert.ok(subject, "certificate must include a subject");
  const commonName = subject.match(/(?:^|,\s*)CN\s*=\s*([^,]+)/)?.[1]?.trim();
  assert.ok(commonName, "certificate must include a common name");
  const commonNameTeamId = commonName.match(/\(([A-Z0-9]{10})\)$/)?.[1];
  assert.match(
    commonName,
    /^Developer ID Application: .+ \([A-Z0-9]{10}\)$/,
    "certificate must be the Barwarden Developer ID Application certificate",
  );
  assert.ok(commonNameTeamId, "certificate common name must include a Team ID");
  const subjectTeamId = subject.match(/(?:^|,\s*)UID\s*=\s*([^,]+)/)?.[1]?.trim();
  assert.ok(subjectTeamId, "certificate subject must include a Team ID");
  assert.equal(subjectTeamId, commonNameTeamId, "certificate Team ID must match its common name");
  assert.equal(commonNameTeamId, barwardenTeamId, `certificate Team ID must be ${barwardenTeamId}`);

  return { teamId: commonNameTeamId, commonName };
}

const defaultFileSystem = { readFileSync, renameSync, rmSync, writeFileSync };

export function recordAutoFillTeamIdentity(
  root,
  certificatePath,
  runner = runOpenSsl,
  fileSystem = defaultFileSystem,
) {
  const identity = inspectDeveloperIdCertificate(certificatePath, runner);
  const contractPath = resolve(root, "config/autofill-spike-contract.json");
  const contract = JSON.parse(fileSystem.readFileSync(contractPath, "utf8"));
  const next = { ...contract, teamId: identity.teamId };
  writeJsonAtomically(contractPath, next, fileSystem);
  return identity;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 3, "exactly one DER certificate path is required");
  const identity = recordAutoFillTeamIdentity(process.cwd(), process.argv[2]);
  process.stdout.write(`Recorded Barwarden Team ID ${identity.teamId}.\n`);
}
