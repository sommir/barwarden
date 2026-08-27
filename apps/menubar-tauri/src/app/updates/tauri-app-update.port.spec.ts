import { describe, expect, it, vi } from "vitest";

import {
  createAppUpdatePort,
  type TauriDownloadEvent,
  type TauriNativeUpdate,
  type TauriUpdaterApi,
  TauriAppUpdatePort,
} from "./tauri-app-update.port";

describe("TauriAppUpdatePort", () => {
  it("installs then relaunches a native update", async () => {
    const native = new NativeUpdateFake("0.2.0", "Fixes");
    const api = new TauriUpdaterFake(native);
    const candidate = await new TauriAppUpdatePort(api).check();
    const progress: Array<number | null> = [];

    await candidate!.downloadAndInstall((value) => progress.push(value));

    expect(api.check).toHaveBeenCalledWith({ timeout: 15_000 });
    expect(native.downloadAndInstall).toHaveBeenCalledOnce();
    expect(api.relaunch).toHaveBeenCalledOnce();
    expect(progress).toEqual([0, 0.5, 1]);
  });

  it("maps an absent native update to null", async () => {
    const candidate = await new TauriAppUpdatePort(new TauriUpdaterFake(null)).check();

    expect(candidate).toBeNull();
  });

  it("does not load the native updater in a browser runtime", async () => {
    await expect(createAppUpdatePort(false)).resolves.toBeNull();
  });
});

class TauriUpdaterFake implements TauriUpdaterApi {
  readonly check = vi.fn(async () => this.candidate);
  readonly relaunch = vi.fn(async () => undefined);

  constructor(private readonly candidate: TauriNativeUpdate | null) {}
}

class NativeUpdateFake implements TauriNativeUpdate {
  readonly downloadAndInstall = vi.fn(async (onEvent: (event: TauriDownloadEvent) => void) => {
    onEvent({ event: "Started", data: { contentLength: 20 } });
    onEvent({ event: "Progress", data: { chunkLength: 10 } });
    onEvent({ event: "Finished" });
  });

  constructor(
    readonly version: string,
    readonly body?: string,
  ) {}
}
