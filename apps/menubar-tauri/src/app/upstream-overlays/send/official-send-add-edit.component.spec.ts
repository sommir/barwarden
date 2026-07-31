import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { describe, expect, it } from "vitest";

import { OfficialSendAddEditComponent } from "./official-send-add-edit.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

describe("OfficialSendAddEditComponent", () => {
  it("renders only retained Text and Password auth choices", async () => {
    await TestBed.configureTestingModule({ imports: [OfficialSendAddEditComponent] }).compileComponents();
    const fixture = TestBed.createComponent(OfficialSendAddEditComponent);
    fixture.componentRef.setInput("mode", "add");
    fixture.componentRef.setInput("editing", true);
    fixture.componentRef.setInput("value", value());
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const details = fixture.debugElement.query(By.css("bw-official-send-details"));
    expect(details.componentInstance.authOptions).toEqual([
      "任何拥有链接的人",
      "任何拥有密码的人",
    ]);
    expect(host.textContent).not.toContain("特定人员");
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(details.componentInstance.authType("password")).toBe("password");
  });

  it("keeps the existing Send in view mode until Edit is selected", async () => {
    await TestBed.configureTestingModule({ imports: [OfficialSendAddEditComponent] }).compileComponents();
    const fixture = TestBed.createComponent(OfficialSendAddEditComponent);
    fixture.componentRef.setInput("mode", "edit");
    fixture.componentRef.setInput("editing", false);
    fixture.componentRef.setInput("value", value());
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.editing()).toBe(false);
    const changes: boolean[] = [];
    fixture.componentInstance.editingChange.subscribe((value) => changes.push(value));
    host.querySelector<HTMLButtonElement>('[data-testid="edit-send"]')?.click();
    expect(changes).toEqual([true]);
  });

});

function value() {
  return {
    name: "Text Send", text: "message", hidden: false, deletionPresetHours: 24 as const,
    authType: "none" as const, password: "", maxAccessCount: "", hideEmail: false, notes: "",
  };
}
