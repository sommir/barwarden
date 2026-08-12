import { describe, expect, it, vi } from "vitest";

import type { AppUpdatePort, AvailableAppUpdate } from "./app-update.port";
import { AppUpdateService } from "./app-update.service";

describe("AppUpdateService", () => {
  it("publishes a discovered release after a manual check", async () => {
    const service = new AppUpdateService(new UpdatePortFake(available("0.2.0", "Fixes")));

    await service.checkManually();

    expect(service.snapshot()).toEqual({
      status: "available",
      version: "0.2.0",
      notes: "Fixes",
      progress: null,
      message: "",
      notificationVisible: true,
    });
    expect(Object.isFrozen(service.snapshot())).toBe(true);
  });

  it("reactively publishes an update discovered in the background", async () => {
    const service = new AppUpdateService(new UpdatePortFake(available("0.2.0", "Fixes")));

    await service.checkInBackground();

    expect(service.view()).toEqual({
      status: "available",
      version: "0.2.0",
      notes: "Fixes",
      progress: null,
      message: "",
      notificationVisible: true,
    });
  });

  it("reports a current release after a manual check", async () => {
    const service = new AppUpdateService(new UpdatePortFake(null));

    await service.checkManually();

    expect(service.snapshot()).toEqual({
      status: "up-to-date",
      version: null,
      notes: null,
      progress: null,
      message: "当前已是最新版本。",
      notificationVisible: false,
    });
  });

  it("does not disrupt the UI after a failed background check", async () => {
    const port = new UpdatePortFake(null);
    port.check.mockRejectedValueOnce(new Error("private updater transport details"));
    const service = new AppUpdateService(port);

    await service.checkInBackground();

    expect(service.snapshot()).toEqual({
      status: "idle",
      version: null,
      notes: null,
      progress: null,
      message: "",
      notificationVisible: false,
    });
  });

  it("sanitizes a failed manual check", async () => {
    const port = new UpdatePortFake(null);
    port.check.mockRejectedValueOnce(new Error("/private/release-key"));
    const service = new AppUpdateService(port);

    await service.checkManually();

    expect(service.snapshot()).toEqual({
      status: "error",
      version: null,
      notes: null,
      progress: null,
      message: "无法检查更新，请重试。",
      notificationVisible: false,
    });
    expect(service.snapshot().message).not.toContain("release-key");
  });

  it("streams download progress before installing the discovered release", async () => {
    const update = available("0.2.0", "Fixes");
    update.downloadAndInstall.mockImplementation(async (onProgress) => {
      onProgress(0.5);
      expect(service.snapshot()).toMatchObject({ status: "downloading", progress: 0.5 });
    });
    const service = new AppUpdateService(new UpdatePortFake(update));
    await service.checkManually();

    await service.downloadAndRestart();

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(service.snapshot()).toEqual({
      status: "idle",
      version: null,
      notes: null,
      progress: null,
      message: "",
      notificationVisible: false,
    });
  });

  it("keeps native install failure details out of the view", async () => {
    const update = available("0.2.0", null);
    update.downloadAndInstall.mockRejectedValueOnce(new Error("private install error"));
    const service = new AppUpdateService(new UpdatePortFake(update));
    await service.checkManually();

    await service.downloadAndRestart();

    expect(service.snapshot()).toMatchObject({
      status: "error",
      message: "无法下载或安装更新，请重试。",
    });
    expect(service.snapshot().message).not.toContain("private install error");
  });

  it("keeps a failed install available for retry", async () => {
    const update = available("0.2.0", null);
    update.downloadAndInstall
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValueOnce(undefined);
    const service = new AppUpdateService(new UpdatePortFake(update));
    await service.checkManually();

    await service.downloadAndRestart();
    await service.downloadAndRestart();

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it("suppresses duplicate checks while one is pending", async () => {
    const port = new UpdatePortFake(null);
    const pending = deferred<AvailableAppUpdate | null>();
    port.check.mockReturnValueOnce(pending.promise);
    const service = new AppUpdateService(port);

    const first = service.checkManually();
    const duplicate = service.checkManually();
    await Promise.resolve();

    expect(port.check).toHaveBeenCalledOnce();
    expect(service.snapshot().status).toBe("checking");

    pending.resolve(null);
    await Promise.all([first, duplicate]);
  });

  it("dismisses an available release without installing it", async () => {
    const service = new AppUpdateService(new UpdatePortFake(available("0.2.0", null)));
    await service.checkManually();

    service.dismiss();

    expect(service.snapshot().status).toBe("idle");
  });

  it("dismisses only the global notification while preserving the available update", async () => {
    const update = available("0.2.0", null);
    const service = new AppUpdateService(new UpdatePortFake(update));
    await service.checkInBackground();

    service.dismissNotification();

    expect(service.snapshot()).toMatchObject({
      status: "available",
      version: "0.2.0",
      notificationVisible: false,
    });
    await service.downloadAndRestart();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  });
});

class UpdatePortFake implements AppUpdatePort {
  readonly check = vi.fn(async () => this.candidate);

  constructor(private readonly candidate: AvailableAppUpdate | null) {}
}

function available(version: string, notes: string | null): AvailableAppUpdate & {
  readonly downloadAndInstall: ReturnType<typeof vi.fn>;
} {
  return {
    version,
    notes,
    downloadAndInstall: vi.fn(async () => undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
