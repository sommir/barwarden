import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const globalCss = readFileSync(
  resolve(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
  "utf8",
);

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...globalCss.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "gs"))]
    .map((match) => match[1])
    .join("\n");
}

describe("shared UI component sizing and rhythm", () => {
  it("keeps the Send list heading compact instead of inheriting the browser h2 margin", () => {
    expect(cssRule(".send-list-section bit-section-header h2")).toContain("margin-block-start: 0");
  });

  it("keeps compact icon controls at least 36px square", () => {
    expect(cssRule(".filter-button")).toContain("width: var(--bw-control-sm)");
    expect(cssRule(".filter-button")).toContain("height: var(--bw-control-sm)");
    expect(cssRule(".icon-action")).toContain("width: var(--bw-control-sm)");
    expect(cssRule(".icon-action")).toContain("height: var(--bw-control-sm)");
  });
});
