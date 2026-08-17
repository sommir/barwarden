import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("GeneratorPageComponent", () => {
  it("is only the route host for the guarded retained Generator runtime", () => {
    const source = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/generator/generator-page.component.ts"),
      "utf8",
    );

    expect(source).toContain('from "@bitwarden/generator-overlay/credential-generator"');
    expect(source).toContain('template: "<bw-official-credential-generator />"');
    expect(source).toMatch(/export class GeneratorPageComponent \{\s*\}/);
    expect(source).not.toMatch(/bit-card|bit-toggle|operationEpoch|settings\s*=|value\s*=/);
  });

  it("marks the route host for the rendered Generator visual contract", () => {
    const root = process.cwd();
    const source = readFileSync(
      join(root, "apps/menubar-tauri/src/app/generator/generator-page.component.ts"),
      "utf8",
    );

    expect(source).toContain('host: { class: "macos-page macos-page--generator" }');
  });
});
