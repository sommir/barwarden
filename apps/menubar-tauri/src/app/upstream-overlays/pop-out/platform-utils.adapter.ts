import { Injectable } from "@angular/core";

import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import type { ClientType, DeviceType } from "@bitwarden/common/enums";

/** Minimal native-only PlatformUtils implementation required by the official pop-out component. */
@Injectable({ providedIn: "root" })
export class TauriPopupPlatformUtilsAdapter extends PlatformUtilsService {
  getDevice(): DeviceType { return "desktop" as unknown as DeviceType; }
  getDeviceString(): string { return "desktop"; }
  getClientType(): ClientType { return "desktop" as ClientType; }
  isFirefox(): boolean { return false; }
  isChrome(): boolean { return false; }
  isEdge(): boolean { return false; }
  isOpera(): boolean { return false; }
  isVivaldi(): boolean { return false; }
  isSafari(): boolean { return false; }
  isChromium(): boolean { return false; }
  isMacAppStore(): boolean { return false; }
  isPopupOpen(): Promise<boolean> { return Promise.resolve(true); }
  isAnyViewFocused(): Promise<boolean> { return Promise.resolve(true); }
  launchUri(_uri: string, _options?: unknown): void {}
  getApplicationVersion(): Promise<string> { return Promise.resolve("0.1.0"); }
  getApplicationVersionNumber(): Promise<string> { return Promise.resolve("0.1.0"); }
  supportsWebAuthn(_win: Window): boolean { return false; }
  supportsDuo(): boolean { return false; }
  supportsAutofill(): boolean { return false; }
  supportsFileDownloads(): boolean { return false; }
  showToast(_type: "error" | "success" | "warning" | "info", _title: string, _text: string | string[]): void {}
  isDev(): boolean { return false; }
  isSelfHost(): boolean { return false; }
  copyToClipboard(_text: string): boolean { return false; }
  readFromClipboard(): Promise<string> { return Promise.resolve(""); }
  supportsSecureStorage(): boolean { return true; }
  getAutofillKeyboardShortcut(): Promise<string> { return Promise.resolve(""); }
  packageType(): Promise<string | null> { return Promise.resolve("tauri"); }
}
