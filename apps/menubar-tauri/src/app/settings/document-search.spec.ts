import { describe, expect, it } from "vitest";

import { findDocumentMatches, segmentDocument } from "./document-search";

describe("document search utilities", () => {
  it("finds bounded literal, non-overlapping matches case-insensitively", () => {
    expect(findDocumentMatches("MIT\nmitochondria\nMIT", "mit")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 17, end: 20 },
    ]);
    expect(findDocumentMatches("abcdef", "", 500)).toEqual([]);
    expect(findDocumentMatches("aaaa", "aa", 2)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("segments document text without injecting HTML", () => {
    expect(segmentDocument("MIT License", [{ start: 0, end: 3 }])).toEqual([
      { text: "MIT", matchIndex: 0 },
      { text: " License", matchIndex: null },
    ]);
  });
});
