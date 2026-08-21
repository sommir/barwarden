import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  canonicalMemberFromSource,
  validatePinnedMemberTransforms,
  type PinnedMemberTransformContract,
} from "../../official-source-body-contract";
import {
  hintMemberContract,
  loginMemberContract,
} from "./official-login-member-transforms";

const root = process.cwd();
const transformationManifestSha256 =
  "3e7da0d61f819ce7de61258c5c54fd353e1a426d4fd0921a6f7f2dc227a1a074";
const pinned = (path: string) => join(root, "vendor/bitwarden-clients", path);
const overlay = (path: string) =>
  join(root, "apps/menubar-tauri/src/app/upstream-overlays/auth/login", path);

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

type Partition = {
  readonly retained: readonly {
    readonly upstream: string;
    readonly local: string;
    readonly contracts?: readonly string[];
  }[];
  readonly adapted: readonly {
    readonly upstream: string;
    readonly local: string;
    readonly contracts?: readonly string[];
  }[];
  readonly removed: readonly string[];
};

type NormalizedImportBinding =
  `${"value" | "type"}:${"default" | "namespace" | "named"}:${string}:${string}`;

function normalizedImportBindings(
  clause: ts.ImportClause | undefined,
): NormalizedImportBinding[] {
  if (!clause) {
    return [];
  }

  const type = clause.isTypeOnly ? "type" : "value";
  const bindings: NormalizedImportBinding[] = [];
  if (clause.name) {
    bindings.push(`${type}:default:default:${clause.name.text}`);
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    bindings.push(`${type}:namespace:*:${clause.namedBindings.name.text}`);
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const binding of clause.namedBindings.elements) {
      bindings.push(
        `${clause.isTypeOnly || binding.isTypeOnly ? "type" : "value"}:named:${(binding.propertyName ?? binding.name).text}:${binding.name.text}`,
      );
    }
  }
  return bindings.sort();
}

function assertLocalImportPartition(
  runtime: string,
  partition: { readonly imports: Partition; readonly runtime: string },
): void {
  const runtimeSource = ts.createSourceFile(
    partition.runtime,
    runtime,
    ts.ScriptTarget.Latest,
    true,
  );
  const localImports = runtimeSource.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => ({
      module: (statement.moduleSpecifier as ts.StringLiteral).text,
      bindings: normalizedImportBindings(statement.importClause),
    }));
  const mappedImports = [
    ...partition.imports.retained,
    ...partition.imports.adapted,
  ].filter((entry) => entry.local);
  expect(new Set(localImports.map((entry) => entry.module))).toEqual(
    new Set(mappedImports.map((entry) => entry.local)),
  );
  for (const entry of mappedImports) {
    const localImport = localImports.find(
      (candidate) => candidate.module === entry.local,
    );
    expect(
      localImport,
      `${partition.runtime} import ${entry.local}`,
    ).toBeDefined();
    expect(localImport?.bindings).toEqual([...(entry.contracts ?? [])].sort());
  }
}

const allowedRemovedMembers = new Set([
  "destroy$",
  "Icons",
  "clientType",
  "ClientType",
  "orgPoliciesFromInvite",
  "isKnownDevice",
  "ssoRequired",
  "emailFormControl",
  "deferFocus",
  "defaultOnInit",
  "applyEmailFromQueryParams",
  "desktopOnInit",
  "initSsoRequiredTracking",
  "handleSubmitError",
  "handleAuthResult",
  "isPasswordChangeRequiredByOrgPolicy",
  "startAuthRequestLogin",
  "toggleLoginUiState",
  "isLoginWithPasskeySupported",
  "continue",
  "handleLoginWithPasskeyClick",
  "handleSsoClick",
  "getKnownDevice",
  "loadRememberedEmail",
  "focusInput",
  "onWindowHidden",
  "prefetchPasswordPreloginData",
  "handlePopState",
  "validateEmail",
  "persistEmailIfValid",
  "clientType",
  "email",
  "validateEmailOrShowToast",
]);

describe("official password authentication overlays", () => {
  it("derives login and password-hint security members from pinned authorities and exact statement transforms", () => {
    const login = readFileSync(
      overlay("official-password-login.component.ts"),
      "utf8",
    );
    const hint = readFileSync(
      overlay("official-password-hint.component.ts"),
      "utf8",
    );

    expect(
      validatePinnedMemberTransforms(
        readFileSync(
          pinned("libs/auth/src/angular/login/login.component.ts"),
          "utf8",
        ),
        login,
        loginMemberContract,
      ),
    ).toEqual([]);
    expect(
      validatePinnedMemberTransforms(
        readFileSync(
          pinned(
            "libs/auth/src/angular/password-hint/password-hint.component.ts",
          ),
          "utf8",
        ),
        hint,
        hintMemberContract,
      ),
    ).toEqual([]);
  });

  it("rejects submit and lifecycle body mutation even when imports and member names are unchanged", () => {
    const authority = readFileSync(
      pinned("libs/auth/src/angular/login/login.component.ts"),
      "utf8",
    );
    const login = readFileSync(
      overlay("official-password-login.component.ts"),
      "utf8",
    );
    const mutatedSubmit = login.replace(
      '      this.store.setLoginError("");\n      this.authPending = true;',
      '      this.store.setStatus("");\n      this.authPending = true;',
    );
    const mutatedDestroy = login.replace(
      "this.alive = false;\n    this.invalidateNavigation();",
      "this.alive = true;\n    this.invalidateNavigation();",
    );

    expect(
      validatePinnedMemberTransforms(
        authority,
        mutatedSubmit,
        loginMemberContract,
      ),
    ).toContain("OfficialPasswordLoginComponent.submit derived body mismatch");
    expect(
      validatePinnedMemberTransforms(
        authority,
        mutatedDestroy,
        loginMemberContract,
      ),
    ).toContain(
      "OfficialPasswordLoginComponent.ngOnDestroy derived body mismatch",
    );
  });

  it("rejects pinned authority drift and ambiguous member transforms", () => {
    const authority = readFileSync(
      pinned("libs/auth/src/angular/login/login.component.ts"),
      "utf8",
    );
    const runtime = readFileSync(
      overlay("official-password-login.component.ts"),
      "utf8",
    );
    const drifted = authority.replace(
      "this.destroy$.next();",
      "this.destroy$.complete();",
    );
    const ambiguous: PinnedMemberTransformContract = {
      ...loginMemberContract,
      transforms: [
        ...loginMemberContract.transforms,
        { ...loginMemberContract.transforms[2], runtimeMember: "ngOnInit" },
      ],
    };

    expect(
      validatePinnedMemberTransforms(drifted, runtime, loginMemberContract),
    ).toEqual(["LoginComponent pinned authority drift"]);
    expect(
      validatePinnedMemberTransforms(authority, runtime, ambiguous),
    ).toContain("LoginComponent.submit transform is ambiguous");
  });

  it("rejects zero/multiple operation matches and whole-member acceptance shortcuts", () => {
    const authority = readFileSync(
      pinned("libs/auth/src/angular/login/login.component.ts"),
      "utf8",
    );
    const runtime = readFileSync(
      overlay("official-password-login.component.ts"),
      "utf8",
    );
    const transform = loginMemberContract.transforms[0];
    const contractFor = (
      operation: PinnedMemberTransformContract["transforms"][number]["operations"][number],
    ): PinnedMemberTransformContract => ({
      ...loginMemberContract,
      transforms: [{ ...transform, operations: [operation] }],
    });
    const canonicalAuthority = canonicalMemberFromSource(
      authority,
      "LoginComponent",
      "ngOnInit",
    );
    const canonicalRuntime = canonicalMemberFromSource(
      runtime,
      "OfficialPasswordLoginComponent",
      "ngOnInit",
    );
    const validSearch = transform.operations[0].search;

    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime,
        contractFor({
          kind: "remove",
          search: "not-present-in-authority",
        }),
      ),
    ).toContain(
      "LoginComponent.ngOnInit operation 1 must match exactly once; received 0",
    );
    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime,
        contractFor({
          kind: "remove",
          search: "[[",
        }),
      ),
    ).toContain(
      "LoginComponent.ngOnInit operation 1 must match exactly once; received 9",
    );
    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime,
        contractFor({
          kind: "replace",
          search: canonicalAuthority,
          replacement: "rejected",
        }),
      ),
    ).toContain(
      "LoginComponent.ngOnInit operation 1 cannot replace the whole member",
    );
    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime,
        contractFor({
          kind: "replace",
          search: validSearch,
          replacement: canonicalRuntime,
        }),
      ),
    ).toContain(
      "LoginComponent.ngOnInit operation 1 cannot inject the whole runtime member",
    );
    expect(
      validatePinnedMemberTransforms(
        authority,
        runtime,
        contractFor({
          kind: "replace",
          search: transform.retainedAuthorityFragments[0],
          replacement: transform.retainedAuthorityFragments[0],
        }),
      ),
    ).toContain(
      "LoginComponent.ngOnInit operation 1 overlaps retained official structure",
    );
  });

  it("rejects statement-by-statement total body replacement despite retaining the signature", () => {
    const authority = readFileSync(
      pinned("libs/auth/src/angular/login/login.component.ts"),
      "utf8",
    );
    const runtime = readFileSync(
      overlay("official-password-login.component.ts"),
      "utf8",
    );
    const transform = loginMemberContract.transforms[0];
    const retained = transform.retainedAuthorityStatements[0];
    const retainedToken = `[[statement:${retained.index}]]\n${retained.source}\n[[/statement:${retained.index}]]`;
    const totalBodyReplacement: PinnedMemberTransformContract = {
      ...loginMemberContract,
      transforms: [
        {
          ...transform,
          operations: [
            ...transform.operations,
            {
              kind: "replace",
              search: retainedToken,
              replacement: retainedToken,
            },
          ],
        },
      ],
    };

    expect(
      validatePinnedMemberTransforms(authority, runtime, totalBodyReplacement),
    ).toContain(
      `LoginComponent.ngOnInit operation ${transform.operations.length + 1} overlaps retained official structure`,
    );
  });

  it("pins the Login, LoginComponentService, and Password Hint authorities", () => {
    const authorities = [
      [
        "libs/auth/src/angular/login/login.component.ts",
        "official-password-login.component.ts",
        "1ef2a3bf77baaa4e25b559f5cee1b46fb5251ee79035236b9c8f9aa6dbd771b0",
      ],
      [
        "libs/auth/src/angular/login/login.component.html",
        "official-password-login.component.html",
        "92215e603d0f9d4d594878dcaea0026b4e892c76d3f194912de40c5fc6f11831",
      ],
      [
        "libs/auth/src/angular/login/login-component.service.ts",
        "official-password-login.component.ts",
        "d4c7830b13d72a5f279c41554eb4089c77e8da9f5b0d547c068b246be0b35794",
      ],
      [
        "libs/auth/src/angular/password-hint/password-hint.component.ts",
        "official-password-hint.component.ts",
        "e54d5e56c6c1e411dee574a7ac3d0ab8a6613362153aaeb51d9a61b8608e4f75",
      ],
      [
        "libs/auth/src/angular/password-hint/password-hint.component.html",
        "official-password-hint.component.html",
        "f7b8541f8ab9e05951efb4890fafe8bb482713677e482b573470bcca418e1815",
      ],
    ] as const;

    for (const [authority, runtime, hash] of authorities) {
      expect(existsSync(pinned(authority)), authority).toBe(true);
      expect(sha256(pinned(authority)), `${authority} pinned hash`).toBe(hash);
      expect(existsSync(overlay(runtime)), `${runtime} runtime`).toBe(true);
    }
  });

  it("retains official form primitives and permits only excluded login branches to be removed", () => {
    const loginAuthority = readFileSync(
      pinned("libs/auth/src/angular/login/login.component.html"),
      "utf8",
    );
    const expected = loginAuthority
      .replace(
        '<form [bitSubmit]="submit" [formGroup]="formGroup">',
        '<form [bitSubmit]="submit" [formGroup]="formGroup" class="macos-auth-card">',
      )
      .replace(
        "    <bit-form-field>\n",
        '    <bit-form-field class="macos-field macos-field-owner">\n',
      )
      .replace(
        '    <bit-form-field class="!tw-mb-1">\n',
        '    <bit-form-field class="!tw-mb-1 macos-field macos-field-owner">\n',
      )
      .replace(
        '        buttonType="primary"\n        data-testid="login-continue-button"',
        '        buttonType="primary"\n        class="macos-primary-action macos-button-owner"\n        data-testid="login-continue-button"',
      )
      .replace(
        '        buttonType="primary"\n        data-testid="login-submit-button"',
        '        buttonType="primary"\n        class="macos-primary-action macos-button-owner"\n        [disabled]="submitting"\n        data-testid="login-submit-button"',
      )
      .replace(
        '        bitInput\n        appAutofocus',
        '        bitInput\n        class="macos-control-visible"\n        appAutofocus',
      )
      .replace(
        '        bitInput\n        data-testid="login-master-password-input"',
        '        bitInput\n        class="macos-control-visible"\n        data-testid="login-master-password-input"',
      )
      .replace(
        '          buttonType="secondary"\n          data-testid="login-back-button"',
        '          buttonType="secondary"\n          [disabled]="submitting"\n          data-testid="login-back-button"',
      )
      .replace(
        '        (keyup.enter)="ssoRequired ? handleSsoClick() : continuePressed()"\n',
        '        (keyup.enter)="continuePressed()"\n',
      )
      .replace(
        '        data-testid="login-email-input"\n',
        '        data-testid="login-email-input"\n        #emailInputRef\n',
      )
      .replace(
        '        #masterPasswordInputRef\n',
        '        #masterPasswordInputRef\n        (input)="onMasterPasswordInput()"\n',
      )
      .replace(
        '      <button type="button" bitIconButton bitSuffix bitPasswordInputToggle></button>',
        '      <button\n        type="button"\n        [bitIconButton]="showPassword ? \'bwi-eye-slash\' : \'bwi-eye\'"\n        bitSuffix\n        (click)="passwordVisibilityChanged(!showPassword)"\n        (pointerdown)="preservePasswordFocus($event)"\n        [attr.aria-label]="passwordVisibilityLabel"\n        [attr.title]="passwordVisibilityLabel"\n        data-testid="login-password-visibility"\n      ></button>',
      )
      .replace(
        '        type="password"\n        autocomplete="current-password"',
        '        [type]="showPassword ? \'text\' : \'password\'"\n        autocomplete="current-password"',
      )
      .replace(
        "        [bitTooltip]=\"ssoRequired ? ('yourOrganizationRequiresSingleSignOn' | i18n) : ''\"\n",
        "",
      )
      .replace('        [addTooltipToDescribedby]="ssoRequired"\n', "")
      .replace('        [disabled]="ssoRequired"\n', "")
      .replace(
        /\n      <!-- Button to Login with Passkey -->[\s\S]*?<\/ng-container>\n/,
        "\n",
      )
      .replace(
        /\n      <!-- Button to Login with SSO -->[\s\S]*?<\/button>\n/,
        "\n",
      )
      .replace(
        /\n      <!-- Button to Login with Device -->[\s\S]*?<\/ng-container>\n/,
        "\n",
      )
      .replace(
        '\n      <div class="tw-text-center">{{ "or" | i18n }}</div>\n\n',
        "\n",
      )
      .replace(
        '    </bit-form-field>\n\n    <!-- Link to Password Hint page - doesn\'t use bit-hint so that it doesn\'t get hidden on input validation errors -->',
        '    </bit-form-field>\n\n    <div class="macos-auth-validation">\n      <bit-callout\n        *ngIf="loginError"\n        type="danger"\n        data-testid="login-error"\n        (dismiss)="dismissLoginError()"\n      >\n        <p bitTypography="body1">{{ loginError }}</p>\n      </bit-callout>\n    </div>\n\n    <!-- Link to Password Hint page - doesn\'t use bit-hint so that it doesn\'t get hidden on input validation errors -->',
      )
      .concat(
        '\n<bw-login-environment-selector\n  (serverUrlChange)="selectEnvironment($event)"\n  (environmentValidChange)="environmentIsValid = $event"\n  (interactionStarted)="captureEmailValidationState()"\n  (interactionCompleted)="restoreEmailValidationState()"\n/>\n',
      );

    expect(
      readFileSync(overlay("official-password-login.component.html"), "utf8"),
    ).toBe(expected);
    const runtime = readFileSync(
      overlay("official-password-login.component.ts"),
      "utf8",
    );
    expect(runtime).toContain("OfficialPasswordAuthPort");
    expect(runtime).not.toMatch(
      /passkey|sso|knownDevice|startAuthRequestLogin|Broadcaster|organization-policy/i,
    );
    expect(runtime).not.toMatch(
      /chrome\.runtime|BrowserApi|nativeMessaging|webRequest|webNavigation|app-routing\.module/i,
    );
  });

  it("retains the official Password Hint form while removing only browser-client branching", () => {
    const authority = readFileSync(
      pinned(
        "libs/auth/src/angular/password-hint/password-hint.component.html",
      ),
      "utf8",
    );
    const expected = authority
      .replace('        appInputVerbatim="false"\n', "")
      .replace(
        /\n  <!-- Browser -->[\s\S]*?<ng-container \*ngIf=\"clientType !== 'browser'\">\n    <ng-container \*ngTemplateOutlet=\"formContentTemplate\"><\/ng-container>\n  <\/ng-container>/,
        '\n  <ng-container *ngTemplateOutlet="formContentTemplate"></ng-container>',
      );

    expect(
      readFileSync(overlay("official-password-hint.component.html"), "utf8"),
    ).toBe(expected);
    const runtime = readFileSync(
      overlay("official-password-hint.component.ts"),
      "utf8",
    );
    expect(runtime).toContain("OfficialPasswordHintPort");
    expect(runtime).not.toMatch(
      /clientType|ApiService|ToastService|Browser|Desktop/i,
    );
    expect(runtime).not.toMatch(
      /chrome\.runtime|BrowserApi|nativeMessaging|webRequest|webNavigation|app-routing\.module/i,
    );
  });

  it("checks the pinned TypeScript authorities through an explicit transformation manifest", () => {
    const manifestPath = overlay(
      "official-password-auth.transform-manifest.json",
    );
    expect(
      existsSync(manifestPath),
      "deterministic TS transformation manifest",
    ).toBe(true);
    expect(sha256(manifestPath)).toBe(transformationManifestSha256);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      readonly authorities: readonly {
        readonly path: string;
        readonly sha256: string;
      }[];
      readonly transforms: readonly {
        readonly runtime: string;
        readonly ast: {
          readonly className: string;
          readonly interfaces: readonly string[];
          readonly members: readonly string[];
        };
        readonly retainedMembers: readonly string[];
        readonly substitutions: readonly string[];
        readonly removals: readonly string[];
      }[];
    };
    expect(manifest.authorities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "libs/auth/src/angular/login/login.component.ts",
          sha256:
            "1ef2a3bf77baaa4e25b559f5cee1b46fb5251ee79035236b9c8f9aa6dbd771b0",
        }),
        expect.objectContaining({
          path: "libs/auth/src/angular/password-hint/password-hint.component.ts",
          sha256:
            "e54d5e56c6c1e411dee574a7ac3d0ab8a6613362153aaeb51d9a61b8608e4f75",
        }),
      ]),
    );

    for (const transform of manifest.transforms) {
      const runtime = readFileSync(overlay(transform.runtime), "utf8");
      const source = ts.createSourceFile(
        transform.runtime,
        runtime,
        ts.ScriptTarget.Latest,
        true,
      );
      const declaration = source.statements.find(
        (statement): statement is ts.ClassDeclaration =>
          ts.isClassDeclaration(statement),
      );
      expect(declaration?.name?.text).toBe(transform.ast.className);
      const interfaces =
        declaration?.heritageClauses?.flatMap((clause) =>
          clause.types.map((type) => type.expression.getText(source)),
        ) ?? [];
      expect(interfaces).toEqual(
        expect.arrayContaining(transform.ast.interfaces),
      );
      const members =
        declaration?.members.flatMap((member) => {
          if (
            ts.isMethodDeclaration(member) ||
            ts.isPropertyDeclaration(member) ||
            ts.isGetAccessorDeclaration(member)
          ) {
            return [member.name?.getText(source) ?? ""];
          }
          return [];
        }) ?? [];
      expect(members).toEqual(expect.arrayContaining(transform.ast.members));
      for (const member of transform.retainedMembers)
        expect(runtime).toContain(member);
      expect(transform.substitutions.length).toBeGreaterThan(0);
      expect(transform.removals).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/browser|desktop|sso|passkey|device/i),
        ]),
      );
    }

    const loginRuntime = readFileSync(
      overlay("official-password-login.component.ts"),
      "utf8",
    );
    expect(loginRuntime).toContain("OnDestroy");
    expect(loginRuntime).toContain("Validators.minLength(8)");
    expect(
      readFileSync(overlay("official-password-login.component.html"), "utf8"),
    ).toContain("bit-callout");
  });

  it("partitions every pinned upstream TS member and import into retained, adapted, or explicitly allowed removal", () => {
    const manifest = JSON.parse(
      readFileSync(
        overlay("official-password-auth.transform-manifest.json"),
        "utf8",
      ),
    ) as {
      readonly exactPartitions: readonly {
        readonly authority: string;
        readonly runtime: string;
        readonly members: Partition;
        readonly imports: Partition;
        readonly localMembers: readonly string[];
      }[];
    };

    for (const partition of manifest.exactPartitions) {
      const upstreamPath = pinned(partition.authority);
      const upstreamSource = ts.createSourceFile(
        upstreamPath,
        readFileSync(upstreamPath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const upstreamClass = upstreamSource.statements.find(
        (statement): statement is ts.ClassDeclaration =>
          ts.isClassDeclaration(statement),
      )!;
      const upstreamMembers = upstreamClass.members
        .map((member) => member.name?.getText(upstreamSource))
        .filter(Boolean);
      const upstreamImports = upstreamSource.statements
        .filter(ts.isImportDeclaration)
        .map(
          (statement) => (statement.moduleSpecifier as ts.StringLiteral).text,
        );
      const partitionedMembers = [
        ...partition.members.retained.map((entry) => entry.upstream),
        ...partition.members.adapted.map((entry) => entry.upstream),
        ...partition.members.removed,
      ];
      const partitionedImports = [
        ...partition.imports.retained.map((entry) => entry.upstream),
        ...partition.imports.adapted.map((entry) => entry.upstream),
        ...partition.imports.removed,
      ];
      expect(new Set(partitionedMembers)).toEqual(new Set(upstreamMembers));
      expect(new Set(partitionedImports)).toEqual(new Set(upstreamImports));
      expect(
        partition.members.removed.every((member) =>
          allowedRemovedMembers.has(member),
        ),
      ).toBe(true);

      const runtime = readFileSync(overlay(partition.runtime), "utf8");
      const runtimeSource = ts.createSourceFile(
        partition.runtime,
        runtime,
        ts.ScriptTarget.Latest,
        true,
      );
      const runtimeClass = runtimeSource.statements.find(
        (statement): statement is ts.ClassDeclaration =>
          ts.isClassDeclaration(statement),
      )!;
      const localMembers = runtimeClass.members
        .map((member) => member.name?.getText(runtimeSource))
        .filter(Boolean);
      expect(new Set(localMembers)).toEqual(new Set(partition.localMembers));
      for (const entry of [
        ...partition.members.retained,
        ...partition.members.adapted,
      ]) {
        expect(localMembers).toContain(entry.local);
        for (const contract of entry.contracts ?? [])
          expect(runtime).toContain(contract);
      }

      assertLocalImportPartition(runtime, partition);
    }
  });

  it("rejects changed, removed, and extra local runtime imports without changing the manifest", () => {
    const manifest = JSON.parse(
      readFileSync(
        overlay("official-password-auth.transform-manifest.json"),
        "utf8",
      ),
    ) as {
      readonly exactPartitions: readonly {
        readonly runtime: string;
        readonly imports: Partition;
      }[];
    };
    const partition = manifest.exactPartitions.find(
      (candidate) =>
        candidate.runtime === "official-password-login.component.ts",
    )!;
    const runtime = readFileSync(overlay(partition.runtime), "utf8");

    expect(() =>
      assertLocalImportPartition(
        runtime.replace(
          'from "@angular/common"',
          'from "@angular/common-mutated"',
        ),
        partition,
      ),
    ).toThrow();
    expect(() =>
      assertLocalImportPartition(
        runtime.replace(
          'import { I18nPipe } from "@bitwarden/ui-common";\n',
          "",
        ),
        partition,
      ),
    ).toThrow();
    expect(() =>
      assertLocalImportPartition(
        `${runtime}\nimport { readFileSync } from "node:fs";\n`,
        partition,
      ),
    ).toThrow();
  });

  it("rejects changed, removed, and extra bindings within an existing local import", () => {
    const manifest = JSON.parse(
      readFileSync(
        overlay("official-password-auth.transform-manifest.json"),
        "utf8",
      ),
    ) as {
      readonly exactPartitions: readonly {
        readonly runtime: string;
        readonly imports: Partition;
      }[];
    };
    const partition = manifest.exactPartitions.find(
      (candidate) =>
        candidate.runtime === "official-password-login.component.ts",
    )!;
    const runtime = readFileSync(overlay(partition.runtime), "utf8");

    expect(() =>
      assertLocalImportPartition(
        runtime.replace(
          "import { CommonModule }",
          "import { CommonModule as RenamedCommonModule }",
        ),
        partition,
      ),
    ).toThrow();
    expect(() =>
      assertLocalImportPartition(
        runtime.replace("OnDestroy, OnInit", "OnInit"),
        partition,
      ),
    ).toThrow();
    expect(() =>
      assertLocalImportPartition(
        runtime.replace(
          "import { CommonModule }",
          "import { CommonModule, NgClass }",
        ),
        partition,
      ),
    ).toThrow();
  });
});
