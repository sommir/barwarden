import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PasteError,
  SecureStorageError,
  type PasteFailureCode,
  type TauriInvoke,
} from "./host-api";
import { BiometricHostError } from "./biometric-host";
import { GlobalShortcutHostError } from "./global-shortcut";
import {
  LaunchAtLoginHostError,
  type NativeAutostartApi,
} from "./launch-at-login";
import { TauriHostService } from "./tauri-host.service";
import { BitwardenApiError } from "../bitwarden-api/bitwarden-api";

function brokerSnapshot() {
  return {
    processGeneration: "process-generation",
    version: 3,
    syncVersion: 1,
    authorization: "unlocked",
    activeAccountId: "account-1",
    syncState: "fresh",
    failureCode: null,
    sharedSnapshot: { isUnlocked: true, email: "person@example.com" },
    originWindowLabel: "main",
  };
}

describe("TauriHostService", () => {
  it("maps Agent registration lifecycle and preserves requiresApproval as an explicit state", async () => {
    const invoke = vi.fn<TauriInvoke>(async (command) => {
      if (command === "autofill_agent_registration_status") return "notRegistered" as never;
      if (command === "autofill_agent_register") return "requiresApproval" as never;
      if (command === "autofill_clear_projection") return undefined as never;
      return "notRegistered" as never;
    });
    const host = new TauriHostService(invoke);

    await expect(host.autofillAgentRegistrationStatus()).resolves.toBe("notRegistered");
    await expect(host.autofillAgentRegister()).resolves.toBe("requiresApproval");
    await expect(host.autofillAgentUnregister()).resolves.toBe("notRegistered");
    await expect(host.autofillClearProjection("account-a")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(1, "autofill_agent_registration_status");
    expect(invoke).toHaveBeenNthCalledWith(2, "autofill_agent_register");
    expect(invoke).toHaveBeenNthCalledWith(3, "autofill_agent_unregister");
    expect(invoke).toHaveBeenNthCalledWith(4, "autofill_clear_projection", { accountId: "account-a" });
  });

  it("maps conservative Accessibility fallback calls to exact native commands", async () => {
    const status = { permission: "denied", observation: "hidden" };
    const invoke = vi.fn<TauriInvoke>(async () => status as never);
    const host = new TauriHostService(invoke);

    await expect(host.status()).resolves.toEqual(status);
    await host.setFallback("unsupported");
    await expect(host.requestPermission()).resolves.toEqual(status);

    expect(invoke).toHaveBeenNthCalledWith(1, "autofill_accessibility_status");
    expect(invoke).toHaveBeenNthCalledWith(2, "autofill_set_accessibility_fallback", {
      fallback: "unsupported",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "autofill_request_accessibility_permission");
  });

  it("rejects malicious native Accessibility diagnostic bundle identifiers", async () => {
    for (const bundleId of [
      "com.example\nsecret",
      "com.example\0secret",
      "com.example.\uD800",
      "com.example.编辑器",
      "com..example",
      ".com.example",
      "com.example-",
      "a".repeat(256),
    ]) {
      const invoke = vi.fn<TauriInvoke>(async () => ({
        permission: "granted",
        observation: "hidden",
        diagnostic: { reason: "offscreen", bundleId },
      }) as never);
      const host = new TauriHostService(invoke);

      await expect(host.status()).rejects.toThrow("invalid accessibility status");
    }
  });
  it("reads and confirms the native launch-at-login state", async () => {
    let enabled = false;
    const autostart: NativeAutostartApi = {
      isEnabled: vi.fn(async () => enabled),
      enable: vi.fn(async () => {
        enabled = true;
      }),
      disable: vi.fn(async () => {
        enabled = false;
      }),
    };
    const host = new TauriHostService(vi.fn<TauriInvoke>(), autostart);

    await expect(host.getLaunchAtLogin()).resolves.toBe(false);
    await expect(host.setLaunchAtLogin(true)).resolves.toBe(true);
    await expect(host.setLaunchAtLogin(true)).resolves.toBe(true);
    await expect(host.setLaunchAtLogin(false)).resolves.toBe(false);

    expect(autostart.enable).toHaveBeenCalledTimes(1);
    expect(autostart.disable).toHaveBeenCalledTimes(1);
    expect(autostart.isEnabled).toHaveBeenCalledTimes(7);
  });

  it("sanitizes launch-at-login failures without leaking native details", async () => {
    const privateDetail = "private LaunchAgent failure";
    const autostart: NativeAutostartApi = {
      isEnabled: vi.fn(async () => {
        throw new Error(privateDetail);
      }),
      enable: vi.fn(),
      disable: vi.fn(),
    };
    const host = new TauriHostService(vi.fn<TauriInvoke>(), autostart);

    for (const operation of [host.getLaunchAtLogin(), host.setLaunchAtLogin(true)]) {
      const error = await operation.then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(LaunchAtLoginHostError);
      expect(error).toMatchObject({ message: "Launch at login unavailable." });
      expect(JSON.stringify(error)).not.toContain(privateDetail);
    }
  });

  it("maps global shortcut requests to exact native commands", async () => {
    const invoke = vi.fn<TauriInvoke>(async (command) => {
      if (command === "get_global_shortcut") {
        return { shortcut: { modifiers: ["option"], code: "KeyB" }, availability: "active" } as never;
      }
      return {
        status: "updated",
        snapshot: { shortcut: { modifiers: ["option"], code: "KeyB" }, availability: "active" },
      } as never;
    });
    const host = new TauriHostService(invoke);
    const shortcut = { modifiers: ["option"] as const, code: "KeyB" };

    await expect(host.getGlobalShortcut()).resolves.toEqual({ shortcut, availability: "active" });
    await expect(host.setGlobalShortcut(shortcut)).resolves.toEqual({
      status: "updated",
      snapshot: { shortcut, availability: "active" },
    });
    await expect(host.clearGlobalShortcut()).resolves.toEqual({
      status: "updated",
      snapshot: { shortcut, availability: "active" },
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "get_global_shortcut", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "set_global_shortcut", { shortcut });
    expect(invoke).toHaveBeenNthCalledWith(3, "clear_global_shortcut", undefined);
  });

  it("strictly decodes global shortcut snapshots and outcomes", async () => {
    const privateDetail = "private global shortcut platform detail";
    const inheritedFields = Object.create({
      shortcut: { modifiers: ["option"], code: "KeyB" },
      availability: "active",
    });
    const customPrototype = Object.assign(Object.create({}), {
      shortcut: { modifiers: ["option"], code: "KeyB" },
      availability: "active",
    });
    class NativeShortcutSnapshot {
      readonly shortcut = { modifiers: ["option"], code: "KeyB" };
      readonly availability = "active";
    }
    let snapshotGetterRead = false;
    const accessorSnapshot = {
      availability: "active",
      get shortcut() {
        snapshotGetterRead = true;
        return { modifiers: ["option"], code: "KeyB" };
      },
    };
    let bindingGetterRead = false;
    const accessorBinding = {
      shortcut: {
        modifiers: ["option"],
        get code() {
          bindingGetterRead = true;
          return "KeyB";
        },
      },
      availability: "active",
    };
    const outcomes: unknown[] = [
      undefined,
      inheritedFields,
      customPrototype,
      new NativeShortcutSnapshot(),
      accessorSnapshot,
      accessorBinding,
      { shortcut: { modifiers: ["option"], code: "KeyB" }, availability: "active", detail: privateDetail },
      { shortcut: { modifiers: ["option", "option"], code: "KeyB" }, availability: "active" },
      { shortcut: { modifiers: ["command", "shift"], code: "KeyB" }, availability: "active" },
      { shortcut: { modifiers: ["option"], code: "F01" }, availability: "active" },
      { shortcut: null, availability: "active" },
      { shortcut: { modifiers: ["option"], code: "KeyB" }, availability: "cleared" },
      { status: "updated", snapshot: { shortcut: null, availability: "cleared" }, detail: privateDetail },
      { status: "unknown", snapshot: { shortcut: null, availability: "cleared" } },
      new Proxy({}, { ownKeys() { throw new Error(privateDetail); } }),
    ];

    for (const outcome of outcomes) {
      const host = new TauriHostService(async () => outcome as never);
      const error = await host.getGlobalShortcut().then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(GlobalShortcutHostError);
      expect(error).toMatchObject({ code: "unavailable", message: "Global shortcut unavailable." });
      expect(JSON.stringify(error)).not.toContain(privateDetail);
    }
    expect(snapshotGetterRead).toBe(false);
    expect(bindingGetterRead).toBe(false);
  });

  it("sanitizes global shortcut command rejections and malformed mutation outcomes", async () => {
    const privateDetail = "private global shortcut rejection";
    const rejected = new TauriHostService(async () => Promise.reject(new Error(privateDetail)));
    const malformed = new TauriHostService(async () => ({
      status: "updated",
      snapshot: { shortcut: null, availability: "cleared" },
      detail: privateDetail,
    }) as never);

    for (const operation of [
      rejected.setGlobalShortcut({ modifiers: ["option"], code: "KeyB" }),
      malformed.clearGlobalShortcut(),
    ]) {
      const error = await operation.then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(GlobalShortcutHostError);
      expect(error).toMatchObject({ code: "unavailable", message: "Global shortcut unavailable." });
      expect(JSON.stringify(error)).not.toContain(privateDetail);
    }
  });

  it("keeps the main popup hidden at the 480 by 600 minimum and allows vertical resizing", () => {
    const config = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "apps/menubar-tauri/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as { app?: { windows?: Array<Record<string, unknown>> } };
    const mainWindow = config.app?.windows?.find((window) => window["label"] === "main");

    expect(mainWindow).toMatchObject({
      visible: false,
      width: 480,
      height: 600,
      minWidth: 480,
      maxWidth: 480,
      minHeight: 600,
      resizable: true,
      decorations: false,
      skipTaskbar: true,
      windowEffects: {
        effects: ["popover"],
        state: "active",
        radius: 14,
      },
    });
  });

  it.each([0, 10, 20, 30, 60, 120, 300])(
    "maps the %i second clipboard clear option to the copy_text command",
    async (clearAfterSeconds) => {
      const calls: Array<[string, Record<string, unknown> | undefined]> = [];
      const invoke: TauriInvoke = async (command, args) => {
        calls.push([command, args]);
        return undefined as never;
      };
      const host = new TauriHostService(invoke);

      await host.copyText("secret", clearAfterSeconds);

      expect(calls).toEqual([["copy_text", { value: "secret", clearAfterSeconds }]]);
    },
  );

  it("preserves an omitted clipboard clear timeout for the native command", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return undefined as never;
    };
    const host = new TauriHostService(invoke);

    await host.copyText("secret");

    expect(calls).toEqual([["copy_text", { value: "secret", clearAfterSeconds: undefined }]]);
  });

  it("maps paste requests to the paste_text command", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return { status: "success", valueCopied: true } as never;
    };
    const host = new TauriHostService(invoke);

    await host.pasteText("username");

    expect(calls).toEqual([["paste_text", { value: "username", clearAfterSeconds: undefined }]]);
  });

  it.each([
    "no-target",
    "target-not-active",
    "accessibility-denied",
    "activation-failed",
    "keystroke-failed",
  ] satisfies readonly PasteFailureCode[])(
    "decodes the resolved native paste failure %s after copy succeeded",
    async (code) => {
      const host = new TauriHostService(async () => ({
        status: "paste-failed",
        code,
        valueCopied: true,
      }) as never);

      const error = await host.pasteText("selected-value", 30).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(PasteError);
      expect(error).toMatchObject({ code, valueCopied: true, message: "Paste unavailable." });
    },
  );

  it.each([
    "no-target",
    "target-not-active",
    "accessibility-denied",
    "activation-failed",
    "keystroke-failed",
  ] satisfies readonly PasteFailureCode[])(
    "never treats rejected allowlisted string %s as proof of native copy success",
    async (code) => {
      const host = new TauriHostService(async () => Promise.reject(code));

      const error = await host.pasteText("selected-value", 30).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(PasteError);
      expect(error).toMatchObject({
        code: "keystroke-failed",
        valueCopied: false,
        message: "Paste unavailable.",
      });
    },
  );

  it("rejects malformed and hostile resolved paste envelopes without claiming copy success", async () => {
    const privateDetail = "private malformed paste outcome";
    const hiddenDetailOutcome = Object.defineProperty(
      { status: "success", valueCopied: true },
      "detail",
      { enumerable: false, value: privateDetail },
    );
    const symbolDetailOutcome = {
      status: "success",
      valueCopied: true,
      [Symbol("detail")]: privateDetail,
    };
    const outcomes: unknown[] = [
      undefined,
      { status: "success", valueCopied: false },
      { status: "success", valueCopied: true, detail: privateDetail },
      hiddenDetailOutcome,
      symbolDetailOutcome,
      { status: "paste-failed", code: "no-target", valueCopied: false },
      { status: "paste-failed", code: "unknown", valueCopied: true },
      { status: "paste-failed", code: "no-target", valueCopied: true, detail: privateDetail },
      new Proxy({}, {
        ownKeys() {
          throw new Error(privateDetail);
        },
      }),
      new Proxy({}, {
        ownKeys() {
          throw new PasteError("no-target", true);
        },
      }),
    ];

    for (const outcome of outcomes) {
      const host = new TauriHostService(async () => outcome as never);
      const error = await host.pasteText("selected-value", 30).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(PasteError);
      expect(error).toMatchObject({
        code: "keystroke-failed",
        valueCopied: false,
        message: "Paste unavailable.",
      });
      expect(JSON.stringify(error)).not.toContain(privateDetail);
      expect(JSON.stringify(error)).not.toContain("selected-value");
    }
  });

  it("sanitizes hostile and unknown paste rejections without claiming native copy success", async () => {
    const privateDetail = "private paste transport and selected value";
    const rejections: unknown[] = [
      privateDetail,
      new Proxy({}, {
        get() {
          throw new Error(privateDetail);
        },
      }),
    ];

    for (const rejection of rejections) {
      const host = new TauriHostService(async () => Promise.reject(rejection));
      const error = await host.pasteText("selected-value", 30).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(PasteError);
      expect(error).toMatchObject({
        code: "keystroke-failed",
        valueCopied: false,
        message: "Paste unavailable.",
      });
      expect(JSON.stringify(error)).not.toContain(privateDetail);
      expect(JSON.stringify(error)).not.toContain("selected-value");
    }
  });

  it("maps URL launch requests to the native open_url command", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return undefined as never;
    };
    const host = new TauriHostService(invoke);

    await host.openUrl("https://example.com");

    expect(calls).toEqual([["open_url", { url: "https://example.com" }]]);
  });

  it.each([
    ["invalid-url", "invalid-url"],
    ["private URL parser detail", "launch-failed"],
    [new Error("private process launch detail"), "launch-failed"],
  ] as const)(
    "exposes only the fixed URL launch status %s",
    async (nativeFailure, expectedStatus) => {
      const host = new TauriHostService(async () => Promise.reject(nativeFailure));

      const error = await host.openUrl("https://private.example.test/path").then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ name: "Error", message: expectedStatus });
      expect(String(error)).toBe(`Error: ${expectedStatus}`);
      expect(Object.getOwnPropertyNames(error as object)).not.toContain("cause");
      for (const key of Reflect.ownKeys(error as object)) {
        const value = Reflect.get(error as object, key);
        expect(String(value)).not.toContain("private");
        expect(String(value)).not.toContain("https://private.example.test/path");
      }
    },
  );

  it("maps pop-out requests to the native pop_out command", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return undefined as never;
    };
    const host = new TauriHostService(invoke);

    await host.popOut("/tabs/settings");

    expect(calls).toEqual([["pop_out", { route: "/tabs/settings" }]]);
  });

  it("maps process-session broker requests without adding credentials to command payloads", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      if (command === "session_broker_attach") {
        return {
          startupMode: "attach",
          snapshot: brokerSnapshot(),
        } as never;
      }
      return brokerSnapshot() as never;
    };
    const host = new TauriHostService(invoke) as TauriHostService & {
      attachProcessSession(): Promise<unknown>;
      processSessionSnapshot(): Promise<unknown>;
      mutateProcessSession(mutation: unknown): Promise<unknown>;
    };
    const mutation = {
      type: "unlocked",
      activeAccountId: "account-1",
      sharedSnapshot: { isUnlocked: true, email: "person@example.com" },
    };

    await expect(host.attachProcessSession()).resolves.toMatchObject({
      startupMode: "attach",
      snapshot: { activeAccountId: "account-1" },
    });
    await expect(host.processSessionSnapshot()).resolves.toMatchObject({
      activeAccountId: "account-1",
    });
    await expect(host.mutateProcessSession(mutation)).resolves.toMatchObject({
      activeAccountId: "account-1",
    });

    expect(calls).toEqual([
      ["session_broker_attach", undefined],
      ["session_broker_snapshot", undefined],
      ["session_broker_mutate", { mutation }],
    ]);
    expect(JSON.stringify(calls)).not.toContain("accessToken");
    expect(JSON.stringify(calls)).not.toContain("refreshToken");
    expect(JSON.stringify(calls)).not.toContain("masterPassword");
  });

  it("maps the ephemeral process-only session handoff to its dedicated native commands", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const handoff = { accessToken: "process-only-token" };
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return (command === "session_broker_handoff" ? handoff : undefined) as never;
    };
    const host = new TauriHostService(invoke);

    await host.setProcessSessionHandoff(handoff);
    await expect(host.processSessionHandoff()).resolves.toEqual(handoff);

    expect(calls).toEqual([
      ["session_broker_set_handoff", { session: handoff }],
      ["session_broker_handoff", undefined],
    ]);
  });

  it("maps popup visibility requests to fixed native lifecycle commands", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return undefined as never;
    };
    const host = new TauriHostService(invoke);

    await host.showPopup();
    await host.hidePopup();

    expect(calls).toEqual([
      ["show_popup", undefined],
      ["hide_popup", undefined],
    ]);
  });

  it("maps popup size metrics and height requests to the native window commands", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return { currentHeight: 600, maximumHeight: 980 } as never;
    };
    const host = new TauriHostService(invoke);

    await expect(host.getPopupWindowMetrics()).resolves.toEqual({
      currentHeight: 600,
      maximumHeight: 980,
    });
    await expect(host.setPopupHeight(720)).resolves.toEqual({
      currentHeight: 600,
      maximumHeight: 980,
    });

    expect(calls).toEqual([
      ["popup_window_metrics", undefined],
      ["set_popup_height", { height: 720 }],
    ]);
  });

  it("maps secure storage requests to stable command names", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return command === "secure_get"
        ? ({ status: "success", value: "value" } as never)
        : command === "secure_compare_and_swap"
          ? ({ status: "success", value: true } as never)
          : command === "secure_get_or_create_uuid"
            ? ({ status: "success", value: "11111111-1111-4111-8111-111111111111" } as never)
            : ({ status: "success", value: null } as never);
    };
    const host = new TauriHostService(invoke);

    await expect(host.secureGet("token")).resolves.toBe("value");
    await host.secureSet("token", "value");
    await host.secureDelete("token");
    await expect(host.secureCompareAndSwap("token", null, "replacement")).resolves.toBe(true);
    await host.secureGetOrCreateUuid("installation.deviceIdentifier");

    expect(calls).toEqual([
      ["secure_get", { key: "token" }],
      ["secure_set", { key: "token", value: "value" }],
      ["secure_delete", { key: "token" }],
      ["secure_compare_and_swap", { key: "token", expected: null, replacement: "replacement" }],
      ["secure_get_or_create_uuid", { key: "installation.deviceIdentifier" }],
    ]);
  });

  it("maps a typed missing secure value to null", async () => {
    const host = new TauriHostService(async () => ({ status: "missing" }) as never);

    await expect(host.secureGet("auth.session")).resolves.toBeNull();
  });

  it("accepts only string success values from secure_get", async () => {
    const nullHost = new TauriHostService(async () => ({ status: "success", value: null }) as never);
    const numberHost = new TauriHostService(async () => ({ status: "success", value: 42 }) as never);

    await expect(nullHost.secureGet("auth.session")).rejects.toMatchObject({
      code: "unavailable",
      message: "unavailable",
    });
    await expect(numberHost.secureGet("auth.session")).rejects.toMatchObject({
      code: "unavailable",
      message: "unavailable",
    });
  });

  it("sanitizes a hostile secure_get success value envelope", async () => {
    const privateDetail = "private secure_get value detail";
    const host = new TauriHostService(async () => ({
      status: "success",
      get value() {
        throw new Error(privateDetail);
      },
    }) as never);

    const error = await host.secureGet("auth.session").then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ code: "unavailable", message: "unavailable" });
    expect(JSON.stringify(error)).not.toContain(privateDetail);
  });

  it.each([
    ["secure_set", (host: TauriHostService) => host.secureSet("auth.session", "value")],
    ["secure_delete", (host: TauriHostService) => host.secureDelete("auth.session")],
  ] as const)("requires an exact null success value from %s", async (command, call) => {
    const host = new TauriHostService(async (invokedCommand) => ({
      status: "success",
      value: invokedCommand === command ? false : null,
    }) as never);

    await expect(call(host)).rejects.toMatchObject({
      code: "unavailable",
      message: "unavailable",
    });
  });

  it("accepts only boolean success values from secure_compare_and_swap", async () => {
    const host = new TauriHostService(async () => ({ status: "success", value: "true" }) as never);

    await expect(host.secureCompareAndSwap("auth.session", null, "value")).rejects.toMatchObject({
      code: "unavailable",
      message: "unavailable",
    });
  });

  it.each(["", "not-a-uuid", "11111111-1111-1111-1111-111111111111"])(
    "rejects malformed UUID success value %j without reflecting it",
    async (value) => {
      const host = new TauriHostService(async () => ({ status: "success", value }) as never);

      const error = await host.secureGetOrCreateUuid("installation.deviceIdentifier").then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({ code: "unavailable", message: "unavailable" });
      if (value) {
        expect(JSON.stringify(error)).not.toContain(value);
      }
    },
  );

  it("sanitizes malformed and hostile secure-storage envelopes", async () => {
    const privateDetail = "private platform getter detail";
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(privateDetail);
        },
      },
    );
    const malformedHost = new TauriHostService(async () => ({ status: "success" }) as never);
    const hostileHost = new TauriHostService(async () => hostile as never);
    const disguisedHost = new TauriHostService(async () => new Proxy(
      {},
      {
        get() {
          throw new SecureStorageError("invalid-key");
        },
      },
    ) as never);

    for (const operation of [
      malformedHost.secureSet("auth.session", "value"),
      hostileHost.secureGet("auth.session"),
      disguisedHost.secureGet("auth.session"),
    ]) {
      const error = await operation.then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toMatchObject({ code: "unavailable", message: "unavailable" });
      expect(JSON.stringify(error)).not.toContain(privateDetail);
    }
  });

  it("rejects missing outcomes for commands that cannot return missing", async () => {
    const host = new TauriHostService(async () => ({ status: "missing" }) as never);

    await expect(host.secureDelete("auth.session")).rejects.toMatchObject({
      code: "unavailable",
      message: "unavailable",
    });
  });

  it.each(["unavailable", "invalid-key"] as const)(
    "exposes the fixed typed %s secure-storage failure without key, value, or platform detail",
    async (code) => {
      const host = new TauriHostService(async () => ({
        status: code,
        key: "auth.account.private",
        value: "private-value",
        detail: "platform detail",
      }) as never);

      const error = await host.secureSet("auth.account.private", "private-value").then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(SecureStorageError);
      expect(error).toMatchObject({ code, message: code });
      expect(JSON.stringify(error)).not.toMatch(/auth\.account|private|platform/);
    },
  );

  it("sanitizes rejected native secure-storage invocations to unavailable", async () => {
    const host = new TauriHostService(async () => {
      throw new Error("private platform detail");
    });

    await expect(host.secureGet("auth.session")).rejects.toMatchObject({
      name: "SecureStorageError",
      code: "unavailable",
      message: "unavailable",
    });
  });

  it("maps account lock intents to the native fail-closed store", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return command === "get_account_lock_intents" ? (["account-one"] as never) : (undefined as never);
    };
    const host = new TauriHostService(invoke);

    await expect(host.getAccountLockIntents()).resolves.toEqual(["account-one"]);
    await host.setAccountLockIntents(["account-one", "account-two"], true);
    await host.setAccountLockIntents(["account-one"], false);

    expect(calls).toEqual([
      ["get_account_lock_intents", undefined],
      ["set_account_lock_intents", { accountIds: ["account-one", "account-two"], locked: true }],
      ["set_account_lock_intents", { accountIds: ["account-one"], locked: false }],
    ]);
  });

  it("maps biometric requests to fixed native commands and reason codes", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return command === "biometric_status"
        ? ({ status: "available" } as never)
        : command === "biometric_enable"
          ? ({ status: "enabled" } as never)
          : command === "biometric_unlock"
            ? ({ status: "success" } as never)
            : ({ status: "disabled" } as never);
    };
    const host = new TauriHostService(invoke);
    const accountId = "a".repeat(64);

    await expect(host.biometricStatus(accountId)).resolves.toBe("available");
    await expect(host.biometricEnable(accountId)).resolves.toBe("enabled");
    await expect(host.biometricUnlock(accountId)).resolves.toBe("success");
    await expect(host.biometricDisable(accountId)).resolves.toBe("disabled");

    expect(calls).toEqual([
      ["biometric_status", { accountId }],
      ["biometric_enable", { accountId, reason: "setup" }],
      ["biometric_unlock", { accountId, reason: "unlock" }],
      ["biometric_disable", { accountId }],
    ]);
  });

  it("cancels a picker receipt with its complete release scope", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const host = new TauriHostService(async (command, args) => {
      calls.push([command, args]);
      return undefined as never;
    });
    const scope = {
      accountId: "account-a",
      candidateId: "cipher-a",
      field: "password" as const,
      generation: "00000000-0000-4000-8000-000000000004",
      contextToken: "context-a",
    };

    await host.cancelReprompt(scope, "receipt-a");

    expect(calls).toEqual([["autofill_cancel_reprompt", { scope, receipt: "receipt-a" }]]);
  });

  it.each([
    () => Promise.reject(new Error("private native error")),
    () => Promise.resolve({ status: "success", secret: "private token" }),
    () => Promise.resolve(new Proxy({}, {
      ownKeys() {
        throw new Error("private proxy detail");
      },
    })),
  ])("sanitizes rejected or malformed biometric responses", async (response) => {
    const host = new TauriHostService(async () => await response() as never);

    const error = await host.biometricUnlock("b".repeat(64)).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BiometricHostError);
    expect(error).toMatchObject({ code: "unavailable", message: "Biometric unavailable." });
    expect(JSON.stringify(error)).not.toMatch(/private|token|native/);
  });

  it("maps JSON HTTP requests to the native host transport command", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push([command, args]);
      return { ok: true } as never;
    };
    const host = new TauriHostService(invoke);

    await expect(
      host.fetchJson("https://bitwarden.example.com/identity/connect/token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: new URLSearchParams({ grant_type: "password" }),
      }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      [
        "http_fetch_json",
        {
          request: {
            url: "https://bitwarden.example.com/identity/connect/token",
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            },
            body: "grant_type=password",
          },
        },
      ],
    ]);
  });

  it("types a rejected native HTTP invocation as transport-unavailable", async () => {
    const host = new TauriHostService(async () => {
      throw new Error("private native transport detail");
    });

    const error = await host.fetchJson("https://api.example.test/sync", {}).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      name: "HttpTransportError",
      code: "unavailable",
      message: "HTTP transport unavailable.",
    });
    expect((error as Error).message).not.toContain("private native transport detail");
  });

  it("maps a native 401 envelope to a typed status without embedding its body in the message", async () => {
    const invoke: TauriInvoke = async () => ({
      ok: false,
      status: 401,
      responseJson: { ErrorModel: { Message: "private server detail" } },
    } as never);
    const host = new TauriHostService(invoke);

    const error = await host.fetchJson("https://api.example.test/sync", {}).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BitwardenApiError);
    expect(error).toMatchObject({ status: 401 });
    expect((error as Error).message).not.toContain("private server detail");
  });

});
