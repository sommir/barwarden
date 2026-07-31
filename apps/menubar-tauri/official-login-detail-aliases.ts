import { resolve } from "node:path";

export const officialLoginDetailAliasSources = [
  ["@bitwarden/storage-core", "vendor/bitwarden-clients/libs/storage-core/src/index.ts"],
  ["@bitwarden/key-management", "apps/menubar-tauri/src/app/official-ui/official-key-management.adapter.ts"],
  ["@bitwarden/guid", "vendor/bitwarden-clients/libs/guid/src/index.ts"],
  ["@bitwarden/user-core", "vendor/bitwarden-clients/libs/user-core/src/index.ts"],
  ["@bitwarden/official-login-detail/item-details", "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts"],
  ["@bitwarden/official-login-detail/login-credentials", "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.ts"],
  ["@bitwarden/official-login-detail/uri-options", "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.ts"],
  ["@bitwarden/official-login-detail/additional-options", "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts"],
  ["@bitwarden/official-login-detail/custom-fields", "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts"],
  ["@bitwarden/official-login-detail/item-history", "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts"],
] as const;

export interface OfficialLoginDetailAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

export function buildOfficialLoginDetailAliases(projectRoot: string): OfficialLoginDetailAlias[] {
  return officialLoginDetailAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(projectRoot, source),
  }));
}
