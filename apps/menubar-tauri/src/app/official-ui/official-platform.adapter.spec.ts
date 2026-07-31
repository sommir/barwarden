import { describe, expect, it } from "vitest";

import { isBrowserSafariApi } from "./official-platform.adapter";

describe("official UI platform adapter", () => {
  it("uses the official WebKit-compatible search input path", () => {
    expect(isBrowserSafariApi()).toBe(true);
  });
});
