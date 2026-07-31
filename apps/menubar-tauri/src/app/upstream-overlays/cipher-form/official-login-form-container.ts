import type { Observable } from "rxjs";

import type { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import type { RetainedOfficialCipherFormConfig } from "../../vault/retained-login-form.adapter";
import type { OfficialAdditionalOptionsComponent } from "./official-additional-options.component";
import type { OfficialAutofillOptionsComponent } from "./official-autofill-options.component";
import type { OfficialCustomFieldsComponent } from "./official-custom-fields.component";
import type { OfficialLoginDetailsComponent } from "./official-login-details.component";
import type { OfficialLoginItemDetailsComponent } from "./official-login-item-details.component";

export type OfficialLoginForm = {
  itemDetails?: OfficialLoginItemDetailsComponent["itemDetailsForm"];
  additionalOptions?: OfficialAdditionalOptionsComponent["additionalOptionsForm"];
  loginDetails?: OfficialLoginDetailsComponent["loginDetailsForm"];
  autoFillOptions?: OfficialAutofillOptionsComponent["autofillOptionsForm"];
  customFields?: OfficialCustomFieldsComponent["customFieldsForm"];
};

export abstract class OfficialLoginFormContainer {
  readonly config: RetainedOfficialCipherFormConfig;
  readonly originalCipherView: CipherView | null;
  readonly canViewSecrets: boolean;

  abstract registerChildForm<K extends keyof OfficialLoginForm>(
    name: K,
    group: Exclude<OfficialLoginForm[K], undefined>,
  ): void;

  abstract get website(): string | null;

  abstract patchCipher(updateFn: (current: CipherView) => CipherView): void;

  abstract getInitialCipherView(): CipherView | null;

  abstract initializedWithCachedCipher(): boolean;

  abstract disableFormFields(): void;

  abstract enableFormFields(): void;

  formStatusChange$: Observable<"enabled" | "disabled">;
}
