import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const revision = "f47b6946e01aed474875789081966d311d5b8289";
const overlays = [
  {
    path: "form-field/error.component.ts",
    authority: "ee702668fa093c144702e350fa8f868f909efaa302dba53de77f0abe92ff2670",
    local: "0a7fab439253b64caad431691879395aa568e04ef8d263817fd0db4610aa6cb3",
    marker: 'aria-hidden="true"',
  },
  {
    path: "form-field/form-field-control.directive.ts",
    authority: "ac8c39eb655ded34c38f083599ed149474b1bd6e6f8fb81eeb157046653eee1a",
    local: "e3059b23afe32f3f2f2392bf48f0ada175cca0b85433163a0f6eac3afd07b295",
    marker: "setAriaDescribedBy",
  },
  {
    path: "form-field/form-field.component.ts",
    authority: "e30148a2d062c7799a8c6e38e1801e00c835e9b1d4bc8c974be4a9401d569e4b",
    local: "9ee2de4f1535fe57fff6dc193742b66916257317e3330505fa99a9a14d77b4a2",
    marker: "AfterViewChecked",
  },
  {
    path: "form-field/password-input-toggle.directive.ts",
    authority: "5f1c6dbe200b96b8ff80c76b8e944ae2eb6f0fc1ba482b2d6caa577c8b2bddb5",
    local: "8d2bc3cb24ac85234dffa4f652b4d6a26bcde80749da4767e5039275a8cf9c6c",
    marker: "aria-description",
  },
  {
    path: "menu/menu-trigger-for.directive.ts",
    authority: "88abc9a938a639a49664ab683ea0919e265b35691ff0bd9f862e648039e804c2",
    local: "4d89a61678c0decb92e44b2c9c326f681e14b70121e4d6a644a3877eaa679e7c",
    marker: "bit-menu-panel--closing",
  },
] as const;

describe("official component behavior overlays", () => {
  it("pins the untouched authority revision and every materialized local adapter", () => {
    const sourceRevision = readFileSync(
      resolve(root, "vendor/bitwarden-clients/.source-revision"),
      "utf8",
    );
    expect(sourceRevision).toContain(revision);

    for (const overlay of overlays) {
      const authorityPath = resolve(
        root,
        "vendor/bitwarden-clients/libs/components/src",
        overlay.path,
      );
      const localPath = resolve(
        root,
        "apps/menubar-tauri/official-components-overlay",
        overlay.path,
      );
      const authority = readFileSync(authorityPath, "utf8");
      const local = readFileSync(localPath, "utf8");

      expect(lstatSync(localPath).isSymbolicLink(), overlay.path).toBe(false);
      expect(sha256(authority), `${overlay.path} authority`).toBe(overlay.authority);
      expect(sha256(local), `${overlay.path} local`).toBe(overlay.local);
      expect(local, overlay.path).toContain(overlay.marker);
      expect(local, overlay.path).not.toBe(authority);
    }
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
