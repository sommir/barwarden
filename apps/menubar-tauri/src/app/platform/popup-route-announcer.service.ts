import { LiveAnnouncer } from "@angular/cdk/a11y";
import { DOCUMENT } from "@angular/common";
import { Injectable, Injector, afterNextRender, inject } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter, Subscription } from "rxjs";

@Injectable({ providedIn: "root" })
export class PopupRouteAnnouncerService {
  private readonly router = inject(Router);
  private readonly live = inject(LiveAnnouncer);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private subscription?: Subscription;
  private latestNavigationId = 0;
  private suppressNextNavigation = true;

  start(): void {
    if (this.subscription) return;
    this.subscription = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    ).subscribe((event) => {
      if (this.suppressNextNavigation) {
        this.suppressNextNavigation = false;
        return;
      }
      this.latestNavigationId = event.id;
      afterNextRender(
        {
          read: () => {
            if (this.latestNavigationId !== event.id) return;
            const owner = deepestActivePrimaryRouteHost(this.document);
            const heading = owner
              ? Array.from(owner.querySelectorAll<HTMLElement>("popup-header h1"))
                .find((node) => isRenderedHeading(node, owner))
              : undefined;
            const text = heading?.textContent?.replace(/\s+/g, " ").trim() ?? "";
            if (text) void this.live.announce(text, "polite");
          },
        },
        { injector: this.injector },
      );
    });
  }

  destroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.latestNavigationId = 0;
    this.suppressNextNavigation = true;
    this.live.clear();
  }
}

function deepestActivePrimaryRouteHost(document: Document): HTMLElement | null {
  const primaryOutlets = Array.from(
    document.querySelectorAll<HTMLElement>("router-outlet"),
  ).filter((outlet) => outlet.isConnected && isPrimaryOutlet(outlet));
  const rootOutlet = primaryOutlets.find((candidate) =>
    !primaryOutlets.some((outlet) =>
      outlet !== candidate && activatedRouteHost(outlet)?.contains(candidate)
    )
  );
  let owner = rootOutlet ? activatedRouteHost(rootOutlet) : null;

  while (owner) {
    const nestedOwner = Array.from(
      owner.querySelectorAll<HTMLElement>("router-outlet"),
    )
      .filter(isPrimaryOutlet)
      .map(activatedRouteHost)
      .find((candidate): candidate is HTMLElement =>
        candidate !== null && owner!.contains(candidate)
      );
    if (!nestedOwner) return owner;
    owner = nestedOwner;
  }

  return null;
}

function isPrimaryOutlet(outlet: HTMLElement): boolean {
  const name = outlet.getAttribute("name")?.trim();
  return !name || name === "primary";
}

function activatedRouteHost(outlet: HTMLElement): HTMLElement | null {
  const host = outlet.nextElementSibling as HTMLElement | null;
  return host?.isConnected && host.parentElement === outlet.parentElement ? host : null;
}

function isRenderedHeading(heading: HTMLElement, owner: HTMLElement): boolean {
  if (!heading.isConnected || !owner.isConnected || !owner.contains(heading)) return false;

  for (let node: HTMLElement | null = heading; node; node = node.parentElement) {
    if (
      node.hasAttribute("hidden") ||
      node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden")?.trim().toLowerCase() === "true"
    ) {
      return false;
    }
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }

  return true;
}
