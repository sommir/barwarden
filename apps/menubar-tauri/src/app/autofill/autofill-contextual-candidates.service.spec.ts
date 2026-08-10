import { describe, expect, it, vi } from "vitest";

import { AutoFillCandidateService, type AutoFillCandidateHost, type AutoFillSecretField } from "./autofill-candidate.service";
import type { LiveAutoFillContext } from "./autofill-fill-context.model";
import type { AutoFillAgentSession, AutoFillNativeHost } from "./autofill-native.host";
import {
  AutoFillCandidatesUnavailableError,
  AutoFillContextChangedError,
  AutoFillContextualCandidatesService,
} from "./autofill-contextual-candidates.service";

const context: LiveAutoFillContext = {
  bundleId: "com.example.Terminal",
  appName: "Terminal",
  fillContextToken: "00000000-0000-4000-8000-000000000005",
  focusedField: { kind: "password", confidence: "high" },
  action: { mode: "form", fields: ["username", "password", "totp"] },
};
const session: AutoFillAgentSession = {
  generation: "00000000-0000-4000-8000-000000000004",
  accountId: "account-a",
  vaultRevision: 7,
};

describe("AutoFillContextualCandidatesService", () => {
  it("queries three field scopes concurrently and preserves every authorization token", async () => {
    const pending = new Map<AutoFillSecretField, (value: unknown) => void>();
    const candidateHost: AutoFillCandidateHost = {
      queryCandidates: vi.fn((request) => new Promise((resolve) => pending.set(request.field!, resolve))),
    };
    const service = new AutoFillContextualCandidatesService(
      new AutoFillCandidateService(candidateHost),
      liveHost(),
    );
    const resultPromise = service.queryAll(context, session, "term");
    expect([...pending.keys()]).toEqual(["username", "password", "totp"]);
    pending.get("password")?.(response("password-token", [candidate("login-a", "relevant")]));
    pending.get("username")?.(response("username-token", [candidate("login-a", "other")]));
    pending.get("totp")?.(response("totp-token", [candidate("login-a", "exact")]));

    const result = await resultPromise;
    expect(result).toEqual([
      expect.objectContaining({
        cipherId: "login-a",
        group: "exact",
        availableFields: ["username", "password", "totp"],
      }),
    ]);
    expect(result[0].authorizations.get("username")?.contextToken).toBe("username-token");
    expect(result[0].authorizations.get("password")?.contextToken).toBe("password-token");
    expect(result[0].authorizations.get("totp")?.contextToken).toBe("totp-token");
    expect("set" in result[0].authorizations).toBe(false);
  });

  it("omits unavailable fields and sorts strongest group while retaining stable Agent order", async () => {
    const host: AutoFillCandidateHost = {
      queryCandidates: vi.fn(async (request) => request.field === "username"
        ? response("username-token", [candidate("other-first", "other"), candidate("exact-first", "exact")])
        : request.field === "password"
          ? response("password-token", [candidate("relevant-first", "relevant"), candidate("exact-first", "relevant")])
          : response("totp-token", [candidate("exact-second", "exact")])),
    };
    const result = await new AutoFillContextualCandidatesService(
      new AutoFillCandidateService(host),
      liveHost(),
    ).queryAll(context, session, "");

    expect(result.map((item) => item.cipherId)).toEqual([
      "exact-first", "exact-second", "relevant-first", "other-first",
    ]);
    expect(result.find((item) => item.cipherId === "other-first")?.availableFields).toEqual(["username"]);
  });

  it("rejects all settled results when live target or Agent session changes", async () => {
    let currentContext = context;
    const host: AutoFillCandidateHost = {
      queryCandidates: vi.fn(async (request) => {
        if (request.field === "totp") currentContext = { ...context, appName: "Other" };
        return response(`${request.field}-token`, [candidate("login-a", "exact")]);
      }),
    };
    const service = new AutoFillContextualCandidatesService(
      new AutoFillCandidateService(host),
      liveHost(() => currentContext),
    );

    await expect(service.queryAll(context, session, "")).rejects.toBeInstanceOf(AutoFillContextChangedError);
  });

  it("uses frozen request projections while caller context and session mutate during queries", async () => {
    const mutableContext = {
      bundleId: context.bundleId,
      appName: context.appName,
      fillContextToken: context.fillContextToken,
      focusedField: { kind: context.focusedField.kind, confidence: context.focusedField.confidence },
      action: { mode: context.action.mode, fields: [...context.action.fields] },
    };
    const mutableSession = { ...session };
    const query = deferred<unknown>();
    const host: AutoFillCandidateHost = {
      queryCandidates: vi.fn((request) => request.field === "username"
        ? query.promise
        : Promise.resolve(response(`${request.field}-token`, [candidate("login-a", "exact")]))),
    };
    const service = new AutoFillContextualCandidatesService(new AutoFillCandidateService(host), liveHost());
    const result = service.queryAll(mutableContext, mutableSession, "term");
    mutableContext.fillContextToken = "00000000-0000-4000-8000-000000000006";
    mutableSession.accountId = "account-b";
    query.resolve(response("username-token", [candidate("login-a", "exact")]));

    await expect(result).resolves.toHaveLength(1);
    expect(vi.mocked(host.queryCandidates).mock.calls.every(([request]) => request.accountId === "account-a")).toBe(true);
  });

  it("returns a fixed unavailable error for any field query rejection", async () => {
    const host: AutoFillCandidateHost = {
      queryCandidates: vi.fn(async (request) => {
        if (request.field === "password") throw new Error("native candidate secret detail");
        return response(`${request.field}-token`, []);
      }),
    };
    const service = new AutoFillContextualCandidatesService(new AutoFillCandidateService(host), liveHost());
    await expect(service.queryAll(context, session, "")).rejects.toEqual(new AutoFillCandidatesUnavailableError());
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function candidate(cipherId: string, group: "exact" | "relevant" | "other") {
  return {
    cipherId,
    displayName: `${cipherId}-${group}`,
    username: `${cipherId}@example.test`,
    group,
    reason: group,
    requiresMismatchConfirmation: group !== "exact",
  };
}

function response(contextToken: string, candidates: ReturnType<typeof candidate>[]) {
  return { contextToken, candidates };
}

function liveHost(readContext: () => LiveAutoFillContext = () => context): AutoFillNativeHost {
  return {
    entryContext: vi.fn<AutoFillNativeHost["entryContext"]>(async () => ({ status: "available", context: readContext() })),
    agentSession: vi.fn<AutoFillNativeHost["agentSession"]>(async () => ({ status: "success", ...session })),
    beginReprompt: vi.fn(),
    cancelReprompt: vi.fn(),
    beginRepromptBatch: vi.fn(),
    cancelRepromptBatch: vi.fn(),
    biometricReprompt: vi.fn(),
    fillDetected: vi.fn(),
    releaseSecret: vi.fn(),
    pasteText: vi.fn(),
    copyText: vi.fn(),
  };
}
