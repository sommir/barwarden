import { describe, expect, it } from "vitest";

import {
  decodeCapturedWebsiteContext,
  WebsiteContextHostError,
} from "./website-context";

describe("decodeCapturedWebsiteContext", () => {
  it("accepts a bounded HTTP(S) website outcome", () => {
    expect(decodeCapturedWebsiteContext({
      status: "available",
      generation: 7,
      browserBundleId: "com.google.Chrome",
      url: "https://login.example.com/account",
    })).toEqual({
      status: "available",
      generation: 7,
      browserBundleId: "com.google.Chrome",
      url: "https://login.example.com/account",
    });
    expect(decodeCapturedWebsiteContext({
      status: "unavailable",
      generation: 8,
      reason: "permission-denied",
    })).toEqual({
      status: "unavailable",
      generation: 8,
      reason: "permission-denied",
    });
  });

  it.each([
    null,
    {},
    { status: "available", generation: 1, browserBundleId: "x", url: "file:///tmp/a" },
    { status: "available", generation: -1, browserBundleId: "x", url: "https://example.com" },
    { status: "available", generation: 1.5, browserBundleId: "x", url: "https://example.com" },
    { status: "available", generation: 1, browserBundleId: "", url: "https://example.com" },
    { status: "unavailable", generation: 1, reason: "private-native-error" },
  ])("rejects a hostile or malformed payload without reflecting it: %j", (value) => {
    let error: unknown;
    try {
      decodeCapturedWebsiteContext(value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WebsiteContextHostError);
    expect((error as Error).message).toBe("Website context unavailable.");
  });

  it("rejects an oversized URL before it reaches vault matching", () => {
    expect(() => decodeCapturedWebsiteContext({
      status: "available",
      generation: 1,
      browserBundleId: "com.google.Chrome",
      url: `https://example.com/${"a".repeat(8192)}`,
    })).toThrow(WebsiteContextHostError);
  });
});
