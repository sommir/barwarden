import { Injectable } from "@angular/core";

export type AppOverlayKind =
  | "bottom-sheet"
  | "context-menu"
  | "dialog"
  | "listbox"
  | "menu"
  | "select";

export interface AppOverlayRegistration {
  readonly kind: AppOverlayKind;
  readonly dismiss: () => void;
}

interface RegisteredOverlay extends AppOverlayRegistration {
  readonly id: symbol;
}

const PRESENTED_OVERLAY_SELECTOR = [
  "dialog[open]",
  ".cdk-overlay-container .cdk-overlay-pane",
  '[data-overlay-open="true"]',
  '[data-context-menu="true"]',
  '[aria-modal="true"]',
].join(",");

const OVERLAY_PATH_SELECTOR = [
  "dialog",
  "select",
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  "[data-overlay-open]",
  "[data-context-menu]",
  ".cdk-overlay-pane",
].join(",");

@Injectable({ providedIn: "root" })
export class AppOverlayStackService {
  private readonly overlays: RegisteredOverlay[] = [];

  register(registration: AppOverlayRegistration): () => void {
    const entry: RegisteredOverlay = {
      ...registration,
      id: Symbol(registration.kind),
    };
    this.overlays.push(entry);
    return () => {
      const index = this.overlays.findIndex((candidate) => candidate.id === entry.id);
      if (index >= 0) {
        this.overlays.splice(index, 1);
      }
    };
  }

  consumeEscape(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) {
      return true;
    }

    const top = this.overlays.at(-1);
    if (top) {
      event.preventDefault();
      top.dismiss();
      return true;
    }

    if (!this.hasPresentedDomOverlay(event)) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  private hasPresentedDomOverlay(event: KeyboardEvent): boolean {
    if (typeof document === "undefined") {
      return false;
    }

    const eventPath = typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];
    if (eventPath.some((candidate) =>
      candidate instanceof Element
      && Boolean(candidate.closest(OVERLAY_PATH_SELECTOR))
    )) {
      return true;
    }

    if (document.activeElement instanceof HTMLSelectElement) {
      return true;
    }

    return Array.from(document.querySelectorAll<HTMLElement>(PRESENTED_OVERLAY_SELECTOR))
      .some(isPresented);
  }
}

function isPresented(element: HTMLElement): boolean {
  if (
    element.hidden
    || element.getAttribute("aria-hidden") === "true"
    || element.closest("[hidden], [inert], [aria-hidden='true']")
  ) {
    return false;
  }
  const style = globalThis.getComputedStyle?.(element);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}
