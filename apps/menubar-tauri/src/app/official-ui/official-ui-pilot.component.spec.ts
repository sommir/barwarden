import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import "../../styles/global.css";
import { OfficialUiPilotComponent } from "./official-ui-pilot.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

async function renderOfficialPilot(): Promise<HTMLElement> {
  await TestBed.configureTestingModule({ imports: [OfficialUiPilotComponent] }).compileComponents();

  const fixture = TestBed.createComponent(OfficialUiPilotComponent);
  fixture.detectChanges();

  return fixture.nativeElement as HTMLElement;
}

describe("OfficialUiPilotComponent", () => {
  it("renders real official button, icon button, typography, and section primitives", async () => {
    const host = await renderOfficialPilot();

    expect(host.querySelector("button[bitbutton]")).not.toBeNull();
    expect(host.querySelector('[data-testid="official-icon-button"]')).not.toBeNull();
    expect(host.querySelector("bit-bottom-navigation")).not.toBeNull();
    expect(getComputedStyle(host.querySelector("button")!).fontFamily.startsWith("-apple-system")).toBe(true);
    expect(host.querySelector(".local-primary-action")).toBeNull();
  });

  it("imports the complete pinned official icon stylesheet", () => {
    const officialTheme = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/official-theme.css"),
      "utf8",
    );
    const officialIconStyles = readFileSync(
      join(
        process.cwd(),
        "vendor/bitwarden-clients/libs/angular/src/scss/bwicons/styles/style.css",
      ),
      "utf8",
    );

    expect(officialTheme).toContain(
      '@import "../../../../vendor/bitwarden-clients/libs/angular/src/scss/bwicons/styles/style.css";',
    );
    expect(officialIconStyles).toMatch(/\.bwi-accessibility:before\s*\{\s*content:\s*"\\f172";/s);
  });
});
