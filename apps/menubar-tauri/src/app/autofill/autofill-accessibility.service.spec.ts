import { describe, expect, it, vi } from "vitest";

import {
  AutoFillAccessibilityService,
  decodeAccessibilityStatus,
  type AutoFillAccessibilityHost,
} from "./autofill-accessibility.service";

describe("AutoFillAccessibilityService", () => {
  it("keeps system AutoFill preferred until an unsupported fallback is explicit", async () => {
    const host: AutoFillAccessibilityHost = {
      status: vi.fn().mockResolvedValue({ permission: "granted", observation: "stopped" }),
      setFallback: vi.fn().mockResolvedValue(undefined),
      requestPermission: vi.fn(),
    };
    const service = new AutoFillAccessibilityService(host);

    await service.stopForSystemAutoFill();
    await service.startUnsupportedFallback();

    expect(host.setFallback).toHaveBeenNthCalledWith(1, "system-autofill");
    expect(host.setFallback).toHaveBeenNthCalledWith(2, "unsupported");
    expect(host.requestPermission).not.toHaveBeenCalled();
  });

  it("requests the AX prompt only from the explicit user action", async () => {
    const host: AutoFillAccessibilityHost = {
      status: vi.fn().mockResolvedValue({ permission: "denied", observation: "stopped" }),
      setFallback: vi.fn(),
      requestPermission: vi.fn().mockResolvedValue({ permission: "denied", observation: "stopped" }),
    };
    const service = new AutoFillAccessibilityService(host);

    await service.status();
    expect(host.requestPermission).not.toHaveBeenCalled();
    await service.requestPermissionFromUserAction();
    expect(host.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("rejects native status payloads containing app names or field content", () => {
    expect(() => decodeAccessibilityStatus({
      permission: "granted",
      observation: "visible",
      appName: "Editor",
    })).toThrow();
    expect(() => decodeAccessibilityStatus({
      permission: "granted",
      observation: "hidden",
      diagnostic: { reason: "offscreen", bundleId: "com.example.editor", value: "secret" },
    })).toThrow();
    expect(() => decodeAccessibilityStatus({
      permission: "granted",
      observation: "hidden",
      diagnostic: { reason: "field contains secret", bundleId: "com.example.editor" },
    })).toThrow();
  });

  it("accepts only fixed permission, observation and diagnostic fields", () => {
    expect(decodeAccessibilityStatus({
      permission: "denied",
      observation: "hidden",
      diagnostic: { reason: "permission-denied", bundleId: "com.example.editor" },
    })).toEqual({
      permission: "denied",
      observation: "hidden",
      diagnostic: { reason: "permission-denied", bundleId: "com.example.editor" },
    });
  });
});
