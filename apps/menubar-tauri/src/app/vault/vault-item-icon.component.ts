import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

import { environmentFromServerUrl } from "../auth/vault-sync.shared";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import type { VaultItem, VaultItemType } from "./vault-item.model";

@Component({
  selector: "bw-vault-item-icon",
  standalone: true,
  template: `
    <span
      class="vault-item-icon-slot"
      aria-hidden="true"
      [style.width.px]="28"
      [style.height.px]="28"
    >
      @if (resolvedImageUrl; as imageUrl) {
        @if (!imageFailed) {
          <img
            class="vault-item-icon-image"
            [class.is-pending]="!imageLoaded"
            [src]="imageUrl"
            alt=""
            decoding="async"
            loading="lazy"
            [style.width.px]="24"
            [style.height.px]="24"
            (load)="handleImageLoad()"
            (error)="handleImageError()"
          />
        }
        @if (!imageLoaded || imageFailed) {
          <i [class]="fallbackClass"></i>
        }
      } @else {
        <i [class]="fallbackClass"></i>
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultItemIconComponent {
  private currentItem!: VaultItem;
  protected resolvedImageUrl: string | null = null;
  protected fallbackClass = "";
  protected imageLoaded = false;
  protected imageFailed = false;

  @Input({ required: true })
  set item(item: VaultItem) {
    this.currentItem = item;
    this.resolvedImageUrl = this.buildFaviconUrl();
    this.fallbackClass = `bwi ${FALLBACK_ICON_CLASSES[item.type]}`;
    this.imageLoaded = false;
    this.imageFailed = false;
  }

  get item(): VaultItem {
    return this.currentItem;
  }

  constructor(
    private readonly store: PopupStateStore,
    private readonly settingsService: SettingsService,
  ) {}

  protected handleImageLoad(): void {
    this.imageLoaded = true;
    this.imageFailed = false;
  }

  protected handleImageError(): void {
    this.imageLoaded = false;
    this.imageFailed = true;
  }

  private buildFaviconUrl(): string | null {
    if (!this.settingsService.snapshot().showFavicons || this.item.type !== "login") {
      return null;
    }

    const uri = this.item.uris[0]?.uri;
    if (!uri) {
      return null;
    }

    try {
      const website = new URL(uri);
      if (website.protocol !== "http:" && website.protocol !== "https:") {
        return null;
      }

      const hostname = canonicalWebsiteHostname(website.hostname);
      if (hostname === null) {
        return null;
      }

      const snapshot = this.store.snapshot();
      const iconsUrl = snapshot.activeSession?.environment.iconsUrl ??
        environmentFromServerUrl(snapshot.serverUrl).iconsUrl;
      return iconsUrl ? `${iconsUrl.replace(/\/+$/g, "")}/${hostname}/icon.png` : null;
    } catch {
      return null;
    }
  }
}

function canonicalWebsiteHostname(parsedHostname: string): string | null {
  const lowercaseHostname = parsedHostname.toLowerCase();
  const hostname = lowercaseHostname.endsWith(".")
    ? lowercaseHostname.slice(0, -1)
    : lowercaseHostname;

  if (hostname.endsWith(".onion") || hostname.endsWith(".i2p")) {
    return null;
  }

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname;
  }

  if (!hostname.includes(".") || hostname.length > 253) {
    return null;
  }

  const labels = hostname.split(".");
  return labels.every((label) => DNS_HOSTNAME_LABEL.test(label)) ? hostname : null;
}

const DNS_HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const FALLBACK_ICON_CLASSES: Record<VaultItemType, string> = {
  login: "bwi-globe",
  card: "bwi-credit-card",
  identity: "bwi-id-card",
  "secure-note": "bwi-sticky-note",
  "ssh-key": "bwi-key",
};
