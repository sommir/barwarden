const services = ["cloud-us", "cloud-eu", "self-hosted"];
const liveRequirements = [
  "auth-token",
  "auth-refresh",
  "auth-sync",
  "auth-challenge",
  "vault-read-only",
  "folder-mutation",
  "login-mutation",
  "card-mutation",
  "identity-mutation",
  "secure-note-mutation",
  "text-send-mutation",
  "file-send-non-interference",
];
const nativeRowIds = [
  "native.release-candidate-build",
  "native.process-path-identity",
  "native.hidden-start",
  "native.tray-show-hide",
  "native.outside-click-hide",
  "native.escape-hide",
  "native.close-relaunch",
  "native.pop-out-reuse",
  "native.two-display-placement",
  "native.keychain-roundtrip",
  "native.keychain-second-account-isolation",
  "native.keychain-selected-account-removal",
  "native.keychain-online-relaunch",
  "native.keychain-offline-relaunch",
  "native.clipboard-generations",
  "native.clipboard-timeout-clear",
  "native.clipboard-user-change-preservation",
  "native.one-field-paste-accessibility-denied",
  "native.one-field-paste-accessibility-granted",
  "native.one-field-copy-fallback",
  "native.url-public-handoff",
  "native.permissions-denied-feedback",
  "native.permissions-granted-feedback",
  "native.clean-user-launch",
];

export const expectedReplayRowIds = Object.freeze([
  ...services.flatMap((service) =>
    liveRequirements.map((requirement) => `live.${service}.${requirement}`),
  ),
  ...nativeRowIds,
]);

const allowedStatuses = new Set(["passed", "skipped_external", "blocked_external"]);
const skippedReasons = new Set([
  "credentials_absent",
  "mutation_disabled",
  "built_app_observation_absent",
]);
const blockedReasons = new Set([
  "challenge_input_absent",
  "credentials_partial",
  "accessibility_confirmation_required",
  "clean_user_session_absent",
  "disposable_second_account_absent",
  "second_display_absent",
]);
const allowedEvidenceKinds = new Set([
  "m14-sanitized-child",
  "m16-machine-report-gate",
  "m16-machine-report-artifact",
  "built-app-observation",
]);
const reportBackedNativeRows = new Map([
  [
    "native.release-candidate-build",
    { kind: "m16-machine-report-gate", reference: "tauri-release-candidate-build" },
  ],
  [
    "native.process-path-identity",
    { kind: "m16-machine-report-artifact", reference: "artifacts.executable" },
  ],
]);

export function validateM16Replay(replay, machine) {
  assertExactKeys(replay, ["candidate", "rows", "schema"]);
  if (replay.schema !== "m16-live-native-replay-v1") throw replayError("schema is invalid");
  assertExactKeys(replay.candidate, [
    "dmgSha256",
    "executableSha256",
    "machineReportPath",
    "sourceRevision",
  ]);
  if (
    replay.candidate.machineReportPath !==
      "docs/superpowers/specs/2026-07-22-m16-machine-verification.json" ||
    replay.candidate.sourceRevision !== machine.sourceRevision ||
    replay.candidate.executableSha256 !== machine.artifacts?.executable?.sha256 ||
    replay.candidate.dmgSha256 !== machine.artifacts?.dmg?.sha256
  ) {
    throw replayError("candidate identity is stale");
  }
  if (!Array.isArray(replay.rows)) throw replayError("row inventory is invalid");
  const ids = replay.rows.map((row) => row.id);
  if (
    JSON.stringify(ids) !== JSON.stringify(expectedReplayRowIds) ||
    new Set(ids).size !== ids.length
  ) {
    throw replayError("row inventory is invalid");
  }
  for (const row of replay.rows) validateRow(row);
}

export function validateM16ReplayMarkdown(markdown, replay) {
  if (typeof markdown !== "string") throw replayError("result is invalid");
  for (const identity of [
    replay.candidate.sourceRevision,
    replay.candidate.executableSha256,
    replay.candidate.dmgSha256,
  ]) {
    if (!markdown.includes(`\`${identity}\``)) throw replayError("result identity is stale");
  }
  for (const row of replay.rows) {
    const detail = row.status === "passed"
      ? `${row.evidence.kind}:${row.evidence.reference}`
      : row.reasonCode;
    const expectedLine = `| \`${row.id}\` | \`${row.status}\` | \`${detail}\` |`;
    if (markdown.split("\n").filter((line) => line === expectedLine).length !== 1) {
      throw replayError("result row model is invalid");
    }
  }
  if (/@[\w.-]+|password|access[_-]?token|refresh[_-]?token/i.test(markdown)) {
    throw replayError("result contains private input");
  }
}

function validateRow(row) {
  if (!allowedStatuses.has(row?.status)) throw replayError("row status is invalid");
  if (row.domain !== "live" && row.domain !== "native") throw replayError("row domain is invalid");
  if ((row.domain === "live") !== row.id.startsWith("live.")) {
    throw replayError("row domain is invalid");
  }
  if (row.status === "passed") {
    if (!row.evidence || typeof row.evidence !== "object" || Array.isArray(row.evidence)) {
      throw replayError("row evidence is invalid");
    }
    assertExactKeys(row, ["domain", "evidence", "id", "status"]);
    validatePassedEvidence(row);
    return;
  }
  assertExactKeys(row, ["domain", "id", "reasonCode", "status"]);
  const reasons = row.status === "skipped_external" ? skippedReasons : blockedReasons;
  if (!reasons.has(row.reasonCode)) throw replayError("row reason is invalid");
}

function validatePassedEvidence(row) {
  assertExactKeys(row.evidence, ["kind", "reference"]);
  if (!allowedEvidenceKinds.has(row.evidence.kind)) throw replayError("row evidence is invalid");
  if (row.domain === "live") {
    if (
      row.evidence.kind !== "m14-sanitized-child" ||
      row.evidence.reference !== "m14-live-gate-result-v1"
    ) {
      throw replayError("live row evidence is invalid");
    }
    return;
  }
  const reportEvidence = reportBackedNativeRows.get(row.id);
  if (reportEvidence) {
    if (
      row.evidence.kind !== reportEvidence.kind ||
      row.evidence.reference !== reportEvidence.reference
    ) {
      throw replayError("local native row evidence is invalid");
    }
    return;
  }
  if (
    row.evidence.kind !== "built-app-observation" ||
    row.evidence.reference !== "sanitized-native-replay"
  ) {
    throw replayError("native row evidence is invalid");
  }
}

function assertExactKeys(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    throw replayError("fields are invalid");
  }
}

function replayError(message) {
  return new Error(`M16 replay ${message}`);
}
