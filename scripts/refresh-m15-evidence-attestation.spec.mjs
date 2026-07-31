import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRefreshedM15Attestation } from "./refresh-m15-evidence-attestation.mjs";

const authorities = [
  ["M11", "docs/superpowers/screenshots/m11-generator-2026-07-19/PROVENANCE.md", "generator"],
  ["M12", "docs/superpowers/screenshots/m12-text-send-2026-07-19/PROVENANCE.md", "send"],
  ["M13", "docs/superpowers/screenshots/m13-settings-2026-07-20/provenance.json", "settings"],
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "m15-attestation-"));
  for (const [, path, contents] of authorities) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  const attestation = {
    schema: "m15-cross-milestone-evidence-attestation-v1",
    attestationSourceRevision: "0".repeat(40),
    evidence: authorities.map(([milestone, provenancePath]) => ({
      milestone,
      provenancePath,
      provenanceSha256: "0".repeat(64),
    })),
  };
  return { root, attestation };
}

test("derives every M11-M13 provenance hash from fixed authority files", () => {
  const { root, attestation } = fixture();

  const refreshed = buildRefreshedM15Attestation(root, attestation, "a".repeat(40));

  assert.equal(refreshed.attestationSourceRevision, "a".repeat(40));
  for (const [milestone, , contents] of authorities) {
    const expected = createHash("sha256").update(contents).digest("hex");
    assert.equal(
      refreshed.evidence.find((entry) => entry.milestone === milestone)?.provenanceSha256,
      expected,
    );
  }
});

test("rejects substituted, escaping, duplicate, missing, and unknown M15 provenance mappings", () => {
  const cases = [
    ["mismatched", (attestation) => { attestation.evidence[0].provenancePath = authorities[1][1]; }],
    ["absolute", (attestation) => { attestation.evidence[0].provenancePath = "/tmp/attestation"; }],
    ["traversal", (attestation) => { attestation.evidence[0].provenancePath = "../attestation"; }],
    ["duplicate", (attestation) => { attestation.evidence[1].milestone = "M11"; }],
    ["missing", (attestation) => { attestation.evidence.pop(); }],
    ["unknown", (attestation) => { attestation.evidence[2].milestone = "M14"; }],
  ];
  for (const [label, mutate] of cases) {
    const { root, attestation } = fixture();
    mutate(attestation);
    assert.throws(
      () => buildRefreshedM15Attestation(root, attestation, "a".repeat(40)),
      /M15 (?:evidence|attestation)/i,
      label,
    );
  }
});

test("rejects a canonical provenance path redirected through a symlink outside the repository", () => {
  const { root, attestation } = fixture();
  const target = join(root, "docs/superpowers/screenshots/m12-text-send-2026-07-19");
  const outside = mkdtempSync(join(tmpdir(), "m15-attestation-outside-"));
  writeFileSync(join(outside, "PROVENANCE.md"), "outside");
  rmSync(target, { recursive: true });
  symlinkSync(outside, target, "dir");

  assert.throws(
    () => buildRefreshedM15Attestation(root, attestation, "a".repeat(40)),
    /outside the repository/i,
  );
});
