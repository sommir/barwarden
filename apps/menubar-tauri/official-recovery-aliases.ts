import { resolve } from "node:path";

export const officialRecoveryAliasSources = [
  ["@bitwarden/common/vault/models/view/cipher.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/cipher.view.ts"],
  ["@bitwarden/common/vault/models/view/folder.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/folder.view.ts"],
  ["@bitwarden/common/vault/models/view/password-history.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/password-history.view.ts"],
] as const;

export interface OfficialRecoveryAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

export function buildOfficialRecoveryAliases(projectRoot: string): OfficialRecoveryAlias[] {
  return officialRecoveryAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(projectRoot, source),
  }));
}
