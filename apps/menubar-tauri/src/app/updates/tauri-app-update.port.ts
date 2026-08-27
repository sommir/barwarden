import { isTauriRuntime } from "../../host/default-host.service";

import type { AppUpdatePort, AvailableAppUpdate } from "./app-update.port";

export type TauriDownloadEvent =
  | { readonly event: "Started"; readonly data: { readonly contentLength?: number } }
  | { readonly event: "Progress"; readonly data: { readonly chunkLength: number } }
  | { readonly event: "Finished" };

export interface TauriNativeUpdate {
  readonly version: string;
  readonly body?: string;
  downloadAndInstall(onEvent?: (event: TauriDownloadEvent) => void): Promise<void>;
}

export interface TauriUpdaterApi {
  check(options?: { readonly timeout?: number }): Promise<TauriNativeUpdate | null>;
  relaunch(): Promise<void>;
}

export class TauriAppUpdatePort implements AppUpdatePort {
  constructor(private readonly api: TauriUpdaterApi) {}

  async check(): Promise<AvailableAppUpdate | null> {
    const update = await this.api.check({ timeout: 15_000 });
    if (!update) {
      return null;
    }

    return {
      version: update.version,
      notes: update.body ?? null,
      downloadAndInstall: async (onProgress) => {
        let contentLength: number | null = null;
        let downloaded = 0;
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = positiveOrNull(event.data.contentLength);
              onProgress(contentLength === null ? null : 0);
              break;
            case "Progress":
              downloaded += event.data.chunkLength;
              onProgress(contentLength === null ? null : Math.min(1, downloaded / contentLength));
              break;
            case "Finished":
              onProgress(contentLength === null ? null : 1);
              break;
          }
        });
        await this.api.relaunch();
      },
    };
  }
}

export async function createAppUpdatePort(
  native = isTauriRuntime(),
): Promise<AppUpdatePort | null> {
  if (!native) {
    return null;
  }

  const [updater, process] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  return new TauriAppUpdatePort({ check: updater.check, relaunch: process.relaunch });
}

export function createDefaultAppUpdatePort(): AppUpdatePort | null {
  return isTauriRuntime() ? new LazyTauriAppUpdatePort() : null;
}

class LazyTauriAppUpdatePort implements AppUpdatePort {
  private port: Promise<AppUpdatePort | null> | null = null;

  async check(): Promise<AvailableAppUpdate | null> {
    this.port ??= createAppUpdatePort(true);
    return (await this.port)?.check() ?? null;
  }
}

function positiveOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}
