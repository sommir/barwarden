import { expect, test } from "@playwright/test";

import {
  runLiveAuthenticationRow,
  type LiveAuthenticationOutcome,
} from "./live-standard-password-login";
import {
  liveAuthenticationFailureId,
  recordLiveGateFailure,
  recordLiveGateRows,
  type LiveGateFailureId,
} from "./m14-live-gate-result";
import { assertNoLiveSecrets, type LiveServiceClass, type LiveStageResult } from "./live-test-protocol";

test.use({ screenshot: "off", trace: "off", video: "off" });
test.describe.configure({ mode: "serial", timeout: 120_000 });

for (const service of ["cloud-us", "cloud-eu", "self-hosted"] as const) {
  test(`runs or externally declares the opt-in ${service} authentication row`, async () => {
    let outcome: LiveAuthenticationOutcome;
    try {
      outcome = await runLiveAuthenticationRow(service, process.env);
      recordLiveGateRows(authenticationRows(service, outcome));
    } catch {
      failWithFixedIdentifier(liveAuthenticationFailureId(service, "token"));
    }

    test.skip(
      outcome.login.status === "skipped_external" || outcome.login.status === "blocked_external",
      outcome.login.reasonCode,
    );
    try {
      expectCompletedDisposition(outcome, service);
    } catch {
      const failureStage = [outcome.login, outcome.refresh, outcome.sync]
        .find(({ status }) => status === "failed")?.stage ?? "token";
      failWithFixedIdentifier(liveAuthenticationFailureId(
        service,
        failureStage as "token" | "refresh" | "sync",
      ));
    }
  });
}

function authenticationRows(
  service: LiveServiceClass,
  outcome: LiveAuthenticationOutcome,
): LiveStageResult[] {
  return [
    outcome.login,
    outcome.refresh,
    outcome.sync,
    outcome.challenge ?? {
      service,
      mode: "read-only",
      stage: "token",
      status: "blocked_external",
      reasonCode: "challenge_not_triggered",
    },
  ];
}

function failWithFixedIdentifier(identifier: LiveGateFailureId): never {
  try {
    recordLiveGateFailure(identifier);
  } catch {
    // The controller will use its fixed fallback if the child artifact is unavailable.
  }
  throw new Error(identifier);
}

function expectCompletedDisposition(
  outcome: LiveAuthenticationOutcome,
  service: LiveServiceClass,
): void {
  for (const stage of [outcome.login, outcome.refresh, outcome.sync]) {
    expect(stage).toMatchObject({
      service,
      mode: "read-only",
      status: "passed",
    });
  }
  assertNoLiveSecrets(JSON.stringify(outcome), []);
}
