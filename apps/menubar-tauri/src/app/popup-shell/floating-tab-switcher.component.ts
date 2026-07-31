import { Component, DestroyRef, Input, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router } from "@angular/router";
import { filter } from "rxjs";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";

import { OfficialI18nService } from "../official-ui/official-i18n.service";

export type FloatingTabIcon =
  | "bwi-vault"
  | "bwi-clock"
  | "bwi-generate"
  | "bwi-send"
  | "bwi-settings";

export interface FloatingTab {
  readonly label: string;
  readonly translationKey?: string;
  readonly path: `/tabs/${"vault" | "otp" | "generator" | "send" | "settings"}`;
  readonly icon: FloatingTabIcon;
}

@Component({
  selector: "bw-floating-tab-switcher",
  standalone: true,
  template: `
    <nav
      class="floating-tab-switcher macos-glass-navigation"
      [attr.aria-label]="translate('i18nPrimaryNavigation')"
      [style.--segment-count]="tabs.length"
      [style.--selected-index]="selectedIndex"
    >
      <span class="floating-tab-switcher__indicator" aria-hidden="true"></span>
      @for (tab of tabs; track tab.path) {
        <button
          type="button"
          class="floating-tab-switcher__segment macos-pressable"
          [attr.aria-current]="isCurrent(tab.path) ? 'page' : null"
          (click)="activate(tab, $event)"
        >
          <i class="bwi floating-tab-switcher__icon {{ tab.icon }}" aria-hidden="true"></i>
          <span class="floating-tab-switcher__label">
            {{ tab.translationKey ? translate(tab.translationKey) : tab.label }}
          </span>
        </button>
      }
    </nav>
  `,
})
export class FloatingTabSwitcherComponent {
  @Input({ required: true }) tabs: readonly FloatingTab[] = [];

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly i18n = inject(OfficialI18nService);
  private readonly activeLocale = toSignal(this.i18n.locale$, {
    initialValue: this.i18n.translationLocale,
  });
  private currentUrl = this.router.url;
  private pendingPath: FloatingTab["path"] | null = null;

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl = event.urlAfterRedirects;
        this.pendingPath = null;
      });
  }

  get selectedIndex(): number {
    const activeIndex = this.tabs.findIndex((tab) =>
      this.pendingPath === null
        ? this.isCurrentPath(tab.path)
        : tab.path === this.pendingPath,
    );
    return activeIndex === -1 ? 0 : activeIndex;
  }

  isCurrent(path: FloatingTab["path"]): boolean {
    return this.tabs[this.selectedIndex]?.path === path;
  }

  async activate(tab: FloatingTab, event: MouseEvent): Promise<void> {
    const button = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : undefined;
    this.pendingPath = tab.path;

    try {
      if (await this.router.navigateByUrl(tab.path)) {
        button?.focus({ preventScroll: true });
      } else {
        this.pendingPath = null;
      }
    } catch {
      // Keep the current segment and focus unchanged when router navigation is rejected.
      this.pendingPath = null;
    }
  }

  protected translate(key: string): string {
    this.activeLocale();
    return this.i18n.t(key);
  }

  private isCurrentPath(path: FloatingTab["path"]): boolean {
    return this.currentUrl.split(/[?#]/, 1)[0] === path;
  }
}
