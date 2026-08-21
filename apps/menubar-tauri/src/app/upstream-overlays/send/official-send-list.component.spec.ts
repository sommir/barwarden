import "zone.js";
import "@angular/compiler";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { beforeEach, describe, expect, it } from "vitest";

const runtimePath = resolve(
  process.cwd(),
  "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts",
);

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

beforeEach(() => TestBed.resetTestingModule());

describe("OfficialSendListComponent", () => {
  it("has a generated official runtime", () => {
    expect(existsSync(runtimePath)).toBe(true);
  });

  it("isolates row, Copy link, and danger Delete in More", async () => {
    const fixture = await createFixture({ sends: [textSend({ hasPassword: true })], state: "ready" });
    const commands = outputCommands(fixture.componentInstance);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    document.body.append(host);
    const row = host.querySelector<HTMLElement>("bit-item")!;
    expect(host.textContent).toContain("Payroll token");
    expect(host.querySelectorAll("bit-item")).toHaveLength(1);
    expect(host.querySelector('a[href*="edit-send"]')).toBeNull();

    row.querySelector<HTMLButtonElement>("[bit-item-content]")!.click();
    row.querySelector<HTMLButtonElement>('[aria-label^="复制链接"]')!.click();
    const more = row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    expect(more).not.toBeNull();
    expect(more.getAttribute("aria-label")).toContain("Payroll token");
    expect(row.querySelector('[biticonbutton="bwi-trash"]')).toBeNull();
    more.click();
    await fixture.whenStable();
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label*="Payroll token"]')!;
    const danger = menu.querySelector<HTMLButtonElement>('[role="menuitem"].tw-text-fg-danger')!;
    expect(danger.textContent?.trim()).toBe("删除");
    danger.click();

    expect(host.querySelector('[aria-label^="移除密码"]')).toBeNull();
    expect(host.querySelector('[bitIconButton="bwi-unlock"]')).toBeNull();
    expect("removePassword" in fixture.componentInstance).toBe(false);
    expect(commands).toEqual(["open:send-1", "copy:send-1", "delete:send-1"]);
    expect(document.activeElement).toBe(more);

    fixture.destroy();
    host.remove();
  });

  it("supports keyboard menu navigation and returns focus to the contextual More trigger", async () => {
    const fixture = await createFixture({ sends: [textSend()], state: "ready" });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    document.body.append(host);
    const more = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    more.focus();
    more.click();
    await new Promise((resolvePromise) => setTimeout(resolvePromise));

    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label*="Payroll token"]')!;
    expect(menu.getAttribute("aria-label")).toContain("Payroll token");
    expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'));

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 170));

    expect(document.querySelector('[role="menu"][aria-label*="Payroll token"]')).toBeNull();
    expect(document.activeElement).toBe(more);

    fixture.destroy();
    host.remove();
  });

  it("emits search and filter commands and exposes only a Text new action", async () => {
    const fixture = await createFixture({
      sends: [textSend()],
      state: "ready",
      filtersVisible: true,
      filterType: "text",
    });
    const commands = outputCommands(fixture.componentInstance);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="类型"]')!;

    expect(select.value).toBe("text");
    fixture.componentRef.setInput("filtersVisible", false);
    fixture.detectChanges();
    fixture.componentRef.setInput("filtersVisible", true);
    fixture.detectChanges();
    const reopenedSelect = host.querySelector<HTMLSelectElement>('select[aria-label="类型"]')!;
    expect(reopenedSelect.value).toBe("text");

    const search = host.querySelector<HTMLInputElement>("bit-search input")!;
    search.value = "payroll";
    search.dispatchEvent(new Event("input"));
    await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('[aria-label="筛选 Send"]')?.click();
    reopenedSelect.value = "text";
    reopenedSelect.dispatchEvent(new Event("change"));
    host.querySelector<HTMLButtonElement>('[aria-label="新增文本 Send"]')?.click();

    expect(commands).toEqual(["query:payroll", "filters", "filter:text", "open:new"]);
    expect(host.textContent).not.toContain("文件 Send");
    expect(host.querySelector('[value="file"]')).toBeNull();
  });

  it("publishes structural Send focus keys without exposing visible Send values", async () => {
    const fixture = await createFixture({
      sends: [
        textSend({
          id: "m12-text-send",
          name: "Example Send",
          text: "secret body",
          accessUrl: "https://send.example.test/m12-text-send",
        }),
      ],
      state: "ready",
    });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const sendKeys = [...host.querySelectorAll<HTMLElement>("[data-popup-focus-key]")].map((node) =>
      node.getAttribute("data-popup-focus-key"),
    );

    expect(sendKeys).toEqual(
      expect.arrayContaining([
        "send:search",
        "send-item:m12-text-send",
        "send-item:m12-text-send:copy",
        "send-item:m12-text-send:more",
      ]),
    );
    expect(sendKeys.join("\n")).not.toMatch(/Example Send|secret body|https?:\/\//);
    expect(host.querySelector("[data-bw-focus-key]")).toBeNull();
  });

  it.each([
    ["loading", { loading: true, state: "empty" }, "正在加载 Send"],
    ["empty", { state: "empty" }, "安全地发送敏感信息"],
    ["no results", { state: "no-results" }, "没有匹配的 Send"],
    ["disabled policy", { state: "empty", disabled: true }, "Send 已禁用"],
  ] as const)("renders the official %s state", async (_label, inputs, expected) => {
    const fixture = await createFixture(inputs);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const renderedState = inputs.loading
      ? host.querySelector('[aria-label="正在加载 Send"]')?.getAttribute("aria-label")
      : host.textContent;
    expect(renderedState).toContain(expected);
    if (inputs.disabled) {
      expect(host.querySelector('[aria-label="新增文本 Send"]')).toBeNull();
    }
  });
});

async function createFixture(inputs: Record<string, unknown>) {
  const { OfficialSendListComponent } = await import("./official-send-list.component");
  await TestBed.configureTestingModule({ imports: [OfficialSendListComponent] }).compileComponents();
  const fixture = TestBed.createComponent(OfficialSendListComponent);
  fixture.componentRef.setInput("sends", []);
  fixture.componentRef.setInput("query", "");
  fixture.componentRef.setInput("filtersVisible", false);
  fixture.componentRef.setInput("filterType", "");
  fixture.componentRef.setInput("loading", false);
  fixture.componentRef.setInput("disabled", false);
  fixture.componentRef.setInput("state", "empty");
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  return fixture;
}

function outputCommands(component: any): string[] {
  const commands: string[] = [];
  component.queryChange.subscribe((value: string) => commands.push(`query:${value}`));
  component.toggleFilters.subscribe(() => commands.push("filters"));
  component.filterChange.subscribe((value: string) => commands.push(`filter:${value}`));
  component.open.subscribe((send: { id: string } | undefined) => commands.push(`open:${send?.id ?? "new"}`));
  component.copyLink.subscribe((request: { send: { id: string } }) =>
    commands.push(`copy:${request.send.id}`),
  );
  component.delete.subscribe((send: { id: string }) => commands.push(`delete:${send.id}`));
  return commands;
}

function textSend(overrides: Record<string, unknown> = {}) {
  return {
    id: "send-1",
    name: "Payroll token",
    deletionDate: "2026-08-01T00:00:00.000Z",
    disabled: false,
    expired: false,
    maxAccessCountReached: false,
    hasPassword: false,
    ...overrides,
  };
}
