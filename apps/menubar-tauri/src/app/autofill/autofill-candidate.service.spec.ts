import { describe, expect, it, vi } from "vitest";

import { AutoFillBindingsService } from "./autofill-bindings.service";
import {
  AutoFillCandidateService,
  type AutoFillCandidateHost,
  validateSecretReleaseRequest,
} from "./autofill-candidate.service";

describe("AutoFillBindingsService", () => {
  it("keeps bindings account scoped and removes bindings and history with the account", () => {
    const bindings = new AutoFillBindingsService();
    bindings.bind("account-a", "COM.EXAMPLE.App", "cipher-a");
    bindings.bind("account-b", "com.example.app", "cipher-b");
    bindings.recordSuccessfulSelection({
      accountId: "account-a",
      bundleId: "com.example.app",
      serviceIdentifiers: [],
      cipherId: "cipher-a",
      selectedAt: "2026-08-08T00:00:00Z",
      explicitUserAction: true,
      succeeded: true,
    });

    expect(bindings.snapshot("account-a")).toEqual({
      bindings: [{ bundleId: "com.example.app", cipherId: "cipher-a" }],
      history: [{
        contextKey: "app:com.example.app",
        cipherId: "cipher-a",
        successfulSelectionCount: 1,
        lastSelectedAt: 1_786_147_200_000,
      }],
    });
    expect(bindings.bindingFor("account-b", "COM.EXAMPLE.APP")).toBe("cipher-b");

    bindings.clearAccount("account-a");

    expect(bindings.snapshot("account-a")).toEqual({ bindings: [], history: [] });
    expect(bindings.bindingFor("account-b", "com.example.app")).toBe("cipher-b");
  });

  it("records only explicit successful selections and merges their count and recency", () => {
    const bindings = new AutoFillBindingsService();
    const base = {
      accountId: "account-a",
      bundleId: "com.example.app",
      serviceIdentifiers: [] as string[],
      cipherId: "cipher-a",
      selectedAt: "2026-08-08T00:00:00Z",
    };
    bindings.recordSuccessfulSelection({ ...base, explicitUserAction: false, succeeded: true });
    bindings.recordSuccessfulSelection({ ...base, explicitUserAction: true, succeeded: false });
    bindings.recordSuccessfulSelection({ ...base, explicitUserAction: true, succeeded: true });
    bindings.recordSuccessfulSelection({
      ...base,
      selectedAt: "2026-08-09T00:00:00Z",
      explicitUserAction: true,
      succeeded: true,
    });

    expect(bindings.snapshot("account-a").history).toEqual([{
      contextKey: "app:com.example.app",
      cipherId: "cipher-a",
      successfulSelectionCount: 2,
      lastSelectedAt: 1_786_233_600_000,
    }]);
  });

  it("rejects selection timestamps without an explicit UTC offset", () => {
    const bindings = new AutoFillBindingsService();
    expect(() => bindings.recordSuccessfulSelection({
      accountId: "account-a",
      bundleId: "com.example.app",
      serviceIdentifiers: [],
      cipherId: "cipher-a",
      selectedAt: "2026-08-08T00:00:00",
      explicitUserAction: true,
      succeeded: true,
    })).toThrow("invalid selection timestamp");
  });
});

describe("AutoFillCandidateService", () => {
  it("sends the account generation and normalized all-Login query to the Agent", async () => {
    const host = new RecordingCandidateHost({
      contextToken: "context-token",
      candidates: [{
        cipherId: "opaque-cipher",
        displayName: "Cafe Admin",
        username: "person@example.test",
        group: "other",
        reason: "query",
        requiresMismatchConfirmation: true,
      }],
    });
    const service = new AutoFillCandidateService(host);

    const result = await service.query({
      accountId: "account-a",
      lockGeneration: "0f9ddca7-c7ee-45ce-841f-62e47df55c89",
      context: {
        bundleId: "com.example.App",
        appName: "Example",
        serviceIdentifiers: ["https://example.test"],
        query: "  CAFÉ  ",
      },
    });

    expect(host.requests[0].context.query).toBe("CAFÉ");
    expect(result.candidates.map((candidate) => candidate.cipherId)).toEqual(["opaque-cipher"]);
    expect(JSON.stringify(result)).not.toMatch(/password|totp|uri/i);
  });

  it("rejects candidate payloads that smuggle secret or URI fields", async () => {
    const host = new RecordingCandidateHost({
      contextToken: "context-token",
      candidates: [{
        cipherId: "opaque-cipher",
        displayName: "Display",
        username: "person@example.test",
        group: "exact",
        reason: "service_identifier",
        requiresMismatchConfirmation: false,
        password: "must-not-cross",
      }],
    });

    await expect(new AutoFillCandidateService(host).query({
      accountId: "account-a",
      lockGeneration: "0f9ddca7-c7ee-45ce-841f-62e47df55c89",
      context: { bundleId: "com.example.App", appName: "Example", serviceIdentifiers: [], query: "" },
    })).rejects.toThrow("AutoFill candidates unavailable");
  });

  it.each([
    ["custom prototype", Object.assign(Object.create({ inherited: true }), {
      contextToken: "context-token", candidates: [],
    })],
    ["symbol root key", Object.assign({ contextToken: "context-token", candidates: [] }, {
      [Symbol("secret")]: "hidden",
    })],
    ["undefined root key", { contextToken: "context-token", candidates: [], password: undefined }],
    ["oversized token", { contextToken: "x".repeat(513), candidates: [] }],
    ["duplicate cipher IDs", {
      contextToken: "context-token",
      candidates: [
        candidatePayload("same"),
        candidatePayload("same"),
      ],
    }],
    ["nested unknown key", {
      contextToken: "context-token",
      candidates: [{ ...candidatePayload("a"), secret: undefined }],
    }],
  ])("rejects hostile %s candidate responses with a fixed error", async (_name, response) => {
    const service = new AutoFillCandidateService(new RecordingCandidateHost(response));
    await expect(service.query(candidateRequest())).rejects.toThrow(/^AutoFill candidates unavailable$/);
  });

  it("projects and freezes candidate responses instead of retaining Agent aliases", async () => {
    const candidate = candidatePayload("opaque-cipher");
    const response = { contextToken: "context-token", candidates: [candidate] };
    const result = await new AutoFillCandidateService(new RecordingCandidateHost(response)).query(candidateRequest());
    candidate.displayName = "mutated";
    response.candidates.push(candidatePayload("late"));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].displayName).toBe("Display");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
  });

  it("sanitizes rejected promises and hostile getters without leaking details", async () => {
    const rejection = new AutoFillCandidateService({
      queryCandidates: vi.fn(async () => { throw new Error("native password database detail"); }),
    });
    await expect(rejection.query(candidateRequest())).rejects.toThrow(/^AutoFill candidates unavailable$/);

    const hostile = new Proxy({}, { get: () => { throw new Error("getter secret detail"); } });
    const getter = new AutoFillCandidateService(new RecordingCandidateHost(hostile));
    await expect(getter.query(candidateRequest())).rejects.toThrow(/^AutoFill candidates unavailable$/);
  });

  it("rejects stateful root and candidate accessors without a second read or retained secret", async () => {
    let tokenReads = 0;
    let displayReads = 0;
    const statefulCandidate = candidatePayload("opaque-cipher");
    Object.defineProperty(statefulCandidate, "displayName", {
      enumerable: true,
      get: () => {
        displayReads += 1;
        if (displayReads > 1) throw new Error("private getter second read");
        return "safe-first-value";
      },
    });
    const statefulRoot = {
      get contextToken() {
        tokenReads += 1;
        return tokenReads === 1 ? "context-token" : "secret-token-second-value";
      },
      candidates: [],
    };
    const statefulNested = { contextToken: "context-token", candidates: [statefulCandidate] };
    for (const response of [statefulRoot, statefulNested]) {
      const error = await new AutoFillCandidateService(new RecordingCandidateHost(response))
        .query(candidateRequest()).then(() => null, (caught: unknown) => caught);
      expect(error).toMatchObject({ message: "AutoFill candidates unavailable" });
      expect(JSON.stringify(error)).not.toMatch(/private|secret|second/);
    }
    expect(tokenReads).toBeLessThanOrEqual(1);
    expect(displayReads).toBeLessThanOrEqual(1);
  });

  it("sanitizes descriptor traps and rejects whitespace-only context tokens", async () => {
    const descriptorTrap = new Proxy({ contextToken: "context-token", candidates: [] }, {
      getOwnPropertyDescriptor() { throw new Error("private descriptor value"); },
    });
    for (const response of [descriptorTrap, { contextToken: "   ", candidates: [] }]) {
      const error = await new AutoFillCandidateService(new RecordingCandidateHost(response))
        .query(candidateRequest()).then(() => null, (caught: unknown) => caught);
      expect(error).toMatchObject({ message: "AutoFill candidates unavailable" });
      expect(JSON.stringify(error)).not.toMatch(/private|descriptor/);
    }
  });

  it("defines a separate secret operation bound to candidate field context generation mismatch and reprompt", () => {
    const request = {
      accountId: "account-a",
      candidateId: "opaque-cipher",
      field: "password" as const,
      contextToken: "context-token",
      lockGeneration: "0f9ddca7-c7ee-45ce-841f-62e47df55c89",
      mismatchConfirmed: true,
      reprompt: { result: "grant" as const, grant: "single-use-grant" },
    };

    expect(validateSecretReleaseRequest(request)).toEqual(request);
    expect(() => validateSecretReleaseRequest({ ...request, contextToken: "" })).toThrow();
    expect(() => validateSecretReleaseRequest({ ...request, field: "all" as "password" })).toThrow();
    expect(() => validateSecretReleaseRequest({
      ...request,
      reprompt: { result: "grant", grant: "" },
    })).toThrow();
    expect(() => validateSecretReleaseRequest({
      ...request,
      password: "must-not-be-part-of-request-contract",
    } as typeof request)).toThrow();
  });
});

function candidatePayload(cipherId: string) {
  return {
    cipherId,
    displayName: "Display",
    username: "person@example.test",
    group: "exact",
    reason: "service_identifier",
    requiresMismatchConfirmation: false,
  };
}

function candidateRequest() {
  return {
    accountId: "account-a",
    lockGeneration: "0f9ddca7-c7ee-45ce-841f-62e47df55c89",
    context: { bundleId: "com.example.App", appName: "Example", serviceIdentifiers: [] as string[], query: "" },
  };
}

class RecordingCandidateHost implements AutoFillCandidateHost {
  readonly requests: Parameters<AutoFillCandidateHost["queryCandidates"]>[0][] = [];

  constructor(private readonly response: unknown) {}

  async queryCandidates(request: Parameters<AutoFillCandidateHost["queryCandidates"]>[0]): Promise<unknown> {
    this.requests.push(request);
    return this.response;
  }
}
