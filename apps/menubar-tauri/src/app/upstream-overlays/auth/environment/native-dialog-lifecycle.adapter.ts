import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class NativeDialogLifecycleAdapter {
  private readonly triggers = new WeakMap<HTMLDialogElement, HTMLElement>();

  open(
    dialog: HTMLDialogElement,
    trigger: HTMLElement,
    autofocus: HTMLElement,
    deferFocusUntilClick = false,
  ): void {
    this.triggers.set(dialog, trigger);
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    if (deferFocusUntilClick) {
      // The upstream bit-menu restores focus while its item click bubbles. Capture the final
      // next task after that official close path so the native dialog retains autofocus.
      window.setTimeout(() => autofocus.focus());
    } else {
      autofocus.focus();
    }
  }

  close(dialog: HTMLDialogElement): void {
    if (!dialog.open) {
      this.restoreFocus(dialog);
      return;
    }
    try {
      dialog.close();
    } catch {
      // The fallback below applies to both native and test/WebKit implementations.
    }
    dialog.removeAttribute("open");
    this.restoreFocus(dialog);
  }

  cancel(event: Event, dialog: HTMLDialogElement): void {
    event.preventDefault();
    this.close(dialog);
  }

  closed(dialog: HTMLDialogElement): void {
    this.restoreFocus(dialog);
  }

  trapTab(event: KeyboardEvent, dialog: HTMLDialogElement): void {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        !element.hidden && element.tabIndex >= 0 && !element.classList.contains("cdk-focus-trap-anchor"),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private restoreFocus(dialog: HTMLDialogElement): void {
    const trigger = this.triggers.get(dialog);
    trigger?.focus();
    // WebKit may apply its own native close focus after the close event. Reassert the dialog
    // lifecycle target after that browser work has completed.
    if (trigger) {
      window.setTimeout(() => trigger.focus());
    }
    this.triggers.delete(dialog);
  }
}
