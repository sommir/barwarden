import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

function installVisualCss(targetDocument: Document): HTMLStyleElement {
  const source = [
    "apps/menubar-tauri/src/styles/macos-tokens.css",
    "apps/menubar-tauri/src/styles/global.css",
  ]
    .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const tokens = new Map(
    [...rootDeclarations.matchAll(/(--(?:mac|bw)-[\w-]+):\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]),
  );
  const style = targetDocument.createElement("style");
  style.textContent = source
    .replace(/var\((--(?:mac|bw)-[\w-]+)\)/g, (value, name) => tokens.get(name) ?? value)
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
  targetDocument.head.append(style);
  return style;
}

afterEach(() => {
  delete document.documentElement.dataset["bwCompactMode"];
  document.body.classList.remove("macos-page");
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-ios27-test]").forEach((node) => node.remove());
});

describe("iOS 27 shared primitives", () => {
  it("separates 44px owners from compact visible geometry", () => {
    const style = installVisualCss(document);
    style.dataset["ios27Test"] = "true";
    document.body.classList.add("macos-page");
    document.body.innerHTML = `
      <button class="macos-hit-target"><span class="macos-icon-plate">Copy</span></button>
      <button class="macos-button-owner macos-primary-action">Save</button>
      <label class="macos-field-owner"><input class="macos-control-visible" /></label>
      <div class="macos-row macos-row--double">Row</div>
    `;
    const owner = getComputedStyle(document.querySelector<HTMLElement>(".macos-hit-target")!);
    const plate = getComputedStyle(document.querySelector<HTMLElement>(".macos-icon-plate")!);
    const fieldOwner = getComputedStyle(document.querySelector<HTMLElement>(".macos-field-owner")!);
    const input = getComputedStyle(document.querySelector<HTMLInputElement>("input")!);
    const row = getComputedStyle(document.querySelector<HTMLElement>(".macos-row")!);
    const primaryElement = document.querySelector<HTMLButtonElement>(".macos-button-owner")!;
    const primary = getComputedStyle(primaryElement);
    expect(owner.minWidth).toBe("44px");
    expect(owner.minHeight).toBe("44px");
    expect(plate.width).toBe("32px");
    expect(plate.height).toBe("32px");
    expect(fieldOwner.minHeight).toBe("44px");
    expect(input.height).toBe("40px");
    expect(row.minHeight).toBe("48px");
    expect(primary.minWidth).toBe("44px");
    expect(primary.minHeight).toBe("44px");
    expect(primary.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    primaryElement.focus();
    primaryElement.dataset["testFocusVisible"] = "true";
    expect(document.activeElement).toBe(primaryElement);
    expect(getComputedStyle(primaryElement).outlineWidth).toBe("0px");

    document.documentElement.dataset["bwCompactMode"] = "true";
    const compactPlate = getComputedStyle(document.querySelector<HTMLElement>(".macos-icon-plate")!);
    const compactInput = getComputedStyle(document.querySelector<HTMLInputElement>("input")!);
    const compactRow = getComputedStyle(document.querySelector<HTMLElement>(".macos-row")!);
    expect(compactPlate.width).toBe("28px");
    expect(compactPlate.height).toBe("28px");
    expect(compactInput.height).toBe("36px");
    expect(compactInput.minHeight).toBe("36px");
    expect(compactRow.minHeight).toBe("44px");
    expect(getComputedStyle(primaryElement).outlineWidth).toBe("0px");

    expect(style.textContent).toMatch(/\.macos-button-owner::before\s*{[^}]*inset-block:\s*2px/s);
    expect(style.textContent).toMatch(/data-bw-compact-mode="true"[^}]*\.macos-button-owner::before\s*{[^}]*inset-block:\s*4px/s);
  });

  it("keeps ordinary surfaces flat while menus and Sheet remain shaped overlays", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const frameWindow = frame.contentWindow!;
    const style = installVisualCss(frameDocument);
    style.dataset["ios27Test"] = "true";
    frameDocument.body.innerHTML = `
      <main class="macos-page--settings">
        <bit-item-group class="macos-continuous-group">
          <bit-item>
            <bit-item-action><button class="macos-continuous-row">Row</button></bit-item-action>
          </bit-item>
          <bit-item>
            <bit-item-action><button class="macos-continuous-row">Last row</button></bit-item-action>
          </bit-item>
        </bit-item-group>
      </main>
      <section class="macos-continuous-group direct-row-group">
        <button class="macos-continuous-row">Direct row</button>
        <button class="macos-continuous-row">Last direct row</button>
      </section>
      <input class="macos-form-control" />
      <button class="icon-action">Action</button>
      <div class="bit-menu-panel"><div role="menu">Menu</div></div>
      <div class="app-bottom-sheet">Sheet</div>
    `;

    const group = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".macos-continuous-group")!);
    const itemHosts = frameDocument.querySelectorAll<HTMLElement>(
      ".macos-page--settings .macos-continuous-group > bit-item",
    );
    const item = frameWindow.getComputedStyle(itemHosts[0]!);
    const lastItem = frameWindow.getComputedStyle(itemHosts[1]!);
    const itemAction = frameWindow.getComputedStyle(
      itemHosts[0]!.querySelector<HTMLElement>(":scope > bit-item-action")!,
    );
    const row = frameWindow.getComputedStyle(
      itemHosts[0]!.querySelector<HTMLElement>(".macos-continuous-row")!,
    );
    const directRows = frameDocument.querySelectorAll<HTMLElement>(
      ".direct-row-group > .macos-continuous-row",
    );
    const directRow = frameWindow.getComputedStyle(directRows[0]!);
    const lastDirectRow = frameWindow.getComputedStyle(directRows[1]!);
    const control = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".macos-form-control")!);
    const action = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".icon-action")!);
    const menu = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>('[role="menu"]')!);
    const sheet = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".app-bottom-sheet")!);

    expect(group.borderRadius).toBe("0px");
    expect(group.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(group.boxShadow).toBe("none");
    expect(item.borderBottomWidth).toBe("1px");
    expect(item.margin).toBe("0px");
    expect(item.overflow).toBe("visible");
    expect(item.borderRadius).toBe("0px");
    expect(item.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(item.boxShadow).toBe("none");
    expect(lastItem.margin).toBe("0px");
    expect(lastItem.borderRadius).toBe("0px");
    expect(lastItem.borderBottomWidth).toBe("0px");
    expect(lastItem.boxShadow).toBe("none");
    expect(itemAction.margin).toBe("0px");
    expect(itemAction.overflow).toBe("visible");
    expect(itemAction.borderRadius).toBe("0px");
    expect(itemAction.borderBottomWidth).toBe("0px");
    expect(itemAction.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(itemAction.boxShadow).toBe("none");
    expect(Number.parseFloat(row.minHeight)).toBeGreaterThanOrEqual(52);
    expect(row.borderRadius).toBe("0px");
    expect(row.borderBottomWidth).toBe("0px");
    expect(row.boxShadow).toBe("none");
    expect(directRow.borderBottomWidth).toBe("1px");
    expect(lastDirectRow.borderBottomWidth).toBe("0px");
    expect(control.minHeight).toBe("44px");
    expect(control.borderRadius).toBe("10px");
    expect(action.width).toBe("44px");
    expect(action.height).toBe("44px");
    expect(menu.borderRadius).toBe("12px");
    expect(menu.boxShadow).not.toBe("none");
    expect(sheet.borderRadius).toBe("16px 16px 0 0");
  });

  it("replaces the upstream menu-item focus shadow with one blue ring", () => {
    const upstreamStyle = document.createElement("style");
    upstreamStyle.textContent = `
      .bit-menu-panel [role="menuitem"][data-test-focus-visible="true"] {
        box-shadow: rgb(0 0 0) 0 0 0 2px inset;
      }
    `;
    document.head.append(upstreamStyle);
    const style = installVisualCss(document);
    style.dataset["ios27Test"] = "true";
    document.body.innerHTML = `
      <div class="bit-menu-panel">
        <div role="menu">
          <button role="menuitem" data-test-focus-visible="true">Login</button>
        </div>
      </div>
    `;

    const menuItem = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    const menuItemStyle = getComputedStyle(menuItem);
    expect(menuItemStyle.outlineWidth).toBe("2px");
    expect(menuItemStyle.outlineColor).toBe("rgb(10, 102, 255)");
    expect(menuItemStyle.boxShadow).toBe("none");

    upstreamStyle.remove();
  });
});
