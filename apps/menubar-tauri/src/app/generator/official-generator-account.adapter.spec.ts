import { firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import type { GeneratorRuntimePort } from "./generator-runtime.port";
import { OfficialGeneratorAccountAdapter } from "./official-generator-account.adapter";

describe("OfficialGeneratorAccountAdapter", () => {
  it("waits for an additional window to inherit the unlocked session before retrying settings", async () => {
    const store = new PopupStateStore();
    const activeSettings = vi.fn()
      .mockRejectedValueOnce(new Error("Active account is locked"))
      .mockResolvedValueOnce({ accountId: "account-a", settings: {} });
    const adapter = new OfficialGeneratorAccountAdapter(
      { activeSettings } as unknown as GeneratorRuntimePort,
      store,
    );

    const accountPromise = firstValueFrom(adapter.activeAccount$);
    await Promise.resolve();
    expect(activeSettings).toHaveBeenCalledOnce();

    store.setUnlocked("user@example.com");

    await expect(accountPromise).resolves.toMatchObject({
      id: "account-a",
      email: "user@example.com",
    });
    expect(activeSettings).toHaveBeenCalledTimes(2);
  });
});
