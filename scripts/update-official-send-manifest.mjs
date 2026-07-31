import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  closureExclusionViolations,
  deriveTypeScriptRuntimeClosure,
} from "./lib/typescript-runtime-closure.mjs";

const root = process.cwd();
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/send";
const manifestPath = resolve(root, overlayRoot, "official-send.transform-manifest.json");
const transformContractPath = `${overlayRoot}/official-send-member-transforms.ts`;

const authorityPaths = [
  "apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html",
  "apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts",
  "apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html",
  "apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts",
  "apps/browser/src/tools/popup/send-v2/send-v2.component.html",
  "apps/browser/src/tools/popup/send-v2/send-v2.component.ts",
  "libs/tools/send/send-ui/src/send-list/send-list.component.ts",
  "libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.html",
  "libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.ts",
  "libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
  "libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts",
  "libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html",
  "libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.ts",
  "libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
  "libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts",
].sort();

const runtimePaths = [
  `${overlayRoot}/official-send-add-edit.component.html`,
  `${overlayRoot}/official-send-add-edit.component.ts`,
  `${overlayRoot}/official-send-created.component.html`,
  `${overlayRoot}/official-send-created.component.ts`,
  `${overlayRoot}/official-send-details.component.html`,
  `${overlayRoot}/official-send-details.component.ts`,
  `${overlayRoot}/official-send-list-items-container.component.html`,
  `${overlayRoot}/official-send-list-items-container.component.ts`,
  `${overlayRoot}/official-send-list.component.html`,
  `${overlayRoot}/official-send-list.component.ts`,
  `${overlayRoot}/official-send-options.component.html`,
  `${overlayRoot}/official-send-options.component.ts`,
  `${overlayRoot}/official-send-raw-template.d.ts`,
  `${overlayRoot}/official-send-text-details.component.html`,
  `${overlayRoot}/official-send-text-details.component.ts`,
  `${overlayRoot}/source-patches/official-send-add-edit.component.html.patch`,
  `${overlayRoot}/source-patches/official-send-add-edit.component.ts.patch`,
  `${overlayRoot}/source-patches/official-send-created.component.ts.patch`,
  `${overlayRoot}/source-patches/official-send-details.component.html.patch`,
  `${overlayRoot}/source-patches/official-send-details.component.ts.patch`,
  `${overlayRoot}/source-patches/official-send-list-items-container.component.ts.patch`,
  `${overlayRoot}/source-patches/official-send-list.component.ts.patch`,
  `${overlayRoot}/source-patches/official-send-options.component.html.patch`,
  `${overlayRoot}/source-patches/official-send-options.component.ts.patch`,
  `${overlayRoot}/source-patches/official-send-text-details.component.html.patch`,
  `${overlayRoot}/source-patches/official-send-text-details.component.ts.patch`,
  transformContractPath,
].sort();

const aliases = [
  ["@bitwarden/send-overlay/add-edit", `${overlayRoot}/official-send-add-edit.component.ts`],
  ["@bitwarden/send-overlay/created", `${overlayRoot}/official-send-created.component.ts`],
  ["@bitwarden/send-overlay/list", `${overlayRoot}/official-send-list.component.ts`],
  ["@bitwarden/send-overlay/list-items", `${overlayRoot}/official-send-list-items-container.component.ts`],
].sort(([left], [right]) => left.localeCompare(right));

const productionRoots = [
  "apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts",
  "apps/menubar-tauri/src/app/send/send-created-page.component.ts",
  "apps/menubar-tauri/src/app/send/send-page.component.ts",
].sort();

const forbiddenClosureRules = [
  { id: "file-send", pattern: "send-file|SendFile|FileReader|upload.*send|download.*send", flags: "i" },
  { id: "premium-billing", pattern: "Billing|PremiumUpgrade|hasPremiumFromAnySource", flags: "i" },
  {
    id: "organization-admin",
    pattern: "OrganizationService|allowedDomains|SpecificPeople",
    flags: "i",
    ignoredContentPaths: ["vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json"],
  },
  {
    id: "browser-runtime",
    pattern: "CurrentAccount|PopOutComponent|nativeMessaging|webRequest|webNavigation|contentScript|browser\\.tabs|chrome\\.tabs",
    flags: "i",
    ignoredContentPaths: ["vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json"],
  },
  {
    id: "sso",
    pattern: "@bitwarden/auth/sso|singleSignOn",
    flags: "i",
    ignoredContentPaths: ["vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json"],
  },
];

const sourcePatchMappings = [
  ["apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html", `${overlayRoot}/official-send-add-edit.component.html`, `${overlayRoot}/source-patches/official-send-add-edit.component.html.patch`],
  ["apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts", `${overlayRoot}/official-send-add-edit.component.ts`, `${overlayRoot}/source-patches/official-send-add-edit.component.ts.patch`],
  ["apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts", `${overlayRoot}/official-send-created.component.ts`, `${overlayRoot}/source-patches/official-send-created.component.ts.patch`],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html", `${overlayRoot}/official-send-details.component.html`, `${overlayRoot}/source-patches/official-send-details.component.html.patch`],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.ts", `${overlayRoot}/official-send-details.component.ts`, `${overlayRoot}/source-patches/official-send-details.component.ts.patch`],
  ["libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.ts", `${overlayRoot}/official-send-list-items-container.component.ts`, `${overlayRoot}/source-patches/official-send-list-items-container.component.ts.patch`],
  ["libs/tools/send/send-ui/src/send-list/send-list.component.ts", `${overlayRoot}/official-send-list.component.ts`, `${overlayRoot}/source-patches/official-send-list.component.ts.patch`],
  ["libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html", `${overlayRoot}/official-send-options.component.html`, `${overlayRoot}/source-patches/official-send-options.component.html.patch`],
  ["libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts", `${overlayRoot}/official-send-options.component.ts`, `${overlayRoot}/source-patches/official-send-options.component.ts.patch`],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html", `${overlayRoot}/official-send-text-details.component.html`, `${overlayRoot}/source-patches/official-send-text-details.component.html.patch`],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts", `${overlayRoot}/official-send-text-details.component.ts`, `${overlayRoot}/source-patches/official-send-text-details.component.ts.patch`],
];

for (const [authority, runtime, patch] of sourcePatchMappings) {
  const result = spawnSync(
    "diff",
    [
      "-U0",
      "--label",
      "authority",
      "--label",
      "runtime",
      resolve(root, "vendor/bitwarden-clients", authority),
      resolve(root, runtime),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 1 || result.error) {
    throw result.error ?? new Error(`Unable to regenerate official Send source patch: ${patch}`);
  }
  writeFileSync(resolve(root, patch), result.stdout);
}

const productionClosure = deriveTypeScriptRuntimeClosure({ root, roots: productionRoots });
const closureViolations = closureExclusionViolations(productionClosure, forbiddenClosureRules);
if (closureViolations.length > 0) {
  throw new Error(`Forbidden official Send runtime closure dependencies:\n${closureViolations.join("\n")}`);
}

const manifest = {
  version: 1,
  upstreamRevision: "f47b6946e01aed474875789081966d311d5b8289",
  license: "GPL-3.0-only",
  authorities: authorityPaths.map((path) => ({
    path: `vendor/bitwarden-clients/${path}`,
    sha256: hashFile(`vendor/bitwarden-clients/${path}`),
  })),
  localRuntimes: runtimePaths.map((path) => ({ path, sha256: hashFile(path) })),
  aliases: aliases.map(([specifier, source]) => ({ specifier, source })),
  transformContract: {
    path: transformContractPath,
    sha256: hashFile(transformContractPath),
  },
  productionRoots,
  forbiddenClosureRules,
  productionClosure: {
    roots: productionClosure.roots,
    paths: productionClosure.paths,
    edges: productionClosure.edges,
    sha256: hashText(JSON.stringify({ paths: productionClosure.paths, edges: productionClosure.edges })),
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

function hashFile(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`Missing official Send manifest file: ${path}`);
  }
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}
