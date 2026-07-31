import { DIALOG_DATA } from "@angular/cdk/dialog";
import { Component, inject } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { ButtonModule } from "@bitwarden/components/button/button.module";
import { DialogRef } from "@bitwarden/components/dialog/dialog-ref";
import {
  DialogFooterDirective,
  IconDirective,
  SimpleDialogComponent,
} from "@bitwarden/components/dialog/simple-dialog/simple-dialog.component";
import {
  CenterPositionStrategy,
  DialogService,
} from "@bitwarden/components/dialog/dialog.service";

export type AdvancedUriOptionDialogParams = {
  ariaLabel: string;
  contentKey: string;
  onCancel: () => void;
  onContinue: () => void;
};

@Component({
  templateUrl: "./official-advanced-uri-option-dialog.component.html",
  imports: [
    ButtonModule,
    DialogFooterDirective,
    IconDirective,
    JslibModule,
    SimpleDialogComponent,
  ],
})
export class OfficialAdvancedUriOptionDialogComponent {
  constructor(private dialogRef: DialogRef<boolean>) {}

  protected params = inject<AdvancedUriOptionDialogParams>(DIALOG_DATA);

  get contentKey(): string {
    return this.params.contentKey;
  }

  onCancel() {
    this.params.onCancel?.();
    void this.dialogRef.close(false);
  }

  onContinue() {
    this.params.onContinue?.();
    void this.dialogRef.close(true);
  }

  static open(
    dialogService: DialogService,
    params: AdvancedUriOptionDialogParams,
  ): DialogRef<boolean> {
    const config = {
      data: params,
      disableClose: true,
      positionStrategy: new CenterPositionStrategy(),
      ariaLabel: params.ariaLabel,
    };
    return dialogService.open<boolean>(
      OfficialAdvancedUriOptionDialogComponent,
      config,
    );
  }
}
