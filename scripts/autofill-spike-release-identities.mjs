import assert from "node:assert/strict";

export const forbiddenChromiumExtensionIds = new Set([
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "nngceckbapebfimnlniiiahkandclblb",
  "jbkfoedolllekgbhcbcoahefnbanhhlh",
]);

export function hasNoReleaseIdentities({ teamId, chromeExtensionId, edgeExtensionId }) {
  return teamId === null && chromeExtensionId === null && edgeExtensionId === null;
}

export function assertBarwardenReleaseIdentities({ teamId, chromeExtensionId, edgeExtensionId }) {
  assert.ok(teamId && chromeExtensionId && edgeExtensionId, "release identities must be a complete non-empty triple");
  assert.match(teamId, /^[A-Z0-9]{10}$/);
  assert.match(chromeExtensionId, /^[a-p]{32}$/);
  assert.match(edgeExtensionId, /^[a-p]{32}$/);
  assert.ok(!forbiddenChromiumExtensionIds.has(chromeExtensionId), "forbidden browser store ID cannot be recorded");
  assert.ok(!forbiddenChromiumExtensionIds.has(edgeExtensionId), "forbidden browser store ID cannot be recorded");
  assert.notEqual(chromeExtensionId, edgeExtensionId);
}
