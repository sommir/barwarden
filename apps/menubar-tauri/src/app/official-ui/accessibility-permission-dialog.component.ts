import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  ViewChild,
} from "@angular/core";

import { AppBottomSheetComponent } from "./app-bottom-sheet.component";
import { AccessibilityPermissionDialogService } from "./accessibility-permission-dialog.service";
import { MacosAlertStripComponent } from "./macos-alert-strip.component";
import { translateOfficialMessage } from "./official-i18n.service";

@Component({
  selector: "bw-accessibility-permission-dialog",
  standalone: true,
  imports: [AppBottomSheetComponent, MacosAlertStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bw-app-bottom-sheet
      #sheet
      testId="accessibility-permission-sheet"
      labelledBy="accessibility-permission-title"
      describedBy="accessibility-permission-description"
      [disableClose]="dialog.openingSettings()"
      (dismissed)="dialog.dismiss()"
    >
      <h2 id="accessibility-permission-title">{{ t("i18nAllowAutofill") }}</h2>
      <p id="accessibility-permission-description">{{ t("i18nAccessibilityInstructions") }}</p>
      @if (dialog.launchFailed()) {
        <bw-macos-alert-strip
          urgency="assertive"
          [message]="t('i18nOpenSystemSettingsFailed')"
        />
      }
      <footer [attr.aria-busy]="dialog.openingSettings()">
        <button
          #later
          type="button"
          data-testid="accessibility-later"
          [disabled]="dialog.openingSettings()"
          (click)="dialog.dismiss()"
        >{{ t("i18nLater") }}</button>
        <button
          type="button"
          data-testid="accessibility-settings"
          [disabled]="dialog.openingSettings()"
          (click)="dialog.openSystemSettings()"
        >{{ t(dialog.openingSettings() ? "i18nOpening" : "i18nGoToSystemSettings") }}</button>
      </footer>
    </bw-app-bottom-sheet>
  `,
})
export class AccessibilityPermissionDialogComponent {
  @ViewChild("sheet") private sheet?: AppBottomSheetComponent;
  @ViewChild("later", { read: ElementRef }) private later?: ElementRef<HTMLButtonElement>;
  protected readonly t = translateOfficialMessage;

  constructor(readonly dialog: AccessibilityPermissionDialogService) {
    effect(() => {
      const isOpen = this.dialog.isOpen();
      const trigger = this.dialog.trigger();
      if (isOpen) {
        this.sheet?.open(trigger, this.later?.nativeElement);
      } else if (this.sheet?.nativeElement.open) {
        this.sheet.close();
      }
    });
  }
}
