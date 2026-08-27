import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertReleaseVersionSync,
  readReleaseVersion,
  releaseDmgName,
} from "./release-version.mjs";

function fixture(versions) {
  const root = mkdtempSync(join(tmpdir(), "barwarden-release-version-"));
  mkdirSync(join(root, "apps/menubar-tauri/src-tauri"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: versions.package }));
  writeFileSync(
    join(root, "apps/menubar-tauri/src-tauri/tauri.conf.json"),
    JSON.stringify({ version: versions.tauri }),
  );
  writeFileSync(
    join(root, "apps/menubar-tauri/src-tauri/Cargo.toml"),
    `[package]\nname = "barwarden"\nversion = "${versions.cargo}"\n`,
  );
  writeFileSync(
    join(root, "apps/menubar-tauri/src-tauri/Cargo.lock"),
    `[[package]]\nname = "barwarden"\nversion = "${versions.lock}"\n`,
  );
  return root;
}

test("reads one validated release version and derives the DMG name", () => {
  const root = fixture({ package: "1.2.3", tauri: "1.2.3", cargo: "1.2.3", lock: "1.2.3" });
  assert.equal(readReleaseVersion(root), "1.2.3");
  assert.equal(releaseDmgName("1.2.3"), "Barwarden-1.2.3.dmg");
  assert.equal(assertReleaseVersionSync(root), "1.2.3");
});

test("rejects invalid or drifting release versions", () => {
  const root = fixture({ package: "1.2.3", tauri: "1.2.4", cargo: "1.2.3", lock: "1.2.3" });
  assert.throws(() => assertReleaseVersionSync(root), /release version mismatch/);
  assert.throws(() => releaseDmgName("latest"), /invalid release version/);
});
