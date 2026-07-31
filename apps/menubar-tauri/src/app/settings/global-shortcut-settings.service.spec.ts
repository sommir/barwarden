import { describe, expect, it, vi } from "vitest";

import type {
  GlobalShortcutBinding,
  GlobalShortcutHost,
  GlobalShortcutMutationOutcome,
  GlobalShortcutSnapshot,
} from "../../host/global-shortcut";
import { GlobalShortcutSettingsService } from "./global-shortcut-settings.service";

const optionB = binding(["option"], "KeyB");
const commandShiftL = binding(["shift", "command"], "KeyL");

describe("GlobalShortcutSettingsService", () => {
  it("loads one immutable native snapshot", async () => {
    const host = new ShortcutHostFake();
    const service = new GlobalShortcutSettingsService(host);

    await service.load();

    expect(service.snapshot()).toEqual({
      shortcut: optionB,
      availability: "active",
      pending: false,
      message: "",
    });
    expect(Object.isFrozen(service.snapshot())).toBe(true);
    expect(Object.isFrozen(service.snapshot().shortcut)).toBe(true);
    expect(Object.isFrozen(service.snapshot().shortcut?.modifiers)).toBe(true);
  });

  it("exposes a sanitized message for an unavailable startup snapshot", async () => {
    const host = new ShortcutHostFake();
    host.snapshotValue = unavailable(optionB);
    const service = new GlobalShortcutSettingsService(host);

    await service.load();

    expect(service.snapshot()).toEqual({
      shortcut: optionB,
      availability: "unavailable",
      pending: false,
      message: "快捷键已被占用",
    });
  });

  it("publishes the native snapshot after a successful replacement", async () => {
    const host = new ShortcutHostFake();
    host.setOutcome = outcome("updated", active(commandShiftL));
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    await service.replace(commandShiftL);

    expect(host.setGlobalShortcut).toHaveBeenCalledWith(commandShiftL);
    expect(service.snapshot()).toEqual({
      shortcut: commandShiftL,
      availability: "active",
      pending: false,
      message: "",
    });
  });

  it("treats an unchanged replacement as a successful no-op", async () => {
    const host = new ShortcutHostFake();
    host.setOutcome = outcome("unchanged", active(optionB));
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    await service.replace(optionB);

    expect(service.snapshot()).toMatchObject({
      shortcut: optionB,
      availability: "active",
      pending: false,
      message: "",
    });
  });

  it("uses the native snapshot and a validation message for invalid input", async () => {
    const host = new ShortcutHostFake();
    host.setOutcome = outcome("invalid", active(optionB));
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    await service.replace(commandShiftL);

    expect(service.snapshot()).toMatchObject({
      shortcut: optionB,
      message: "请输入有效的快捷键",
      pending: false,
    });
  });

  it("keeps the previous shortcut when replacement is unavailable", async () => {
    const host = new ShortcutHostFake();
    host.setOutcome = outcome("unavailable", active(optionB));
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    await service.replace(commandShiftL);

    expect(service.snapshot()).toMatchObject({
      shortcut: optionB,
      message: "快捷键已被占用",
      pending: false,
    });
  });

  it("keeps private failure details out of the reader-facing state", async () => {
    const host = new ShortcutHostFake();
    host.setOutcome = outcome("failed", active(optionB));
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    await service.replace(commandShiftL);

    expect(service.snapshot()).toMatchObject({
      shortcut: optionB,
      message: "无法更新快捷键，请重试。",
      pending: false,
    });
  });

  it("sanitizes rejected host mutations", async () => {
    const host = new ShortcutHostFake();
    host.setGlobalShortcut.mockRejectedValueOnce(new Error("private platform detail"));
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    await service.replace(commandShiftL);

    expect(service.snapshot()).toMatchObject({
      shortcut: optionB,
      message: "无法更新快捷键，请重试。",
      pending: false,
    });
    expect(service.snapshot().message).not.toContain("private platform detail");
  });

  it("clears the shortcut from the native snapshot", async () => {
    const host = new ShortcutHostFake();
    host.clearOutcome = outcome("updated", cleared());
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    await service.clear();

    expect(host.clearGlobalShortcut).toHaveBeenCalledTimes(1);
    expect(service.snapshot()).toEqual({
      shortcut: null,
      availability: "cleared",
      pending: false,
      message: "",
    });
  });

  it("suppresses duplicate replacement submissions while pending", async () => {
    const host = new ShortcutHostFake();
    const pending = deferred<GlobalShortcutMutationOutcome>();
    host.setGlobalShortcut.mockImplementationOnce(async () => pending.promise);
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    const first = service.replace(commandShiftL);
    const duplicate = service.replace(binding(["shift", "command"], "KeyL"));
    await Promise.resolve();

    expect(host.setGlobalShortcut).toHaveBeenCalledTimes(1);
    expect(service.snapshot().pending).toBe(true);

    pending.resolve(outcome("updated", active(commandShiftL)));
    await Promise.all([first, duplicate]);
    expect(service.snapshot().pending).toBe(false);
  });

  it("serializes distinct mutations", async () => {
    const host = new ShortcutHostFake();
    const replacement = deferred<GlobalShortcutMutationOutcome>();
    host.setGlobalShortcut.mockImplementationOnce(async () => replacement.promise);
    host.clearOutcome = outcome("updated", cleared());
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    const replacePromise = service.replace(commandShiftL);
    const clearPromise = service.clear();
    await Promise.resolve();

    expect(host.setGlobalShortcut).toHaveBeenCalledTimes(1);
    expect(host.clearGlobalShortcut).not.toHaveBeenCalled();

    replacement.resolve(outcome("updated", active(commandShiftL)));
    await replacePromise;
    await clearPromise;

    expect(host.clearGlobalShortcut).toHaveBeenCalledTimes(1);
    expect(service.snapshot().shortcut).toBeNull();
    expect(service.snapshot().pending).toBe(false);
  });

  it("ignores stale host completion after destroy", async () => {
    const host = new ShortcutHostFake();
    const pending = deferred<GlobalShortcutMutationOutcome>();
    host.setGlobalShortcut.mockImplementationOnce(async () => pending.promise);
    const service = new GlobalShortcutSettingsService(host);
    await service.load();

    const replacement = service.replace(commandShiftL);
    await Promise.resolve();
    service.ngOnDestroy();
    const destroyedView = service.snapshot();

    pending.resolve(outcome("updated", active(commandShiftL)));
    await replacement;

    expect(service.snapshot()).toBe(destroyedView);
    expect(service.snapshot()).toMatchObject({
      shortcut: optionB,
      pending: false,
    });
  });
});

class ShortcutHostFake implements GlobalShortcutHost {
  snapshotValue: GlobalShortcutSnapshot = active(optionB);
  setOutcome: GlobalShortcutMutationOutcome = outcome("updated", active(commandShiftL));
  clearOutcome: GlobalShortcutMutationOutcome = outcome("updated", cleared());

  readonly getGlobalShortcut = vi.fn(async () => this.snapshotValue);
  readonly setGlobalShortcut = vi.fn(async (_shortcut: GlobalShortcutBinding) => this.setOutcome);
  readonly clearGlobalShortcut = vi.fn(async () => this.clearOutcome);
}

function binding(
  modifiers: GlobalShortcutBinding["modifiers"],
  code: string,
): GlobalShortcutBinding {
  return { modifiers, code };
}

function active(shortcut: GlobalShortcutBinding): GlobalShortcutSnapshot {
  return { shortcut, availability: "active" };
}

function cleared(): GlobalShortcutSnapshot {
  return { shortcut: null, availability: "cleared" };
}

function unavailable(shortcut: GlobalShortcutBinding): GlobalShortcutSnapshot {
  return { shortcut, availability: "unavailable" };
}

function outcome(
  status: GlobalShortcutMutationOutcome["status"],
  snapshot: GlobalShortcutSnapshot,
): GlobalShortcutMutationOutcome {
  return { status, snapshot };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
