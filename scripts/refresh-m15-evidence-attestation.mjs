import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const attestationPath = "docs/superpowers/specs/2026-07-22-m15-evidence-attestation.json";
export const canonicalM15Evidence = Object.freeze([
  Object.freeze({ milestone: "M11", provenancePath: "docs/superpowers/screenshots/m11-generator-2026-07-19/PROVENANCE.md" }),
  Object.freeze({ milestone: "M12", provenancePath: "docs/superpowers/screenshots/m12-text-send-2026-07-19/PROVENANCE.md" }),
  Object.freeze({ milestone: "M13", provenancePath: "docs/superpowers/screenshots/m13-settings-2026-07-20/provenance.json" }),
]);

export function buildRefreshedM15Attestation(root, attestation, sourceRevision) {
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) {
    throw new Error("M15 attestation source revision must be a full Git commit");
  }
  if (attestation.schema !== "m15-cross-milestone-evidence-attestation-v1") {
    throw new Error("M15 attestation schema is invalid");
  }
  if (!Array.isArray(attestation.evidence) || attestation.evidence.length !== canonicalM15Evidence.length) {
    throw new Error("M15 attestation must contain exactly M11-M13 evidence rows");
  }
  const canonicalRoot = realpathSync(resolve(root));
  const evidence = attestation.evidence.map((entry, index) => {
    const expected = canonicalM15Evidence[index];
    if (!expected
      || entry?.milestone !== expected.milestone
      || entry?.provenancePath !== expected.provenancePath
      || isAbsolute(entry?.provenancePath ?? "")) {
      throw new Error("M15 evidence mapping must use the fixed M11-M13 provenance paths");
    }
    const provenancePath = resolve(canonicalRoot, expected.provenancePath);
    const resolvedProvenancePath = realpathSync(provenancePath);
    const rootRelativePath = relative(canonicalRoot, resolvedProvenancePath);
    if (rootRelativePath === "" || rootRelativePath === ".." || rootRelativePath.startsWith(`..${sep}`) || isAbsolute(rootRelativePath)) {
      throw new Error("M15 evidence provenance resolves outside the repository");
    }
    const provenance = readFileSync(resolvedProvenancePath);
    return {
      ...entry,
      provenanceSha256: createHash("sha256").update(provenance).digest("hex"),
    };
  });
  return { ...attestation, attestationSourceRevision: sourceRevision, evidence };
}

export function refreshM15EvidenceAttestation(root) {
  const absoluteRoot = resolve(root);
  const target = join(absoluteRoot, attestationPath);
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: absoluteRoot,
    encoding: "utf8",
  }).trim();
  const attestation = JSON.parse(readFileSync(target, "utf8"));
  const refreshed = buildRefreshedM15Attestation(absoluteRoot, attestation, sourceRevision);
  const staging = join(dirname(target), ".m15-evidence-attestation.staging.json");
  writeFileSync(staging, `${JSON.stringify(refreshed, null, 2)}\n`);
  renameSync(staging, target);
  return refreshed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const refreshed = refreshM15EvidenceAttestation(process.cwd());
  process.stdout.write(`Refreshed M15 evidence attestation for ${refreshed.attestationSourceRevision}\n`);
}
