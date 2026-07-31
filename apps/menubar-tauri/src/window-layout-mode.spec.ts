import { describe, expect, it } from "vitest";

import {
  markWindowLayout,
  resolveWindowLayoutMode,
} from "./window-layout-mode";

describe("window layout mode", () => {
  it.each([
    ["", "popup"],
    ["?uilocation=popup", "popup"],
    ["?uilocation=POPOUT", "popup"],
    ["?uilocation=popout&uilocation=popout", "popup"],
    ["?uilocation=popout", "popout"],
    ["?vaultEvidence=populated&uilocation=popout", "popout"],
  ] as const)("resolves %s as %s", (search, expected) => {
    expect(resolveWindowLayoutMode(search)).toBe(expected);
  });

  it("marks the document root without changing route state", () => {
    const root = document.createElement("html");
    expect(markWindowLayout(root, "?uilocation=popout")).toBe("popout");
    expect(root.dataset["bwWindow"]).toBe("popout");
  });
});
