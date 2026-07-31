import { describe, expect, it } from "vitest";

import {
  extractVerificationFailure,
  extractVerificationSummary,
} from "../../../../../scripts/verification-summary.mjs";

describe("M10 verification artifact runner", () => {
  it("extracts bounded machine summaries from ANSI-colored gate output", () => {
    const output = [
      "\u001b[1mRunning 404 tests using 1 worker\u001b[0m",
      "unrelated diagnostic",
      "  10 skipped",
      "  394 passed (6.5m)",
    ].join("\n");

    expect(extractVerificationSummary(output)).toEqual([
      "Running 404 tests using 1 worker",
      "10 skipped",
      "394 passed (6.5m)",
    ]);
  });

  it("keeps failure context even when later warnings push it out of the output tail", () => {
    const output = [
      "Error: Timed out waiting for locator",
      "Expected: 2",
      "Received: 1",
      ...Array.from({ length: 100 }, (_, index) => `Angular warning ${index}`),
    ].join("\n");

    expect(extractVerificationFailure(output)).toEqual([
      "Error: Timed out waiting for locator",
      "Expected: 2",
      "Received: 1",
      "Angular warning 0",
      "Angular warning 1",
      "Angular warning 2",
      "Angular warning 3",
      "Angular warning 4",
      "Angular warning 5",
      "Angular warning 6",
      "Angular warning 7",
      "Angular warning 8",
      "Angular warning 9",
    ]);
  });
});
