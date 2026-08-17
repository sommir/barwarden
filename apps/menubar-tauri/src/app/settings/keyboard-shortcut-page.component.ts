import { Location } from "@angular/common";
import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  ViewChild,
} from "@angular/core";
import { BitFormFieldControlDirective } from "@bitwarden/components/form-field/form-field-control.directive";

import {
  bindingFromKeyboardEvent,
  formatMacShortcut,
  type GlobalShortcutBinding,
} from "../../host/global-shortcut";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import {
  BitFormFieldComponent,
  BitHintDirective,
  BitIconButtonComponent,
  BitLabelComponent,
  BitSuffixDirective,
  ButtonComponent,
} from "../official-ui/official-components";
import {
  MacosAlertStripComponent,
  type MacosAlertKind,
} from "../official-ui/macos-alert-strip.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { GlobalShortcutSettingsService } from "./global-shortcut-settings.service";

@Directive({
  selector: "button[bwShortcutRecorder]",
  standalone: true,
  hostDirectives: [BitFormFieldControlDirective],
})
class ShortcutRecorderControlDirective {}

@Component({
  selector: "bw-keyboard-shortcut-page",
  host: { class: "macos-page macos-page--secondary macos-page--settings-detail" },
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitHintDirective,
    BitIconButtonComponent,
    BitLabelComponent,
    BitSuffixDirective,
    ButtonComponent,
    I18nPipe,
    MacosAlertStripComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    ShortcutRecorderControlDirective,
  ],
  providers: [GlobalShortcutSettingsService],
  template: `
    <popup-page>
      <popup-header
        slot="header"
        [pageTitle]="'i18nKeyboardShortcuts' | i18n"
        [showBackButton]="true"
        [backAction]="backAction"
      />

      <section class="settings-detail-group macos-continuous-group">
        <bit-form-field class="settings-detail-row macos-continuous-row" disableMargin>
          <bit-label>{{ "i18nShowBarwarden" | i18n }}</bit-label>
          <button
            #shortcutRecorder
            bwShortcutRecorder
            bitButton
            buttonType="secondary"
            type="button"
            class="macos-form-field__control macos-form-control"
            data-testid="shortcut-recorder"
            [attr.aria-label]="recorderAccessibleLabel"
            [disabled]="view.pending"
            [attr.aria-pressed]="recording"
            (click)="startRecording()"
            (keydown)="record($event)"
          >
            {{ displayValue }}
          </button>
          <button
            bitSuffix
            type="button"
            bitIconButton="bwi-close"
            class="macos-form-field__suffix"
            [label]="'i18nShortcutClear' | i18n"
            [attr.aria-label]="'i18nShortcutClear' | i18n"
            data-testid="shortcut-clear"
            [disabled]="view.pending || view.shortcut === null"
            (click)="clear()"
          ></button>
          @if (hintMessage) {
            <bit-hint>{{ hintMessage }}</bit-hint>
          }
        </bit-form-field>
        @if (operationMessage) {
          <bw-macos-alert-strip
            [kind]="operationAlertKind"
            [title]="operationAlertTitle"
            [message]="operationMessage"
            [actionLabel]="'i18nRetry' | i18n"
            actionTestId="shortcut-retry"
            testId="shortcut-operation-alert"
            (action)="retry()"
          />
        }
      </section>
    </popup-page>
  `,
})
export class KeyboardShortcutPageComponent {
  @ViewChild("shortcutRecorder", { read: ElementRef })
  private shortcutRecorder?: ElementRef<HTMLButtonElement>;

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.location.back();

  recording = false;
  private validationMessage = "";
  private retryOperation: ShortcutOperation = { type: "load" };

  constructor(
    private readonly settings: GlobalShortcutSettingsService,
    private readonly location: Location,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef,
  ) {
    setTimeout(() => void this.load());
  }

  get view() {
    return this.settings.snapshot();
  }

  get displayValue(): string {
    if (this.recording) {
      return translateOfficialMessage("i18nEnterShortcut");
    }
    return this.view.shortcut === null
      ? translateOfficialMessage("i18nNotSet")
      : formatMacShortcut(this.view.shortcut);
  }

  get hintMessage(): string {
    return this.validationMessage
      || (
        this.view.message === translateOfficialMessage("i18nShortcutInvalid")
          ? this.view.message
          : ""
      );
  }

  get operationMessage(): string {
    return this.hintMessage ? "" : this.view.message;
  }

  get operationAlertKind(): MacosAlertKind {
    return this.view.message === translateOfficialMessage("i18nShortcutInUse")
      ? "warning"
      : "danger";
  }

  get operationAlertTitle(): string {
    return translateOfficialMessage(
      this.operationAlertKind === "warning"
        ? "i18nShortcutUnavailable"
        : "i18nShortcutOperationFailed",
    );
  }

  get recorderAccessibleLabel(): string {
    return this.recording
      ? translateOfficialMessage("i18nRecordShortcutPrompt")
      : translateOfficialMessage("i18nRecordShortcut");
  }

  startRecording(): void {
    if (this.view.pending) {
      return;
    }
    this.validationMessage = "";
    this.recording = true;
    this.shortcutRecorder?.nativeElement.focus({ preventScroll: true });
  }

  record(event: KeyboardEvent): void {
    if (!this.recording) {
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      this.validationMessage = "";
      this.recording = false;
      return;
    }

    const shortcut = bindingFromKeyboardEvent(event);
    if (isModifierCode(event.code)) {
      return;
    }
    if (shortcut === null) {
      this.validationMessage = translateOfficialMessage("i18nShortcutInvalid");
      return;
    }

    this.validationMessage = "";
    this.recording = false;
    void this.replace(shortcut);
  }

  clear(): void {
    if (this.view.pending) {
      return;
    }
    this.validationMessage = "";
    this.recording = false;
    void this.clearShortcut();
  }

  retry(): void {
    if (this.view.pending) {
      return;
    }
    this.validationMessage = "";
    switch (this.retryOperation.type) {
      case "load":
        void this.load();
        return;
      case "replace":
        void this.replace(this.retryOperation.shortcut);
        return;
      case "clear":
        void this.clearShortcut();
    }
  }

  private async load(): Promise<void> {
    this.retryOperation = { type: "load" };
    await this.settings.load();
    this.refreshView();
  }

  private async replace(shortcut: GlobalShortcutBinding): Promise<void> {
    this.retryOperation = { type: "replace", shortcut };
    await this.settings.replace(shortcut);
    this.refreshView();
  }

  private async clearShortcut(): Promise<void> {
    this.retryOperation = { type: "clear" };
    await this.settings.clear();
    this.refreshView();
  }

  private refreshView(): void {
    if (!this.destroyRef.destroyed) {
      this.changeDetectorRef.detectChanges();
    }
  }
}

type ShortcutOperation =
  | { readonly type: "load" }
  | { readonly type: "replace"; readonly shortcut: GlobalShortcutBinding }
  | { readonly type: "clear" };

function isModifierCode(code: string): boolean {
  return [
    "AltLeft",
    "AltRight",
    "ControlLeft",
    "ControlRight",
    "MetaLeft",
    "MetaRight",
    "ShiftLeft",
    "ShiftRight",
  ].includes(code);
}
