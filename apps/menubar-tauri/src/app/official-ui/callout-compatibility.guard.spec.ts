import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pinned = {
  "vendor/bitwarden-clients/libs/components/src/callout/callout.component.ts":
    "b00c36a37efb906fca2bcd070301b90302665c0a2c9bf102ca8e4fe6bb3ae3aa",
  "vendor/bitwarden-clients/libs/components/src/callout/callout.component.html":
    "9c789f7fb967f565e3de8da8c9fc0b305b23e314d7d5bddd63f43d7587d561d0",
  "apps/menubar-tauri/src/app/official-ui/official-components.ts":
    "a7f29e04a68268d2428195edf953dcb8d99dd005dfae7a2a75cc8b12e53b76fe",
  "apps/menubar-tauri/src/app/official-ui/callout-compatibility.component.ts":
    "2d340f6272f4616d5f220840dedde76b99573f5e764e1e2d6e77e1f8e97ed602",
  "apps/menubar-tauri/src/app/official-ui/macos-alert-strip.component.ts":
    "04c4eadeaa39cf000c651a34f81e409a474442cfe64fc4b3673b42588da8cf27",
} as const;

describe("shared callout compatibility source", () => {
  it("pins the upstream contract, global alias, and local Alert adapter as one closure", () => {
    for (const [path, digest] of Object.entries(pinned)) {
      expect(sha256(read(path)), path).toBe(digest);
    }

    const upstream = read(
      "vendor/bitwarden-clients/libs/components/src/callout/callout.component.ts",
    );
    const template = read(
      "vendor/bitwarden-clients/libs/components/src/callout/callout.component.html",
    );
    const alias = read(
      "apps/menubar-tauri/src/app/official-ui/official-components.ts",
    );
    const compatibility = read(
      "apps/menubar-tauri/src/app/official-ui/callout-compatibility.component.ts",
    );

    for (const input of ["type", "icon", "title", "accessibleName"]) {
      expect(upstream, input).toMatch(new RegExp(`readonly ${input} = input`));
      expect(compatibility, input).toContain(`@Input() ${input}`);
    }
    expect(template).toContain('<ng-content select="[slot=title]" />');
    expect(template).toContain('<ng-content select="[slot=end]" />');
    expect(compatibility).toContain('<ng-content select="[slot=title]" />');
    expect(compatibility).toContain('<ng-content select="[slot=end]" />');
    expect(alias).toContain(
      'export { CalloutCompatibilityComponent as CalloutComponent } from "./callout-compatibility.component";',
    );
  });
});

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
