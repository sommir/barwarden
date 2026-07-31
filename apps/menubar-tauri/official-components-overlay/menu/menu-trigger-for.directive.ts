import { hasModifierKey } from "@angular/cdk/keycodes";
import { ConnectedPosition, Overlay, OverlayConfig, OverlayRef } from "@angular/cdk/overlay";
import { TemplatePortal } from "@angular/cdk/portal";
import {
  Directive,
  ElementRef,
  HostBinding,
  HostListener,
  OnDestroy,
  ViewContainerRef,
  inject,
  input,
} from "@angular/core";
import { outputToObservable } from "@angular/core/rxjs-interop";
import { merge, Subscription } from "rxjs";
import { filter, skip, takeUntil } from "rxjs/operators";

import { TooltipDirective } from "../tooltip/tooltip.directive";

import { MenuPositionIdentifier, defaultPositions } from "./default-positions";
import { MenuComponent } from "./menu.component";

@Directive({
  selector: "[bitMenuTriggerFor]",
  exportAs: "menuTrigger",
  host: { "[attr.role]": "this.role()" },
})
export class MenuTriggerForDirective implements OnDestroy {
  @HostBinding("attr.aria-expanded") isOpen = false;
  @HostBinding("attr.aria-haspopup") get hasPopup(): "menu" | "dialog" {
    return this.menu()?.ariaRole() || "menu";
  }

  readonly role = input("button");

  readonly menu = input.required<MenuComponent>({ alias: "bitMenuTriggerFor" });

  /** Preferred opening position. CDK falls back through the remaining positions if the preferred one doesn't fit. */
  readonly menuPosition = input<MenuPositionIdentifier>();

  private overlayRef: OverlayRef | null = null;

  /**
   * Host tooltip (if any) on the same element. Suppressed while the menu is open so
   * a `bitTooltip` can't pop over the active menu.
   */
  private readonly hostTooltip = inject(TooltipDirective, { self: true, optional: true });

  private get positions(): ConnectedPosition[] {
    const preferred = this.menuPosition();
    if (!preferred) {
      return defaultPositions;
    }
    const match = defaultPositions.find((p) => p.id === preferred);
    return match ? [match, ...defaultPositions.filter((p) => p !== match)] : defaultPositions;
  }

  private get defaultMenuConfig(): OverlayConfig {
    return {
      panelClass: "bit-menu-panel",
      hasBackdrop: true,
      backdropClass: ["cdk-overlay-transparent-backdrop", "bit-menu-panel-backdrop"],
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.elementRef)
        .withPositions(this.positions)
        .withLockedPosition(true)
        .withFlexibleDimensions(false)
        .withPush(true)
        .withTransformOriginOn('[role="menu"]'),
    };
  }
  private closedEventsSub: Subscription | null = null;
  private keyDownEventsSub: Subscription | null = null;
  private menuCloseListenerSub: Subscription | null = null;
  private closingTimer: number | undefined;

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private viewContainerRef: ViewContainerRef,
    private overlay: Overlay,
  ) {}

  @HostListener("click") toggleMenu() {
    if (this.closingTimer !== undefined) {
      this.cancelPendingClose();
      return;
    }
    this.isOpen ? this.destroyMenu() : this.openMenu();
  }

  /**
   * Toggles the menu on right click event.
   * If the menu is already open, it updates the menu position.
   * @param event The MouseEvent from the right-click interaction
   */
  toggleMenuOnRightClick(event: MouseEvent) {
    event.preventDefault(); // Prevent default context menu
    if (this.closingTimer !== undefined) {
      this.cancelPendingClose();
      this.updateMenuPosition(event);
      return;
    }
    this.isOpen ? this.updateMenuPosition(event) : this.openMenu(event);
  }

  ngOnDestroy() {
    this.disposeAll();
  }

  private openMenu(event?: MouseEvent) {
    const menu = this.menu();
    if (menu == null) {
      throw new Error("Cannot find bit-menu element");
    }

    this.isOpen = true;
    this.hostTooltip?.suppressed.set(true);

    const baseConfig = this.defaultMenuConfig;
    // For a zero-size point anchor (right-click), originX/originY collapse onto the
    // click coordinate — only overlayX/overlayY drive placement, so the same positions
    // we use for element anchors work here too.
    const positionStrategy = event
      ? this.overlay
          .position()
          .flexibleConnectedTo({ x: event.clientX, y: event.clientY })
          .withPositions(this.positions)
          .withLockedPosition(false)
          .withFlexibleDimensions(false)
          .withPush(true)
          .withTransformOriginOn('[role="menu"]')
      : baseConfig.positionStrategy;

    const config = { ...baseConfig, positionStrategy, hasBackdrop: !event };

    this.overlayRef = this.overlay.create(config);

    const templatePortal = new TemplatePortal(menu.templateRef(), this.viewContainerRef);
    this.overlayRef.attach(templatePortal);

    // Context menus are opened with a MouseEvent
    const isContextMenu = !!event;
    this.setupClosingActions(isContextMenu);
    this.setupMenuCloseListener();

    const menuKeyManager = menu.keyManager();
    if (menuKeyManager) {
      menuKeyManager.setFirstItemActive();
      this.keyDownEventsSub = this.overlayRef
        .keydownEvents()
        .subscribe((event: KeyboardEvent) => menuKeyManager.onKeydown(event));
    }
  }

  /**
   * Updates the position of the menu overlay based on the mouse event coordinates.
   * This is typically called when the menu is already open and the user right-clicks again,
   * allowing the menu to reposition itself to the new cursor location.
   * @param event The MouseEvent containing the new clientX and clientY coordinates
   */
  private updateMenuPosition(event: MouseEvent) {
    if (this.overlayRef == null) {
      return;
    }

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo({ x: event.clientX, y: event.clientY })
      .withPositions(this.positions)
      .withTransformOriginOn('[role="menu"]');

    this.overlayRef.updatePositionStrategy(positionStrategy);
  }

  private destroyMenu() {
    if (this.overlayRef == null || !this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.hostTooltip?.suppressed.set(false);
    this.unsubscribeClosingActions();
    if (prefersReducedMotion()) {
      this.finishClose();
      return;
    }
    this.overlayRef.addPanelClass("bit-menu-panel--closing");
    this.closingTimer = window.setTimeout(() => this.finishClose(), 100);
  }

  private setupClosingActions(isContextMenu: boolean) {
    if (!this.overlayRef) {
      return;
    }

    const keyEvents = this.overlayRef.keydownEvents().pipe(
      filter((event: KeyboardEvent) => {
        const keys = this.menu().ariaRole() === "menu" ? ["Escape", "Tab"] : ["Escape"];
        return keys.includes(event.key);
      }),
    );
    const menuClosed = outputToObservable(this.menu().closed);
    const detachments = this.overlayRef.detachments();

    const closeEvents = isContextMenu
      ? merge(detachments, keyEvents, menuClosed)
      : merge(detachments, keyEvents, this.overlayRef.backdropClick(), menuClosed);

    this.closedEventsSub = closeEvents
      .pipe(takeUntil(this.overlayRef.detachments()))
      .subscribe((event) => {
        // Closing the menu is handled in this.destroyMenu, so we want to prevent the escape key
        // from doing its normal default action, which would otherwise cause a parent component
        // (like a dialog) or extension window to close
        if (event instanceof KeyboardEvent && event.key === "Escape" && !hasModifierKey(event)) {
          event.preventDefault();
        }

        // Move focus to the menu trigger, since any active menu items are about to be destroyed
        this.elementRef.nativeElement.focus();

        this.destroyMenu();
      });
  }

  /**
   * Sets up a listener for clicks outside the menu overlay.
   * We skip(1) because the initial right-click event that opens the menu is also
   * considered an outside click event, which would immediately close the menu
   */
  private setupMenuCloseListener() {
    if (!this.overlayRef) {
      return;
    }

    this.menuCloseListenerSub = this.overlayRef
      .outsidePointerEvents()
      .pipe(skip(1), takeUntil(this.overlayRef.detachments()))
      .subscribe((_) => {
        this.destroyMenu();
      });
  }

  private disposeAll() {
    if (this.closingTimer !== undefined) {
      window.clearTimeout(this.closingTimer);
      this.closingTimer = undefined;
    }
    this.unsubscribeClosingActions();
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  private unsubscribeClosingActions() {
    this.closedEventsSub?.unsubscribe();
    this.keyDownEventsSub?.unsubscribe();
    this.menuCloseListenerSub?.unsubscribe();
    this.closedEventsSub = null;
    this.keyDownEventsSub = null;
    this.menuCloseListenerSub = null;
  }

  private cancelPendingClose() {
    if (this.closingTimer === undefined || this.overlayRef == null) {
      return;
    }
    window.clearTimeout(this.closingTimer);
    this.closingTimer = undefined;
    this.overlayRef.removePanelClass("bit-menu-panel--closing");
    this.isOpen = true;
    this.hostTooltip?.suppressed.set(true);
    this.setupClosingActions(false);
    this.setupMenuCloseListener();
  }

  private finishClose() {
    if (this.closingTimer !== undefined) {
      window.clearTimeout(this.closingTimer);
      this.closingTimer = undefined;
    }
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.menu().closed.emit();
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
