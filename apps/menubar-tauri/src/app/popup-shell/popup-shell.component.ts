import { AfterViewInit, Component, ElementRef, OnDestroy } from "@angular/core";
import { RouterOutlet } from "@angular/router";

import { BARWARDEN_BRAND } from "../brand";
import { PopupStateStore } from "../popup-state";
import { FloatingTabSwitcherComponent, type FloatingTab } from "./floating-tab-switcher.component";

let nextRoutedHeadingId = 0;

@Component({
  selector: "bw-popup-shell",
  standalone: true,
  imports: [FloatingTabSwitcherComponent, RouterOutlet],
  template: `
    <section class="popup-shell" [attr.aria-label]="productName">
      <div class="popup-tab-scroll-host" data-testid="popup-shell-scroll-region">
        <router-outlet />
      </div>
      <bw-floating-tab-switcher [tabs]="tabs" />
    </section>
  `,
})
export class PopupShellComponent implements AfterViewInit, OnDestroy {
  readonly productName = BARWARDEN_BRAND.productName;
  private routeObserver?: MutationObserver;

  constructor(
    private readonly store: PopupStateStore,
    private readonly host: ElementRef<HTMLElement>,
  ) {}

  ngAfterViewInit(): void {
    this.labelRoutedScrollRegions();
    if (typeof MutationObserver === "undefined") return;
    this.routeObserver = new MutationObserver(() => this.labelRoutedScrollRegions());
    this.routeObserver.observe(this.host.nativeElement, { childList: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.routeObserver?.disconnect();
  }

  protected get tabs(): readonly FloatingTab[] {
    return [
      {
        label: "Vault",
        translationKey: "vault",
        path: "/tabs/vault",
        icon: "bwi-vault",
      },
      {
        label: "OTP",
        path: "/tabs/otp",
        icon: "bwi-clock",
      },
      {
        label: "Generator",
        translationKey: "generator",
        path: "/tabs/generator",
        icon: "bwi-generate",
      },
      ...(this.store.snapshot().isSendDisabled
        ? []
        : [
            {
              label: "Send",
              path: "/tabs/send",
              icon: "bwi-send",
            },
          ]),
      {
        label: "Settings",
        translationKey: "settings",
        path: "/tabs/settings",
        icon: "bwi-settings",
      },
    ] as const;
  }

  private labelRoutedScrollRegions(): void {
    for (const region of this.host.nativeElement.querySelectorAll<HTMLElement>(
      '[data-testid="popup-layout-scroll-region"]',
    )) {
      if (region.hasAttribute("aria-label") || region.hasAttribute("aria-labelledby")) continue;
      const heading = region.closest("popup-page")?.querySelector<HTMLHeadingElement>("h1");
      if (!heading) continue;
      heading.id ||= `bw-routed-page-heading-${++nextRoutedHeadingId}`;
      region.setAttribute("aria-labelledby", heading.id);
    }
  }

}
