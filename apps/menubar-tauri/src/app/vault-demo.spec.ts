import { describe, expect, it } from "vitest";

import { PasteError, type HostApi } from "../host/host-api";
import { ACCESSIBILITY_PERMISSION_STATUS } from "./official-ui/accessibility-permission-dialog.service";
import {
  copyVaultField,
  demoVaultItems,
  fillVaultField,
  searchVaultItems,
  type VaultField,
} from "./vault-demo";

class RecordingHost implements HostApi {
  readonly calls: Array<[string, string, number | undefined]> = [];
  pasteFailure: unknown = null;
  failCopy = false;

  showPopup(): Promise<void> {
    return Promise.resolve();
  }

  hidePopup(): Promise<void> {
    return Promise.resolve();
  }

  copyText(value: string, clearAfterSeconds?: number): Promise<void> {
    this.calls.push(["copy", value, clearAfterSeconds]);
    return this.failCopy ? Promise.reject(new Error("private copy failure")) : Promise.resolve();
  }

  pasteText(value: string, clearAfterSeconds?: number): Promise<void> {
    this.calls.push(["paste", value, clearAfterSeconds]);
    return this.pasteFailure ? Promise.reject(this.pasteFailure) : Promise.resolve();
  }

  openUrl(): Promise<void> {
    return Promise.resolve();
  }

  secureGet(): Promise<string | null> {
    return Promise.resolve(null);
  }

  secureSet(): Promise<void> {
    return Promise.resolve();
  }

  secureDelete(): Promise<void> {
    return Promise.resolve();
  }
}

describe("vault demo model", () => {
  it("includes demo items for each visible vault item type and two folders", () => {
    expect(demoVaultItems.map((item) => item.type)).toEqual([
      "login",
      "card",
      "identity",
      "secure-note",
      "ssh-key",
    ]);
    expect(new Set(demoVaultItems.map((item) => item.folderName))).toEqual(
      new Set(["Work", "Personal"]),
    );
    expect(demoVaultItems[0]?.uris.map((uri) => uri.uri)).toEqual([
      "https://github.com",
      "https://gist.github.com",
    ]);
  });

  it("searches by item name, username, URI, and custom field label", () => {
    expect(searchVaultItems(demoVaultItems, "git").map((item) => item.name)).toEqual(["GitHub"]);
    expect(searchVaultItems(demoVaultItems, "ops@").map((item) => item.name)).toEqual(["GitHub"]);
    expect(searchVaultItems(demoVaultItems, "stripe").map((item) => item.name)).toEqual([
      "Travel card",
    ]);
    expect(searchVaultItems(demoVaultItems, "workspace").map((item) => item.name)).toEqual([
      "GitHub",
    ]);
  });

  it("returns all items for an empty query", () => {
    expect(searchVaultItems(demoVaultItems, "")).toHaveLength(demoVaultItems.length);
  });

  it("copies the selected vault field through the host API", async () => {
    const host = new RecordingHost();
    const field: VaultField = { id: "username", label: "Username", value: "ops@example.com" };

    await expect(copyVaultField(host, field, 45)).resolves.toBe("Copied Username");

    expect(host.calls).toEqual([["copy", "ops@example.com", 45]]);
  });

  it("fills a selected vault field with paste and falls back to copy on paste failure", async () => {
    const host = new RecordingHost();
    host.pasteFailure = new PasteError("keystroke-failed", false);
    const field: VaultField = { id: "password", label: "Password", value: "secret" };

    await expect(fillVaultField(host, field, 30)).resolves.toBe("Paste unavailable; value copied.");

    expect(host.calls).toEqual([
      ["paste", "secret", 30],
      ["copy", "secret", 30],
    ]);
  });

  it("does not duplicate a native copy after a known paste failure", async () => {
    const host = new RecordingHost();
    host.pasteFailure = new PasteError("target-not-active", true);

    await expect(
      fillVaultField(host, { id: "password", label: "Password", value: "selected-only" }, 30),
    ).resolves.toBe("Paste unavailable; value copied.");

    expect(host.calls).toEqual([["paste", "selected-only", 30]]);
  });

  it("returns actionable fixed Accessibility status without repeating the copied value", async () => {
    const host = new RecordingHost();
    host.pasteFailure = new PasteError("accessibility-denied", true);

    await expect(
      fillVaultField(host, { id: "password", label: "private label", value: "selected-only" }, 30),
    ).resolves.toBe(ACCESSIBILITY_PERMISSION_STATUS);

    expect(host.calls).toEqual([["paste", "selected-only", 30]]);
  });

  it("sanitizes fallback copy failures", async () => {
    const host = new RecordingHost();
    host.pasteFailure = new Error("private paste failure");
    host.failCopy = true;

    await expect(
      fillVaultField(host, { id: "password", label: "private label", value: "selected-only" }, 30),
    ).resolves.toBe("Unable to fill field.");
    expect(host.calls).toEqual([
      ["paste", "selected-only", 30],
      ["copy", "selected-only", 30],
    ]);
  });
});
