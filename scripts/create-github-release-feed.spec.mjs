import assert from "node:assert/strict";
import test from "node:test";

import { createReleaseFeed } from "./create-github-release-feed.mjs";

test("creates a feed tied to the tagged updater artifact", () => {
  assert.deepEqual(createReleaseFeed({ version: "0.2.0", repository: "acme/barwarden", artifactName: "Barwarden.app.tar.gz", signature: "signed", notes: "Fixes", publishedAt: "2026-07-28T00:00:00.000Z" }), {
    version: "0.2.0",
    notes: "Fixes",
    pub_date: "2026-07-28T00:00:00.000Z",
    platforms: { "darwin-aarch64": { url: "https://github.com/acme/barwarden/releases/download/v0.2.0/Barwarden.app.tar.gz", signature: "signed" } },
  });
});

test("rejects unsigned or mismatched release inputs", () => {
  assert.throws(() => createReleaseFeed({ version: "0.2.0", tag: "v0.1.0", repository: "acme/barwarden", artifactName: "bad.zip", signature: "" }));
});
