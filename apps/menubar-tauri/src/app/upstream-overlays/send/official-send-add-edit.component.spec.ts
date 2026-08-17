import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { describe, expect, it } from "vitest";

import { OfficialSendAddEditComponent } from "./official-send-add-edit.component";
import type {
  RetainedTextSendErrors,
  RetainedTextSendField,
} from "../../send/retained-text-send-form.service";

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
    fixture.componentRef.setInput("errors", {} satisfies RetainedTextSendErrors);
    fixture.componentRef.setInput("touched", new Set<RetainedTextSendField>());
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
    fixture.componentRef.setInput("errors", {} satisfies RetainedTextSendErrors);
    fixture.componentRef.setInput("touched", new Set<RetainedTextSendField>());
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.editing()).toBe(false);
    const changes: boolean[] = [];
    fixture.componentInstance.editingChange.subscribe((value) => changes.push(value));
    host.querySelector<HTMLButtonElement>('[data-testid="edit-send"]')?.click();
    expect(changes).toEqual([true]);
  });

  it("renders touched field errors with stable accessible ids in visual focus order", async () => {
    await TestBed.configureTestingModule({ imports: [OfficialSendAddEditComponent] }).compileComponents();
    const fixture = TestBed.createComponent(OfficialSendAddEditComponent);
    fixture.componentRef.setInput("mode", "add");
    fixture.componentRef.setInput("editing", true);
    fixture.componentRef.setInput("value", {
      ...value(),
      name: "",
      text: "",
      authType: "password",
      maxAccessCount: "1.5",
    });
    fixture.componentRef.setInput("errors", {
      name: "required",
      text: "required",
      password: "required",
      maxAccessCount: "invalid-positive-integer",
    } satisfies RetainedTextSendErrors);
    fixture.componentRef.setInput(
      "touched",
      new Set<RetainedTextSendField>(["name", "text", "password", "maxAccessCount"]),
    );
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ids = ["name", "text", "password", "maxAccessCount"] as const;
    expect(ids.map((field) => host.querySelector(`#send-${field}`)?.getAttribute("aria-invalid")))
      .toEqual(["true", "true", "true", "true"]);
    expect(ids.map((field) => host.querySelector(`#send-${field}`)?.getAttribute("aria-describedby")))
      .toEqual(ids.map((field) => `send-error-${field}`));
    expect(ids.map((field) => host.querySelector(`#send-error-${field}`)?.getAttribute("role")))
      .toEqual(["alert", "alert", "alert", "alert"]);
    const maximum = host.querySelector<HTMLInputElement>("#send-maxAccessCount")!;
    expect({ type: maximum.type, min: maximum.min, step: maximum.step, inputMode: maximum.inputMode })
      .toEqual({ type: "number", min: "1", step: "1", inputMode: "numeric" });
    expect(host.querySelector("bit-card")).toBeNull();

    fixture.componentInstance.focusFirstError({ text: "required", password: "required" });
    expect(document.activeElement).toBe(host.querySelector("#send-text"));
  });

  it("keeps pending values readable while exposing a busy duplicate-submit gate", async () => {
    await TestBed.configureTestingModule({ imports: [OfficialSendAddEditComponent] }).compileComponents();
    const fixture = TestBed.createComponent(OfficialSendAddEditComponent);
    fixture.componentRef.setInput("mode", "add");
    fixture.componentRef.setInput("editing", true);
    fixture.componentRef.setInput("pending", true);
    fixture.componentRef.setInput("value", { ...value(), name: "Readable", text: "Still visible" });
    fixture.componentRef.setInput("errors", {} satisfies RetainedTextSendErrors);
    fixture.componentRef.setInput("touched", new Set<RetainedTextSendField>());
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const save = host.querySelector<HTMLButtonElement>('[data-testid="save-send"]')!;
    expect(save.getAttribute("aria-busy")).toBe("true");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("#send-name")?.value).toBe("Readable");
    expect(host.querySelector<HTMLTextAreaElement>("#send-text")?.value).toBe("Still visible");
  });

});

function value() {
  return {
    name: "Text Send", text: "message", hidden: false, deletionPresetHours: 24 as const,
    authType: "none" as const, password: "", maxAccessCount: "", hideEmail: false, notes: "",
  };
}
