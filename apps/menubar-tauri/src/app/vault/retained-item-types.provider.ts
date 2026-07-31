import type { Provider } from "@angular/core";
import { of } from "rxjs";

import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { RestrictedItemTypesService } from "@bitwarden/common/vault/services/restricted-item-types.service";

const restrictedTypes = [
  CipherType.SshKey,
  CipherType.BankAccount,
  CipherType.DriversLicense,
  CipherType.Passport,
].map((cipherType) => ({ cipherType, allowViewOrgIds: [] }));

export const retainedNewItemProviders: readonly Provider[] = [
  {
    provide: RestrictedItemTypesService,
    useValue: { restricted$: of(restrictedTypes) },
  },
  {
    provide: ConfigService,
    useValue: { getFeatureFlag$: () => of(false) },
  },
];
