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
      <section class="macos-continuous-group">
        <button class="macos-continuous-row">Row</button>
        <button class="macos-continuous-row">Last row</button>
      </section>
      <input class="macos-form-control" />
      <button class="icon-action">Action</button>
      <div class="bit-menu-panel"><div role="menu">Menu</div></div>
      <div class="app-bottom-sheet">Sheet</div>
    `;

    const group = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".macos-continuous-group")!);
    const row = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".macos-continuous-row")!);
    const control = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".macos-form-control")!);
    const action = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".icon-action")!);
    const menu = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>('[role="menu"]')!);
    const sheet = frameWindow.getComputedStyle(frameDocument.querySelector<HTMLElement>(".app-bottom-sheet")!);

    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.minHeight).toBe("52px");
    expect(row.borderRadius).toBe("0px");
    expect(row.borderBottomWidth).toBe("1px");
    expect(row.boxShadow).toBe("none");
    expect(control.minHeight).toBe("44px");
    expect(control.borderRadius).toBe("10px");
    expect(action.width).toBe("44px");
    expect(action.height).toBe("44px");
    expect(menu.borderRadius).toBe("12px");
    expect(menu.boxShadow).not.toBe("none");
    expect(sheet.borderRadius).toBe("16px 16px 0 0");
  });
});
