import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { officialSettingsClosureExclusions } from "../apps/menubar-tauri/official-settings-aliases.ts";

const root = resolve(import.meta.dirname, "..");
const vendorRoot = resolve(root, "vendor/bitwarden-clients");
const sourceManifestPath = "apps/menubar-tauri/official-settings-source-manifest.json";
const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/settings";
const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";
const authorityPaths = [
  "apps/browser/src/tools/popup/settings/settings-v2.component.ts",
  "apps/browser/src/tools/popup/settings/settings-v2.component.html",
  "apps/browser/src/auth/popup/settings/account-security.component.ts",
  "apps/browser/src/auth/popup/settings/account-security.component.html",
  "apps/browser/src/vault/popup/settings/vault-settings.component.ts",
  "apps/browser/src/vault/popup/settings/vault-settings.component.html",
  "apps/browser/src/vault/popup/settings/appearance.component.ts",
  "apps/browser/src/vault/popup/settings/appearance.component.html",
  "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts",
  "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html",
  "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts",
  "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html",
];

const revision = readFileSync(resolve(vendorRoot, "UI_SOURCE_COMMIT"), "utf8").trim();
if (revision !== pinnedRevision) throw new Error(`Pinned Bitwarden revision drift: ${revision}`);

const sourceManifest = JSON.parse(readFileSync(resolve(root, sourceManifestPath), "utf8"));
if (sourceManifest.version !== 1 || sourceManifest.upstreamRevision !== pinnedRevision) {
  throw new Error("Settings source manifest revision drift");
}
if (JSON.stringify(sourceManifest.authorities?.map(({ path }) => path)) !== JSON.stringify(authorityPaths)) {
  throw new Error("Settings source manifest authority inventory drift");
}
for (const { path, sha256 } of sourceManifest.authorities) {
  const authority = resolve(vendorRoot, path);
  if (!existsSync(authority)) throw new Error(`Missing pinned Settings authority: ${path}`);
  const actual = createHash("sha256").update(readFileSync(authority)).digest("hex");
  if (actual !== sha256) throw new Error(`Pinned Settings authority hash drift: ${path}`);
}

const upstreamConfig = JSON.parse(
  readFileSync(resolve(root, "apps/menubar-tauri/tsconfig.official-settings-upstream.json"), "utf8"),
);
const expectedTypecheckAuthorities = authorityPaths
  .filter((authority) => authority.endsWith(".ts"))
  .map((authority) => `src/app/upstream-overlays/settings/generated/${authority}`)
  .concat("official-settings-upstream.edges.ts");
if (upstreamConfig.extends !== "../../tsconfig.json") {
  throw new Error("Upstream Settings source check no longer extends the application config");
}
if (upstreamConfig.compilerOptions?.noCheck === true) {
  throw new Error("Upstream Settings typecheck must retain semantic source diagnostics");
}
if (upstreamConfig.compilerOptions?.noResolve === true) {
  throw new Error("Upstream Settings typecheck must resolve exact dependency contracts");
}
if (JSON.stringify(upstreamConfig.files) !== JSON.stringify(expectedTypecheckAuthorities)) {
  throw new Error("Upstream Settings typecheck authority inventory drift");
}
if (existsSync(resolve(root, "apps/menubar-tauri/official-settings-upstream.compatibility.d.ts"))) {
  throw new Error("Wildcard Settings compatibility declaration must not exist");
}

const edgeContractPath = resolve(root, "apps/menubar-tauri/official-settings-upstream.edges.ts");
const edgeContract = readFileSync(edgeContractPath, "utf8");
const edgeTypeRoot = resolve(root, `${overlayRoot}/upstream-edge-types`);
for (const path of [edgeContractPath, ...filesBelow(edgeTypeRoot)]) {
  const source = readFileSync(path, "utf8");
  if (/\bany\b/.test(source) || /declare\s+module\s+["']\*["']/.test(source)) {
    throw new Error(`Unbounded Settings edge type: ${relative(root, path)}`);
  }
  for (const exclusion of officialSettingsClosureExclusions) {
    if (new RegExp(exclusion.pattern, exclusion.flags).test(source)) {
      throw new Error(
        `Settings closure exclusion ${exclusion.id} survived edge types: ${relative(root, path)}`,
      );
    }
  }
}

for (const authority of authorityPaths) {
  const generatedPath = resolve(root, `${overlayRoot}/generated/${authority}`);
  const generated = readFileSync(generatedPath, "utf8");
  for (const exclusion of officialSettingsClosureExclusions) {
    if (new RegExp(exclusion.pattern, exclusion.flags).test(generated)) {
      throw new Error(`Settings closure exclusion ${exclusion.id} survived: ${authority}`);
    }
  }
  if (!authority.endsWith(".ts")) continue;
  const edgeSpecifiers = [...generated.matchAll(/from\s+["'](@bitwarden\/[^"']+)["']/g)].map(
    ([, specifier]) => specifier,
  );
  for (const specifier of edgeSpecifiers) {
    if (!edgeContract.includes(`declare module "${specifier}"`)) {
      throw new Error(`Missing exact Settings edge declaration: ${specifier}`);
    }
  }
}

console.log(`Pinned upstream Settings source check passed at ${pinnedRevision}`);

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
