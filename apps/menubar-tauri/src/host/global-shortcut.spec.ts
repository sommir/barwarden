import { describe, expect, it, vi } from "vitest";

import {
  bindingFromKeyboardEvent,
  formatMacShortcut,
  isSupportedGlobalShortcutCode,
} from "./global-shortcut";

describe("global shortcut recorder", () => {
  it("records physical keyboard codes and canonical modifier order", () => {
    const event = keydown({ altKey: true, ctrlKey: true, shiftKey: true, metaKey: true, code: "KeyB" });

    expect(bindingFromKeyboardEvent(event)).toEqual({
      modifiers: ["control", "option", "shift", "command"],
      code: "KeyB",
    });
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("uses KeyboardEvent.code rather than the active keyboard-layout key value", () => {
    expect(bindingFromKeyboardEvent(keydown({ altKey: true, code: "KeyB", key: "x" }))).toEqual({
      modifiers: ["option"],
      code: "KeyB",
    });
  });

  it("does not intercept key events outside recording mode", () => {
    const event = keydown({ altKey: true, code: "KeyB" });

    expect(bindingFromKeyboardEvent(event, false)).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves Escape available to cancel recording", () => {
    const event = keydown({ code: "Escape" });

    expect(bindingFromKeyboardEvent(event)).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    { shiftKey: true, code: "KeyB" },
    { code: "KeyB" },
    { altKey: true, code: "AltLeft" },
    { metaKey: true, code: "MetaRight" },
    { ctrlKey: true, shiftKey: true, code: "ShiftLeft" },
    { altKey: true, code: "Escape" },
    { altKey: true, code: "Numpad1" },
    { altKey: true, code: "F01" },
    { altKey: true, code: "F13" },
  ])("rejects unsupported or incomplete recording input %#", (init) => {
    expect(bindingFromKeyboardEvent(keydown(init))).toBeNull();
  });

  it("returns immutable canonical DTOs", () => {
    const binding = bindingFromKeyboardEvent(keydown({ altKey: true, code: "KeyB" }));

    expect(binding).toEqual({ modifiers: ["option"], code: "KeyB" });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding?.modifiers)).toBe(true);
  });

  it("matches the Rust supported-code contract including only canonical F1 through F12", () => {
    for (const code of [
      "KeyA", "KeyZ", "Digit0", "Digit9", "F1", "F12",
      "ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End", "PageUp", "PageDown",
      "Space", "Tab", "Enter", "Backspace", "Delete",
      "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "IntlBackslash",
      "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash",
    ]) {
      expect(isSupportedGlobalShortcutCode(code)).toBe(true);
    }

    for (const code of ["Keya", "KeyAA", "Digit10", "F0", "F01", "F13", "Escape", "Numpad1"]) {
      expect(isSupportedGlobalShortcutCode(code)).toBe(false);
    }
  });

  it("formats canonical macOS shortcut labels for letters, punctuation, and function keys", () => {
    expect(formatMacShortcut({ modifiers: ["option"], code: "KeyB" })).toBe("⌥ B");
    expect(formatMacShortcut({ modifiers: ["command", "shift", "control"], code: "Minus" })).toBe("⌃⇧⌘ -");
    expect(formatMacShortcut({ modifiers: ["command"], code: "F12" })).toBe("⌘ F12");
    expect(formatMacShortcut({ modifiers: ["control"], code: "ArrowUp" })).toBe("⌃ ↑");
  });
});

function keydown(init: Partial<KeyboardEventInit> & Pick<KeyboardEventInit, "code">): KeyboardEvent {
  const event = {
    altKey: init.altKey ?? false,
    code: init.code,
    ctrlKey: init.ctrlKey ?? false,
    key: init.key ?? "",
    metaKey: init.metaKey ?? false,
    preventDefault: vi.fn(),
    shiftKey: init.shiftKey ?? false,
  };
  return event as unknown as KeyboardEvent;
}
