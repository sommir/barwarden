import { NgModule } from "@angular/core";

import { FormControlModule } from "../form-control";
import { InputModule } from "../input/input.module";
import { BitErrorComponent } from "./error.component";
import { BitFormFieldComponent } from "./form-field.component";
import { BitPasswordInputToggleDirective } from "./password-input-toggle.directive";
import { BitPrefixDirective } from "./prefix.directive";
import { BitSuffixDirective } from "./suffix.directive";

const formFieldImports = [
  FormControlModule,
  InputModule,
  BitErrorComponent,
  BitFormFieldComponent,
  BitPasswordInputToggleDirective,
  BitPrefixDirective,
  BitSuffixDirective,
];

@NgModule({
  imports: formFieldImports,
  exports: formFieldImports,
})
export class FormFieldModule {}
