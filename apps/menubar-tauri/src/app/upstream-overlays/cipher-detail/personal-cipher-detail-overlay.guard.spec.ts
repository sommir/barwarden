import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOfficialPersonalDetailAliases,
  officialPersonalDetailAliasSources,
} from "../../../../official-personal-detail-aliases";

const root = process.cwd();
const revision = "f47b6946e01aed474875789081966d311d5b8289";
const manifestPath = resolve(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json",
);
const expectedAuthorities = [
  "apps/browser/src/vault/popup/components/vault/view/view.component.ts",
  "apps/browser/src/vault/popup/components/vault/view/view.component.html",
  "libs/vault/src/cipher-view/cipher-view.component.ts",
  "libs/vault/src/cipher-view/cipher-view.component.html",
  "libs/vault/src/cipher-view/item-details/item-details-v2.component.ts",
  "libs/vault/src/cipher-view/item-details/item-details-v2.component.html",
  "libs/vault/src/cipher-view/card-details/card-details-view.component.ts",
  "libs/vault/src/cipher-view/card-details/card-details-view.component.html",
  "libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts",
  "libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.html",
  "libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.ts",
  "libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.html",
  "libs/vault/src/cipher-view/additional-options/additional-options.component.ts",
  "libs/vault/src/cipher-view/additional-options/additional-options.component.html",
  "libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts",
  "libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.html",
  "libs/vault/src/cipher-view/item-history/item-history-v2.component.ts",
  "libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
  "libs/vault/src/pipes/credit-card-number.pipe.ts",
  "libs/common/src/autofill/utils/index.ts",
  "libs/common/src/vault/models/view/card.view.ts",
  "libs/common/src/vault/models/view/identity.view.ts",
  "libs/common/src/vault/models/view/secure-note.view.ts",
  "libs/common/src/vault/models/view/cipher.view.ts",
  "libs/common/src/vault/models/view/field.view.ts",
  "libs/common/src/vault/models/view/folder.view.ts",
  "libs/common/src/vault/enums/index.ts",
  "libs/common/src/vault/enums/linked-id-type.enum.ts",
  "libs/common/src/vault/types/union-of-values.ts",
] as const;
const expectedRuntimePaths = [
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.html",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-card-details.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-card-details.component.html",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-identity-sections.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-identity-sections.component.html",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-read-only-cipher-card.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-read-only-cipher-card.component.html",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-credit-card-number.pipe.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-custom-fields.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-custom-fields.component.html",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-details.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-details.component.html",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-additional-options.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-additional-options.component.html",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.html",
] as const;
const expectedTransforms = [
  {
    authority: "libs/vault/src/cipher-view/cipher-view.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.html",
  },
  {
    authority: "libs/vault/src/cipher-view/card-details/card-details-view.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-card-details.component.ts",
  },
  {
    authority: "libs/vault/src/cipher-view/card-details/card-details-view.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-card-details.component.html",
  },
  {
    authority: "libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-identity-sections.component.ts",
  },
  {
    authority: "libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-identity-sections.component.html",
  },
  {
    authority: "libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-read-only-cipher-card.component.ts",
  },
  {
    authority: "libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-read-only-cipher-card.component.html",
  },
  {
    authority: "libs/vault/src/pipes/credit-card-number.pipe.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-credit-card-number.pipe.ts",
  },
] as const;
const excludedTokens = [
  "BrowserApi", "chrome.", "VaultPopupAutofillService", "BrowserPopupUtils",
  "AttachmentsV2ViewComponent", "CipherAttachmentsComponent", "Fido2CredentialView",
  "SshKeyViewComponent", "BankAccountViewComponent", "DriversLicenseViewComponent",
  "PassportViewComponent", "PremiumUpgradePromptService", "BillingAccountProfileStateService",
  "EventCollectionService", "CollectionService", "PolicyService", "nativeMessaging",
] as const;

describe("official personal detail source foundation", () => {
  it("pins every declared authority and GPL boundary to the vendored revision", () => {
    const manifest = readManifest();

    expect(readFileSync(resolve(root, "vendor/bitwarden-clients/.source-revision"), "utf8"))
      .toContain(revision);
    expect(manifest.revision).toBe(revision);
    expect(manifest.authorities.map(({ path }) => path)).toEqual(expectedAuthorities);
    for (const authority of manifest.authorities) {
      expect(sha256(resolve(root, "vendor/bitwarden-clients", authority.path))).toBe(
        authority.sha256,
      );
    }
    expect(manifest.license).toEqual({
      rootPackageSha256: sha256(resolve(root, "package.json")),
      rootLicenseSha256: sha256(resolve(root, "LICENSE")),
      upstreamPackageSha256: sha256(resolve(root, "vendor/bitwarden-clients/package.json")),
      upstreamGplSha256: sha256(resolve(root, "vendor/bitwarden-clients/LICENSE_GPL.txt")),
    });
  });

  it("uses fully anchored aliases with exact first-match resolution", () => {
    const manifest = readManifest();
    const aliases = buildOfficialPersonalDetailAliases(root);

    expect(Object.fromEntries(officialPersonalDetailAliasSources)).toEqual(manifest.aliases);
    for (const [specifier, source] of Object.entries(manifest.aliases)) {
      const first = aliases.find(({ find }) => find.test(specifier));
      expect(first?.replacement).toBe(resolve(root, source));
      expect(first?.find.test(`${specifier}/sibling`)).toBe(false);
      expect(aliases.filter(({ find }) => find.test(specifier))).toHaveLength(1);
    }
  });

  it("pins the retained personal runtime closure and excludes unsupported graph tokens", () => {
    const manifest = readManifest();
    const production = [
      readFileSync(resolve(root, "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.ts"), "utf8"),
      readFileSync(resolve(root, "apps/menubar-tauri/official-personal-detail-aliases.ts"), "utf8"),
      ...manifest.runtimes.map(({ path }) => readFileSync(resolve(root, path), "utf8")),
    ].join("\n");

    expect(manifest.runtimes.map(({ path }) => path)).toEqual(expectedRuntimePaths);
    for (const runtime of manifest.runtimes) {
      expect(sha256(resolve(root, runtime.path)), runtime.path).toBe(runtime.sha256);
    }
    expect(manifest.transforms.map(({ authority, runtime }) => ({ authority, runtime })))
      .toEqual(expectedTransforms);
    for (const transform of manifest.transforms) {
      expect(transform.allowedDifferences.length).toBeGreaterThan(0);
    }
    expect(manifest.i18nKeys).toEqual([
      "additionalOptions", "address", "cardBrandDetails", "cardDetails", "cardExpiredMessage",
      "cardExpiredTitle", "cardholderName",
      "cfTypeLinked", "company", "contactInfo", "copyAddress", "copyCardholderName",
      "copyCompany", "copyCustomField", "copyEmail", "copyLicenseNumber", "copyName",
      "copyNotes", "copyNumber", "copyPassportNumber", "copyPhone", "copySecurityCode",
      "copySSN", "customFields", "dateCreated", "email", "expiration", "identification",
      "itemHistory", "lastEdited", "licenseNumber", "name", "noValueEntered", "note",
      "number", "passportNumber", "personalDetails", "phone", "securityCode",
      "showCharacterCount", "ssn", "username",
    ]);
    expect(manifest.closure.roots).toEqual([
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.ts",
    ]);
    expect(manifest.closure.edges).toEqual(expectedRuntimePaths);
    expect(manifest.closure.sha256).toBe(sha256Text(expectedRuntimePaths.join("\n")));
    expect(manifest.excludedTokens).toEqual(excludedTokens);
    for (const token of excludedTokens) {
      expect(production).not.toContain(token);
    }

    const rootComponent = readFileSync(resolve(root, expectedRuntimePaths[0]), "utf8");
    const rootTemplate = readFileSync(resolve(root, expectedRuntimePaths[1]), "utf8");
    expect(rootComponent).toContain("isCardExpired(this.projection.cipher.card)");
    expect(rootTemplate).toContain("<bw-macos-alert-strip");
    expect(rootTemplate).toContain("cardExpiredTitle");
    expect(rootTemplate).toContain("cardExpiredMessage");
  });

  it("installs the exact alias builder before broad Vite aliases", () => {
    const vite = readFileSync(resolve(root, "apps/menubar-tauri/vite.config.ts"), "utf8");

    expect(vite).toContain("buildOfficialPersonalDetailAliases");
    expect(vite.indexOf("...buildOfficialPersonalDetailAliases")).toBeLessThan(
      vite.indexOf('find: "@bitwarden/common"'),
    );
  });
});

type Manifest = {
  revision: string;
  license: Record<string, string>;
  authorities: { path: string; sha256: string }[];
  aliases: Record<string, string>;
  runtimes: { path: string; sha256: string }[];
  transforms: { authority: string; runtime: string; allowedDifferences: string[] }[];
  i18nKeys: string[];
  closure: { roots: string[]; edges: string[]; sha256: string };
  excludedTokens: string[];
};

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
