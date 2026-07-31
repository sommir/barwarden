import "@angular/compiler";

import { describe, expect, it } from "vitest";

import { OfficialAccountComponent } from "./official-account.component";
import { presentAvailableAccounts } from "./official-account-switcher.component";

describe("OfficialAccountComponent authorization copy", () => {
  it("distinguishes the current account from an unlocked session and explains recovery", () => {
    const component = new OfficialAccountComponent(
      {} as never,
      {
        t: (key: string) =>
          key === "i18nSessionRestoreRequired" ? "会话需要恢复" : key,
      } as never,
    );
    component.account = {
      id: "account-1",
      name: "person@example.com",
      email: "person@example.com",
      isActive: true,
      status: "recovery-required",
    };

    expect(component.status).toEqual({
      text: "会话需要恢复",
      icon: "bwi-exclamation-triangle",
    });
  });

  it("announces both current-account ownership and unlocked authorization", () => {
    const component = new OfficialAccountComponent(
      {} as never,
      { t: (key: string) => key } as never,
    );
    component.account = {
      id: "account-1",
      name: "person@example.com",
      email: "person@example.com",
      isActive: true,
      status: "unlocked",
    };

    expect(component.status).toEqual({
      text: "active · unlocked",
      icon: "bwi-unlock",
    });
  });

  it("projects recovery authorization onto only the active account card", () => {
    expect(
      presentAvailableAccounts(
        [
          {
            id: "active",
            email: "active@example.com",
            serverUrl: "https://vault.active.example.com",
            status: "unlocked",
            isActive: true,
          },
          {
            id: "other",
            email: "other@example.com",
            serverUrl: "https://vault.other.example.com",
            status: "unlocked",
            isActive: false,
          },
        ],
        "recovery-required",
        5,
      ),
    ).toEqual([
      expect.objectContaining({ id: "active", status: "recovery-required" }),
      expect.objectContaining({ id: "other", status: "unlocked" }),
      expect.objectContaining({ id: "addAccount" }),
    ]);
  });
});
