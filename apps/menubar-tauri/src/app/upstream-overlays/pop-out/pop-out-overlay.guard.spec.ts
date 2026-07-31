import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const upstreamRoot = "vendor/bitwarden-clients/apps/browser/src/platform/popup/components";
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/pop-out";

describe("official PopOutComponent overlay guard", () => {
  it("keeps the pinned source hashes and byte-identical official template", () => {
    const upstreamTs = join(process.cwd(), upstreamRoot, "pop-out.component.ts");
    const upstreamHtml = join(process.cwd(), upstreamRoot, "pop-out.component.html");
    const overlayTs = join(process.cwd(), overlayRoot, "pop-out.component.ts");
    const overlayHtml = join(process.cwd(), overlayRoot, "pop-out.component.html");

    expect(createHash("sha256").update(readFileSync(upstreamTs)).digest("hex")).toBe(
      "bcfa0387e0b9eef1564c5901eb12c7af107ad7b3df8281c080150b728dcd68f4",
    );
    expect(createHash("sha256").update(readFileSync(upstreamHtml)).digest("hex")).toBe(
      "ddb7193f54282122070fe4d463f2dfcc33476bee04556dde94ebad59fb748c2e",
    );
    expect(existsSync(overlayTs)).toBe(true);
    expect(existsSync(overlayHtml)).toBe(true);
    expect(readFileSync(overlayHtml)).toEqual(readFileSync(upstreamHtml));
  });

  it("permits only the BrowserPopupUtils dependency substitution in the official component", () => {
    const upstream = readFileSync(join(process.cwd(), upstreamRoot, "pop-out.component.ts"), "utf8");
    const overlay = readFileSync(join(process.cwd(), overlayRoot, "pop-out.component.ts"), "utf8");

    expect(overlay).toBe(
      upstream.replace(
        'import BrowserPopupUtils from "../../browser/browser-popup-utils";',
        [
          'import BrowserPopupUtils from "./browser-popup-utils.adapter";',
          'import { TauriPopupPlatformUtilsAdapter } from "./platform-utils.adapter";',
        ].join("\n"),
      ).replace(
        "  imports: [CommonModule, JslibModule, IconButtonModule],",
        [
          "  imports: [CommonModule, JslibModule, IconButtonModule],",
          "  providers: [{ provide: PlatformUtilsService, useExisting: TauriPopupPlatformUtilsAdapter }],",
        ].join("\n"),
      ),
    );
  });
});
