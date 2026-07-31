import { DragDropModule } from "@angular/cdk/drag-drop";
import {
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  Input,
  Output,
  ViewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  ControlValueAccessor,
  FormBuilder,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from "@angular/forms";
import { concatMap, pairwise } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import {
  UriMatchStrategy,
  UriMatchStrategySetting,
} from "@bitwarden/common/models/domain/domain-service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogService } from "@bitwarden/components/dialog/dialog.service";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { SelectComponent } from "@bitwarden/components/select/select.component";
import { SelectModule } from "@bitwarden/components/select/select.module";

import { OfficialAdvancedUriOptionDialogComponent } from "./official-advanced-uri-option-dialog.component";

@Component({
  selector: "vault-autofill-uri-option",
  templateUrl: "./official-uri-option.component.html",
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => OfficialUriOptionComponent),
      multi: true,
    },
  ],
  imports: [
    DragDropModule,
    FormFieldModule,
    ReactiveFormsModule,
    IconButtonModule,
    JslibModule,
    SelectModule,
  ],
})
export class OfficialUriOptionComponent implements ControlValueAccessor {
  @ViewChild("uriInput")
  private inputElement: ElementRef<HTMLInputElement>;

  @ViewChild("matchDetectionSelect")
  private matchDetectionSelect: SelectComponent<UriMatchStrategySetting>;

  protected uriForm = this.formBuilder.group({
    uri: [null as string],
    matchDetection: [null as UriMatchStrategySetting],
  });

  protected uriMatchOptions: {
    label: string;
    value: UriMatchStrategySetting;
    disabled?: boolean;
  }[] = [
    { label: this.i18nService.t("default"), value: null },
    { label: this.i18nService.t("baseDomain"), value: UriMatchStrategy.Domain },
    { label: this.i18nService.t("host"), value: UriMatchStrategy.Host },
    { label: this.i18nService.t("exact"), value: UriMatchStrategy.Exact },
    { label: this.i18nService.t("never"), value: UriMatchStrategy.Never },
    {
      label: this.i18nService.t("uriAdvancedOption"),
      value: null,
      disabled: true,
    },
    {
      label: this.i18nService.t("startsWith"),
      value: UriMatchStrategy.StartsWith,
    },
    {
      label: this.i18nService.t("regEx"),
      value: UriMatchStrategy.RegularExpression,
    },
  ];

  protected advancedOptionWarningMap: Partial<
    Record<UriMatchStrategySetting, string>
  > = {
    [UriMatchStrategy.StartsWith]: "startsWithAdvancedOptionWarning",
    [UriMatchStrategy.RegularExpression]: "regExAdvancedOptionWarning",
  };

  @Input({ required: true })
  canReorder: boolean;

  @Input({ required: true })
  canRemove: boolean;

  @Input({ required: true })
  set defaultMatchDetection(value: UriMatchStrategySetting) {
    if (value === null) {
      return;
    }

    this.uriMatchOptions[0].label = this.i18nService.t(
      "defaultLabelWithValue",
      this.uriMatchOptions.find((o) => o.value === value)?.label,
    );
  }

  @Input({ required: true }) index: number;

  @Output()
  onKeydown = new EventEmitter<KeyboardEvent>();

  @Output()
  remove = new EventEmitter<void>();

  protected showMatchDetection = false;

  protected toggleMatchDetection() {
    this.showMatchDetection = !this.showMatchDetection;
    if (this.showMatchDetection) {
      setTimeout(() => this.matchDetectionSelect?.select()?.focus(), 0);
    }
  }

  protected get uriLabel() {
    return this.index === 0
      ? this.i18nService.t("websiteUri")
      : this.i18nService.t("websiteUriCount", this.index + 1);
  }

  protected get toggleTitle() {
    return this.i18nService.t(
      this.showMatchDetection
        ? "hideMatchDetectionNoPlaceholder"
        : "showMatchDetectionNoPlaceholder",
    );
  }

  private onChange: any = () => {};
  private onTouched: any = () => {};

  protected handleKeydown(event: KeyboardEvent) {
    this.onKeydown.emit(event);
  }

  constructor(
    private dialogService: DialogService,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
  ) {
    this.uriForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.onChange(value);
    });

    this.uriForm.statusChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.onTouched();
    });

    this.uriForm.controls.matchDetection.valueChanges
      .pipe(
        pairwise(),
        concatMap(([previous, current]) =>
          this.handleAdvancedMatch(previous, current),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  private async handleAdvancedMatch(
    previous: UriMatchStrategySetting,
    current: UriMatchStrategySetting,
  ) {
    const valueChange = previous !== current;
    const isAdvanced =
      current === UriMatchStrategy.StartsWith ||
      current === UriMatchStrategy.RegularExpression;

    if (!valueChange || !isAdvanced) {
      return;
    }
    OfficialAdvancedUriOptionDialogComponent.open(this.dialogService, {
      ariaLabel: this.i18nService.t("warningCapitalized"),
      contentKey: this.advancedOptionWarningMap[current],
      onContinue: () => {
        this.uriForm.controls.matchDetection.setValue(current);
      },
      onCancel: () => {
        this.uriForm.controls.matchDetection.setValue(previous);
      },
    });
  }

  focusInput() {
    if (this.inputElement?.nativeElement) {
      this.inputElement.nativeElement.focus();
    }
  }

  removeUri() {
    this.remove.emit();
  }

  writeValue(value: {
    uri: string;
    matchDetection: UriMatchStrategySetting | null;
  }): void {
    if (value) {
      this.uriForm.setValue(
        {
          uri: value.uri ?? "",
          matchDetection: value.matchDetection ?? null,
        },
        { emitEvent: false },
      );
    }
  }

  registerOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    isDisabled ? this.uriForm.disable() : this.uriForm.enable();
  }

  getMatchHints() {
    const hints = ["uriMatchDefaultStrategyHint"];
    const strategy = this.uriForm.get("matchDetection")?.value;
    if (
      strategy === UriMatchStrategy.StartsWith ||
      strategy === UriMatchStrategy.RegularExpression
    ) {
      hints.push(this.advancedOptionWarningMap[strategy]);
    }
    return hints;
  }
}
