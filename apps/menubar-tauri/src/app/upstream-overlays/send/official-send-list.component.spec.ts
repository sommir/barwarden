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

  it("renders populated Text rows with only the official view-before-edit, copy, and delete commands", async () => {
    const fixture = await createFixture({ sends: [textSend({ hasPassword: true })], state: "ready" });
    const commands = outputCommands(fixture.componentInstance);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("Payroll token");
    expect(host.querySelectorAll("bit-item")).toHaveLength(1);
    expect(host.querySelector('a[href*="edit-send"]')).toBeNull();

    host.querySelector<HTMLButtonElement>("[bit-item-content]")?.click();
    host.querySelector<HTMLButtonElement>('[aria-label^="复制链接"]')?.click();
    host.querySelector<HTMLButtonElement>('[aria-label^="删除"]')?.click();

    expect(host.querySelector('[aria-label^="移除密码"]')).toBeNull();
    expect(host.querySelector('[bitIconButton="bwi-unlock"]')).toBeNull();
    expect("removePassword" in fixture.componentInstance).toBe(false);
    expect(commands).toEqual(["open:send-1", "copy:send-1", "delete:send-1"]);
  });

  it("emits search and filter commands and exposes only a Text new action", async () => {
    const fixture = await createFixture({ sends: [textSend()], state: "ready", filtersVisible: true });
    const commands = outputCommands(fixture.componentInstance);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const search = host.querySelector<HTMLInputElement>("bit-search input")!;
    search.value = "payroll";
    search.dispatchEvent(new Event("input"));
    await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('[aria-label="筛选 Send"]')?.click();
    host.querySelector<HTMLSelectElement>('select[aria-label="类型"]')!.value = "text";
    host.querySelector<HTMLSelectElement>('select[aria-label="类型"]')!.dispatchEvent(new Event("change"));
    host.querySelector<HTMLButtonElement>('[aria-label="新增文本 Send"]')?.click();

    expect(commands).toEqual(["query:payroll", "filters", "filter:text", "open:new"]);
    expect(host.textContent).not.toContain("文件 Send");
    expect(host.querySelector('[value="file"]')).toBeNull();
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
