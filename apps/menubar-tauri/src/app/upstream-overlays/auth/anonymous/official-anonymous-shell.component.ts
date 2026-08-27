import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

import { BitSvg } from "@bitwarden/assets/svg";
import {
  AnonLayoutComponent,
  ContentVerticalPaddingType,
  FooterVerticalPaddingType,
  HeroTextAlignmentType,
  SecondaryContentLocationType,
  SvgModule,
} from "@bitwarden/components";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { I18nPipe } from "@bitwarden/ui-common";

import { PopupHeaderComponent } from "../../../layout/popup-header.component";
import { PopupPageComponent } from "../../../layout/popup-page.component";
import { PopOutComponent } from "../../pop-out/pop-out.component";
import { TauriPopupPlatformUtilsAdapter } from "../../pop-out/platform-utils.adapter";
import { OfficialAnonymousEnvironmentAdapter } from "./official-anonymous-environment.adapter";
import { OfficialI18nService } from "../../../official-ui/official-i18n.service";

/**
 * Guarded overlay of the pinned extension anonymous layout wrapper.
 * Browser route data, account switching, and router outlets are replaced by retained local projection.
 */
@Component({
  selector: "bw-official-anonymous-shell",
  standalone: true,
  imports: [AnonLayoutComponent, CommonModule, I18nPipe, PopupHeaderComponent, PopupPageComponent, PopOutComponent, SvgModule],
  providers: [
    OfficialAnonymousEnvironmentAdapter,
    OfficialI18nService,
    { provide: EnvironmentService, useExisting: OfficialAnonymousEnvironmentAdapter },
    { provide: I18nService, useExisting: OfficialI18nService },
    { provide: PlatformUtilsService, useExisting: TauriPopupPlatformUtilsAdapter },
  ],
  templateUrl: "./official-anonymous-shell.component.html",
})
export class OfficialAnonymousShellComponent {
  @Input() showBackButton = false;
  @Input() backAction: () => void | Promise<void> = () => undefined;
  @Input() pageTitle = "";
  @Input() pageSubtitle = "";
  readonly pageIcon: BitSvg | null = null;
  readonly showReadonlyHostname = false;
  readonly maxWidth = "md" as const;
  readonly hideFooter = false;
  readonly hideCardWrapper = false;
  readonly hidePageIcon = true;
  readonly contentVerticalPadding: ContentVerticalPaddingType | undefined;
  readonly footerVerticalPadding: FooterVerticalPaddingType | undefined;
  readonly heroTextAlignment: HeroTextAlignmentType | undefined;
  readonly secondaryContentLocation: SecondaryContentLocationType = "main";
}
