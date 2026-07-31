import { Component } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import {
  BitIconButtonComponent,
  BottomNavigationComponent,
  ButtonComponent,
  SectionComponent,
  TypographyDirective,
} from "./official-components";
import { OfficialI18nService } from "./official-i18n.service";
import { I18nPipe } from "./official-ui-common";

@Component({
  selector: "bw-official-ui-pilot",
  imports: [
    ButtonComponent,
    BitIconButtonComponent,
    TypographyDirective,
    SectionComponent,
    BottomNavigationComponent,
    I18nPipe,
  ],
  providers: [
    OfficialI18nService,
    { provide: I18nService, useExisting: OfficialI18nService },
  ],
  template: `
    <bit-section>
      <h1 bitTypography="h3">{{ "i18nOfficialUiPrimitives" | i18n }}</h1>

      <button bitButton type="button">{{ "continue" | i18n }}</button>
      <button bitButton type="button" disabled>{{ "i18nUnavailable" | i18n }}</button>
      <button
        bitIconButton="bwi-plus"
        data-testid="official-icon-button"
        [label]="'add' | i18n"
        type="button"
      ></button>
    </bit-section>

    <bit-bottom-navigation />
  `,
})
export class OfficialUiPilotComponent {}
