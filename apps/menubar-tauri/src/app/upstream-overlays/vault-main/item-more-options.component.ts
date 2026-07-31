import {
  Component,
  EventEmitter,
  Injectable,
  Input,
  type OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";
import {
  BitIconButtonComponent,
  ItemActionComponent,
  MenuComponent,
  MenuItemComponent,
  MenuTriggerForDirective,
} from "../../official-ui/official-components";
import type { RetainedPopupCipherView } from "../../vault/popup-cipher-view.adapter";
import { I18nPipe } from "../../official-ui/official-ui-common";
import { translateOfficialMessage } from "../../official-ui/official-i18n.service";

@Component({
  selector: "app-item-more-options",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    I18nPipe,
    ItemActionComponent,
    MenuComponent,
    MenuItemComponent,
    MenuTriggerForDirective,
  ],
  templateUrl: "./item-more-options.component.html",
})
export class ItemMoreOptionsComponent implements OnDestroy {
  private isMenuOpen = false;

  @ViewChild(MenuTriggerForDirective) private menuTrigger?: MenuTriggerForDirective;
  @ViewChild("moreOptions") private menu?: MenuComponent;

  @Input({ required: true }) cipher!: RetainedPopupCipherView;
  @Input()
  set menuOpen(open: boolean) {
    this.isMenuOpen = open;
    if (!open && this.menuTrigger?.isOpen) {
      this.menuTrigger.toggleMenu();
    }
  }
  get menuOpen(): boolean {
    return this.isMenuOpen;
  }

  @Output() view = new EventEmitter<RetainedPopupCipherView>();
  @Output() edit = new EventEmitter<RetainedPopupCipherView>();
  @Output() clone = new EventEmitter<RetainedPopupCipherView>();
  @Output() toggleFavorite = new EventEmitter<RetainedPopupCipherView>();
  @Output() archive = new EventEmitter<RetainedPopupCipherView>();
  @Output() delete = new EventEmitter<RetainedPopupCipherView>();
  @Output() menuOpenChange = new EventEmitter<ItemMenuOpenChange>();

  constructor(private readonly menuCoordinator: RetainedVaultMenuCoordinator) {}

  ngOnDestroy(): void {
    this.menuCoordinator.closed(this);
  }

  protected get favoriteText(): string {
    return translateOfficialMessage(
      this.cipher.favorite ? "i18nRemoveFavorite" : "i18nAddFavorite",
    );
  }

  protected menuToggled(): void {
    const opening = !this.isMenuOpen;
    this.isMenuOpen = opening;
    this.emitMenuOpenChange();
    if (opening) {
      this.menuCoordinator.open(this);
    } else {
      this.menuCoordinator.closed(this);
    }
  }

  protected menuClosed(): void {
    if (!this.isMenuOpen) {
      return;
    }
    this.isMenuOpen = false;
    this.menuCoordinator.closed(this);
    this.emitMenuOpenChange();
  }

  protected onView(): void {
    this.view.emit(this.cipher);
    this.closeMenu();
  }

  protected onToggleFavorite(): void {
    this.toggleFavorite.emit(this.cipher);
    this.closeMenu();
  }

  protected onEdit(): void {
    this.edit.emit(this.cipher);
    this.closeMenu();
  }

  protected onClone(): void {
    this.clone.emit(this.cipher);
    this.closeMenu();
  }

  protected onArchive(): void {
    this.archive.emit(this.cipher);
    this.closeMenu();
  }

  protected onDelete(): void {
    this.delete.emit(this.cipher);
    this.closeMenu();
  }

  protected closeMenu(): void {
    if (this.menuTrigger?.isOpen) {
      this.menuTrigger.toggleMenu();
    }
  }

  protected handleMenuKeydown(event: KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const keyManager = this.menu?.keyManager();
    if (event.key === "ArrowDown") {
      keyManager?.setNextItemActive();
    } else if (event.key === "ArrowUp") {
      keyManager?.setPreviousItemActive();
    } else if (event.key === "Home") {
      keyManager?.setFirstItemActive();
    } else {
      keyManager?.setLastItemActive();
    }
    event.stopPropagation();
  }

  closeFromCoordinator(): void {
    if (this.menuTrigger?.isOpen) {
      this.menuTrigger.toggleMenu();
    }
    if (this.isMenuOpen) {
      this.isMenuOpen = false;
      this.emitMenuOpenChange();
    }
  }

  private emitMenuOpenChange(): void {
    this.menuOpenChange.emit({ cipherId: this.cipher.id, open: this.isMenuOpen });
  }
}

export interface ItemMenuOpenChange {
  readonly cipherId: string;
  readonly open: boolean;
}

@Injectable({ providedIn: "root" })
export class RetainedVaultMenuCoordinator {
  private current: ItemMoreOptionsComponent | null = null;

  open(next: ItemMoreOptionsComponent): void {
    if (this.current !== next) {
      this.current?.closeFromCoordinator();
      this.current = next;
    }
  }

  closed(menu: ItemMoreOptionsComponent): void {
    if (this.current === menu) {
      this.current = null;
    }
  }

  closeAll(): void {
    this.current?.closeFromCoordinator();
    this.current = null;
  }
}
