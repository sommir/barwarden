import { describe, expect, it, vi } from "vitest";

import { AppOverlayStackService } from "./app-overlay-stack.service";

describe("AppOverlayStackService", () => {
  it("dismisses only the top registered overlay and consumes Escape", () => {
    const service = new AppOverlayStackService();
    const dismissFirst = vi.fn();
    const dismissSecond = vi.fn();
    service.register({ kind: "dialog", dismiss: dismissFirst });
    const releaseSecond = service.register({ kind: "menu", dismiss: dismissSecond });
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    expect(service.consumeEscape(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(dismissSecond).toHaveBeenCalledTimes(1);
    expect(dismissFirst).not.toHaveBeenCalled();

    releaseSecond();
    service.consumeEscape(new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    }));
    expect(dismissFirst).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["native select", () => document.createElement("select")],
    ["Bitwarden menu", () => Object.assign(document.createElement("div"), { role: "menu" })],
    ["context menu", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.dataset["contextMenu"] = "true";
      return menu;
    }],
    ["listbox", () => Object.assign(document.createElement("div"), { role: "listbox" })],
  ])("consumes Escape for an open %s without dismissing the window", (_label, createOverlay) => {
    const service = new AppOverlayStackService();
    const overlay = createOverlay();
    if (overlay instanceof HTMLSelectElement) {
      document.body.append(overlay);
      overlay.focus();
    } else {
      overlay.setAttribute("data-overlay-open", "true");
      document.body.append(overlay);
    }
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: overlay });

    expect(service.consumeEscape(event)).toBe(true);

    overlay.remove();
  });

  it("respects an Escape event already consumed by the overlay implementation", () => {
    const service = new AppOverlayStackService();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    event.preventDefault();

    expect(service.consumeEscape(event)).toBe(true);
  });

  it("returns false when there is no active overlay", () => {
    const service = new AppOverlayStackService();

    expect(service.consumeEscape(new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    }))).toBe(false);
  });
});
