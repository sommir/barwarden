import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Tauri popup bootstrap", () => {
  it("loads Zone.js so async popup state changes render like the official browser popup", async () => {
    const source = await readFile(
      join(process.cwd(), "apps/menubar-tauri/src/main.ts"),
      "utf8",
    );

    expect(source).toContain('import "zone.js";');
  });
});
