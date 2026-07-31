import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LiveCleanupLedger,
  assertLiveCleanup,
  assertNoLiveSecrets,
  createLiveRunContext,
  resolveLiveDisposition,
  resolveLiveServiceDisposition,
  runLiveMutation,
} from "./live-test-protocol";
import { cloudInputNames, selfHostedInputNames } from "./live-standard-password-login";
import {
  liveAuthenticationFailureId,
  liveTextSendFailureId,
  liveVaultFailureId,
  recordLiveGateFailure,
  recordLiveGateRows,
} from "./m14-live-gate-result";

const completeSelfHostedInputs = {
  BARWARDEN_LIVE_SERVER_URL: "https://vault.example.test",
  BARWARDEN_LIVE_EMAIL: "operator@example.test",
  BARWARDEN_LIVE_PASSWORD: "synthetic-private-input",
};

describe("live test protocol", () => {
  it("builds fixed service and stage-specific live failure identifiers", () => {
    expect(liveAuthenticationFailureId("cloud-eu", "refresh"))
      .toBe("live_auth_cloud_eu_refresh_failed");
    expect(liveVaultFailureId("self-hosted", "secure-note"))
      .toBe("live_vault_self_hosted_secure_note_failed");
    expect(liveTextSendFailureId("cloud-us", "file-send-non-interference"))
      .toBe("live_text_send_cloud_us_file_send_non_interference_failed");
  });

  it("writes only strict sanitized live rows and allowlisted fixed failure identifiers", () => {
    const directory = mkdtempSync(join(tmpdir(), "m14-live-result-contract-"));
    const resultPath = join(directory, "result.json");
    const environment = { BARWARDEN_LIVE_RESULT_PATH: resultPath };
    try {
      recordLiveGateRows([{
        service: "self-hosted",
        mode: "read-only",
        stage: "token",
        status: "skipped_external",
        reasonCode: "credentials_absent",
      }], environment);
      recordLiveGateFailure("live_auth_self_hosted_token_failed", environment);

      expect(JSON.parse(readFileSync(resultPath, "utf8"))).toEqual({
        schema: "m14-live-gate-result-v1",
        rows: [{
          service: "self-hosted",
          mode: "read-only",
          stage: "token",
          status: "skipped_external",
          reasonCode: "credentials_absent",
        }],
        failure: "live_auth_self_hosted_token_failed",
      });
      expect(() => recordLiveGateRows([{
        service: "self-hosted",
        mode: "read-only",
        stage: "token",
        status: "passed",
        detail: "synthetic user title",
      } as never], environment)).toThrow("Live gate result row is invalid");

      recordLiveGateFailure("synthetic user title" as never, environment);
      expect(JSON.parse(readFileSync(resultPath, "utf8")).failure).toBe("chromium_live_matrix_failed");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("classifies absent, partial, and complete read-only inputs without reflecting values", () => {
    expect(resolveLiveDisposition(selfHostedInputNames, "read-only", {})).toEqual({
      status: "skipped_external",
      reasonCode: "credentials_absent",
    });
    expect(resolveLiveDisposition(selfHostedInputNames, "read-only", {
      BARWARDEN_LIVE_SERVER_URL: "https://private.example.test",
    })).toEqual({
      status: "blocked_external",
      reasonCode: "credentials_partial",
    });
    expect(resolveLiveDisposition(selfHostedInputNames, "read-only", completeSelfHostedInputs)).toEqual({
      status: "ready",
    });
  });

  it("requires explicit mutation enablement after complete inputs", () => {
    expect(resolveLiveDisposition(selfHostedInputNames, "mutation", completeSelfHostedInputs, {})).toEqual({
      status: "skipped_external",
      reasonCode: "mutation_disabled",
    });
    expect(resolveLiveDisposition(selfHostedInputNames, "mutation", completeSelfHostedInputs, {
      BARWARDEN_LIVE_MUTATION: "true",
    })).toEqual({ status: "ready" });
    expect(resolveLiveDisposition(cloudInputNames, "mutation", {
      BARWARDEN_LIVE_CLOUD_REGION: "US",
    }, { BARWARDEN_LIVE_MUTATION: "true" })).toEqual({
      status: "blocked_external",
      reasonCode: "credentials_partial",
    });
  });

  it("classifies unselected and invalid cloud services before live transport", () => {
    const cloudInputs = {
      BARWARDEN_LIVE_CLOUD_REGION: "US",
      BARWARDEN_LIVE_CLOUD_EMAIL: "operator@example.test",
      BARWARDEN_LIVE_CLOUD_PASSWORD: "synthetic-private-input",
    };
    expect(resolveLiveServiceDisposition("cloud-us", cloudInputNames, "read-only", cloudInputs)).toEqual({
      status: "ready",
    });
    expect(resolveLiveServiceDisposition("cloud-eu", cloudInputNames, "read-only", cloudInputs)).toEqual({
      status: "skipped_external",
      reasonCode: "service_not_selected",
    });
    expect(resolveLiveServiceDisposition("cloud-us", cloudInputNames, "read-only", {
      ...cloudInputs,
      BARWARDEN_LIVE_CLOUD_REGION: "invalid",
    })).toEqual({
      status: "blocked_external",
      reasonCode: "stage_failed",
    });
  });

  it("creates a fixed lowercase hexadecimal run prefix and tracks only owned resources", () => {
    const context = createLiveRunContext("self-hosted", "mutation", () =>
      Uint8Array.from({ length: 16 }, (_, index) => index),
    );

    expect(context.prefix).toBe("barwarden-m14-000102030405060708090a0b0c0d0e0f");
    context.track("folder", "folder-1", `${context.prefix} folder`);
    expect(context.trackedIds()).toEqual(new Set(["folder-1"]));
    expect(context.trackedNames()).toEqual(new Set([`${context.prefix} folder`]));
    expect(() => context.track("cipher", "", `${context.prefix} cipher`)).toThrow();
    expect(() => context.track("cipher", "cipher-1", "unowned name")).toThrow();
    expect(() => context.track("send", "folder-1", `${context.prefix} send`)).toThrow();
  });

  it("runs all cleanup in reverse order and reports a fixed error after failures", async () => {
    const cleanupCalls: string[] = [];
    const ledger = new LiveCleanupLedger();
    ledger.register("folder", async () => { cleanupCalls.push("folder"); });
    ledger.register("cipher", async () => { cleanupCalls.push("cipher"); throw new Error("body failure"); });
    ledger.register("send", async () => { cleanupCalls.push("send"); });

    await expect(ledger.drain()).rejects.toThrow("Live cleanup did not complete");
    expect(cleanupCalls).toEqual(["send", "cipher", "folder"]);
    await expect(ledger.drain()).resolves.toBeUndefined();
  });

  it("lets cleanup failure win over body failure after attempting every cleanup and verification", async () => {
    const calls: string[] = [];
    const context = createLiveRunContext("self-hosted", "mutation", () => new Uint8Array(16));
    context.cleanup.register("folder", async () => { calls.push("folder"); });
    context.cleanup.register("cipher", async () => {
      calls.push("cipher");
      throw new Error("private cleanup detail");
    });
    context.cleanup.register("send", async () => { calls.push("send"); });

    let escaped: unknown;
    try {
      await runLiveMutation(
        context,
        "folder",
        [],
        async () => {
          calls.push("body");
          throw new Error("body failure");
        },
        async () => {
          calls.push("verify");
          throw new Error("private verification detail");
        },
      );
    } catch (error) {
      escaped = error;
    }
    expect((escaped as Error).message).toBe("Live cleanup did not complete");
    expect(calls).toEqual(["body", "send", "cipher", "folder", "verify"]);
  });

  it("maps a private body failure to the fixed mutation error after successful cleanup", async () => {
    const calls: string[] = [];
    const privateText = [
      "https://private.example.test/vault",
      "operator@example.test",
      "private-token-value",
      "123e4567-e89b-12d3-a456-426614174000",
      "decrypted-field-value",
    ];
    const context = createLiveRunContext("self-hosted", "mutation", () => new Uint8Array(16));
    context.cleanup.register("cipher", async () => { calls.push("cleanup"); });

    let escaped: unknown;
    try {
      await runLiveMutation(
        context,
        "login",
        privateText,
        async () => {
          calls.push("body");
          throw new Error(privateText.join(" "));
        },
        async () => { calls.push("verify"); },
      );
    } catch (error) {
      escaped = error;
    }

    expect((escaped as Error).message).toBe("Live mutation did not complete");
    for (const value of privateText) {
      expect((escaped as Error).message).not.toContain(value);
    }
    expect(calls).toEqual(["body", "cleanup", "verify"]);
  });

  it("returns and sanitizes only the fixed mutation result", async () => {
    const context = createLiveRunContext("self-hosted", "mutation", () => new Uint8Array(16));
    await expect(runLiveMutation(
      context,
      "login",
      [],
      async () => undefined,
      async () => undefined,
    )).resolves.toEqual({
      service: "self-hosted",
      mode: "mutation",
      stage: "login",
      status: "passed",
    });

    await expect(runLiveMutation(
      createLiveRunContext("self-hosted", "mutation", () => new Uint8Array(16)),
      "login",
      ["passed"],
      async () => undefined,
      async () => undefined,
    )).rejects.toThrow("Live output contains private input");
  });

  it("rejects tracked IDs and names remaining after cleanup across raw and decrypted projections", () => {
    const context = createLiveRunContext("cloud-us", "mutation", () => new Uint8Array(16));
    context.track("cipher", "cipher-1", `${context.prefix} login`);
    context.track("folder", "folder-1", `${context.prefix} folder`);
    context.track("send", "send-1", `${context.prefix} send`);

    expect(() => assertLiveCleanup({ Ciphers: [{ Id: "cipher-1" }], Folders: [], Sends: [] }, {
      items: [], folders: [], sends: [],
    }, context)).toThrow("Live cleanup did not complete");
    expect(() => assertLiveCleanup({ ciphers: [], folders: [], sends: [] }, {
      items: [{ name: `${context.prefix} login` }], folders: [], sends: [],
    }, context)).toThrow("Live cleanup did not complete");
    expect(() => assertLiveCleanup({ Ciphers: [], Folders: [], Sends: [] }, {
      items: [], folders: [], sends: [],
    }, context)).not.toThrow();
  });

  it.each([
    null,
    {},
    { Ciphers: [], Folders: [] },
    { Ciphers: [], Folders: [], Sends: "invalid" },
    { ciphers: [], folders: "invalid", sends: [] },
  ])("fails closed for malformed cleanup sync structures", (sync) => {
    const context = createLiveRunContext("self-hosted", "mutation", () => new Uint8Array(16));
    expect(() => assertLiveCleanup(sync, { items: [], folders: [], sends: [] }, context)).toThrow(
      "Live cleanup did not complete",
    );
  });

  it("rejects private inputs and credential-shaped output with a fixed error", () => {
    const serialized = JSON.stringify({ password: "synthetic-private-input" });
    expect(() => assertNoLiveSecrets(serialized, Object.values(completeSelfHostedInputs))).toThrow(
      "Live output contains private input",
    );
    for (const value of [
      "Authorization: Bearer synthetic-token",
      '{"token":"synthetic-token"}',
      "https://user:password@example.test/path",
      "https://vault.example.test/path",
      "http://vault.example.test/path",
      "operator@example.test",
      "account 123e4567-e89b-12d3-a456-426614174000",
    ]) {
      expect(() => assertNoLiveSecrets(value, [])).toThrow("Live output contains private input");
    }
    expect(() => assertNoLiveSecrets("live stage skipped", [])).not.toThrow();
  });
});
