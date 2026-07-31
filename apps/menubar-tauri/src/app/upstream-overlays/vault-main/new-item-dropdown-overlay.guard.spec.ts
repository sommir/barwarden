import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BrowserApi } from "./browser-src/platform/browser/browser-api";
import BrowserPopupUtils from "./browser-src/platform/browser/browser-popup-utils";

const root = process.cwd();
const overlayRoot = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src",
);
const upstreamRoot = resolve(root, "vendor/bitwarden-clients/apps/browser/src");
const dropdownSources = [
  {
    path: "vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
    sha256: "552cd77fa8ece5e46f4ec9183a2925e097af979c40ec97c0d05ae0f770c18cc8",
  },
  {
    path: "vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.html",
    sha256: "a6c3526a0b9c9661935884e6500305c822c8d2066809c102fa5cdfabc35d4187",
  },
] as const;

const browserApiAdapter = resolve(overlayRoot, "platform/browser/browser-api.ts");
const popupUtilsAdapter = resolve(overlayRoot, "platform/browser/browser-popup-utils.ts");
const addEditBoundary = resolve(
  overlayRoot,
  "vault/popup/components/vault/add-edit/add-edit.component.ts",
);

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

describe("official New item dropdown overlay guard", () => {
  it("returns no current tab and always disables browser-popup prefill", async () => {
    await expect(BrowserApi.getTabFromCurrentWindow()).resolves.toBeUndefined();
    expect(BrowserPopupUtils.inPopout(window)).toBe(true);
  });

  it("runs the pinned dropdown TypeScript and template through relative symlinks", () => {
    for (const source of dropdownSources) {
      const overlay = resolve(overlayRoot, source.path);
      const upstream = resolve(upstreamRoot, source.path);
      expect(existsSync(overlay), overlay).toBe(true);
      expect(lstatSync(overlay).isSymbolicLink(), overlay).toBe(true);
      expect(isAbsolute(readlinkSync(overlay)), overlay).toBe(false);
      expect(realpathSync(overlay), overlay).toBe(upstream);
      expect(sha256(readFileSync(upstream))).toBe(source.sha256);
      expect(readFileSync(overlay)).toEqual(readFileSync(upstream));
    }
  });

  it("uses fail-closed browser adapters and a type-only add-edit boundary", () => {
    const browserApi = readFileSync(browserApiAdapter, "utf8");
    const popupUtils = readFileSync(popupUtilsAdapter, "utf8");
    const addEdit = readFileSync(addEditBoundary, "utf8");

    expect(browserApi).toContain("getTabFromCurrentWindow(): Promise<undefined>");
    expect(browserApi).toContain("return undefined");
    expect(browserApi).not.toMatch(/\b(?:chrome|browser)\./);
    expect(browserApi).not.toMatch(/url|title|pageDetails/i);
    expect(popupUtils).toContain("inPopout");
    expect(popupUtils).toContain("return true");
    expect(popupUtils).not.toMatch(/\b(?:chrome|browser)\./);
    expect(addEdit).toContain("export type AddEditQueryParams");
    expect(addEdit).not.toMatch(/@Component|class AddEditComponent|prefillNameAndURIFromTab/);
  });

  it("does not resolve the pinned browser implementations or excluded browser context", () => {
    const adapters = [browserApiAdapter, popupUtilsAdapter].map((path) => realpathSync(path));
    expect(adapters).not.toContain(resolve(upstreamRoot, "platform/browser/browser-api.ts"));
    expect(adapters).not.toContain(resolve(upstreamRoot, "platform/browser/browser-popup-utils.ts"));

    const productionHeader = readFileSync(
      resolve(root, "apps/menubar-tauri/src/app/popup-header-actions.component.ts"),
      "utf8",
    );
    expect(productionHeader).not.toMatch(/organizationId|collectionId|currentUrl|pageDetails/);
    expect(productionHeader).toContain("NewItemDropdownComponent");
  });
});
