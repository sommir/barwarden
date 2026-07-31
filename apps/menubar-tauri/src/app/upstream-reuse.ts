export const upstreamRevision = "f47b6946e01aed474875789081966d311d5b8289";

export const allowedUpstreamRoots = [
  "vendor/bitwarden-clients/libs/common",
  "vendor/bitwarden-clients/libs/auth",
  "vendor/bitwarden-clients/libs/angular",
  "vendor/bitwarden-clients/libs/tools/generator",
  "vendor/bitwarden-clients/apps/browser/src/popup",
  "vendor/bitwarden-clients/apps/browser/src/platform/popup",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup",
  "vendor/bitwarden-clients/apps/browser/src/tools/popup",
] as const;

export const excludedRuntimeRoots = [
  "vendor/bitwarden-clients/apps/browser/src/autofill/content",
  "vendor/bitwarden-clients/apps/browser/src/autofill/background",
  "vendor/bitwarden-clients/apps/browser/src/vault/content",
] as const;

export { officialSourceMappings } from "./upstream-source-map";
export type { UpstreamReuseMode, UpstreamSourceMapping } from "./upstream-source-map";
