import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validateM16Replay } from "../../../../scripts/m16-live-native-replay-validator.mjs";

const machineReportPath = "docs/superpowers/specs/2026-07-22-m16-machine-verification.json";
const replayPath = "docs/superpowers/specs/2026-07-22-m16-live-native-replay.json";
const resultPath = "docs/superpowers/specs/2026-07-22-m16-live-native-result.md";

const services = ["cloud-us", "cloud-eu", "self-hosted"] as const;
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
] as const;
const liveRowIds = services.flatMap((service) =>
  liveRequirements.map((requirement) => `live.${service}.${requirement}`),
);
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
] as const;
const expectedRowIds = [...liveRowIds, ...nativeRowIds];

describe("M16 exact-candidate live/native replay contract", () => {
  it("publishes the strict sanitized v1 record with the complete fixed inventory", () => {
    const { machine, replay } = loadReports();

    expect(() => validateReplay(replay, machine)).not.toThrow();
    expect(replay.rows.map((row) => row.id)).toEqual(expectedRowIds);
  });

  it("rejects duplicate and missing requirement rows", () => {
    const { machine, replay } = loadReports();
    const duplicate = clone(replay);
    duplicate.rows.push(clone(duplicate.rows[0]));
    const missing = clone(replay);
    missing.rows.pop();

    expect(() => validateReplay(duplicate, machine)).toThrow(/inventory/i);
    expect(() => validateReplay(missing, machine)).toThrow(/inventory/i);
  });

  it("rejects private or unexpected fields at every schema level", () => {
    const { machine, replay } = loadReports();
    const topLevelPrivate = { ...clone(replay), email: "private@example.test" };
    const candidatePrivate = clone(replay);
    candidatePrivate.candidate.accessToken = "private-token";
    const rowPrivate = clone(replay);
    rowPrivate.rows[0].rawError = "private response body";

    expect(() => validateReplay(topLevelPrivate, machine)).toThrow(/fields/i);
    expect(() => validateReplay(candidatePrivate, machine)).toThrow(/fields/i);
    expect(() => validateReplay(rowPrivate, machine)).toThrow(/fields/i);
  });

  it("rejects stale source, executable, and DMG identity", () => {
    const { machine, replay } = loadReports();
    for (const field of ["sourceRevision", "executableSha256", "dmgSha256"] as const) {
      const stale = clone(replay);
      stale.candidate[field] = "0".repeat(64);
      expect(() => validateReplay(stale, machine), field).toThrow(/identity/i);
    }
  });

  it("rejects statuses and reason codes outside the fixed allowlists", () => {
    const { machine, replay } = loadReports();
    const unknownStatus = clone(replay);
    unknownStatus.rows[0].status = "partial";
    const unknownReason = clone(replay);
    unknownReason.rows[0].reasonCode = "operator_said_no";
    const mismatchedReason = clone(replay);
    mismatchedReason.rows[0].status = "blocked_external";
    mismatchedReason.rows[0].reasonCode = "credentials_absent";

    expect(() => validateReplay(unknownStatus, machine)).toThrow(/status/i);
    expect(() => validateReplay(unknownReason, machine)).toThrow(/reason/i);
    expect(() => validateReplay(mismatchedReason, machine)).toThrow(/reason/i);
  });

  it("requires sanitized child evidence for passed live rows", () => {
    const { machine, replay } = loadReports();
    const noEvidence = asPassed(clone(replay), liveRowIds[0]);
    const unitEvidence = asPassed(clone(replay), liveRowIds[0], {
      kind: "unit-test",
      reference: "vitest-full",
    });
    const validEvidence = asPassed(clone(replay), liveRowIds[0], {
      kind: "m14-sanitized-child",
      reference: "m14-live-gate-result-v1",
    });

    expect(() => validateReplay(noEvidence, machine)).toThrow(/evidence/i);
    expect(() => validateReplay(unitEvidence, machine)).toThrow(/evidence/i);
    expect(() => validateReplay(validEvidence, machine)).not.toThrow();
  });

  it("requires built-app evidence for native interactions and exact report evidence for local facts", () => {
    const { machine, replay } = loadReports();
    const playwrightOnly = asPassed(clone(replay), "native.tray-show-hide", {
      kind: "playwright",
      reference: "playwright-release",
    });
    const reportOnlyInteraction = asPassed(clone(replay), "native.tray-show-hide", {
      kind: "m16-machine-report-gate",
      reference: "tauri-release-candidate-build",
    });
    const builtApp = asPassed(clone(replay), "native.tray-show-hide", {
      kind: "built-app-observation",
      reference: "sanitized-native-replay",
    });
    const wrongBuildEvidence = asPassed(clone(replay), "native.release-candidate-build", {
      kind: "built-app-observation",
      reference: "sanitized-native-replay",
    });

    expect(() => validateReplay(playwrightOnly, machine)).toThrow(/evidence/i);
    expect(() => validateReplay(reportOnlyInteraction, machine)).toThrow(/evidence/i);
    expect(() => validateReplay(builtApp, machine)).not.toThrow();
    expect(() => validateReplay(wrongBuildEvidence, machine)).toThrow(/evidence/i);
  });

  it("records only report-backed local facts as passed and all unavailable replay inputs truthfully", () => {
    const { replay } = loadReports();
    const rows = new Map(replay.rows.map((row) => [row.id, row]));

    expect(replay.rows.filter((row) => row.status === "passed").map((row) => row.id)).toEqual([
      "native.release-candidate-build",
      "native.process-path-identity",
      "native.hidden-start",
    ]);
    expect(rows.get("native.hidden-start")).toMatchObject({
      status: "passed",
      evidence: { kind: "built-app-observation", reference: "sanitized-native-replay" },
    });
    for (const id of liveRowIds) {
      expect(rows.get(id)).toMatchObject({
        domain: "live",
        status: "skipped_external",
        reasonCode: "credentials_absent",
      });
    }
    expect(rows.get("native.two-display-placement")).toMatchObject({
      status: "blocked_external",
      reasonCode: "second_display_absent",
    });
    expect(rows.get("native.clean-user-launch")).toMatchObject({
      status: "blocked_external",
      reasonCode: "clean_user_session_absent",
    });
    for (const id of nativeRowIds.filter((id) => id.includes("keychain-") && id !== "native.keychain-roundtrip")) {
      expect(rows.get(id)).toMatchObject({
        status: "blocked_external",
        reasonCode: "disposable_second_account_absent",
      });
    }
    for (const id of nativeRowIds.filter((id) => id.includes("accessibility") || id.includes("permissions-"))) {
      expect(rows.get(id)).toMatchObject({
        status: "blocked_external",
        reasonCode: "accessibility_confirmation_required",
      });
    }
  });

  it("keeps the Markdown result bound to the same identity and row model", () => {
    const { replay } = loadReports();
    const markdown = readFileSync(resolve(resultPath), "utf8");

    for (const identity of [
      replay.candidate.sourceRevision,
      replay.candidate.executableSha256,
      replay.candidate.dmgSha256,
    ]) {
      expect(markdown).toContain(`\`${identity}\``);
    }
    for (const row of replay.rows) {
      expect(markdown.match(new RegExp("\\| `" + escapeRegExp(row.id) + "` \\|", "g"))).toHaveLength(1);
    }
    expect(markdown).not.toMatch(/@[\w.-]+|password|access[_-]?token|refresh[_-]?token/i);
  });
});

type JsonObject = Record<string, any>;

function loadReports(): { machine: JsonObject; replay: JsonObject } {
  return {
    machine: JSON.parse(readFileSync(resolve(machineReportPath), "utf8")),
    replay: JSON.parse(readFileSync(resolve(replayPath), "utf8")),
  };
}

function validateReplay(replay: JsonObject, machine: JsonObject): void {
  validateM16Replay(replay, machine);
}

function asPassed(replay: JsonObject, id: string, evidence?: JsonObject): JsonObject {
  const row = replay.rows.find((candidate: JsonObject) => candidate.id === id);
  row.status = "passed";
  delete row.reasonCode;
  if (evidence) row.evidence = evidence;
  return replay;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
