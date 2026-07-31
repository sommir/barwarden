export type ShortcutModifier = "control" | "option" | "shift" | "command";

export interface GlobalShortcutBinding {
  readonly modifiers: readonly ShortcutModifier[];
  readonly code: string;
}

export interface GlobalShortcutSnapshot {
  readonly shortcut: GlobalShortcutBinding | null;
  readonly availability: "active" | "cleared" | "unavailable";
}

export interface GlobalShortcutMutationOutcome {
  readonly status: "updated" | "unchanged" | "invalid" | "unavailable" | "failed";
  readonly snapshot: GlobalShortcutSnapshot;
}

export interface GlobalShortcutHost {
  getGlobalShortcut(): Promise<GlobalShortcutSnapshot>;
  setGlobalShortcut(shortcut: GlobalShortcutBinding): Promise<GlobalShortcutMutationOutcome>;
  clearGlobalShortcut(): Promise<GlobalShortcutMutationOutcome>;
}

export class GlobalShortcutHostError extends Error {
  override readonly name = "GlobalShortcutHostError";

  constructor(readonly code: "unavailable" = "unavailable") {
    super("Global shortcut unavailable.");
  }
}

const MODIFIER_ORDER: readonly ShortcutModifier[] = ["control", "option", "shift", "command"];
const PRIMARY_MODIFIERS = new Set<ShortcutModifier>(["control", "option", "command"]);
const FUNCTION_CODES = new Set(Array.from({ length: 12 }, (_, index) => `F${index + 1}`));
const NAMED_CODES = new Set([
  "ArrowUp",
  "ArrowRight",
  "ArrowDown",
  "ArrowLeft",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Space",
  "Tab",
  "Enter",
  "Backspace",
  "Delete",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "IntlBackslash",
  "Semicolon",
  "Quote",
  "Backquote",
  "Comma",
  "Period",
  "Slash",
]);

const DISPLAY_CODES: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowDown: "↓",
  ArrowLeft: "←",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Space: "Space",
  Tab: "Tab",
  Enter: "Return",
  Backspace: "Delete",
  Delete: "Forward Delete",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

const MODIFIER_SYMBOLS: Readonly<Record<ShortcutModifier, string>> = {
  control: "⌃",
  option: "⌥",
  shift: "⇧",
  command: "⌘",
};

export function bindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "preventDefault" | "shiftKey">,
  recording = true,
): GlobalShortcutBinding | null {
  if (!recording) {
    return null;
  }
  if (event.code === "Escape") {
    return null;
  }

  event.preventDefault();
  const modifiers = canonicalModifiers(event);
  if (!modifiers.some((modifier) => PRIMARY_MODIFIERS.has(modifier)) || !isSupportedGlobalShortcutCode(event.code)) {
    return null;
  }

  return freezeBinding(modifiers, event.code);
}

export function isSupportedGlobalShortcutCode(code: string): boolean {
  return (
    NAMED_CODES.has(code)
    || FUNCTION_CODES.has(code)
    || /^Key[A-Z]$/.test(code)
    || /^Digit[0-9]$/.test(code)
  );
}

export function formatMacShortcut(shortcut: GlobalShortcutBinding): string {
  const modifiers = canonicalizeModifierList(shortcut.modifiers);
  const key = displayCode(shortcut.code);
  return `${modifiers.map((modifier) => MODIFIER_SYMBOLS[modifier]).join("")} ${key}`;
}

export function decodeGlobalShortcutSnapshot(value: unknown): GlobalShortcutSnapshot {
  try {
    const fields = readExactOwnDataProperties(value, ["shortcut", "availability"]);
    if (fields === null) {
      throw new Error("malformed global shortcut snapshot");
    }

    const shortcut = decodeGlobalShortcutBinding(fields["shortcut"]);
    const availability = fields["availability"];
    if (
      (availability !== "active" && availability !== "cleared" && availability !== "unavailable")
      || (availability === "cleared" && shortcut !== null)
      || (availability !== "cleared" && shortcut === null)
    ) {
      throw new Error("malformed global shortcut snapshot");
    }

    return Object.freeze({ shortcut, availability });
  } catch {
    throw new GlobalShortcutHostError();
  }
}

export function decodeGlobalShortcutMutationOutcome(value: unknown): GlobalShortcutMutationOutcome {
  try {
    const fields = readExactOwnDataProperties(value, ["status", "snapshot"]);
    if (fields === null) {
      throw new Error("malformed global shortcut outcome");
    }

    const status = fields["status"];
    if (
      status !== "updated"
      && status !== "unchanged"
      && status !== "invalid"
      && status !== "unavailable"
      && status !== "failed"
    ) {
      throw new Error("malformed global shortcut outcome");
    }

    return Object.freeze({ status, snapshot: decodeGlobalShortcutSnapshot(fields["snapshot"]) });
  } catch {
    throw new GlobalShortcutHostError();
  }
}

function canonicalModifiers(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">): readonly ShortcutModifier[] {
  const modifiers: ShortcutModifier[] = [];
  if (event.ctrlKey) {
    modifiers.push("control");
  }
  if (event.altKey) {
    modifiers.push("option");
  }
  if (event.shiftKey) {
    modifiers.push("shift");
  }
  if (event.metaKey) {
    modifiers.push("command");
  }
  return Object.freeze(modifiers);
}

function decodeGlobalShortcutBinding(value: unknown): GlobalShortcutBinding | null {
  if (value === null) {
    return null;
  }
  const fields = readExactOwnDataProperties(value, ["modifiers", "code"]);
  if (fields === null) {
    throw new Error("malformed global shortcut binding");
  }

  const modifiers = readExactArrayDataValues(fields["modifiers"]);
  const code = fields["code"];
  if (modifiers === null || typeof code !== "string" || !isSupportedGlobalShortcutCode(code)) {
    throw new Error("malformed global shortcut binding");
  }
  if (!isCanonicalModifierList(modifiers)) {
    throw new Error("malformed global shortcut binding");
  }

  return freezeBinding(modifiers, code);
}

function freezeBinding(modifiers: readonly ShortcutModifier[], code: string): GlobalShortcutBinding {
  return Object.freeze({ modifiers: Object.freeze([...modifiers]), code });
}

function canonicalizeModifierList(modifiers: readonly ShortcutModifier[]): readonly ShortcutModifier[] {
  return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
}

function isCanonicalModifierList(modifiers: unknown[]): modifiers is ShortcutModifier[] {
  if (modifiers.length === 0 || !modifiers.some((modifier) => PRIMARY_MODIFIERS.has(modifier as ShortcutModifier))) {
    return false;
  }

  let previousIndex = -1;
  return modifiers.every((modifier) => {
    const index = MODIFIER_ORDER.indexOf(modifier as ShortcutModifier);
    if (index <= previousIndex) {
      return false;
    }
    previousIndex = index;
    return true;
  });
}

function displayCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  return DISPLAY_CODES[code] ?? code;
}

function readExactArrayDataValues(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return null;
  }
  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!isDataProperty(lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    return null;
  }
  const length = lengthDescriptor.value;
  if (keys.length !== length + 1 || !keys.every((key, index) => key === "length" || key === String(index))) {
    return null;
  }

  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!isDataProperty(descriptor)) {
      return null;
    }
    values.push(descriptor.value);
  }
  return values;
}

function readExactOwnDataProperties(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || !keys.every((key) => typeof key === "string" && expected.includes(key))) {
    return null;
  }

  const fields: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!isDataProperty(descriptor)) {
      return null;
    }
    fields[key] = descriptor.value;
  }
  return fields;
}

function isDataProperty(descriptor: PropertyDescriptor | undefined): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined && Object.hasOwn(descriptor, "value");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
