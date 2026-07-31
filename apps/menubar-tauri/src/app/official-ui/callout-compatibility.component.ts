import { Component, EventEmitter, inject, Input, Output } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import {
  MacosAlertStripComponent,
  type MacosAlertKind,
  type MacosAlertUrgency,
} from "./macos-alert-strip.component";
import { translateOfficialMessage } from "./official-i18n.service";

export type CalloutType = MacosAlertKind;
let nextCalloutId = 0;

/**
 * Compatibility boundary for retained upstream `bit-callout` templates.
 * App-owned alerts import MacosAlertStripComponent directly.
 */
@Component({
  selector: "bit-callout",
  standalone: true,
  imports: [MacosAlertStripComponent],
  template: `
    <bw-macos-alert-strip
      [kind]="kind"
      [title]="resolvedTitle"
      [icon]="icon"
      [accessibleName]="resolvedAccessibleName"
      [dismissible]="dismiss.observed"
      [dismissLabel]="closeLabel"
      [urgency]="resolvedUrgency"
      (dismiss)="dismiss.emit()"
    >
      <span slot="title"><ng-content select="[slot=title]" /></span>
      <ng-content />
      <div slot="end"><ng-content select="[slot=end]" /></div>
    </bw-macos-alert-strip>
  `,
})
export class CalloutCompatibilityComponent {
  @Input() type: CalloutType = "info";
  @Input() icon: string | null | undefined;
  @Input() title: string | null | undefined;
  @Input() accessibleName = "";
  @Input() urgency: MacosAlertUrgency | null = null;
  @Output() readonly dismiss = new EventEmitter<void>();
  private readonly i18n = inject(I18nService, { optional: true });
  private readonly calloutId = ++nextCalloutId;

  get kind(): MacosAlertKind {
    return this.type;
  }

  get resolvedTitle(): string | null {
    if (this.title !== undefined) {
      return this.title;
    }
    if (this.type === "warning") {
      return this.i18n?.t("warning") ?? translateOfficialMessage("warning");
    }
    if (this.type === "danger") {
      return this.i18n?.t("error") ?? translateOfficialMessage("error");
    }
    return null;
  }

  get resolvedAccessibleName(): string {
    if (this.resolvedTitle) {
      return "";
    }
    return this.accessibleName
      || `${this.i18n?.t("i18nCallout") ?? translateOfficialMessage("i18nCallout")} ${this.calloutId}, ${this.type}`;
  }

  get closeLabel(): string {
    return this.i18n?.t("close") ?? translateOfficialMessage("close");
  }

  get resolvedUrgency(): MacosAlertUrgency {
    return this.urgency ?? (this.type === "danger" ? "assertive" : "off");
  }
}
