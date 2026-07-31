import { CdkVirtualScrollViewport, ScrollingModule } from "@angular/cdk/scrolling";
import { AsyncPipe, NgClass, NgTemplateOutlet } from "@angular/common";
import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  type OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";
import { map, of } from "rxjs";

import {
  DisclosureComponent,
  DisclosureTriggerForDirective,
  IconComponent,
  ItemGroupComponent,
  ScrollLayoutDirective,
  SectionComponent,
  SectionHeaderComponent,
  TypographyDirective,
} from "../../official-ui/official-components";
import { PopupStateStore } from "../../popup-state";
import { SettingsService } from "../../settings/settings.service";
import type { VaultItem } from "../../vault-demo";
import {
  type RetainedVaultListCipherView,
  toRetainedPopupCipherView,
} from "../../vault/popup-cipher-view.adapter";
import type { VaultSectionView } from "../../vault/vault.facade";
import type { ItemMenuOpenChange } from "./item-more-options.component";
import {
  RetainedVaultListItemComponent,
  type VaultRowFieldAction,
} from "./retained-vault-list-item.component";

@Component({
  selector: "app-vault-list-items-container",
  standalone: true,
  imports: [
    AsyncPipe,
    DisclosureComponent,
    DisclosureTriggerForDirective,
    IconComponent,
    ItemGroupComponent,
    NgClass,
    NgTemplateOutlet,
    ScrollingModule,
    ScrollLayoutDirective,
    RetainedVaultListItemComponent,
    SectionComponent,
    SectionHeaderComponent,
    TypographyDirective,
  ],
  templateUrl: "./vault-list-items-container.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultListItemsContainerComponent implements AfterViewInit, OnDestroy {
  @ViewChild(CdkVirtualScrollViewport)
  private readonly viewPort?: CdkVirtualScrollViewport;
  protected readonly itemHeight$;
  protected readonly trackByCipher = (
    _index: number,
    cipher: RetainedVaultListCipherView,
  ): string => cipher.id;
  protected ciphers: readonly RetainedVaultListCipherView[] = [];

  private currentSection!: VaultSectionView;
  private embeddedMode = false;
  private viewportRerenderTimeout?: number;

  @Input({ required: true })
  set section(section: VaultSectionView) {
    this.currentSection = section;
    this.ciphers = section.items
      .map(toRetainedPopupCipherView)
      .filter((cipher): cipher is RetainedVaultListCipherView => cipher !== null);
    this.rerenderViewport();
  }
  get section(): VaultSectionView {
    return this.currentSection;
  }

  @Input() showQuickCopyActions = true;
  @Input() openMenuRowId: string | null = null;
  /**
   * The hierarchy uses PopupPage's outer scroll region as the CDK scroll host.
   * Keeping the viewport external avoids nested scrolling while ensuring only
   * the visible rows and a small buffer exist in the WebKit DOM.
   */
  @Input()
  set embedded(value: boolean) {
    this.embeddedMode = value;
    this.rerenderViewport();
  }
  get embedded(): boolean {
    return this.embeddedMode;
  }
  @Output() view = new EventEmitter<VaultItem>();
  @Output() fill = new EventEmitter<VaultRowFieldAction>();
  @Output() edit = new EventEmitter<VaultItem>();
  @Output() clone = new EventEmitter<VaultItem>();
  @Output() launch = new EventEmitter<VaultItem>();
  @Output() toggleFavorite = new EventEmitter<VaultItem>();
  @Output() archive = new EventEmitter<VaultItem>();
  @Output() delete = new EventEmitter<VaultItem>();
  @Output() menuOpenChange = new EventEmitter<VaultMenuOpenChange>();

  constructor(
    private readonly store: PopupStateStore,
    settings: SettingsService,
  ) {
    this.itemHeight$ = of(settings.snapshot().compactMode).pipe(
      map((enabled) => (enabled ? 53 : 59)),
    );
  }

  ngAfterViewInit(): void {
    this.rerenderViewport();
  }

  protected sectionOpenState(): boolean {
    return this.section.forcedOpen ||
      !this.section.collapsible ||
      this.store.isVaultSectionOpen(this.section.id);
  }

  protected toggleSectionOpen(): void {
    if (this.section.collapsible && !this.section.forcedOpen) {
      this.store.toggleVaultSection(this.section.id);
    }
  }

  protected rerenderViewport(): void {
    if (this.viewportRerenderTimeout !== undefined) {
      window.clearTimeout(this.viewportRerenderTimeout);
    }
    this.viewportRerenderTimeout = window.setTimeout(() => {
      this.viewPort?.checkViewportSize();
      this.viewportRerenderTimeout = undefined;
    });
  }

  ngOnDestroy(): void {
    if (this.viewportRerenderTimeout !== undefined) {
      window.clearTimeout(this.viewportRerenderTimeout);
    }
  }

  protected emitMenuOpen(change: ItemMenuOpenChange): void {
    this.menuOpenChange.emit({ rowId: `${this.section.id}:${change.cipherId}`, open: change.open });
  }
}

export interface VaultMenuOpenChange {
  readonly rowId: string;
  readonly open: boolean;
}
