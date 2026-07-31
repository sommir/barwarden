import type { HttpTransport } from "../bitwarden-api/bitwarden-api";
import { BrowserHostService } from "./browser-host.service";
import type {
  AccountLockIntentHost,
  HostApi,
  SecureCompareAndSwapHost,
  SecureUuidHost,
} from "./host-api";
import type { LaunchAtLoginHost } from "./launch-at-login";
import { TauriHostService } from "./tauri-host.service";

export type RuntimeHostService = HostApi & SecureCompareAndSwapHost & SecureUuidHost & AccountLockIntentHost & LaunchAtLoginHost & HttpTransport;

export function createDefaultHostService(): RuntimeHostService {
  return isTauriRuntime() ? new TauriHostService() : new BrowserHostService();
}

export function isTauriRuntime(
  runtime: {
    readonly __TAURI_INTERNALS__?: unknown;
    readonly location?: {
      readonly protocol?: string;
      readonly hostname?: string;
    };
  } = globalThis,
): boolean {
  return (
    import.meta.env.PROD ||
    Boolean(runtime.__TAURI_INTERNALS__) ||
    runtime.location?.protocol === "tauri:" ||
    runtime.location?.hostname === "tauri.localhost"
  );
}
