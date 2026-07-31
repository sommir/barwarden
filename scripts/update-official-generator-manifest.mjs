import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { deriveTypeScriptRuntimeClosure } from "./lib/typescript-runtime-closure.mjs";

const root = process.cwd();
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/generator";
const manifestPath = resolve(root, overlayRoot, "official-generator.transform-manifest.json");
const internalBoundaryPath = "apps/menubar-tauri/official-generator-internal-boundary.json";
const internalBoundary = JSON.parse(readFileSync(resolve(root, internalBoundaryPath), "utf8"));
const authorityPaths = [
  "apps/browser/src/tools/popup/generator/credential-generator.component.ts",
  "apps/browser/src/tools/popup/generator/credential-generator.component.html",
  "libs/tools/generator/components/src/credential-generator.component.ts",
  "libs/tools/generator/components/src/credential-generator.component.html",
  "libs/tools/generator/components/src/password-settings.component.ts",
  "libs/tools/generator/components/src/password-settings.component.html",
  "libs/tools/generator/components/src/passphrase-settings.component.ts",
  "libs/tools/generator/components/src/passphrase-settings.component.html",
  "libs/tools/generator/components/src/username-settings.component.ts",
  "libs/tools/generator/components/src/username-settings.component.html",
  "libs/tools/generator/components/src/subaddress-settings.component.ts",
  "libs/tools/generator/components/src/subaddress-settings.component.html",
  "libs/tools/generator/components/src/catchall-settings.component.ts",
  "libs/tools/generator/components/src/catchall-settings.component.html",
  "apps/browser/src/tools/popup/generator/credential-generator-history.component.ts",
  "apps/browser/src/tools/popup/generator/credential-generator-history.component.html",
  "libs/tools/generator/components/src/credential-generator-history.component.ts",
  "libs/tools/generator/components/src/credential-generator-history.component.html",
  "libs/tools/generator/components/src/empty-credential-history.component.ts",
  "libs/tools/generator/components/src/empty-credential-history.component.html",
];
const runtimePaths = [
  `${overlayRoot}/official-credential-generator.component.ts`,
  `${overlayRoot}/official-credential-generator.component.html`,
  `${overlayRoot}/official-generator-core.component.ts`,
  `${overlayRoot}/official-generator-core.component.html`,
  `${overlayRoot}/official-generator-header-actions.component.ts`,
  "apps/menubar-tauri/src/app/generator/official-generator-core.boundary.ts",
  "apps/menubar-tauri/src/app/generator/official-generator-history.boundary.ts",
  "apps/menubar-tauri/src/app/generator/official-generator-account.adapter.ts",
  "apps/menubar-tauri/src/app/generator/official-credential-generator-service.adapter.ts",
  "apps/menubar-tauri/src/app/generator/official-generator-history.adapter.ts",
  "apps/menubar-tauri/src/app/generator/official-generator-translate.adapter.ts",
  "apps/menubar-tauri/src/app/generator/generator-clipboard.directive.ts",
  "apps/menubar-tauri/src/app/generator/official-generator-toast.adapter.ts",
  "apps/menubar-tauri/src/app/generator/official-generator-log.adapter.ts",
  `${overlayRoot}/official-generator-history.component.ts`,
  `${overlayRoot}/official-generator-history.component.html`,
  `${overlayRoot}/official-generator-history-rows.component.ts`,
  `${overlayRoot}/official-generator-history-rows.component.html`,
  `${overlayRoot}/official-empty-generator-history.component.ts`,
  `${overlayRoot}/official-empty-generator-history.component.html`,
  "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts",
  "apps/menubar-tauri/src/app/generator/generator-history-runtime.port.ts",
  "apps/menubar-tauri/src/app/generator/generator-history-route.owner.ts",
  "apps/menubar-tauri/src/app/generator/official-generator-history-view.adapter.ts",
  internalBoundary.boundary,
];
const aliasSources = [
  ["@bitwarden/generator-overlay/credential-generator", runtimePaths[0]],
  ["@bitwarden/generator-overlay/password-settings", `vendor/bitwarden-clients/${authorityPaths[4]}`],
  ["@bitwarden/generator-overlay/passphrase-settings", `vendor/bitwarden-clients/${authorityPaths[6]}`],
  ["@bitwarden/generator-overlay/username-settings", `vendor/bitwarden-clients/${authorityPaths[8]}`],
  ["@bitwarden/generator-overlay/subaddress-settings", `vendor/bitwarden-clients/${authorityPaths[10]}`],
  ["@bitwarden/generator-overlay/catchall-settings", `vendor/bitwarden-clients/${authorityPaths[12]}`],
  ["@bitwarden/generator-overlay/credential-generator-history", `${overlayRoot}/official-generator-history.component.ts`],
  ["@bitwarden/generator-overlay/credential-generator-history-rows", `${overlayRoot}/official-generator-history-rows.component.ts`],
  ["@bitwarden/generator-overlay/empty-credential-history", `${overlayRoot}/official-empty-generator-history.component.ts`],
  ["@bitwarden/generator-core", "apps/menubar-tauri/src/app/generator/official-generator-core.boundary.ts"],
  ["@bitwarden/generator-history", "apps/menubar-tauri/src/app/generator/official-generator-history.boundary.ts"],
  ["@bitwarden/generator-overlay/color-password", "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-color-password.component.ts"],
  ["@bitwarden/generator-overlay/popup-header-actions", `${overlayRoot}/official-generator-header-actions.component.ts`],
];
const roots = [
  "apps/menubar-tauri/src/app/generator/generator-page.component.ts",
  "apps/menubar-tauri/src/app/generator/generator.service.ts",
  "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts",
];
const aliases = Object.fromEntries(aliasSources.map(([specifier, source]) => [specifier, [source]]));
const closure = deriveTypeScriptRuntimeClosure({
  root,
  roots,
  aliases,
  resolveOverride: ({ importer, specifier }) => resolveInternalBoundary(importer, specifier),
});
const closureMembers = closure.paths.map((path) => ({ path, sha256: hashFile(path) }));

const manifest = {
  version: 2,
  upstreamRevision: "f47b6946e01aed474875789081966d311d5b8289",
  license: "GPL-3.0-only",
  authorities: authorityPaths.map((path) => ({
    path: `vendor/bitwarden-clients/${path}`,
    sha256: hashFile(`vendor/bitwarden-clients/${path}`),
  })),
  localRuntimes: runtimePaths.map((path) => ({ path, sha256: hashFile(path) })),
  aliases: aliasSources.map(([specifier, source]) => ({ specifier, source })),
  ancestryGuard: {
    path: `${overlayRoot}/official-generator-member-transforms.ts`,
    sha256: hashFile(`${overlayRoot}/official-generator-member-transforms.ts`),
  },
  internalBarrelBoundary: {
    path: internalBoundaryPath,
    sha256: hashFile(internalBoundaryPath),
    runtime: internalBoundary.boundary,
    runtimeSha256: hashFile(internalBoundary.boundary),
  },
  productionClosure: {
    roots,
    paths: closure.paths,
    edges: closure.edges,
    members: closureMembers,
    sha256: hashText(JSON.stringify(closureMembers)),
  },
  removedDependencies: [
    "forwarded-email provider graph",
    "browser website/current-tab context",
    "browser copy directive",
    "nudge/spotlight",
    "content/background/native messaging",
    "official StateProvider/SecretState history storage",
    "semantic logger and plaintext debug mode",
    "browser DialogService",
  ],
  localizationKeys: [
    "generatorHistory",
    "clearGeneratorHistoryTitle",
    "cleargGeneratorHistoryDescription",
    "clearHistory",
    "cancel",
    "nothingToShow",
    "nothingGeneratedRecently",
  ],
  memberContracts: [
    "officialGeneratorCoreMemberContract",
    "officialGeneratorHistoryParentMemberContract",
    "officialGeneratorHistoryRowsMemberContract",
    "officialEmptyGeneratorHistoryMemberContract",
  ],
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

function hashFile(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`Missing Generator manifest file: ${path}`);
  }
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function resolveInternalBoundary(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const coreRoot = resolve(root, internalBoundary.coreRoot);
  const importerRelative = relative(coreRoot, importer);
  if (importerRelative.startsWith("..") || resolve(coreRoot, importerRelative) !== importer) return null;
  if (!internalBoundary.importers.includes(importerRelative)) return null;
  const candidate = resolve(dirname(importer), specifier);
  const isPinnedBarrel = internalBoundary.barrels.some((barrel) =>
    candidate === resolve(coreRoot, barrel) || candidate === resolve(coreRoot, barrel, "index.ts"));
  return isPinnedBarrel ? internalBoundary.boundary : null;
}
