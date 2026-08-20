import { LiveAnnouncer } from "@angular/cdk/a11y";
import { Injectable, Injector, afterNextRender, inject } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter, Subscription } from "rxjs";

@Injectable({ providedIn: "root" })
export class PopupRouteAnnouncerService {
  private readonly router = inject(Router);
  private readonly live = inject(LiveAnnouncer);
  private readonly injector = inject(Injector);
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
            const heading = Array.from(
              document.querySelectorAll<HTMLElement>("popup-header h1"),
            )
              .find((node) => !node.closest('[hidden],[aria-hidden="true"]'));
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
