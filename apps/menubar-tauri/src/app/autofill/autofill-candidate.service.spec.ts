import { describe, expect, it } from "vitest";

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
    })).rejects.toThrow("invalid candidate response");
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

class RecordingCandidateHost implements AutoFillCandidateHost {
  readonly requests: Parameters<AutoFillCandidateHost["queryCandidates"]>[0][] = [];

  constructor(private readonly response: unknown) {}

  async queryCandidates(request: Parameters<AutoFillCandidateHost["queryCandidates"]>[0]): Promise<unknown> {
    this.requests.push(request);
    return this.response;
  }
}
