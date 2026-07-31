import { beforeEach, describe, expect, it } from "vitest";

import {
  createGeneratorWorkflowEvidenceAccountPort,
  createGeneratorWorkflowEvidenceEngine,
  createGeneratorWorkflowEvidenceHistoryStore,
  createGeneratorWorkflowEvidenceOperationReceipt,
  resolveGeneratorWorkflowEvidenceScenario,
} from "./generator-workflow-evidence";

describe("generator workflow evidence", () => {
  beforeEach(() => {
    for (const key of [
      "bwEvidenceGeneratorEngineAttempts",
      "bwEvidenceGeneratorHistoryTracks",
      "bwEvidenceGeneratorPending",
    ]) {
      delete document.documentElement.dataset[key];
    }
  });

  it("accepts only one exact lifecycle scenario", () => {
    expect(resolveGeneratorWorkflowEvidenceScenario("?generatorEvidence=generation-account-switch"))
      .toBe("generation-account-switch");
    expect(resolveGeneratorWorkflowEvidenceScenario("?generatorEvidence=generation-same-id"))
      .toBe("generation-same-id");
    expect(() => resolveGeneratorWorkflowEvidenceScenario(
      "?generatorEvidence=generation-lock&generatorEvidence=generation-lock",
    )).toThrow("Invalid generator workflow evidence scenario");
  });

  it("mutates the synthetic active account only through the lifecycle event", async () => {
    const switched = createGeneratorWorkflowEvidenceAccountPort("generation-account-switch");
    expect((await switched.list()).find((account) => account.isActive)?.id).toBe("evidence-account");
    document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-account", { detail: "account-switch" }));
    expect((await switched.list()).find((account) => account.isActive)?.id).toBe("evidence-account-next");

    const locked = createGeneratorWorkflowEvidenceAccountPort("generation-lock");
    document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-account", { detail: "lock" }));
    expect((await locked.list()).find((account) => account.isActive)?.status).toBe("locked");
  });

  it("releases the newest duplicate separately and records only committed history", async () => {
    const engine = createGeneratorWorkflowEvidenceEngine("generation-duplicate");
    await expect(engine.generatePassword({ length: 14 })).resolves.toBe("evidence-lifecycle-initial");
    const receipt = createGeneratorWorkflowEvidenceOperationReceipt();
    const completeStale = receipt.begin();
    const stale = engine.generatePassword({ length: 14 });
    const completeLatest = receipt.begin();
    const latest = engine.generatePassword({ length: 14 });
    expect(document.documentElement.dataset.bwEvidenceGeneratorPending).toBe("2");

    document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-release", { detail: "newest" }));
    await expect(latest).resolves.toBe("evidence-lifecycle-latest");
    expect(document.documentElement.dataset.bwEvidenceGeneratorPending).toBe("2");
    completeLatest();
    expect(document.documentElement.dataset.bwEvidenceGeneratorPending).toBe("1");
    document.dispatchEvent(new CustomEvent("bw-generator-lifecycle-release", { detail: "oldest" }));
    await expect(stale).resolves.toBe("evidence-lifecycle-stale");
    completeStale();
    expect(document.documentElement.dataset.bwEvidenceGeneratorPending).toBeUndefined();

    const history = createGeneratorWorkflowEvidenceHistoryStore("generation-duplicate");
    const pending = await history.prepareTrack("evidence-account", {
      credential: "evidence-lifecycle-latest",
      category: "password",
      generationDate: new Date(0),
      algorithm: "password",
    }, async () => true);
    pending.commit();
    expect(document.documentElement.dataset.bwEvidenceGeneratorHistoryTracks).toBe("1");
  });

  it("fails the first form generation and allows a retry", async () => {
    const engine = createGeneratorWorkflowEvidenceEngine("form-generation-failure");
    await expect(engine.generateUsername({} as never)).rejects.toThrow("Synthetic generator form failure");
    await expect(engine.generateUsername({} as never)).resolves.toBe("evidence-lifecycle-form-retry");
  });
});
