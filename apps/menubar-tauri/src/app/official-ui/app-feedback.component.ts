import {
  AfterViewChecked,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { AsyncPipe } from "@angular/common";

import { AppFeedbackService } from "./app-feedback.service";
import { translateOfficialMessage } from "./official-i18n.service";

@Component({
  selector: "bw-app-feedback",
  standalone: true,
  imports: [AsyncPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (feedback.feedback$ | async; as item) {
      @for (announcement of [item]; track announcement.id) {
        <div
          class="sr-only app-feedback__announcer"
          [attr.data-feedback-id]="announcement.id"
          [attr.role]="announcement.kind === 'warning' ? 'alert' : 'status'"
          [attr.aria-live]="announcement.kind === 'warning' ? null : 'polite'"
          aria-atomic="true"
        >{{ feedbackMessage(announcement.message) }}</div>
      }
      <section
        #surface
        class="app-feedback"
        [attr.data-has-main-switcher]="hasMainSwitcher"
        [attr.data-focus-overlap]="focusOverlap || null"
      >
        @for (presentation of [item]; track presentation.id) {
          <div
            class="app-feedback__message"
            [attr.data-feedback-id]="presentation.id"
            [attr.data-kind]="presentation.kind"
            data-presentation="toast"
            [attr.aria-hidden]="focusOverlap || null"
          >
            <i class="bwi app-feedback__icon {{ feedbackIcon(presentation.kind) }}" aria-hidden="true"></i>
            <span>{{ feedbackMessage(presentation.message) }}</span>
            <button
              type="button"
              class="app-feedback__dismiss macos-pressable"
              [attr.aria-label]="dismissLabel"
              (click)="feedback.dismiss(presentation.id)"
            ><i class="bwi bwi-close" aria-hidden="true"></i></button>
          </div>
        }
      </section>
    }
  `,
})
export class AppFeedbackComponent implements AfterViewChecked, OnInit, OnDestroy {
  @Input() hasMainSwitcher = false;
  @ViewChild("surface") private surface?: ElementRef<HTMLElement>;

  focusOverlap = false;
  private focusCheckQueued = false;

  constructor(
    readonly feedback: AppFeedbackService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    document.addEventListener("scroll", this.onCapturedScroll, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener("scroll", this.onCapturedScroll, true);
  }

  ngAfterViewChecked(): void {
    this.queueFocusCheck();
  }

  @HostListener("document:focusin")
  onDocumentFocus(): void {
    this.queueFocusCheck();
  }

  @HostListener("window:resize")
  onLayoutChange(): void {
    this.queueFocusCheck();
  }

  private readonly onCapturedScroll = (): void => this.queueFocusCheck();

  protected feedbackMessage(message: string): string {
    const copied = /^Copied(?:\s+(.+))?$/iu.exec(message.trim());
    if (!copied) {
      return message;
    }
    return copied[1]
      ? translateOfficialMessage("i18nCopiedLabel", localizedCopiedLabel(copied[1]))
      : translateOfficialMessage("i18nCopied");
  }

  protected feedbackIcon(kind: "status" | "success" | "warning"): string {
    switch (kind) {
      case "success":
        return "bwi-check";
      case "warning":
        return "bwi-error";
      default:
        return "bwi-info-circle";
    }
  }

  protected readonly dismissLabel = translateOfficialMessage("close");

  private queueFocusCheck(): void {
    if (this.focusCheckQueued) {
      return;
    }
    this.focusCheckQueued = true;
    queueMicrotask(() => {
      this.focusCheckQueued = false;
      const surface = this.surface?.nativeElement;
      const focused = document.activeElement;
      const next = Boolean(
        surface
        && focused instanceof HTMLElement
        && !surface.contains(focused)
        && rectanglesOverlap(surface.getBoundingClientRect(), focused.getBoundingClientRect()),
      );
      if (next !== this.focusOverlap) {
        this.focusOverlap = next;
        this.changeDetector.markForCheck();
      }
    });
  }
}

function localizedCopiedLabel(label: string): string {
  const normalized = label.trim().toLocaleLowerCase();
  const labels: Record<string, string> = {
    username: "username",
    password: "password",
    otp: "verificationCode",
    "password history": "passwordHistory",
    "generated result": "i18nGeneratedResult",
    "recovery code": "i18nRecoveryCode",
  };
  const key = labels[normalized];
  return key ? translateOfficialMessage(key) : label;
}

function rectanglesOverlap(first: DOMRect, second: DOMRect): boolean {
  if (first.width <= 0 || first.height <= 0 || second.width <= 0 || second.height <= 0) {
    return false;
  }
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}
