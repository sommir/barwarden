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
  style.textContent = source.replace(/var\((--(?:mac|bw)-[\w-]+)\)/g, (value, name) =>
    tokens.get(name) ?? value,
  );
  targetDocument.head.append(style);
  return style;
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-ios27-test]").forEach((node) => node.remove());
});

describe("iOS 27 shared primitives", () => {
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
});
