// Official Settings overlay source; generated.
// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, DestroyRef, inject, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { DomainSettingsService } from "@bitwarden/common/autofill/services/domain-settings.service";
import { AnimationControlService } from "@bitwarden/common/platform/abstractions/animation-control.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { Theme, ThemeTypes } from "@bitwarden/common/platform/enums";
import { ThemeStateService } from "@bitwarden/common/platform/theming/theme-state.service";
import {
  CardComponent,
  CheckboxModule,
  FormFieldModule,
  SelectModule,
} from "@bitwarden/components";
import { PermitCipherDetailsPopoverComponent } from "@bitwarden/vault";

import { PopOutComponent } from "../../../platform/popup/components/pop-out.component";
import { PopupCompactModeService } from "../../../platform/popup/layout/popup-compact-mode.service";
import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";
import { VaultPopupCopyButtonsService } from "../services/vault-popup-copy-buttons.service";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "./appearance.component.html",
  imports: [
    CommonModule,
    JslibModule,
    PopupPageComponent,
    PopupHeaderComponent,
    PopOutComponent,
    CardComponent,
    FormFieldModule,
    SelectModule,
    ReactiveFormsModule,
    CheckboxModule,
    PermitCipherDetailsPopoverComponent,
  ],
})
export class AppearanceComponent implements OnInit {
  private compactModeService = inject(PopupCompactModeService);
  private copyButtonsService = inject(VaultPopupCopyButtonsService);

  appearanceForm = this.formBuilder.nonNullable.group({
    enableFavicon: false,
    theme: ThemeTypes.System as Theme,
    enableAnimations: true,
    enableCompactMode: false,
    showQuickCopyActions: false,
  });

  formLoading = true;
  themeOptions: { name: string; value: Theme }[];

  constructor(
    private domainSettingsService: DomainSettingsService,
    private themeStateService: ThemeStateService,
    private formBuilder: FormBuilder,
    private destroyRef: DestroyRef,
    private animationControlService: AnimationControlService,
    i18nService: I18nService,
  ) {
    this.themeOptions = [
      { name: i18nService.t("systemDefault"), value: ThemeTypes.System },
      { name: i18nService.t("light"), value: ThemeTypes.Light },
      { name: i18nService.t("dark"), value: ThemeTypes.Dark },
    ];
  }

  async ngOnInit() {
    const enableFavicon = await firstValueFrom(this.domainSettingsService.showFavicons$);
    const theme = await firstValueFrom(this.themeStateService.selectedTheme$);
    const enableAnimations = await firstValueFrom(
      this.animationControlService.enableRoutingAnimation$,
    );
    const enableCompactMode = await firstValueFrom(this.compactModeService.enabled$);
    const showQuickCopyActions = await firstValueFrom(
      this.copyButtonsService.showQuickCopyActions$,
    );

    this.appearanceForm.setValue({
      enableFavicon,
      theme,
      enableAnimations,
      enableCompactMode,
      showQuickCopyActions,
    });
    this.formLoading = false;

    this.appearanceForm.controls.theme.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((newTheme) => void this.saveTheme(newTheme));
    this.appearanceForm.controls.enableFavicon.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enableFavicon) => void this.updateFavicon(enableFavicon));
    this.appearanceForm.controls.enableAnimations.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enableAnimations) => void this.updateAnimations(enableAnimations));
    this.appearanceForm.controls.enableCompactMode.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enableCompactMode) => void this.updateCompactMode(enableCompactMode));
    this.appearanceForm.controls.showQuickCopyActions.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((showQuickCopyActions) => void this.updateQuickCopyActions(showQuickCopyActions));
  }

  async updateFavicon(enableFavicon: boolean) {
    await this.domainSettingsService.setShowFavicons(enableFavicon);
  }

  async saveTheme(newTheme: Theme) {
    await this.themeStateService.setSelectedTheme(newTheme);
  }

  async updateAnimations(enableAnimations: boolean) {
    await this.animationControlService.setEnableRoutingAnimation(enableAnimations);
  }

  async updateCompactMode(enableCompactMode: boolean) {
    await this.compactModeService.setEnabled(enableCompactMode);
  }

  async updateQuickCopyActions(showQuickCopyActions: boolean) {
    await this.copyButtonsService.setShowQuickCopyActions(showQuickCopyActions);
  }

}
