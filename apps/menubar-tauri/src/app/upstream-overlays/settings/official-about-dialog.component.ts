import { Component, EventEmitter, Input, Output, ViewChild } from "@angular/core";
import { DialogModule as CdkDialogModule } from "@angular/cdk/dialog";

import {
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../../official-ui/official-components";
import { AppBottomSheetComponent } from "../../official-ui/app-bottom-sheet.component";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";
import { I18nPipe } from "../../official-ui/official-ui-common";

export type OfficialAboutDialogView = "about" | "troubleshooting";
export type OfficialAboutRevisionCopyStatus = "idle" | "copying" | "copied" | "error";

export interface OfficialAboutDialogMetadata {
  readonly appVersion: string;
  readonly currentWebVaultUrl: string;
  readonly license: string;
  readonly productName: string;
  readonly upstreamRevision: string;
}

@Component({
  selector: "bw-official-about-dialog",
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    ButtonComponent,
    CdkDialogModule,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    MacosAlertStripComponent,
  ],
  templateUrl: "./official-about-dialog.component.html",
})
export class OfficialAboutDialogComponent {
  @ViewChild("metadataDialog") private metadataDialog?: AppBottomSheetComponent;
  @Input({ required: true }) metadata!: Readonly<OfficialAboutDialogMetadata>;
  @Input() revisionCopyStatus: OfficialAboutRevisionCopyStatus = "idle";
  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly copyRevision = new EventEmitter<void>();

  private currentView: OfficialAboutDialogView | null = null;

  @Input({ required: true })
  set view(value: OfficialAboutDialogView | null) {
    this.currentView = value;
    this.syncDialogState();
  }

  get view(): OfficialAboutDialogView | null {
    return this.currentView;
  }

  requestClose(event?: Event): void {
    event?.preventDefault();
    this.closeDialog();
    this.close.emit();
  }

  onDialogClick(event: Event): void {
    if (event.target instanceof Element && event.target.closest("button")?.querySelector(".bwi-close")) {
      this.requestClose();
    }
  }

  private syncDialogState(): void {
    const sheet = this.metadataDialog;
    if (!sheet) {
      return;
    }
    if (this.currentView) {
      if (!sheet.nativeElement.open) {
        sheet.open();
      }
      return;
    }
    this.closeDialog();
  }

  private closeDialog(): void {
    this.metadataDialog?.close();
  }
}
