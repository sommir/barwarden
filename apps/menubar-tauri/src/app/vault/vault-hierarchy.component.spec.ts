import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { ElementRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { ScrollLayoutService } from "@bitwarden/components";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { demoFolders, demoVaultItems } from "../vault-demo";
import { buildVaultHierarchy } from "./vault-hierarchy";
import { VaultHierarchyComponent } from "./vault-hierarchy.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultHierarchyComponent", () => {
  it("renders independently expandable vault disclosure peers with no fake tree role", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultHierarchyComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    provideScrollHost();
    const fixture = TestBed.createComponent(VaultHierarchyComponent);
    fixture.componentRef.setInput("nodes", buildVaultHierarchy({
      items: demoVaultItems,
      folders: demoFolders,
      archivedItems: [],
      deletedItems: [],
    }));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-vault-node]")];

    expect(host.querySelector(".vault-hierarchy")?.getAttribute("role")).toBe("list");
    expect(host.querySelector('[role="tree"], [role="treeitem"]')).toBeNull();
    expect(buttons.map((button) => button.dataset["vaultNode"])).toEqual([
      "favorites",
      "all-items",
      "types",
      "folders",
      "unfiled",
      "hidden",
    ]);
    expect(buttons.filter((button) => button.getAttribute("aria-expanded") === "true"))
      .toHaveLength(1);
    expect(buttons.find((button) => button.dataset["vaultNode"] === "all-items")
      ?.getAttribute("aria-expanded")).toBe("true");
    expect(buttons.every((button) => Boolean(button.getAttribute("aria-controls")))).toBe(true);

    const typeButton = buttons.find((button) => button.dataset["vaultNode"] === "types")!;
    const scrollIntoView = vi.fn();
    typeButton.scrollIntoView = scrollIntoView;
    typeButton.focus();
    typeButton.click();
    fixture.detectChanges();

    expect(typeButton.getAttribute("aria-expanded")).toBe("true");
    expect(buttons.find((button) => button.dataset["vaultNode"] === "all-items")
      ?.getAttribute("aria-expanded")).toBe("true");
    const previousContent = host.querySelector<HTMLElement>("#vault-node-all-items");
    expect(previousContent).not.toBeNull();
    expect(previousContent?.getAttribute("aria-hidden")).toBe("false");
    expect(previousContent?.hasAttribute("inert")).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(host.textContent).toContain("安全笔记");

    const loginChild = host.querySelector<HTMLButtonElement>('[data-vault-child="type:login"]')!;
    const cardChild = host.querySelector<HTMLButtonElement>('[data-vault-child="type:card"]')!;
    loginChild.click();
    fixture.detectChanges();
    expect(host.querySelector("#vault-child-type\\:login")?.getAttribute("aria-hidden")).toBe("false");

    cardChild.click();
    fixture.detectChanges();
    const closingLogin = host.querySelector<HTMLElement>("#vault-child-type\\:login");
    expect(closingLogin).not.toBeNull();
    expect(closingLogin?.getAttribute("aria-hidden")).toBe("false");
    expect(closingLogin?.hasAttribute("inert")).toBe(false);
    expect(host.querySelector("#vault-child-type\\:card")?.getAttribute("aria-hidden")).toBe("false");

    // Each child disclosure remains independent and can be collapsed in place.
    loginChild.click();
    fixture.detectChanges();
    expect(host.querySelector("#vault-child-type\\:login")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("#vault-child-type\\:card")?.getAttribute("aria-hidden")).toBe("false");

    typeButton.click();
    fixture.detectChanges();
    const closingContent = host.querySelector<HTMLElement>("#vault-node-types");

    expect(typeButton.getAttribute("aria-expanded")).toBe("false");
    expect(closingContent?.getAttribute("aria-hidden")).toBe("true");
    expect(closingContent?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(typeButton);

    typeButton.click();
    fixture.detectChanges();

    expect(typeButton.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("#vault-node-types")).not.toBeNull();
    expect(host.querySelector("#vault-node-types")?.getAttribute("aria-hidden")).toBe("false");

    typeButton.click();
    fixture.detectChanges();

    expect(host.querySelector("#vault-node-types")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("#vault-node-types")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(typeButton);
  });

  it("navigates hidden child nodes through their guarded routes", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultHierarchyComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    provideScrollHost();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const fixture = TestBed.createComponent(VaultHierarchyComponent);
    fixture.componentRef.setInput("nodes", buildVaultHierarchy({
      items: demoVaultItems,
      folders: demoFolders,
      archivedItems: [{ ...demoVaultItems[0]!, id: "archived" }],
      deletedItems: [{ ...demoVaultItems[1]!, id: "deleted" }],
    }));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[data-vault-node="hidden"]')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-vault-child="archive"]')!.click();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith("/archive");
    expect(host.querySelector('[data-vault-child="trash"]')?.textContent).toContain("1");
  });
});

function provideScrollHost(): void {
  TestBed.inject(ScrollLayoutService).scrollableRef.set(
    new ElementRef(document.createElement("div")),
  );
}
