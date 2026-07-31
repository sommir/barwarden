import {
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";

import { AppOverlayStackService } from "./app-overlay-stack.service";

@Component({
  selector: "bw-app-bottom-sheet",
  standalone: true,
  host: { class: "app-bottom-sheet-host" },
  template: `
    <dialog
      #dialog
      class="app-bottom-sheet"
      [attr.aria-labelledby]="labelledBy || null"
      [attr.aria-describedby]="describedBy || null"
      data-state="opening"
      [attr.data-testid]="testId || null"
      (cancel)="onCancel($event)"
      (click)="onDialogClick($event)"
      (keydown)="onKeydown($event)"
      (close)="onNativeClose()"
    >
      <ng-content />
    </dialog>
  `,
})
export class AppBottomSheetComponent implements OnDestroy {
  private static activeSheet: AppBottomSheetComponent | null = null;
  private readonly overlayStack = inject(AppOverlayStackService);

  @Input() labelledBy = "";
  @Input() describedBy = "";
  @Input() testId = "";
  @Input() dismissOnBackdrop = true;
  @Input() disableClose = false;
  @Output() readonly dismissed = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();
  @ViewChild("dialog", { static: true }) private dialogRef!: ElementRef<HTMLDialogElement>;

  private trigger: HTMLElement | null = null;
  private restoreFocusOnClose = true;
  private closeSettled = true;
  private transitionEpoch = 0;
  private closeFallback: number | undefined;
  private motionEndHandler: ((event: TransitionEvent) => void) | undefined;
  private releaseOverlay: (() => void) | undefined;
  protected state: "opening" | "open" | "closing" = "opening";

  get nativeElement(): HTMLDialogElement {
    return this.dialogRef.nativeElement;
  }

  prepareOpen(
    trigger?: HTMLElement | ElementRef<HTMLElement> | { el?: ElementRef<HTMLElement> } | null,
  ): void {
    if (this.nativeElement.open) {
      return;
    }
    this.trigger = resolveHTMLElement(trigger) ?? activeHTMLElement();
    this.restoreFocusOnClose = true;
    this.closeSettled = false;
    this.setState("opening");
  }

  open(
    trigger?: HTMLElement | ElementRef<HTMLElement> | { el?: ElementRef<HTMLElement> } | null,
    initialFocus?: HTMLElement | null,
    deferFocusUntilTask = false,
  ): void {
    const dialog = this.nativeElement;
    if (dialog.open) {
      if (this.state === "closing") {
        const epoch = ++this.transitionEpoch;
        this.clearPendingClose();
        this.setState("opening");
        this.scheduleOpen(epoch);
        this.focusInitialTarget(dialog, initialFocus, deferFocusUntilTask);
      }
      return;
    }

    AppBottomSheetComponent.activeSheet?.close(false, true);
    AppBottomSheetComponent.activeSheet = this;
    this.prepareOpen(trigger);

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    const epoch = ++this.transitionEpoch;
    this.releaseOverlay?.();
    this.releaseOverlay = this.overlayStack.register({
      kind: "bottom-sheet",
      dismiss: () => {
        if (this.disableClose || !this.nativeElement.open) {
          return;
        }
        this.dismissed.emit();
        this.close();
      },
    });
    this.setState("opening");
    this.scheduleOpen(epoch);
    this.focusInitialTarget(dialog, initialFocus, deferFocusUntilTask);
  }

  close(restoreFocus = true, closeImmediately = false, force = false): void {
    const dialog = this.nativeElement;
    if (this.state === "closing" && !force) {
      return;
    }

    this.restoreFocusOnClose = restoreFocus;
    const epoch = ++this.transitionEpoch;
    this.clearPendingClose();
    this.setState("closing");
    if (!dialog.open) {
      if (this.closeSettled) {
        return;
      }
      this.settleClose();
      return;
    }
    const motionDuration = transitionDuration(dialog);
    if (closeImmediately || reducedMotionMatches() || motionDuration === null) {
      this.finishClose(epoch);
      return;
    }
    this.waitForMotionEnd(epoch, motionDuration);
  }

  onCancel(event: Event): void {
    event.preventDefault();
    if (this.disableClose) {
      return;
    }
    this.dismissed.emit();
    this.close();
  }

  onDialogClick(event: Event): void {
    if (event.target !== this.nativeElement || !this.dismissOnBackdrop || this.disableClose) {
      return;
    }
    this.dismissed.emit();
    this.close();
  }

  onNativeClose(): void {
    this.clearPendingClose();
    this.settleClose();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = focusableElements(this.nativeElement);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    this.close(false, true, true);
    this.clearPendingClose();
  }

  private focusInitialTarget(
    dialog: HTMLDialogElement,
    initialFocus: HTMLElement | null | undefined,
    deferFocusUntilTask: boolean,
  ): void {
    const focus = () => {
      const focusTarget = initialFocus ?? firstFocusableElement(dialog);
      focusTarget?.focus();
    };
    if (deferFocusUntilTask) {
      window.setTimeout(focus);
    } else {
      queueMicrotask(focus);
    }
  }

  private scheduleOpen(epoch: number): void {
    window.setTimeout(() => {
      if (this.transitionEpoch === epoch && this.nativeElement.open && this.state === "opening") {
        this.setState("open");
      }
    });
  }

  private setState(state: "opening" | "open" | "closing"): void {
    this.state = state;
    this.nativeElement.dataset["state"] = state;
  }

  private waitForMotionEnd(epoch: number, motionDuration: number): void {
    const dialog = this.nativeElement;
    this.motionEndHandler = (event: TransitionEvent) => {
      if (
        event.target === dialog
        && event.propertyName === "transform"
      ) {
        this.finishClose(epoch);
      }
    };
    dialog.addEventListener("transitionend", this.motionEndHandler);
    this.closeFallback = window.setTimeout(
      () => this.finishClose(epoch),
      fallbackDuration(motionDuration),
    );
  }

  private finishClose(epoch: number): void {
    if (this.transitionEpoch !== epoch || this.state !== "closing") {
      return;
    }
    this.clearPendingClose();
    const dialog = this.nativeElement;
    if (dialog.open && typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
      this.settleClose();
    }
  }

  private clearPendingClose(): void {
    if (this.motionEndHandler) {
      this.nativeElement.removeEventListener("transitionend", this.motionEndHandler);
      this.motionEndHandler = undefined;
    }
    if (this.closeFallback !== undefined) {
      window.clearTimeout(this.closeFallback);
      this.closeFallback = undefined;
    }
  }

  private settleClose(): void {
    if (this.closeSettled) {
      return;
    }
    this.closeSettled = true;
    this.releaseOverlay?.();
    this.releaseOverlay = undefined;
    if (AppBottomSheetComponent.activeSheet === this) {
      AppBottomSheetComponent.activeSheet = null;
    }
    const trigger = this.trigger;
    const restoreFocus = this.restoreFocusOnClose;
    this.trigger = null;
    this.closed.emit();
    if (restoreFocus && trigger?.isConnected) {
      trigger.focus();
    }
  }
}

function reducedMotionMatches(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function transitionDuration(dialog: HTMLDialogElement): number | null {
  const styles = window.getComputedStyle(dialog);
  const properties = cssList(styles.transitionProperty);
  const durations = cssList(styles.transitionDuration).map(cssTime);
  const delays = cssList(styles.transitionDelay).map(cssTime);
  if (!properties.length || !durations.length) {
    return null;
  }

  const slotCount = properties.length;
  let total = 0;
  let hasMotion = false;
  for (let index = 0; index < slotCount; index += 1) {
    const property = properties[index % properties.length];
    const duration = durations[index % durations.length];
    const delay = delays.length ? delays[index % delays.length] : 0;
    if ((property === "transform" || property === "all") && duration > 0) {
      hasMotion = true;
      total = Math.max(total, Math.max(0, duration + delay));
    }
  }
  return hasMotion ? total : null;
}

function cssList(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function cssTime(value: string): number {
  if (value.endsWith("ms")) return Number.parseFloat(value);
  if (value.endsWith("s")) return Number.parseFloat(value) * 1000;
  return 0;
}

function fallbackDuration(motionDuration: number): number {
  return motionDuration + 50;
}

function activeHTMLElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function resolveHTMLElement(
  candidate: HTMLElement | ElementRef<HTMLElement> | { el?: ElementRef<HTMLElement> } | null | undefined,
): HTMLElement | null {
  if (candidate instanceof HTMLElement) {
    return candidate;
  }
  if (candidate instanceof ElementRef) {
    return candidate.nativeElement;
  }
  return candidate?.el?.nativeElement ?? null;
}

function firstFocusableElement(dialog: HTMLDialogElement): HTMLElement | null {
  return focusableElements(dialog)[0] ?? null;
}

function focusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    [
      "[autofocus]",
      "button:not([disabled])",
      'input:not([disabled]):not([type="hidden"])',
      "select:not([disabled])",
      "textarea:not([disabled])",
      "a[href]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(","),
  )).filter((element) =>
    !element.hidden
    && element.tabIndex >= 0
    && !element.classList.contains("cdk-focus-trap-anchor")
    && !element.closest("[hidden], [inert], [aria-hidden='true']")
    && visibleByStyle(element)
  );
}

function visibleByStyle(element: HTMLElement): boolean {
  const style = globalThis.getComputedStyle?.(element);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}
