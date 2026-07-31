import { describe, expect, it } from "vitest";

import { PopupStateStore } from "../popup-state";
import type { SendItem } from "./send-item.model";
import { SendFacade } from "./send.facade";

describe("SendFacade", () => {
  it("filters synced sends by query and type without matching hidden access ids alone", () => {
    const store = new PopupStateStore();
    store.setSends([
      demoSend({ id: "text-1", name: "Payroll token", type: "text", accessId: "hidden-payroll-id" }),
      demoSend({ id: "file-1", name: "Wire instructions", type: "file", notes: "bank transfer" }),
    ]);
    const facade = new SendFacade(store);

    facade.setSearch("wire");
    expect(facade.filteredSends().map((send) => send.id)).toEqual(["file-1"]);

    facade.setTypeFilter("text");
    expect(facade.sendState()).toBe("no-results");

    facade.setSearch("hidden-payroll-id");
    facade.setTypeFilter("");
    expect(facade.filteredSends()).toEqual([]);
  });

  it("reports empty only before sends have synced", () => {
    const store = new PopupStateStore();
    const facade = new SendFacade(store);
    expect(facade.sendState()).toBe("empty");

    store.setSends([demoSend({ id: "text-1", name: "Payroll token" })]);
    expect(facade.sendState()).toBe("ready");
  });

  it("reuses filtered sends until send data or filters change", () => {
    const store = new PopupStateStore();
    store.setSends([demoSend({ id: "text-1", name: "Payroll token" })]);
    const facade = new SendFacade(store);
    const filtered = facade.filteredSends();

    store.setStatus("Copied");

    expect(facade.filteredSends()).toBe(filtered);
    facade.setSearch("payroll");
    expect(facade.filteredSends()).not.toBe(filtered);
  });
});

function demoSend(overrides: Partial<SendItem>): SendItem {
  return {
    id: "send",
    accessId: "access",
    type: "text",
    name: "Demo Send",
    notes: "",
    revisionDate: "2026-07-09T10:00:00.000Z",
    deletionDate: "2026-07-16T10:00:00.000Z",
    disabled: false,
    accessCount: 0,
    ...overrides,
  };
}
