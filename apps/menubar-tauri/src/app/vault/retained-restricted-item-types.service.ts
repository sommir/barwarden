import type { Observable } from "rxjs";

import type { CipherType } from "@bitwarden/common/vault/enums";

export type RetainedRestrictedCipherType = {
  cipherType: CipherType;
  allowViewOrgIds: string[];
};

export abstract class RestrictedItemTypesService {
  abstract readonly restricted$: Observable<RetainedRestrictedCipherType[]>;
}
