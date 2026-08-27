import assert from "node:assert/strict";

export const barwardenTeamId = "K7LY92JY96";

export const forbiddenChromiumExtensionIds = new Set([
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "nngceckbapebfimnlniiiahkandclblb",
  "jbkfoedolllekgbhcbcoahefnbanhhlh",
]);

export function assertTeamIdentity(teamId) {
  assert.equal(typeof teamId, "string", "team identity must be a non-empty Team ID");
  assert.match(teamId, /^[A-Z0-9]{10}$/, "team identity must be a ten-character Team ID");
  assert.equal(teamId, barwardenTeamId, `team identity must be ${barwardenTeamId}`);
}

export function hasDeferredBrowserReleaseIdentities({ chromeExtensionId, edgeExtensionId }) {
  return chromeExtensionId === null && edgeExtensionId === null;
}

export function assertBrowserReleaseIdentities({ chromeExtensionId, edgeExtensionId }) {
  assert.ok(
    typeof chromeExtensionId === "string" && typeof edgeExtensionId === "string",
    "browser release identities must be a complete non-empty pair",
  );
  assert.match(chromeExtensionId, /^[a-p]{32}$/);
  assert.match(edgeExtensionId, /^[a-p]{32}$/);
  assert.ok(!forbiddenChromiumExtensionIds.has(chromeExtensionId), "forbidden browser store ID cannot be recorded");
  assert.ok(!forbiddenChromiumExtensionIds.has(edgeExtensionId), "forbidden browser store ID cannot be recorded");
  assert.notEqual(chromeExtensionId, edgeExtensionId);
}

export function assertBarwardenReleaseIdentities({ teamId, chromeExtensionId, edgeExtensionId }) {
  assertTeamIdentity(teamId);
  assertBrowserReleaseIdentities({ chromeExtensionId, edgeExtensionId });
}
