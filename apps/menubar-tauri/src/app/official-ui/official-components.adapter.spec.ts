import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import "zone.js";
import "@angular/compiler";

import { describe, expect, it } from "vitest";

import * as officialComponents from "./official-components";
import { Utils } from "./official-common-utils.adapter";

const expectedExports = [
  "ButtonComponent",
  "BitIconButtonComponent",
  "TypographyDirective",
  "SectionComponent",
  "SectionHeaderComponent",
  "ItemComponent",
  "ItemContentComponent",
  "ItemActionComponent",
  "ItemGroupComponent",
  "BitFormFieldComponent",
  "BitFieldContainerDirective",
  "BitPasswordInputToggleDirective",
  "BitPrefixDirective",
  "BitSuffixDirective",
  "BitInputDirective",
  "AutofocusDirective",
  "MenuComponent",
  "MenuTriggerForDirective",
  "MenuItemComponent",
  "MenuDividerComponent",
  "ScrollLayoutDirective",
  "SearchComponent",
  "CalloutComponent",
  "SkeletonComponent",
  "SkeletonTextComponent",
  "SkeletonGroupComponent",
  "NoItemsComponent",
  "HeaderComponent",
  "BottomNavigationComponent",
  "AvatarComponent",
  "BitHintDirective",
  "BitLabelComponent",
  "CardComponent",
  "CheckboxComponent",
  "FormControlComponent",
  "OptionComponent",
  "SelectComponent",
  "ChipActionComponent",
  "ChipFilterComponent",
  "ColorPasswordComponent",
  "DisclosureComponent",
  "DisclosureTriggerForDirective",
  "IconComponent",
  "ToggleComponent",
  "ToggleGroupComponent",
  "DialogComponent",
  "DialogFooterDirective",
] as const;

const overlayRoot = resolve(process.cwd(), "apps/menubar-tauri/official-components-overlay");
const vendorRoot = resolve(process.cwd(), "vendor/bitwarden-clients/libs/components/src");
const expectedSymlinks = [
  "anon-layout",
  "berry",
  "avatar",
  "bottom-navigation",
  "button",
  "card",
  "callout",
  "checkbox",
  "chips",
  "color-password",
  "disclosure",
  "dialog",
  "form-control",
  "header",
  "icon",
  "icon-button",
  "icon-tile",
  "input",
  "item",
  "link",
  "landing-layout",
  "no-items",
  "popover",
  "search",
  "select",
  "section",
  "shared",
  "skeleton",
  "spinner",
  "svg",
  "typography",
  "toggle-group",
  "a11y/a11y-title.directive.ts",
  "a11y/aria-disable.directive.ts",
  "a11y/aria-disabled-click-capture.service.ts",
  "a11y/autofocus-fallback.directive.ts",
  "a11y/set-a11y-title-and-aria-label.ts",
  "utils/aria-disable-element.ts",
  "utils/dom-observables.ts",
  "utils/function-to-observable.ts",
  "utils/has-scrollable-content.ts",
  "utils/has-scrolled-from.ts",
  "form-field/field-container.directive.ts",
  "form-field/form-field.component.html",
  "form-field/prefix.directive.ts",
  "form-field/suffix.directive.ts",
  "menu/default-positions.ts",
  "menu/menu-divider.component.html",
  "menu/menu-divider.component.ts",
  "menu/menu-item.component.html",
  "menu/menu-item.component.ts",
  "menu/menu.component.html",
  "menu/menu.component.ts",
  "menu/menu.module.ts",
] as const;

const asyncActionsSymlinks = [
  "bit-submit.directive.ts",
  "dirty-form.service.ts",
  "form-button.directive.ts",
] as const;

describe("official-components adapter", () => {
  it("loads the complete official primitive surface at runtime", () => {
    expect(Object.keys(officialComponents).sort()).toEqual([...expectedExports].sort());

    for (const symbol of expectedExports) {
      expect(officialComponents[symbol]).toBeDefined();
    }
  });

  it("provides only the common Utils behavior required by the official avatar", () => {
    expect(Utils.isNullOrWhitespace(undefined)).toBe(true);
    expect(Utils.isNullOrWhitespace("  ")).toBe(true);
    expect(Utils.isNullOrWhitespace("account")).toBe(false);
    expect(Utils.pickTextColorBasedOnBgColor("#ffffff", 135, true)).toBe("black");
    expect(Utils.pickTextColorBasedOnBgColor("#000000", 135, true)).toBe("white");
    expect("A😀B".match(Utils.regexpEmojiPresentation)).toEqual(["😀"]);
    expect(Utils.isPromise(Promise.resolve())).toBe(true);
    expect(Utils.isPromise({ then: () => undefined, catch: () => undefined })).toBe(true);
    expect(Utils.isPromise({ then: () => undefined })).toBe(false);
    expect(Object.getOwnPropertyNames(Utils).sort()).toEqual([
      "isMobileBrowser",
      "isNullOrWhitespace",
      "isPromise",
      "length",
      "name",
      "pickTextColorBasedOnBgColor",
      "prototype",
      "regexpEmojiPresentation",
    ]);
  });

  it("uses only relative symlinks to the pinned official component source", () => {
    for (const relativePath of expectedSymlinks) {
      const overlayPath = resolve(overlayRoot, relativePath);
      const target = readlinkSync(overlayPath);
      const expectedTarget = relativePath.includes("/")
        ? `../../../../vendor/bitwarden-clients/libs/components/src/${relativePath}`
        : `../../../vendor/bitwarden-clients/libs/components/src/${relativePath}`;

      expect(lstatSync(overlayPath).isSymbolicLink()).toBe(true);
      expect(target).toBe(expectedTarget);
      expect(realpathSync(overlayPath)).toBe(resolve(vendorRoot, relativePath));
    }
  });

  it("materializes only the guarded macOS behavior adapters", () => {
    for (const relativePath of [
      "form-field/error.component.ts",
      "form-field/form-field-control.directive.ts",
      "form-field/form-field.component.ts",
      "form-field/password-input-toggle.directive.ts",
      "menu/menu-trigger-for.directive.ts",
      "tooltip/tooltip.directive.ts",
    ]) {
      expect(lstatSync(resolve(overlayRoot, relativePath)).isSymbolicLink()).toBe(false);
    }
  });

  it("keeps runtime component exports on one overlay module identity", () => {
    const barrel = readFileSync(resolve(overlayRoot, "index.ts"), "utf8");
    const directVendorRuntimeExports = barrel
      .split("\n")
      .filter((line) => line.includes("vendor/bitwarden-clients") && !line.trimStart().startsWith("export type"));

    expect(directVendorRuntimeExports).toEqual([]);
  });

  it("keeps unchanged async-actions files pinned while reserving BitActionDirective for its guarded overlay", () => {
    const asyncActionsRoot = resolve(overlayRoot, "async-actions");
    expect(lstatSync(asyncActionsRoot).isSymbolicLink()).toBe(false);

    for (const relativePath of asyncActionsSymlinks) {
      const overlayPath = resolve(asyncActionsRoot, relativePath);
      expect(lstatSync(overlayPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(overlayPath)).toBe(
        `../../../../vendor/bitwarden-clients/libs/components/src/async-actions/${relativePath}`,
      );
      expect(realpathSync(overlayPath)).toBe(resolve(vendorRoot, "async-actions", relativePath));
    }
  });

  it("loads the pinned popup preflight required by official hidden form slots", () => {
    const theme = readFileSync(
      resolve(process.cwd(), "apps/menubar-tauri/src/styles/official-theme.css"),
      "utf8",
    );
    expect(theme).toContain("tw-theme-preflight.css");
    expect(theme).toContain("multi-select/scss/bw.theme.css");
  });

  it("keeps the form-field overlay barrel narrow while loading pinned runtime files", () => {
    expect(readFileSync(resolve(overlayRoot, "form-field/index.ts"), "utf8")).toBe(
      'export { BitFormFieldControlDirective } from "./form-field-control.directive";\n',
    );
  });
});
