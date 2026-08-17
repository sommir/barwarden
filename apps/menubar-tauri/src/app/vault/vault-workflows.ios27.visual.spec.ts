import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = ["macos-tokens.css", "global.css"]
    .map((file) => readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles", file), "utf8"))
    .join("\n");
  document.head.append(style);
});
afterAll(() => { style.remove(); document.body.className = ""; document.body.replaceChildren(); });

describe("iOS 27 Vault workflows", () => {
  it("renders OTP as a flat continuous list with accessible actions", () => {
    document.body.innerHTML = `<main class="macos-page--otp"><div class="otp-page__list">
      <article class="otp-code-row"><button class="otp-code-row__copy"><span class="otp-code-row__code">123 456</span></button><button class="otp-code-row__retry">Retry</button></article>
    </div><div class="otp-page__empty">Empty</div></main>`;
    const group = getComputedStyle(document.querySelector<HTMLElement>(".otp-page__list")!);
    const row = getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row")!);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderBottomWidth).toBe("1px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row__copy")!).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row__retry")!).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-page__empty")!).borderRadius).toBe("0px");
    document.body.className = "tw-bit-compact";
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row")!).minHeight).toBe("52px");
  });
});
