import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeBundleManifestHash } from "./native-autofill-bundle-manifest.mjs";

test("bundle manifest hash binds relative paths, types, modes, and file contents", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-manifest-"));
  try {
    chmodSync(root, 0o700);
    mkdirSync(join(root, "Contents"));
    const file = join(root, "Contents", "payload");
    writeFileSync(file, "one");
    chmodSync(file, 0o600);
    const initial = computeBundleManifestHash(root);

    chmodSync(root, 0o755);
    assert.notEqual(computeBundleManifestHash(root), initial);
    chmodSync(root, 0o700);

    writeFileSync(file, "two");
    const contentChanged = computeBundleManifestHash(root);
    assert.notEqual(contentChanged, initial);

    writeFileSync(file, "one");
    chmodSync(file, 0o700);
    const modeChanged = computeBundleManifestHash(root);
    assert.notEqual(modeChanged, initial);

    chmodSync(file, 0o600);
    renameSync(file, join(root, "Contents", "renamed"));
    assert.notEqual(computeBundleManifestHash(root), initial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundle manifest rejects every symlink instead of hashing its target", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-manifest-link-"));
  try {
    writeFileSync(join(root, "payload"), "safe");
    symlinkSync("payload", join(root, "alias"));
    assert.throws(() => computeBundleManifestHash(root), /NATIVE_AUTOFILL_SYMLINK_FORBIDDEN/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
