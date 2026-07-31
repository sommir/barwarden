import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Output, ViewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import {
  BitFormFieldComponent,
  BitHintDirective,
  BitInputDirective,
  BitLabelComponent,
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
  IconComponent,
} from "../../../official-ui/official-components";
import { AppBottomSheetComponent } from "../../../official-ui/app-bottom-sheet.component";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { I18nPipe } from "@bitwarden/ui-common";

import { normalizeRetainedSelfHostedBaseUrl } from "../../../auth/official-environment.adapter";
import { OfficialI18nService } from "../../../official-ui/official-i18n.service";

/** Guarded overlay of the pinned self-hosted dialog with endpoint expansion and development bypass removed. */
@Component({
  selector: "bw-official-self-hosted-dialog",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitHintDirective,
    BitInputDirective,
    BitLabelComponent,
    ButtonComponent,
    DialogComponent,
    DialogFooterDirective,
    IconComponent,
    I18nPipe,
    ReactiveFormsModule,
    AppBottomSheetComponent,
  ],
  providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
  templateUrl: "./official-self-hosted-dialog.component.html",
})
export class OfficialSelfHostedDialogComponent {
  @Output() readonly saved = new EventEmitter<string>();
  @Output() readonly dismissed = new EventEmitter<void>();
  @ViewChild("dialog") private dialog?: AppBottomSheetComponent;
  @ViewChild("baseUrlInput") private baseUrlInput?: ElementRef<HTMLInputElement>;

  readonly formGroup = this.formBuilder.group({ baseUrl: ["", [Validators.required]] });
  showErrorSummary = false;
  isOpen = false;

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  open(trigger: HTMLElement, serverUrl = "", deferFocusUntilClick = false): void {
    this.formGroup.setValue({ baseUrl: serverUrl });
    this.showErrorSummary = false;
    this.isOpen = true;
    this.changeDetectorRef.detectChanges();
    const input = this.baseUrlInput?.nativeElement;
    if (this.dialog && input) {
      this.dialog.open(trigger, input, deferFocusUntilClick);
    }
  }

  submit(event: Event): void {
    event.preventDefault();
    const normalizedServerUrl = normalizeRetainedSelfHostedBaseUrl(this.formGroup.controls.baseUrl.value ?? "");
    if (!normalizedServerUrl) {
      this.showErrorSummary = true;
      return;
    }
    this.showErrorSummary = false;
    this.isOpen = false;
    this.dialog?.close();
    this.saved.emit(normalizedServerUrl);
  }

  cancel(): void {
    this.isOpen = false;
    this.dialog?.close();
    this.dismissed.emit();
  }

  onDismissed(): void {
    this.isOpen = false;
    this.dismissed.emit();
  }

  onClose(): void {
    this.isOpen = false;
  }
}
