import { ChangeDetectionStrategy, Component, HostListener } from "@angular/core";

import { AccessibilityPermissionDialogService } from "./accessibility-permission-dialog.service";
import { translateOfficialMessage } from "./official-i18n.service";

@Component({
  selector: "bw-accessibility-permission-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialog.isOpen()) {
      <div class="accessibility-permission-backdrop" (click)="dialog.dismiss()">
        <section
          class="accessibility-permission-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="accessibility-permission-title"
          aria-describedby="accessibility-permission-description"
          (click)="$event.stopPropagation()"
        >
          <div class="accessibility-permission-dialog__icon" aria-hidden="true">
            <i class="bwi bwi-accessibility"></i>
          </div>
          <div class="accessibility-permission-dialog__content">
            <h2 id="accessibility-permission-title">{{ t("i18nAllowAutofill") }}</h2>
            <p id="accessibility-permission-description">
              {{ t("i18nAccessibilityInstructions") }}
            </p>
            @if (dialog.launchFailed()) {
              <p class="accessibility-permission-dialog__error" role="alert">
                {{ t("i18nOpenSystemSettingsFailed") }}
              </p>
            }
          </div>
          <footer class="accessibility-permission-dialog__actions">
            <button
              type="button"
              class="macos-button macos-button--secondary"
              [disabled]="dialog.openingSettings()"
              (click)="dialog.dismiss()"
            >{{ t("i18nLater") }}</button>
            <button
              type="button"
              class="macos-button macos-button--primary"
              [disabled]="dialog.openingSettings()"
              (click)="dialog.openSystemSettings()"
            >{{ t(dialog.openingSettings() ? "i18nOpening" : "i18nGoToSystemSettings") }}</button>
          </footer>
        </section>
      </div>
    }
  `,
})
export class AccessibilityPermissionDialogComponent {
  protected readonly t = translateOfficialMessage;
  constructor(readonly dialog: AccessibilityPermissionDialogService) {}

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.dialog.dismiss();
  }
}
