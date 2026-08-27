import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  Output,
} from "@angular/core";

/**
 * Shared disclosure shell for every first-level Vault group.
 *
 * Keeping the trigger, count, chevron, accessibility state, and connected
 * content surface here prevents contextual sections from drifting away from
 * the ordinary Vault hierarchy.
 */
@Component({
  selector: "bw-vault-disclosure-group",
  standalone: true,
  template: `
    <button
      type="button"
      class="vault-hierarchy__trigger macos-pressable"
      data-vault-group-trigger
      [attr.data-vault-node]="groupId"
      [attr.aria-expanded]="open"
      [attr.aria-controls]="contentId"
      (click)="openChange.emit(!open)"
    >
      <span>{{ title }} ({{ count }})</span>
      <i
        class="bwi"
        [class.bwi-angle-up]="open"
        [class.bwi-angle-down]="!open"
        aria-hidden="true"
      ></i>
    </button>

    @if (rendered) {
      <div
        class="vault-hierarchy__content"
        [class.is-open]="open"
        role="group"
        [id]="contentId"
        [attr.aria-label]="title"
        [attr.aria-hidden]="open ? 'false' : 'true'"
        [attr.inert]="open ? null : ''"
      >
        <ng-content />
      </div>
    }
  `,
  host: {
    class: "vault-hierarchy__node",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultDisclosureGroupComponent {
  @Input({ required: true }) groupId = "";
  @Input({ required: true }) title = "";
  @Input({ required: true }) count = 0;
  @Input() open = false;
  @Input() rendered = true;
  @Input() testId: string | null = null;

  @Output() readonly openChange = new EventEmitter<boolean>();

  @HostBinding("attr.data-group-id") get dataGroupId(): string {
    return this.groupId;
  }

  @HostBinding("attr.data-testid") get dataTestId(): string | null {
    return this.testId;
  }

  get contentId(): string {
    return `vault-node-${this.groupId}`;
  }
}
