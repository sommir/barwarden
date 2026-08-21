import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { officialSourceMappings } from "../../../upstream-source-map";

const root = process.cwd();
const vendorRoot = join(root, "vendor/bitwarden-clients");
const overlayRoot = join(root, "apps/menubar-tauri/src/app/upstream-overlays/auth/lock");
const manifestPath = join(overlayRoot, "official-master-password-lock.transform-manifest.json");
const manifestDigest = "57c4626c988733ed5647574af8f5d879ceb0afb64d70c3e9755ebf5faae6030a";
const expectedRevision = [
  "https://github.com/bitwarden/clients.git",
  "f47b6946e01aed474875789081966d311d5b8289",
  "",
].join("\n");
const authorityHashes = [
  ["libs/key-management-ui/src/lock/components/lock.component.ts", "72940f3a20891613a5cd4f614617a8a1f58a0973476fa9a4c3b37f9eaa884d3d"],
  ["libs/key-management-ui/src/lock/components/lock.component.html", "abe5b5337e0d3a2a825d8650eb23ccaf1b76ebfe7d3f4dfb66bfe12c955a4071"],
  ["libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts", "6adf8f3f7f364bd07e86f5e8ad9f1511c98a723d2d1339031f501a69832f99ff"],
  ["libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html", "59ec49469e039a115afae5f35a41ba52de85fcca2cfec6b6771f5b35fd2208e4"],
] as const;
const resolverDecision = [
  "official lock aliases resolve only the pinned source authorities and remain dormant in production",
  "production statically imports LockPageComponent -> OfficialLockComponent -> OfficialPinLockComponent or OfficialMasterPasswordLockComponent with local AuthFacade and UnlockMethodsPort adapters",
  "browser native messaging, PRF/hardware-key, shared unlock, device trust, broadcaster, and browser pop-out modules are deleted rather than resolved into production",
] as const;

const allowedRemovedMembers = {
  "official-lock.component.ts": [
    "destroy$", "activeAccountChange$", "clientType", "enforcedMasterPasswordOptions",
    "shouldClosePopout", "onPrfUnlockSuccess", "setUserKeyAndContinue",
    "requirePasswordChange", "desktopOnInit", "onWindowHidden",
  ],
  "official-master-password-lock.component.ts": [
    "platformUtilsService", "messageListener", "prfUnlockSuccess",
    "destroy$", "ngOnInit", "onPrfUnlockSuccess",
  ],
} as const;

type ExactPartition = {
  readonly authority: string;
  readonly runtime: string;
  readonly upstreamMembers: {
    readonly retained: readonly string[];
    readonly adapted: readonly string[];
    readonly removed: readonly string[];
  };
  readonly upstreamImports: {
    readonly retained: readonly string[];
    readonly adapted: readonly string[];
    readonly removed: readonly string[];
  };
  readonly localMembers: readonly string[];
  readonly localImports: readonly LocalImport[];
};

type LocalImport = {
  readonly module: string;
  readonly bindings: readonly string[];
};

type LockManifest = {
  readonly revision: string;
  readonly license: {
    readonly rootPackageSha256: string;
    readonly rootLicenseSha256: string;
    readonly upstreamPackageSha256: string;
    readonly upstreamGplSha256: string;
  };
  readonly authorities: readonly { readonly path: string; readonly sha256: string }[];
  readonly localRuntimes: readonly { readonly path: string; readonly sha256: string }[];
  readonly exactPartitions: readonly ExactPartition[];
  readonly localGraph: readonly {
    readonly runtime: string;
    readonly localMembers: readonly string[];
    readonly localImports: readonly LocalImport[];
  }[];
  readonly resolverDecision: readonly string[];
  readonly templateTransforms: readonly {
    readonly authority: string;
    readonly runtime: string;
    readonly retained: readonly string[];
    readonly adapted: readonly string[];
    readonly removed: readonly string[];
  }[];
};

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceFile(path: string, source = readFileSync(path, "utf8")): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
}

function classMembers(source: ts.SourceFile): string[] {
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement),
  );
  return declaration?.members
    .map((member) => member.name?.getText(source))
    .filter((member): member is string => Boolean(member)) ?? [];
}

function imports(source: ts.SourceFile): string[] {
  return source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
}

function normalizedBindings(clause: ts.ImportClause | undefined): string[] {
  if (!clause) {
    return [];
  }
  const kind = clause.isTypeOnly ? "type" : "value";
  const result: string[] = [];
  if (clause.name) {
    result.push(`${kind}:default:default:${clause.name.text}`);
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    result.push(`${kind}:namespace:*:${clause.namedBindings.name.text}`);
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const binding of clause.namedBindings.elements) {
      result.push(
        `${clause.isTypeOnly || binding.isTypeOnly ? "type" : "value"}:named:${(binding.propertyName ?? binding.name).text}:${binding.name.text}`,
      );
    }
  }
  return result.sort();
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function assertLocalRuntime(runtime: string, expected: {
  readonly runtime: string;
  readonly localMembers: readonly string[];
  readonly localImports: readonly LocalImport[];
}): void {
  const source = sourceFile(expected.runtime, runtime);
  expect(sorted(classMembers(source))).toEqual(sorted(expected.localMembers));
  const actualImports = source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => ({
      module: (statement.moduleSpecifier as ts.StringLiteral).text,
      bindings: normalizedBindings(statement.importClause),
    }));
  expect(sorted(actualImports.map((entry) => entry.module))).toEqual(
    sorted(expected.localImports.map((entry) => entry.module)),
  );
  for (const expectedImport of expected.localImports) {
    expect(actualImports.find((entry) => entry.module === expectedImport.module)?.bindings)
      .toEqual(sorted(expectedImport.bindings));
  }
}

function replaceExact(source: string, search: string | RegExp, replacement: string, label: string): string {
  const matches = typeof search === "string" ? source.split(search).length - 1 : [...source.matchAll(new RegExp(search.source, `${search.flags.replace("g", "")}g`))].length;
  expect(matches, label).toBe(1);
  return source.replace(search, replacement);
}

function extractExact(source: string, pattern: RegExp, label: string): string {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))];
  expect(matches, label).toHaveLength(1);
  return matches[0][0];
}

function indent(source: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return source.split("\n").map((line) => line ? `${prefix}${line}` : line).join("\n");
}

function localizeLockTemplate(source: string): string {
  return source
    .replaceAll("使用 Touch ID 解锁", '{{ "i18nUnlockWithTouchId" | i18n }}')
    .replaceAll("使用 Touch ID", '{{ "i18nUseTouchId" | i18n }}')
    .replaceAll("使用 PIN", '{{ "i18nUsePin" | i18n }}')
    .replaceAll("使用主密码", '{{ "i18nUseMasterPassword" | i18n }}')
    .replaceAll("退出登录", '{{ "logOut" | i18n }}')
    .replaceAll("\n      解锁\n", '\n      {{ "unlock" | i18n }}\n')
    .replaceAll(">解锁<", '>{{ "unlock" | i18n }}<')
    .replaceAll(">或<", '>{{ "or" | i18n }}<')
    .replaceAll(
      'aria-label="正在载入解锁方式"',
      '[attr.aria-label]="\'i18nLoadingUnlockMethods\' | i18n"',
    )
    .replaceAll(
      "无法完成页面跳转。请重试。",
      '{{ "i18nUnableToCompleteNavigation" | i18n }}',
    )
    .replaceAll(">切换账户<", '>{{ "switchAccount" | i18n }}<');
}

function transformMasterPasswordTemplate(authority: string): string {
  let result = authority;
  result = replaceExact(result, '<form [formGroup]="formGroup" [bitSubmit]="submit">', '<form [formGroup]="formGroup" [bitSubmit]="submit" class="macos-auth-card">', "master-password auth card");
  result = replaceExact(result, "  <bit-form-field>\n", "  <bit-form-field class=\"macos-field\">\n", "master-password semantic field");
  result = replaceExact(result, "      appInputVerbatim\n", "      appInputVerbatim\n      autocomplete=\"current-password\"\n      data-testid=\"lock-master-password-input\"\n      (input)=\"dismissUnlockError()\"\n", "password input attributes");
  result = replaceExact(result, "      type=\"password\"\n", "      [type]=\"showPassword ? 'text' : 'password'\"\n", "localized password visibility input");
  result = replaceExact(
    result,
    "      bitIconButton\n      bitSuffix\n      bitPasswordInputToggle\n      [(toggled)]=\"showPassword\"\n",
    "      [bitIconButton]=\"showPassword ? 'bwi-eye-slash' : 'bwi-eye'\"\n      bitSuffix\n      (click)=\"togglePasswordVisibility()\"\n      [attr.aria-label]=\"passwordVisibilityLabel\"\n      [attr.title]=\"passwordVisibilityLabel\"\n      data-testid=\"lock-password-visibility\"\n",
    "localized password visibility control",
  );
  result = replaceExact(result, "  </bit-form-field>\n\n", "  </bit-form-field>\n\n  <div class=\"macos-auth-validation macos-auth-validation--field\">\n    @if (unlockFailed) {\n      <bit-callout\n        type=\"danger\"\n        [title]=\"null\"\n        data-testid=\"lock-unlock-error\"\n        (dismiss)=\"dismissUnlockError()\"\n      >\n        <p bitTypography=\"body1\" role=\"alert\">{{ unlockErrorMessage }}</p>\n      </bit-callout>\n    }\n  </div>\n\n", "dismissible inline unlock error");
  result = replaceExact(result, "    <button type=\"submit\" bitButton bitFormButton buttonType=\"primary\" block>\n      {{ \"unlock\" | i18n }}\n    </button>", "    <button\n      type=\"submit\"\n      bitButton\n      bitFormButton\n      buttonType=\"primary\"\n      class=\"macos-primary-action macos-button-owner\"\n      block\n      [disabled]=\"submitting\"\n      data-testid=\"lock-unlock-button\"\n    >\n      解锁\n    </button>", "unlock command");
  result = replaceExact(result, "\n\n    <p class=\"tw-text-center\">{{ \"or\" | i18n }}</p>", "\n\n    @if (showBiometric || showPin) {\n      <p class=\"tw-text-center\">或</p>\n    }", "option separator");
  result = replaceExact(result, /\n\n    @if \(showBiometricsSwap\(\)\) \{[\s\S]*?\n    \}/, "\n\n    @if (showBiometric) {\n      <button\n        type=\"button\"\n        bitButton\n        bitFormButton\n        buttonType=\"secondary\"\n        class=\"macos-auth-alternative macos-hit-target macos-pressable\"\n        block\n        [disabled]=\"submitting\"\n        (click)=\"selectMethod('biometric')\"\n        data-testid=\"lock-switch-biometric\"\n      >\n        使用 Touch ID\n      </button>\n    }", "biometric adaptation");
  result = replaceExact(result, /\n\n    @if \(showPinSwap\(\)\) \{[\s\S]*?\n    \}/, "\n\n    @if (showPin) {\n      <button\n        type=\"button\"\n        bitButton\n        bitFormButton\n        buttonType=\"secondary\"\n        class=\"macos-auth-alternative macos-hit-target macos-pressable\"\n        block\n        [disabled]=\"submitting\"\n        (click)=\"selectMethod('pin')\"\n        data-testid=\"lock-switch-pin\"\n      >\n        使用 PIN\n      </button>\n    }", "PIN adaptation");
  result = replaceExact(result, /\n\n    <bit-unlock-via-prf[\s\S]*?<\/bit-unlock-via-prf>/, "", "PRF deletion");
  result = replaceExact(result, "    <button type=\"button\" bitButton bitFormButton block (click)=\"logOut.emit()\">\n      {{ \"logOut\" | i18n }}\n    </button>", "    <button\n      type=\"button\"\n      bitButton\n      bitFormButton\n      class=\"macos-auth-alternative macos-hit-target macos-pressable macos-danger-action\"\n      block\n      [disabled]=\"submitting\"\n      (click)=\"logout()\"\n      data-testid=\"lock-logout-button\"\n    >\n      退出登录\n    </button>", "logout command");
  result = replaceExact(
    result,
    '<div class="tw-flex tw-flex-col tw-space-y-3">',
    '<div class="macos-unlock-methods" data-testid="lock-unlock-methods">',
    "master-password continuous method group",
  );
  result = replaceExact(
    result,
    "    </button>\n  </div>\n</form>",
    "    </button>\n\n    <ng-content />\n  </div>\n</form>",
    "master-password account-switch projection",
  );
  return localizeLockTemplate(result);
}

function transformBiometricBranch(authority: string): string {
  let result = extractExact(
    authority,
    /  <!-- Biometrics Unlock -->[\s\S]*?(?=\n\n  <!-- PIN Unlock -->)/,
    "official biometric branch",
  );
  result = replaceExact(
    result,
    "  <!-- Biometrics Unlock -->\n  <ng-container *ngIf=\"activeUnlockOption === UnlockOption.Biometrics\">\n",
    "",
    "biometric branch opening",
  );
  result = replaceExact(result, "\n  </ng-container>", "", "biometric branch closing");
  result = result.split("\n").map((line) => line.startsWith("    ") ? line.slice(4) : line).join("\n");
  result = replaceExact(result, "  appAutofocus\n", "", "biometric autofocus deletion");
  result = replaceExact(result, "  class=\"tw-mb-3\"\n", "", "biometric spacing adaptation");
  result = replaceExact(
    result,
    "  [disabled]=\"unlockingViaBiometrics || !biometricsAvailable\"\n  [loading]=\"unlockingViaBiometrics\"\n  block\n  [bitTooltip]=\"biometricUnavailabilityReason\"\n",
    "  class=\"macos-primary-action macos-button-owner\"\n  block\n  [disabled]=\"submitting\"\n",
    "biometric pending state",
  );
  result = replaceExact(
    result,
    "  (click)=\"unlockViaBiometrics()\"\n",
    "  (click)=\"unlockWithBiometric()\"\n  data-testid=\"lock-biometric-button\"\n",
    "biometric command",
  );
  result = replaceExact(
    result,
    "  <span> {{ biometricUnlockBtnText | i18n }}</span>",
    "  使用 Touch ID 解锁",
    "biometric label",
  );
  result = replaceExact(
    result,
    /  <ng-container \*ngIf="unlockOptions\.pin\.enabled">[\s\S]*?  <\/ng-container>/,
    "  @if (availability.pinEnabled) {\n    <button\n      type=\"button\"\n      bitButton\n      buttonType=\"secondary\"\n      class=\"macos-auth-alternative macos-hit-target macos-pressable\"\n      block\n      [disabled]=\"submitting\"\n      (click)=\"selectMethod('pin')\"\n      data-testid=\"lock-switch-pin\"\n    >\n      使用 PIN\n    </button>\n  }",
    "biometric-to-PIN switch",
  );
  result = replaceExact(
    result,
    /  <ng-container \*ngIf="unlockOptions\.masterPassword\.enabled">[\s\S]*?  <\/ng-container>/,
    "  <button\n    type=\"button\"\n    bitButton\n    buttonType=\"secondary\"\n    class=\"macos-auth-alternative macos-hit-target macos-pressable\"\n    block\n    [disabled]=\"submitting\"\n    (click)=\"selectMethod('masterPassword')\"\n    data-testid=\"lock-switch-master-password\"\n  >\n    使用主密码\n  </button>",
    "biometric-to-password switch",
  );
  result = replaceExact(
    result,
    "\n\n  <bit-unlock-via-prf (unlockSuccess)=\"onPrfUnlockSuccess($event)\"></bit-unlock-via-prf>",
    "",
    "biometric PRF deletion",
  );
  result = replaceExact(
    result,
    "  <button type=\"button\" bitButton block (click)=\"logOut()\">\n    {{ \"logOut\" | i18n }}\n  </button>",
    "  <button\n    type=\"button\"\n    bitButton\n    class=\"macos-auth-alternative macos-hit-target macos-pressable macos-danger-action\"\n    block\n    [disabled]=\"submitting\"\n    (click)=\"logout()\"\n    data-testid=\"lock-logout-button\"\n  >\n    退出登录\n  </button>",
    "biometric logout command",
  );
  result = replaceExact(
    result,
    "<p class=\"tw-text-center tw-mb-0\">{{ \"or\" | i18n }}</p>",
    "<p class=\"tw-text-center tw-mb-0\">或</p>",
    "biometric separator",
  );
  result = replaceExact(
    result,
    '<div class="tw-flex tw-flex-col tw-space-y-3">',
    '<div class="macos-unlock-methods" data-testid="lock-unlock-methods">',
    "biometric continuous method group",
  );
  const biometricPrimary = extractExact(
    result,
    /^<button[\s\S]*?<\/button>/,
    "biometric primary action",
  );
  result = replaceExact(
    result,
    `${biometricPrimary}\n\n<div class="macos-unlock-methods" data-testid="lock-unlock-methods">`,
    `<div class="macos-unlock-methods" data-testid="lock-unlock-methods">\n${indent(biometricPrimary, 2)}\n`,
    "complete biometric method hierarchy",
  );
  result = replaceExact(
    result,
    "  </button>\n</div>",
    "  </button>\n\n  <a bitLink routerLink=\"/account-switcher\" class=\"macos-auth-alternative macos-hit-target macos-pressable\" data-testid=\"lock-switch-account\">切换账户</a>\n</div>",
    "biometric account switch row",
  );
  return result;
}

function transformPinTemplate(authority: string): string {
  let result = extractExact(
    authority,
    /  <!-- PIN Unlock -->[\s\S]*?(?=\n\n  <!-- MP Unlock -->)/,
    "official PIN branch",
  );
  result = replaceExact(
    result,
    "  <!-- PIN Unlock -->\n  <ng-container *ngIf=\"unlockOptions.pin.enabled && activeUnlockOption === UnlockOption.Pin\">\n",
    "",
    "PIN branch opening",
  );
  result = replaceExact(result, "\n  </ng-container>", "", "PIN branch closing");
  result = result.split("\n").map((line) => line.startsWith("    ") ? line.slice(4) : line).join("\n");
  result = replaceExact(
    result,
    "<form [bitSubmit]=\"submit\" [formGroup]=\"formGroup\">",
    "<form\n  [formGroup]=\"formGroup\"\n  [bitSubmit]=\"submit\"\n  data-testid=\"lock-pin-form\"\n  class=\"macos-auth-card\"\n>",
    "PIN form opening",
  );
  result = replaceExact(result, "  <bit-form-field>\n", "  <bit-form-field class=\"macos-field\">\n", "PIN semantic field");
  result = replaceExact(result, "{{ \"pin\" | i18n }}", "PIN", "PIN label");
  result = replaceExact(
    result,
    "[(toggled)]=\"showPassword\"",
    "[(toggled)]=\"showPin\"",
    "PIN visibility state",
  );
  result = replaceExact(result, "      type=\"password\"\n", "      [type]=\"showPin ? 'text' : 'password'\"\n", "localized PIN visibility input");
  result = replaceExact(
    result,
    "      bitIconButton\n      bitSuffix\n      bitPasswordInputToggle\n      [(toggled)]=\"showPin\"\n",
    "      [bitIconButton]=\"showPin ? 'bwi-eye-slash' : 'bwi-eye'\"\n      bitSuffix\n      (click)=\"togglePinVisibility()\"\n      [attr.aria-label]=\"pinVisibilityLabel\"\n      [attr.title]=\"pinVisibilityLabel\"\n      data-testid=\"lock-pin-visibility\"\n",
    "localized PIN visibility control",
  );
  result = replaceExact(
    result,
    "      required\n      appInputVerbatim\n",
    "      required\n      inputmode=\"numeric\"\n      autocomplete=\"off\"\n      maxlength=\"8\"\n      pattern=\"[0-9]{6,8}\"\n      data-testid=\"lock-pin-input\"\n",
    "PIN input contract",
  );
  result = replaceExact(
    result,
    "    <button type=\"submit\" bitButton bitFormButton buttonType=\"primary\" block>\n      {{ \"unlock\" | i18n }}\n    </button>",
    "    <button\n      type=\"submit\"\n      bitButton\n      bitFormButton\n      buttonType=\"primary\"\n      class=\"macos-primary-action macos-button-owner\"\n      block\n      [disabled]=\"submitting\"\n      data-testid=\"lock-pin-button\"\n    >\n      解锁\n    </button>",
    "PIN unlock command",
  );
  result = replaceExact(
    result,
    "<p class=\"tw-text-center\">{{ \"or\" | i18n }}</p>",
    "<p class=\"tw-text-center tw-mb-0\">或</p>",
    "PIN separator",
  );
  result = replaceExact(
    result,
    /    <ng-container \*ngIf="showBiometrics">[\s\S]*?    <\/ng-container>/,
    "    @if (showBiometric) {\n      <button\n        type=\"button\"\n        bitButton\n        bitFormButton\n        buttonType=\"secondary\"\n        class=\"macos-auth-alternative macos-hit-target macos-pressable\"\n        block\n        [disabled]=\"submitting\"\n        (click)=\"selectMethod('biometric')\"\n        data-testid=\"lock-switch-biometric\"\n      >\n        使用 Touch ID\n      </button>\n    }",
    "PIN-to-biometric switch",
  );
  result = replaceExact(
    result,
    /    <ng-container \*ngIf="unlockOptions\.masterPassword\.enabled">[\s\S]*?    <\/ng-container>/,
    "    <button\n      type=\"button\"\n      bitButton\n      bitFormButton\n      buttonType=\"secondary\"\n      class=\"macos-auth-alternative macos-hit-target macos-pressable\"\n      block\n      [disabled]=\"submitting\"\n      (click)=\"selectMethod('masterPassword')\"\n      data-testid=\"lock-switch-master-password\"\n    >\n      使用主密码\n    </button>",
    "PIN-to-password switch",
  );
  result = replaceExact(
    result,
    /\n\n    <bit-unlock-via-prf[\s\S]*?<\/bit-unlock-via-prf>/,
    "",
    "PIN PRF deletion",
  );
  result = replaceExact(
    result,
    "    <button type=\"button\" bitButton bitFormButton block (click)=\"logOut()\">\n      {{ \"logOut\" | i18n }}\n    </button>",
    "    <button\n      type=\"button\"\n      bitButton\n      bitFormButton\n      class=\"macos-auth-alternative macos-hit-target macos-pressable macos-danger-action\"\n      block\n      [disabled]=\"submitting\"\n      (click)=\"logout()\"\n      data-testid=\"lock-logout-button\"\n    >\n      退出登录\n    </button>",
    "PIN logout command",
  );
  result = replaceExact(
    result,
    '<div class="tw-flex tw-flex-col tw-space-y-3">',
    '<div class="macos-unlock-methods" data-testid="lock-unlock-methods">',
    "PIN continuous method group",
  );
  result = replaceExact(
    result,
    "    </button>\n  </div>\n</form>",
    "    </button>\n\n    <ng-content />\n  </div>\n</form>",
    "PIN account-switch projection",
  );
  return `${localizeLockTemplate(result)}\n`;
}

function transformLockTemplate(authority: string): string {
  const biometricBranch = indent(transformBiometricBranch(authority), 10);
  return localizeLockTemplate(`<popup-page>
  <popup-header slot="header" [pageTitle]="''" />

  <section class="tw-flex tw-flex-col tw-gap-4 macos-auth-page">
    <h1 class="macos-auth-heading">Barwarden</h1>
    @if (account$ | async; as account) {
      <div class="macos-auth-identity">
        <i class="bwi bwi-user macos-auth-identity__icon" aria-hidden="true"></i>
        <div class="macos-auth-identity__text">
          <p bitTypography="body1" class="macos-auth-identity__primary">{{ account.email }}</p>
          <p bitTypography="body2" class="macos-auth-identity__secondary">{{ account.server }}</p>
        </div>
      </div>
    }

    @if (!initialized) {
      <div
        class="tw-flex tw-items-center tw-justify-center tw-py-8 macos-auth-skeleton"
        role="status"
        aria-label="正在载入解锁方式"
        data-testid="lock-methods-loading"
      >
        <i class="bwi bwi-spinner bwi-spin bwi-3x" aria-hidden="true"></i>
      </div>
    } @else {
      <div class="macos-auth-validation">
        @if (alternativeErrorMessage) {
          <bit-callout type="danger" data-testid="lock-alternative-error">
            <p bitTypography="body1" role="alert">{{ alternativeErrorMessage }}</p>
          </bit-callout>
        }
      </div>

      @switch (activeMethod) {
        @case ("biometric") {
${biometricBranch}
        }
        @case ("pin") {
          <bw-official-pin-lock
            [submitting]="submitting"
            [showBiometric]="biometricAvailable()"
            [resetEpoch]="credentialResetEpoch"
            (pinSubmitted)="unlockWithPin($event)"
            (loggedOut)="logout()"
            (methodSelected)="selectMethod($event)"
          >
            <a bitLink routerLink="/account-switcher" class="macos-auth-alternative macos-hit-target macos-pressable" data-testid="lock-switch-account">切换账户</a>
          </bw-official-pin-lock>
        }
        @default {
          <bw-official-master-password-lock
            [showBiometric]="biometricAvailable()"
            [showPin]="availability.pinEnabled"
            [resetEpoch]="credentialResetEpoch"
            (unlocked)="unlockSucceeded($event)"
            (loggedOut)="logoutSucceeded()"
            (methodSelected)="selectMethod($event)"
          >
            <a bitLink routerLink="/account-switcher" class="macos-auth-alternative macos-hit-target macos-pressable" data-testid="lock-switch-account">切换账户</a>
          </bw-official-master-password-lock>
        }
      }
    }

    <div class="macos-auth-validation">
      @if (navigationFailed) {
        <bit-callout type="danger" data-testid="lock-navigation-error">
          <p bitTypography="body1">
          无法完成页面跳转。请重试。
          </p>
        </bit-callout>
      }
    </div>
  </section>
</popup-page>
`);
}

function assertTemplates(lockRuntime: string, masterRuntime: string, pinRuntime: string): void {
  const lockAuthority = readFileSync(join(vendorRoot, authorityHashes[1][0]), "utf8");
  expect(lockRuntime).toBe(transformLockTemplate(lockAuthority));
  expect(pinRuntime).toBe(transformPinTemplate(lockAuthority));
  expect(masterRuntime).toBe(transformMasterPasswordTemplate(readFileSync(join(vendorRoot, authorityHashes[3][0]), "utf8")));
}

function readManifest(): LockManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as LockManifest;
}

describe("official master-password lock overlay", () => {
  it("pins revision, authority bytes, root GPL metadata, local runtimes, and the manifest externally", () => {
    const manifest = readManifest();
    expect(readFileSync(join(vendorRoot, ".source-revision"), "utf8")).toBe(expectedRevision);
    expect(manifest.revision).toBe("f47b6946e01aed474875789081966d311d5b8289");
    expect(manifest.authorities).toEqual(authorityHashes.map(([path, sha256]) => ({ path, sha256 })));
    for (const [path, hash] of authorityHashes) {
      expect(sha256(join(vendorRoot, path)), path).toBe(hash);
    }
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).license).toBe("GPL-3.0-only");
    expect(JSON.parse(readFileSync(join(vendorRoot, "package.json"), "utf8")).license).toBe("GPL-3.0");
    expect(manifest.license).toEqual({
      rootPackageSha256: sha256(join(root, "package.json")),
      rootLicenseSha256: sha256(join(root, "LICENSE")),
      upstreamPackageSha256: "4b7a570f8438e21a03e6f793ce5c11fa3c0f6b3d858edc7080ba436a5d210c84",
      upstreamGplSha256: "b98fbb37db5b23bc5cfdcd16793206a5a7120a7b01f75374e5e0888376e4691c",
    });
    expect(sha256(join(root, "package.json"))).toBe(manifest.license.rootPackageSha256);
    expect(sha256(join(root, "LICENSE"))).toBe(manifest.license.rootLicenseSha256);
    expect(sha256(join(vendorRoot, "package.json"))).toBe(manifest.license.upstreamPackageSha256);
    expect(sha256(join(vendorRoot, "LICENSE_GPL.txt"))).toBe(manifest.license.upstreamGplSha256);
    for (const runtime of manifest.localRuntimes) {
      expect(sha256(join(root, runtime.path)), runtime.path).toBe(runtime.sha256);
    }
    expect(sha256(manifestPath)).toBe(manifestDigest);
  });

  it("derives both local templates exactly from pinned authority fragments and named transforms", () => {
    const manifest = readManifest();
    expect(manifest.templateTransforms).toHaveLength(3);
    expect(manifest.templateTransforms.flatMap((transform) => transform.removed)).toEqual([
      "spinner-only loading shell",
      "PRF/WebAuthn command", "shared/device-trust continuation branches", "browser pop-out and desktop actions",
      "PRF/WebAuthn child", "native window-hidden listener",
      "PRF/WebAuthn child",
    ]);
    assertTemplates(
      readFileSync(join(overlayRoot, "official-lock.component.html"), "utf8"),
      readFileSync(join(overlayRoot, "official-master-password-lock.component.html"), "utf8"),
      readFileSync(join(overlayRoot, "official-pin-lock.component.html"), "utf8"),
    );
  });

  it("partitions every upstream TS member/import and permits only named deletions", () => {
    const manifest = readManifest();
    expect(manifest.exactPartitions).toHaveLength(2);
    for (const partition of manifest.exactPartitions) {
      const upstream = sourceFile(join(vendorRoot, partition.authority));
      expect(sorted([
        ...partition.upstreamMembers.retained,
        ...partition.upstreamMembers.adapted,
        ...partition.upstreamMembers.removed,
      ])).toEqual(sorted(classMembers(upstream)));
      expect(sorted([
        ...partition.upstreamImports.retained,
        ...partition.upstreamImports.adapted,
        ...partition.upstreamImports.removed,
      ])).toEqual(sorted(imports(upstream)));
      expect(sorted(partition.upstreamMembers.removed)).toEqual(
        sorted(allowedRemovedMembers[partition.runtime as keyof typeof allowedRemovedMembers]),
      );
      assertLocalRuntime(readFileSync(join(overlayRoot, partition.runtime), "utf8"), partition);
    }
  });

  it("pins the adapter and thin wrapper members, import modules, and import bindings", () => {
    const manifest = readManifest();
    expect(manifest.localGraph.map((entry) => entry.runtime)).toEqual([
      "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
      "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
    ]);
    for (const entry of manifest.localGraph) {
      assertLocalRuntime(readFileSync(join(root, entry.runtime), "utf8"), entry);
    }
  });

  it("records the exact resolver and production static-import decision", () => {
    const manifest = readManifest();
    expect(manifest.resolverDecision).toEqual(resolverDecision);
    const mapping = officialSourceMappings.find((entry) => entry.localModule.endsWith("official-master-password-lock.transform-manifest.json"));
    expect(mapping?.staticDependencyDecision).toEqual(resolverDecision);
    const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile).config as {
      compilerOptions: { paths: Record<string, readonly string[]> };
    };
    expect(config.compilerOptions.paths["@bitwarden/key-management-ui/lock/components/lock.component"])
      .toEqual(["vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts"]);
    expect(config.compilerOptions.paths["@bitwarden/key-management-ui/lock/components/master-password-lock/master-password-lock.component"])
      .toEqual(["vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts"]);
    const productionImports = [
      "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts",
    ].flatMap((path) => imports(sourceFile(join(root, path))));
    expect(productionImports).not.toContain("@bitwarden/key-management-ui/lock/components/lock.component");
    expect(productionImports).not.toContain("@bitwarden/key-management-ui/lock/components/master-password-lock/master-password-lock.component");
  });

  it("rejects markup, class, member, module, and binding drift without a manifest update", () => {
    const manifest = readManifest();
    const partition = manifest.exactPartitions.find((entry) => entry.runtime === "official-master-password-lock.component.ts")!;
    const runtime = readFileSync(join(overlayRoot, partition.runtime), "utf8");
    expect(() => assertLocalRuntime(runtime.replace("unlockFailed", "unlockFailure"), partition)).toThrow();
    expect(() => assertLocalRuntime(runtime.replace('from "@angular/forms"', 'from "@angular/forms-mutated"'), partition)).toThrow();
    expect(() => assertLocalRuntime(runtime.replace("FormControl, ", ""), partition)).toThrow();
    expect(() => assertLocalRuntime(`${runtime}\nimport { readFileSync } from "node:fs";\n`, partition)).toThrow();
    const lockHtml = readFileSync(join(overlayRoot, "official-lock.component.html"), "utf8");
    const masterHtml = readFileSync(join(overlayRoot, "official-master-password-lock.component.html"), "utf8");
    const pinHtml = readFileSync(join(overlayRoot, "official-pin-lock.component.html"), "utf8");
    expect(() => assertTemplates(lockHtml.replace("tw-gap-4", "tw-gap-8"), masterHtml, pinHtml)).toThrow();
    expect(() => assertTemplates(lockHtml, masterHtml.replace("bit-form-field", "div"), pinHtml)).toThrow();
    expect(() => assertTemplates(lockHtml, masterHtml, pinHtml.replace("lock-pin-input", "lock-pin-secret"))).toThrow();
    expect(() => assertTemplates(`${lockHtml}<p>extra redraw</p>\n`, masterHtml, pinHtml)).toThrow();
  });
});
