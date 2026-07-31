import { resolve } from "node:path";

export const officialPersonalDetailAliasSources = [
  ["@bitwarden/vault/cipher-view/cipher-view.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/cipher-view.component.ts"],
  ["@bitwarden/vault/cipher-view/item-details/item-details-v2.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts"],
  ["@bitwarden/vault/cipher-view/card-details/card-details-view.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.ts"],
  ["@bitwarden/vault/cipher-view/view-identity-sections/view-identity-sections.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts"],
  ["@bitwarden/vault/cipher-view/read-only-cipher-card/read-only-cipher-card.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.ts"],
  ["@bitwarden/vault/cipher-view/additional-options/additional-options.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts"],
  ["@bitwarden/vault/cipher-view/custom-fields/custom-fields-v2.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts"],
  ["@bitwarden/vault/cipher-view/item-history/item-history-v2.component", "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts"],
  ["@bitwarden/vault/pipes/credit-card-number.pipe", "vendor/bitwarden-clients/libs/vault/src/pipes/credit-card-number.pipe.ts"],
  ["@bitwarden/common/autofill/utils", "vendor/bitwarden-clients/libs/common/src/autofill/utils/index.ts"],
  ["@bitwarden/common/vault/models/view/card.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/card.view.ts"],
  ["@bitwarden/common/vault/models/view/identity.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/identity.view.ts"],
  ["@bitwarden/common/vault/models/view/secure-note.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/secure-note.view.ts"],
  ["@bitwarden/common/vault/models/view/cipher.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/cipher.view.ts"],
  ["@bitwarden/common/vault/models/view/field.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/field.view.ts"],
  ["@bitwarden/common/vault/models/view/folder.view", "vendor/bitwarden-clients/libs/common/src/vault/models/view/folder.view.ts"],
  ["@bitwarden/common/vault/enums/linked-id-type.enum", "vendor/bitwarden-clients/libs/common/src/vault/enums/linked-id-type.enum.ts"],
] as const;

export interface OfficialPersonalDetailAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

export function buildOfficialPersonalDetailAliases(
  projectRoot: string,
): OfficialPersonalDetailAlias[] {
  return officialPersonalDetailAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(projectRoot, source),
  }));
}
