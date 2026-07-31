import { firstValueFrom } from "rxjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { OfficialChallengeAdapter } from "./official-challenge.adapter";

describe("OfficialChallengeAdapter", () => {
  it("keeps required AuthFacade challenge methods compile-time enforced", () => {
    const source = readFileSync(join(__dirname, "official-challenge.adapter.ts"), "utf8");

    expect(source).not.toContain("authChallengeExpiresAt?:");
    expect(source).not.toContain("cancelAuthChallenge?:");
    expect(source).not.toContain("authChallengeExpiresAt?.()");
    expect(source).not.toContain("cancelAuthChallenge?.()");
  });

  it("publishes only retained providers in server order and the real challenge deadline", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://vault.example.com",
      providers: ["1", "3", "0", "4"],
    });
    const adapter = new OfficialChallengeAdapter(
      {
        authChallengeExpiresAt: () => 123_456,
        submitTwoFactor: vi.fn(),
        sendTwoFactorEmail: vi.fn(),
        cancelAuthChallenge: vi.fn(),
      } as never,
      store,
    );

    expect(await firstValueFrom(adapter.providers$)).toEqual([1, 0]);
    expect(await firstValueFrom(adapter.expiresAt$)).toBe(123_456);
  });

  it("refreshes to an empty retained state when the route no longer owns a two-factor challenge", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://vault.example.com",
      providers: ["0"],
    });
    const adapter = new OfficialChallengeAdapter(
      {
        authChallengeExpiresAt: () => 10,
        submitTwoFactor: vi.fn(),
        sendTwoFactorEmail: vi.fn(),
        cancelAuthChallenge: vi.fn(),
      } as never,
      store,
    );

    store.clearAuthChallenge();
    adapter.refresh();

    expect(await firstValueFrom(adapter.providers$)).toEqual([]);
    expect(await firstValueFrom(adapter.expiresAt$)).toBeNull();
  });

  it("delegates submit, email resend, and cancellation without retaining the token", async () => {
    const submitTwoFactor = vi.fn(async () => undefined);
    const sendTwoFactorEmail = vi.fn(async () => undefined);
    const cancelAuthChallenge = vi.fn();
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://vault.example.com",
      providers: ["0", "1"],
    });
    const adapter = new OfficialChallengeAdapter(
      {
        authChallengeExpiresAt: () => 10,
        submitTwoFactor,
        sendTwoFactorEmail,
        cancelAuthChallenge,
      } as never,
      store,
    );

    await adapter.submit(1, " 123456 ", true);
    await adapter.sendEmail();
    adapter.cancel();

    expect(submitTwoFactor).toHaveBeenCalledWith({ provider: 1, token: "123456", remember: true });
    expect(sendTwoFactorEmail).toHaveBeenCalledOnce();
    expect(cancelAuthChallenge).toHaveBeenCalledOnce();
    expect(JSON.stringify(adapter)).not.toContain("123456");
  });

  it("rejects provider values outside the retained 0|1 boundary before the facade is called", async () => {
    const submitTwoFactor = vi.fn();
    const adapter = new OfficialChallengeAdapter(
      {
        authChallengeExpiresAt: () => null,
        submitTwoFactor,
        sendTwoFactorEmail: vi.fn(),
        cancelAuthChallenge: vi.fn(),
      } as never,
      new PopupStateStore(),
    );

    await expect(adapter.submit(3 as never, "123456", false)).rejects.toThrow(
      "Unsupported two-factor provider",
    );
    expect(submitTwoFactor).not.toHaveBeenCalled();
  });
});
