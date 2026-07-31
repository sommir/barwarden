import { firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { OfficialNewDeviceAdapter } from "./official-new-device.adapter";

describe("OfficialNewDeviceAdapter", () => {
  it("delegates trimmed submit, resend, and cancellation only while the new-device route owns its challenge", async () => {
    const submitNewDeviceOtp = vi.fn(async () => undefined);
    const resendNewDeviceOtp = vi.fn(async () => undefined);
    const cancelAuthChallenge = vi.fn();
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://vault.example.com",
    });
    const adapter = new OfficialNewDeviceAdapter(
      {
        authChallengeExpiresAt: () => 123_456,
        submitNewDeviceOtp,
        resendNewDeviceOtp,
        cancelAuthChallenge,
      } as never,
      store,
    );

    await adapter.submitOtp(" 654321 ");
    await adapter.resendOtp();
    adapter.cancel();

    expect(submitNewDeviceOtp).toHaveBeenCalledWith("654321");
    expect(resendNewDeviceOtp).toHaveBeenCalledOnce();
    expect(cancelAuthChallenge).toHaveBeenCalledOnce();
    expect(await firstValueFrom(adapter.expiresAt$)).toBe(123_456);
    expect(JSON.stringify(adapter)).not.toContain("654321");
  });

  it("clears its deadline when the route loses new-device ownership", async () => {
    const store = new PopupStateStore();
    const adapter = new OfficialNewDeviceAdapter(
      {
        authChallengeExpiresAt: () => 123_456,
        submitNewDeviceOtp: vi.fn(),
        resendNewDeviceOtp: vi.fn(),
        cancelAuthChallenge: vi.fn(),
      } as never,
      store,
    );

    adapter.refresh();

    expect(await firstValueFrom(adapter.expiresAt$)).toBeNull();
  });
});
