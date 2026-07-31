import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
} from "@angular/core";
import { translateOfficialMessage } from "./official-i18n.service";

export type MacosAlertKind = "danger" | "warning" | "info" | "success" | "subtle";
export type MacosAlertUrgency = "assertive" | "polite" | "off";
export type MacosAlertPresentation = "inline" | "toast";

@Component({
  selector: "bw-macos-alert-strip",
  standalone: true,
  template: `
    <section
      class="macos-alert-strip"
      [attr.data-kind]="kind"
      [attr.data-presentation]="presentation"
      [attr.data-testid]="testId || null"
      [attr.role]="isSilent ? null : isAssertive ? 'alert' : 'status'"
      [attr.aria-live]="isSilent || isAssertive ? null : 'polite'"
      [attr.aria-label]="accessibleName || null"
      aria-atomic="true"
    >
      @if (icon !== null) {
        <i class="bwi macos-alert-strip__icon" [class]="iconClass" aria-hidden="true"></i>
      }
      <div class="macos-alert-strip__content">
        <strong class="macos-alert-strip__title">{{ title }}<ng-content select="[slot=title]" /></strong>
        @if (message) {
          <p class="macos-alert-strip__message">{{ message }}</p>
        } @else {
          <div class="macos-alert-strip__message"><ng-content /></div>
        }
      </div>
      @if (actionLabel) {
        <button
          type="button"
          class="macos-alert-strip__action macos-pressable"
          [attr.data-testid]="actionTestId || null"
          (click)="action.emit()"
        >{{ actionLabel }}</button>
      }
      @if (dismissible) {
        <button
          type="button"
          class="macos-alert-strip__dismiss macos-pressable"
          [attr.aria-label]="resolvedDismissLabel"
          (click)="dismiss.emit()"
        ><i class="bwi bwi-close" aria-hidden="true"></i></button>
      }
      <div class="macos-alert-strip__end"><ng-content select="[slot=end]" /></div>
    </section>
  `,
})
export class MacosAlertStripComponent implements AfterViewInit {
  @Input() kind: MacosAlertKind = "danger";
  @Input() title: string | null = "";
  @Input() message = "";
  @Input() actionLabel = "";
  @Input() actionTestId = "";
  @Input() testId = "";
  @Input() accessibleName = "";
  @Input() icon: string | null | undefined;
  @Input() dismissible = false;
  @Input() dismissLabel = "";
  @Input() urgency: MacosAlertUrgency | null = null;
  @Input() presentation: MacosAlertPresentation = "inline";
  @Output() readonly action = new EventEmitter<void>();
  @Output() readonly dismiss = new EventEmitter<void>();

  @Input()
  set type(value: MacosAlertKind | "") {
    if (value) {
      this.kind = value;
    }
  }

  constructor(private readonly element: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    for (const nestedLiveRegion of Array.from(
      this.element.nativeElement.querySelectorAll(
        ".macos-alert-strip__message [role='alert'], " +
          ".macos-alert-strip__message [role='status'], " +
          ".macos-alert-strip__message [aria-live]",
      ),
    )) {
      nestedLiveRegion.removeAttribute("role");
      nestedLiveRegion.removeAttribute("aria-live");
      nestedLiveRegion.removeAttribute("aria-atomic");
    }
  }

  get isAssertive(): boolean {
    return this.urgency === "assertive"
      || (this.urgency === null && this.kind === "danger");
  }

  get isSilent(): boolean {
    return this.urgency === "off";
  }

  get resolvedDismissLabel(): string {
    return this.dismissLabel || translateOfficialMessage("close");
  }

  get iconClass(): string {
    if (this.icon) {
      return `bwi ${this.icon} macos-alert-strip__icon`;
    }
    switch (this.kind) {
      case "warning":
        return "bwi bwi-exclamation-triangle macos-alert-strip__icon";
      case "info":
        return "bwi bwi-info-circle macos-alert-strip__icon";
      case "success":
        return "bwi bwi-check-circle macos-alert-strip__icon";
      case "subtle":
        return "bwi bwi-info-circle macos-alert-strip__icon";
      default:
        return "bwi bwi-error macos-alert-strip__icon";
    }
  }
}
