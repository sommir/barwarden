import type { Observable } from "rxjs";

import type { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import type { RetainedOfficialPersonalCipherFormConfig } from "../../vault/retained-personal-cipher-form.adapter";
import type { OfficialCardDetailsSectionComponent } from "./official-card-details-section.component";
import type { OfficialIdentitySectionComponent } from "./official-identity-section.component";
import type { OfficialPersonalAdditionalOptionsComponent } from "./official-personal-additional-options.component";
import type { OfficialPersonalCustomFieldsComponent } from "./official-personal-custom-fields.component";
import type { OfficialPersonalItemDetailsComponent } from "./official-personal-item-details.component";

export type OfficialPersonalForm = {
  itemDetails?: OfficialPersonalItemDetailsComponent["itemDetailsForm"];
  cardDetails?: OfficialCardDetailsSectionComponent["cardDetailsForm"];
  identityDetails?: OfficialIdentitySectionComponent["identityForm"];
  additionalOptions?: OfficialPersonalAdditionalOptionsComponent["additionalOptionsForm"];
  customFields?: OfficialPersonalCustomFieldsComponent["customFieldsForm"];
};

export abstract class OfficialPersonalFormContainer {
  readonly config: RetainedOfficialPersonalCipherFormConfig;
  readonly originalCipherView: CipherView | null;
  readonly canViewSecrets: boolean;

  abstract registerChildForm<K extends keyof OfficialPersonalForm>(
    name: K,
    group: Exclude<OfficialPersonalForm[K], undefined>,
  ): void;

  abstract get website(): string | null;

  abstract patchCipher(updateFn: (current: CipherView) => CipherView): void;

  abstract getInitialCipherView(): CipherView | null;

  abstract initializedWithCachedCipher(): boolean;

  abstract disableFormFields(): void;

  abstract enableFormFields(): void;

  readonly formStatusChange$: Observable<"enabled" | "disabled">;
}
