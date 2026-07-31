import { readFileSync } from "node:fs";
import { join } from "node:path";

import "@angular/compiler";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import {
  claimLocalCopyFeedback,
  completeLocalCopyFeedback,
  type LocalCopyFeedbackReceipt,
} from "./local-copy-feedback-event";
import { LocalCopyFeedbackService } from "./local-copy-feedback.service";

describe("LocalCopyFeedbackService", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("morphs an existing copy icon to a check and replays for identical repeated actions", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const service = new LocalCopyFeedbackService(store, document);
    const button = copyButton("复制密码", '<i class="bwi bwi-clone"></i>');
    let receipt: LocalCopyFeedbackReceipt | null = null;
    button.addEventListener("click", (event) => {
      receipt = claimLocalCopyFeedback(event);
    });
    service.start();

    button.click();
    completeLocalCopyFeedback(receipt, false);
    expect(button.classList).toContain("is-copy-confirmed");
    expect(button.querySelector(".bwi-check")).not.toBeNull();

    vi.advanceTimersByTime(500);
    button.click();
    expect(button.classList).not.toContain("is-copy-confirmed");
    expect(button.querySelector(".bwi-clone")).not.toBeNull();
    completeLocalCopyFeedback(receipt, false);
    expect(button.classList).toContain("is-copy-confirmed");

    vi.advanceTimersByTime(999);
    expect(button.classList).toContain("is-copy-confirmed");
    vi.advanceTimersByTime(1);
    expect(button.classList).not.toContain("is-copy-confirmed");
    expect(button.querySelector(".bwi-clone")).not.toBeNull();
    service.destroy();
  });

  it("adds a temporary icon for text-only Send copy buttons and restores failure predictably", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const service = new LocalCopyFeedbackService(store, document);
    const button = copyButton("", "<b>复制链接</b>");
    button.dataset["testid"] = "created-copy";
    let receipt: LocalCopyFeedbackReceipt | null = null;
    button.addEventListener("click", (event) => {
      receipt = claimLocalCopyFeedback(event);
    });
    service.start();

    button.click();
    completeLocalCopyFeedback(receipt, true);

    expect(button.classList).toContain("is-copy-failed");
    expect(button.querySelector(".bwi-error")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("复制失败");
    vi.advanceTimersByTime(1_000);
    expect(button.querySelector(".bwi")).toBeNull();
    expect(button.getAttribute("aria-label")).toBeNull();
    service.destroy();
  });

  it("correlates overlapping copy results to their originating buttons and ignores unrelated status events", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const service = new LocalCopyFeedbackService(store, document);
    const first = copyButton("复制用户名", '<i class="bwi bwi-clone"></i>');
    const second = copyButton("复制 Send 链接", '<i class="bwi bwi-clone"></i>');
    let firstReceipt: LocalCopyFeedbackReceipt | null = null;
    let secondReceipt: LocalCopyFeedbackReceipt | null = null;
    first.addEventListener("click", (event) => {
      firstReceipt = claimLocalCopyFeedback(event);
    });
    second.addEventListener("click", (event) => {
      secondReceipt = claimLocalCopyFeedback(event);
    });
    service.start();

    first.click();
    second.click();
    store.setStatus("同步完成");

    expect(first.classList).not.toContain("is-copy-confirmed");
    expect(second.classList).not.toContain("is-copy-confirmed");

    completeLocalCopyFeedback(secondReceipt, false);
    expect(second.classList).toContain("is-copy-confirmed");
    expect(first.classList).not.toContain("is-copy-confirmed");

    completeLocalCopyFeedback(firstReceipt, true);
    expect(first.classList).toContain("is-copy-failed");
    expect(second.classList).toContain("is-copy-confirmed");
    service.destroy();
  });

  it("disables the morph animation under reduced motion", () => {
    const css = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );

    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.macos-copy-feedback-icon[\s\S]*?animation:\s*none/,
    );
  });
});

function copyButton(label: string, contents: string): HTMLButtonElement {
  const button = document.createElement("button");
  if (label) {
    button.setAttribute("aria-label", label);
  }
  button.innerHTML = contents;
  document.body.append(button);
  return button;
}
