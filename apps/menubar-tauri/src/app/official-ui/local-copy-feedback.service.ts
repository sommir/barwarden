import { DOCUMENT } from "@angular/common";
import { Inject, Injectable, OnDestroy } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import {
  captureLocalCopyFeedback,
  LOCAL_COPY_FEEDBACK_EVENT,
} from "./local-copy-feedback-event";
import { translateOfficialMessage } from "./official-i18n.service";

interface ActiveCopyFeedback {
  readonly icon: HTMLElement;
  readonly originalIconClass: string | null;
  readonly insertedIcon: boolean;
  readonly originalLabel: string | null;
  readonly timer: number;
}

/**
 * Gives every retained copy button the same immediate local receipt without
 * coupling pinned templates to app state. The store event remains the sole
 * accessible live announcement.
 */
@Injectable({ providedIn: "root" })
export class LocalCopyFeedbackService implements OnDestroy {
  private pending = new WeakMap<HTMLButtonElement, number>();
  private started = false;
  private readonly active = new WeakMap<HTMLButtonElement, ActiveCopyFeedback>();

  private readonly captureCopy = (event: Event): void => {
    const target = event.target;
    const button = target instanceof Element
      ? target.closest<HTMLButtonElement>("button")
      : null;
    if (!button || !isCopyButton(button)) {
      return;
    }
    this.restore(button);
    captureLocalCopyFeedback(button, event);
  };

  private readonly captureExplicitReceipt = (event: Event): void => {
    const target = event.target;
    const button = target instanceof Element
      ? target.closest<HTMLButtonElement>("button")
      : null;
    if (!button) {
      return;
    }
    if (!(event instanceof CustomEvent) || !isReceiptDetail(event.detail)) {
      return;
    }
    if (event.detail.pending === true) {
      this.restore(button);
      this.pending.set(button, event.detail.token);
      return;
    }
    if (this.pending.get(button) !== event.detail.token) {
      return;
    }
    this.pending.delete(button);
    this.restore(button);
    this.show(button, event.detail.failed === true);
  };

  constructor(
    _store: PopupStateStore,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.document.addEventListener("click", this.captureCopy, true);
    this.document.addEventListener(
      LOCAL_COPY_FEEDBACK_EVENT,
      this.captureExplicitReceipt,
    );
  }

  destroy(): void {
    this.document.removeEventListener("click", this.captureCopy, true);
    this.document.removeEventListener(
      LOCAL_COPY_FEEDBACK_EVENT,
      this.captureExplicitReceipt,
    );
    this.pending = new WeakMap<HTMLButtonElement, number>();
    this.started = false;
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  private show(button: HTMLButtonElement, failed: boolean): void {
    const existingIcon = button.querySelector<HTMLElement>(".bwi");
    const icon = existingIcon ?? this.document.createElement("i");
    if (!existingIcon) {
      icon.setAttribute("aria-hidden", "true");
      button.prepend(icon);
    }
    const originalIconClass = existingIcon?.className ?? null;
    const originalLabel = button.getAttribute("aria-label");
    icon.className = `bwi ${failed ? "bwi-error" : "bwi-check"} macos-copy-feedback-icon`;
    button.classList.add(failed ? "is-copy-failed" : "is-copy-confirmed");
    button.setAttribute(
      "aria-label",
      translateOfficialMessage(failed ? "i18nCopyFailed" : "i18nCopied"),
    );
    const timer = window.setTimeout(() => this.restore(button), 1_000);
    this.active.set(button, {
      icon,
      originalIconClass,
      insertedIcon: !existingIcon,
      originalLabel,
      timer,
    });
  }

  private restore(button: HTMLButtonElement): void {
    const active = this.active.get(button);
    if (!active) {
      return;
    }
    window.clearTimeout(active.timer);
    button.classList.remove("is-copy-confirmed", "is-copy-failed");
    if (active.insertedIcon) {
      active.icon.remove();
    } else if (active.originalIconClass !== null) {
      active.icon.className = active.originalIconClass;
    }
    if (active.originalLabel === null) {
      button.removeAttribute("aria-label");
    } else {
      button.setAttribute("aria-label", active.originalLabel);
    }
    this.active.delete(button);
  }
}

function isReceiptDetail(value: unknown): value is {
  readonly pending?: boolean;
  readonly failed?: boolean;
  readonly token: number;
} {
  return typeof value === "object"
    && value !== null
    && typeof (value as { token?: unknown }).token === "number";
}

function isCopyButton(button: HTMLButtonElement): boolean {
  const accessibleText = [
    button.getAttribute("aria-label"),
    button.getAttribute("title"),
    button.dataset["testid"],
    button.textContent,
  ].filter(Boolean).join(" ");
  return /(?:复制|copy)/iu.test(accessibleText);
}
