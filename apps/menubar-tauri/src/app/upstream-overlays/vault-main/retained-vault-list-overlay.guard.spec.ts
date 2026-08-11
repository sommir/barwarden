import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const containerSource = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.ts",
);
const containerTemplate = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.html",
);
const menuSource = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.ts",
);
const menuTemplate = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.html",
);
const rowSource = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
);
const rowTemplate = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html",
);
const vaultPageSource = resolve(root, "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts");
const directVisualPrimitives = [
  ["vault-loading-skeleton", "vault-loading-skeleton", "774b631dfec915298ea41cc63f0a72332f66e81002bea1fccf4c732f442bf7a1", "6a0d1948d549abb90917c9f8948145539648626390cbabf8764494b8f42bd6b3"],
  ["vault-fade-in-out", "vault-fade-in-out", "6f591db336c181166174b09353538fed2e6d5838e4931d19498c379777c2cc6f", "d9ee89fd402fee4bd76b89604a20131ac47d54f0eb98fc3d2cca50603b9481f4"],
  ["vault-fade-in-out-skeleton", "vault-fade-in-out-skeleton", "4fcf0a727a0db113c3d4ff040a861049c59a588f80ca67da982baa289505f654", "2c13f231d58a4fac3eb595b5ded4ccf9045434897a3f896ed7d300f62a5bb08e"],
] as const;

const upstreamAuthorities = [
  {
    path: "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.ts",
    sha256: "194e42b627e1c3276f48f23f3546353d1aec96465fc9b71adfd1dc398af09bb3",
  },
  {
    path: "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.html",
    sha256: "f71c839b115098d4a0fa67092e6627c42181712ddbb313950bf1310f98aa10a5",
  },
  {
    path: "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-more-options/item-more-options.component.ts",
    sha256: "3e314247842746018a3e1bfaf5871d3ef44b80b7f529ff4c4e83e59eb8cc5962",
  },
  {
    path: "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-more-options/item-more-options.component.html",
    sha256: "844712ce97432c8bf69bab26988bdcb92dc0bf6398fd5be996ba7ef1c40677b2",
  },
  {
    path: "vendor/bitwarden-clients/apps/browser/src/vault/popup/views/popup-cipher.view.ts",
    sha256: "7a1ab6a828330dfad6af57cd734952be455d61335c187b96a4c4af1674781d72",
  },
  {
    path: "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-copy-action/item-copy-actions.component.ts",
    sha256: "3a26af6b70d974f91193e10644ba8ce7f5ea053ac38a8788eaaa9c0ec39a0bf6",
  },
  {
    path: "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-copy-action/item-copy-actions.component.html",
    sha256: "64a7e87c5e2c47dd547ccc085ac6ab65916abac0b1579a4c9ece7358c73cadc0",
  },
  {
    path: "vendor/bitwarden-clients/libs/vault/src/components/item-copy-actions/item-copy-actions.component.ts",
    sha256: "c5fe689b72a176c342291b20e9b6554c0fe305631d35177264fb60cc8aec76c9",
  },
  {
    path: "vendor/bitwarden-clients/libs/vault/src/components/item-copy-actions/item-copy-actions.component.html",
    sha256: "fd5fc2d88f47982b4a8b39a91ea52652592331a2a5c9c8074f094ea44c905ea5",
  },
] as const;

const retainedOverlayLocks = [
  {
    path: "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.ts",
    sha256: "44f4c72c30c00ba8af046dc8767780a3418e7df7b92482b3dc57f25d8b9d4e74",
    authority: "vault-list-items-container.component.ts",
    retainedTransform: "replace browser/config/account services with section, settings, and single-field action adapters",
  },
  {
    path: "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.html",
    sha256: "58f634b0da213e6b88f8e33222f322e9fc594c59d8632c20698abb0a35490d4a",
    authority: "vault-list-items-container.component.html",
    retainedTransform: "forward retained single-field copy-and-fill actions while removing browser autofill branches",
  },
  {
    path: "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
    sha256: "fc1179633c0fa0e9f3a86db4712f01d1567c32e1ec81871ce7216abc7feea671",
    authority: "vault-list-items-container.component.ts",
    retainedTransform: "host the retained official row and emit guarded single-field copy-and-fill actions",
  },
  {
    path: "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html",
    sha256: "c66d706763020ee1560ecba577e6ef6e54bf40abb118ae144ccee33e70c78ba4",
    authority: "vault-list-items-container.component.html",
    retainedTransform: "compose official item, launch, retained copy-and-fill, and overflow primitives",
  },
  {
    path: "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.ts",
    sha256: "cf22a6af214cb8945b1bf260d63d9e79853e7a8e81ecdebfefcffdb2b45af640",
    authority: "item-more-options.component.ts",
    retainedTransform: "delegate retained actions and remove autofill, collection, premium, and browser services",
  },
  {
    path: "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.html",
    sha256: "fc77e13746f565bf72cd1fff1dff37384b5ce94deaf68da236d2897e560dd653",
    authority: "item-more-options.component.html",
    retainedTransform: "retain View, Favorite, authorized Edit/Clone, Archive, and Delete in official order",
  },
  {
    path: "apps/menubar-tauri/src/app/vault/popup-cipher-view.adapter.ts",
    sha256: "e0793e0f453b3a006c9d27b3757cd8165877259ebb365fb7fb6e07377c22bab4",
    authority: "popup-cipher.view.ts",
    retainedTransform: "project personal list data and fail closed for excluded capabilities and mutations",
  },
] as const;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("retained official Vault list overlays", () => {
  it("pins every upstream list and menu authority", () => {
    for (const authority of upstreamAuthorities) {
      expect(sha256(resolve(root, authority.path)), authority.path).toBe(authority.sha256);
    }
  });

  it("locks every reviewed retained overlay transform byte-for-byte", () => {
    for (const overlay of retainedOverlayLocks) {
      expect(sha256(resolve(root, overlay.path)), overlay.retainedTransform).toBe(overlay.sha256);
      expect(overlay.authority).toMatch(/\.ts$|\.html$/);
      expect(overlay.retainedTransform.length).toBeGreaterThan(30);
    }
  });

  it("provides the guarded list container and more-options overlays", () => {
    for (const path of [
      containerSource,
      containerTemplate,
      rowSource,
      rowTemplate,
      menuSource,
      menuTemplate,
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
  });

  it("directly links the official loading and fade primitives", () => {
    for (const [localDirectory, upstreamDirectory, tsHash, htmlHash] of directVisualPrimitives) {
      for (const [extension, expectedHash] of [["ts", tsHash], ["html", htmlHash]] as const) {
        const filename = `${localDirectory}.component.${extension}`;
        const local = resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/vault-main", localDirectory, filename);
        const upstream = resolve(root, "vendor/bitwarden-clients/apps/browser/src/vault/popup/components", upstreamDirectory, filename);
        expect(lstatSync(local).isSymbolicLink(), local).toBe(true);
        expect(realpathSync(local), local).toBe(upstream);
        expect(sha256(upstream), upstream).toBe(expectedHash);
      }
    }
  });

  it("retains official section, virtual row, item, and menu structure", () => {
    const source = readFileSync(containerSource, "utf8");
    const template = [containerTemplate, rowTemplate]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const menu = readFileSync(menuTemplate, "utf8");

    expect(source).toContain('selector: "app-vault-list-items-container"');
    expect(source).toContain("enabled ? 53 : 59");
    expect(source).toContain("settings.snapshot().compactMode");
    expect(source).not.toContain("of(false)");
    for (const fragment of [
      "tw-group/vault-section-header",
      "cdk-virtual-scroll-viewport",
      "bitScrollLayout",
      "*cdkVirtualFor",
      "<bit-item",
      'data-testid="item-name"',
      "<app-item-more-options",
    ]) {
      expect(template, fragment).toContain(fragment);
    }
    for (const fragment of [
      "onView()",
      "onEdit()",
      "onClone()",
      "onArchive()",
      "onDelete()",
    ]) {
      expect(menu, fragment).toContain(fragment);
    }
    expect(menu).not.toContain("<!--");
    expect(readFileSync(menuSource, "utf8")).toContain("implements OnDestroy");
  });

  it("statically excludes browser, autofill, attachment, organization, collection, and premium branches", () => {
    const retainedGraph = [
      containerSource,
      containerTemplate,
      rowSource,
      rowTemplate,
      menuSource,
      menuTemplate,
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const forbidden of [
      "BrowserApi",
      "BrowserPopupUtils",
      "VaultPopupAutofillService",
      "doAutofill",
      "showAutofill",
      "appOrgIcon",
      "organizationId",
      "hasAttachments",
      "bwi-paperclip",
      "assignToCollections",
      "PremiumBadge",
      "premium-upgrade",
      "chrome.tabs",
      "browser.tabs",
    ]) {
      expect(retainedGraph, forbidden).not.toContain(forbidden);
    }
  });

  it("removes the local section and row selectors from the production route", () => {
    const route = readFileSync(vaultPageSource, "utf8");
    expect(route).toContain("VaultListItemsContainerComponent");
    expect(route).not.toContain("VaultSectionComponent");
    expect(route).not.toContain("<bw-vault-section");
    expect(route).not.toContain("<bw-vault-item-row");
  });

  it("locks the retained official empty and no-results Vault state composition", () => {
    const route = readFileSync(vaultPageSource, "utf8");

    expect(sha256(vaultPageSource)).toBe("5e6d105c337baa365c734cacaad93a79c35626f83ff8ae08ed4fb2f998f57250");
    for (const fragment of [
      "NoResults, VaultOpen",
      "<vault-fade-in-out>",
      "tw-flex tw-flex-col tw-h-full tw-justify-center",
      "[icon]=\"vaultIcon\"",
      "[icon]=\"noResultsIcon\"",
      "tw-flex tw-flex-col tw-justify-center tw-h-auto tw-pt-12",
      "i18nEmptyVaultTitle",
      "i18nEmptyVaultDescription",
      "i18nNoSearchMatches",
      "i18nNoSearchMatchesHint",
      "[queryParams]=\"{ type: '1' }\"",
    ]) {
      expect(route).toContain(fragment);
    }
    expect(route).not.toContain("prefillNameAndURIFromTab");
  });
});
