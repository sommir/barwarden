import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const pinned = (path: string) => join(root, "vendor/bitwarden-clients", path);
const overlay = (path: string) => join(root, "apps/menubar-tauri/src/app/upstream-overlays/auth", path);

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("official authentication environment overlays", () => {
  it("pins every anonymous-shell, selector, and dialog authority before applying transformations", () => {
    const authorities = [
      [
        "apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html",
        "anonymous/official-anonymous-shell.component.html",
        "91c9bb20d25267b7a2483b56c3ef725fef39792edabcbd49688c866c485e151d",
      ],
      [
        "libs/angular/src/auth/environment-selector/environment-selector.component.html",
        "environment/official-environment-selector.component.html",
        "164bf8109eb7553f7297a1a0675a74affb798d77ccc36bd8dd884b657cc68273",
      ],
      [
        "libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
        "environment/official-self-hosted-dialog.component.html",
        "818d86ffea0b050e1cbe0f86fab6437b43f015a629df02301917687f3e87e1f4",
      ],
    ] as const;

    for (const [authority, target, hash] of authorities) {
      expect(existsSync(pinned(authority)), authority).toBe(true);
      expect(sha256(pinned(authority)), `${authority} pinned hash`).toBe(hash);
      expect(existsSync(overlay(target)), `${target} overlay template`).toBe(true);
    }
  });

  it("permits only the documented projection, local dialog, region, and form-block transformations", () => {
    const anonymousAuthority = readFileSync(
      pinned("apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html"),
      "utf8",
    );
    const selectorAuthority = readFileSync(
      pinned("libs/angular/src/auth/environment-selector/environment-selector.component.html"),
      "utf8",
    );
    const dialogAuthority = readFileSync(
      pinned("libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html"),
      "utf8",
    );

    const anonymousExpected = anonymousAuthority
      .replace('      <app-current-account *ngIf="showAcctSwitcher && hasLoggedInAccount"></app-current-account>\n', "")
      .replace(
        '    [showBackButton]="showBackButton"\n',
        '    [showBackButton]="showBackButton"\n    [backAction]="backAction"\n',
      )
      .replace(
        '    <div class="tw-w-32">\n      <bit-svg *ngIf="showLogo" [content]="logo" [ariaLabel]="\'appLogoLabel\' | i18n"></bit-svg>\n    </div>',
        '    <div class="macos-auth-product">\n      <strong>Barwarden</strong>\n    </div>',
      )
      .replace(
        /    <router-outlet><\/router-outlet>[\s\S]*?    <router-outlet slot="environment-selector" name="environment-selector"><\/router-outlet>/,
        "    <ng-content></ng-content>",
      );
    const selectorExpected = selectorAuthority
      .replaceAll("toggle(region.key)", "toggle(region.key, environmentTrigger)")
      .replaceAll("toggle(ServerEnvironmentType.SelfHosted)", "toggle(ServerEnvironmentType.SelfHosted, environmentTrigger)")
      .replace(
        '<button [bitMenuTriggerFor]="environmentOptions" bitLink type="button">',
        [
          "<button",
          "        #environmentTrigger",
          '        [bitMenuTriggerFor]="environmentOptions"',
          "        bitLink",
          '        type="button"',
          '        (mousedown)="interactionStarted.emit(); $event.preventDefault()"',
          '        (click)="interactionCompleted.emit()"',
          "      >",
        ].join("\n"),
      )
      .concat(
        "\n<bw-official-self-hosted-dialog\n  (saved)=\"selectSelfHosted($event)\"\n  (dismissed)=\"restoreValidityAfterDismissal()\"\n></bw-official-self-hosted-dialog>\n",
      );
    const baseField = dialogAuthority.match(/    <bit-form-field>[\s\S]*?    <\/bit-form-field>/)?.[0];
    expect(baseField).toBeDefined();
    const retainedBaseField = baseField!
      .replace(/^    /gm, "      ")
      .replace("        <input\n", "        <input\n          #baseUrlInput\n")
      .replace("          appAutofocus\n", "")
      .replace("          appInputVerbatim\n", '          data-testid="self-hosted-server-url"\n');
    const dialogExpected = [
      '<bw-app-bottom-sheet\n  #dialog\n  labelledBy="self-hosted-dialog-title"\n  testId="self-hosted-dialog"\n  (dismissed)="onDismissed()"\n  (closed)="onClose()"\n>',
      "  @if (isOpen) {",
      '  <form [formGroup]="formGroup" (submit)="submit($event)" bit-dialog dialogSize="small">',
      '    <span bitDialogTitle id="self-hosted-dialog-title">{{ "selfHostedEnvironment" | i18n }}</span>',
      "    <ng-container bitDialogContent>",
      retainedBaseField,
      "\n      @if (showErrorSummary) {\n        <span class=\"tw-block tw-text-danger tw-mt-2\" aria-live=\"assertive\" role=\"alert\">\n          <bit-icon name=\"bwi-error\"></bit-icon> {{ \"selfHostedEnvFormInvalid\" | i18n }}\n        </span>\n      }",
      "    </ng-container>",
      "    <ng-container bitDialogFooter>",
      '      <button bitButton bitFormButton buttonType="primary" type="submit" data-testid="self-hosted-save">',
      '        {{ "save" | i18n }}\n      </button>',
      '      <button bitButton bitFormButton buttonType="secondary" type="button" data-testid="self-hosted-cancel" (click)="cancel()">',
      '        {{ "cancel" | i18n }}\n      </button>',
      "    </ng-container>\n  </form>\n  }\n</bw-app-bottom-sheet>\n",
    ].join("\n");

    expect(readFileSync(overlay("anonymous/official-anonymous-shell.component.html"), "utf8")).toBe(anonymousExpected);
    expect(readFileSync(overlay("environment/official-environment-selector.component.html"), "utf8")).toBe(selectorExpected);
    expect(readFileSync(overlay("environment/official-self-hosted-dialog.component.html"), "utf8")).toBe(dialogExpected);
  });
});
