import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { officialSourceMappings } from "../../../upstream-source-map";

const root = process.cwd();
const vendorRoot = join(root, "vendor/bitwarden-clients");
const overlayRoot = join(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching",
);
const manifestPath = join(overlayRoot, "official-account-switcher.transform-manifest.json");
const manifestDigest = "1007a74897d62e4b67aaf1fc11dd5a977da3c4ca9517d9534924989703078706";
const expectedRevision = [
  "https://github.com/bitwarden/clients.git",
  "f47b6946e01aed474875789081966d311d5b8289",
  "",
].join("\n");

const authorityHashes = [
  ["apps/browser/src/auth/popup/account-switching/current-account.component.ts", "f35f02559ccb0ea1c357d2db0575802e4f6c79452dde4d035af551f7a848479f"],
  ["apps/browser/src/auth/popup/account-switching/current-account.component.html", "97d8958fadfe2ab228621fe7a249f28eb3e8cba00b0964a89523b07930513a67"],
  ["apps/browser/src/auth/popup/account-switching/account-switcher.component.ts", "5f50dfbb92b7c100687b1884b724531f4fdac7da7ddd0939e25e3f5114694e9e"],
  ["apps/browser/src/auth/popup/account-switching/account-switcher.component.html", "4de2735e1f7b9acb5a7b756f5f8859f74e82e0f73ea1080d427be1e88d05e4fc"],
  ["apps/browser/src/auth/popup/account-switching/account.component.ts", "e4173562ef1d4ab1920eccd65c5f5333dbb11b7b1ddafab0d9ce0b3fe3fbb784"],
  ["apps/browser/src/auth/popup/account-switching/account.component.html", "6ca5ecb9447d051ef96934bcf09562a915e9f246c93d30678d7e3ce50270f573"],
  ["apps/browser/src/auth/popup/account-switching/services/account-switcher.service.ts", "87fa6bb3e5a3942a09deff69c4452ccb8378059a5613731489a8338ac36c7d0a"],
] as const;

const upstreamPartitions = {
  "official-account.component.ts": {
    authority: authorityHashes[4][0],
    members: {
      retained: ["account", "specialAccountAddId", "status"],
      adapted: ["selectAccount"],
      removed: ["loading"],
    },
    imports: {
      retained: ["@angular/common", "@angular/core", "@bitwarden/angular/jslib.module", "@bitwarden/common/platform/abstractions/i18n.service", "@bitwarden/components"],
      adapted: ["@angular/router", "@bitwarden/common/auth/enums/authentication-status", "./services/account-switcher.service"],
      removed: ["@bitwarden/common/platform/abstractions/log.service", "@bitwarden/key-management"],
    },
  },
  "official-account-switcher.component.ts": {
    authority: authorityHashes[2][0],
    members: {
      retained: ["lockedStatus", "activeUserCanLock", "enableAccountSwitching$", "accountLimit", "specialAddAccountId", "availableAccounts$", "currentAccount$", "showLockAll$", "ngOnInit", "lock", "lockAll", "logOut"],
      adapted: ["loading"],
      removed: ["destroy$", "back", "ngOnDestroy"],
    },
    imports: {
      retained: ["@angular/common", "@angular/core", "rxjs", "@bitwarden/angular/jslib.module", "@bitwarden/components", "../../../platform/popup/components/pop-out.component", "../../../platform/popup/layout/popup-header.component", "../../../platform/popup/layout/popup-page.component", "./account.component", "./current-account.component"],
      adapted: ["@angular/router", "@bitwarden/auth/common", "@bitwarden/common/auth/abstractions/account.service", "@bitwarden/common/auth/abstractions/auth.service", "@bitwarden/common/auth/enums/authentication-status", "@bitwarden/common/key-management/vault-timeout", "@bitwarden/common/types/guid", "./services/account-switcher.service"],
      removed: [],
    },
  },
  "official-account-switcher.adapter.ts": {
    authority: authorityHashes[6][0],
    members: {
      retained: [],
      adapted: ["ACCOUNT_LIMIT", "SPECIAL_ADD_ACCOUNT_ID", "availableAccounts$", "accountSwitchingEnabled$", "specialAccountAddId", "selectAccount"],
      removed: ["incompleteAccountSwitchError", "switchAccountFinished$", "listenForSwitchAccountFinish"],
    },
    imports: {
      retained: ["@angular/core", "rxjs", "@bitwarden/common/auth/abstractions/account.service", "@bitwarden/common/auth/abstractions/auth.service", "@bitwarden/common/auth/abstractions/avatar.service", "@bitwarden/common/auth/enums/authentication-status", "@bitwarden/common/types/guid"],
      adapted: ["@bitwarden/auth/common", "@bitwarden/common/platform/abstractions/environment.service", "@bitwarden/common/platform/abstractions/log.service", "@bitwarden/common/platform/abstractions/messaging.service"],
      removed: ["@bitwarden/common/enums/feature-flag.enum", "@bitwarden/common/platform/abstractions/config/config.service", "../../../../platform/browser/browser-api", "../../../../platform/browser/from-chrome-event"],
    },
  },
} as const;

const localGraph = {
  "official-account-switcher.adapter.ts": {
    path: "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
    classes: {
      OfficialAccountSwitcherAdapter: ["ACCOUNT_LIMIT", "accountLimit", "accountsSubject", "loadingSubject", "errorSubject", "operations", "popupState", "operationEpoch", "refreshEpoch", "accounts$", "activeAccount$", "activeAuthorization$", "loading$", "error$", "accountService", "avatarService", "authService", "refresh", "select", "add", "lock", "lockAll", "logout", "run", "refreshFor", "publish", "navigate", "assertCurrent", "isCurrent", "isCurrentUnlockedAccount"],
      CurrentAccountService: ["activeAccount$"],
      CurrentAvatarService: ["avatarColor$", "getUserAvatarColor$"],
      CurrentAuthService: ["activeAccountStatus$", "authStatuses$", "authStatusFor$", "getAuthStatus", "logOut"],
    },
    imports: ["@angular/core", "@angular/router", "@bitwarden/common/auth/abstractions/account.service", "@bitwarden/common/auth/abstractions/auth.service", "@bitwarden/common/auth/abstractions/avatar.service", "@bitwarden/common/auth/enums/authentication-status", "@bitwarden/common/types/guid", "rxjs", "../../auth/account-session-store", "./auth.facade", "../popup-state", "../official-ui/official-i18n.service"],
  },
  "official-account.component.ts": {
    path: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
    classes: { OfficialAccountComponent: ["account", "specialAccountAddId", "selectAccount", "status"] },
    imports: ["@angular/common", "@angular/core", "@bitwarden/angular/jslib.module", "@bitwarden/common/platform/abstractions/i18n.service", "../../../official-ui/official-components", "../../../auth/official-account-switcher.adapter"],
  },
  "official-account-switcher.component.ts": {
    path: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
    classes: { OfficialAccountSwitcherComponent: ["lockedStatus", "enableAccountSwitching$", "activeUserCanLock", "loading", "error$", "currentAccount$", "currentAuthorization$", "availableAccounts$", "showLockAll$", "accountLimit", "specialAddAccountId", "ngOnInit", "lock", "lockAll", "recover", "logOut"] },
    imports: ["@angular/common", "@angular/core", "@angular/core/rxjs-interop", "rxjs", "@bitwarden/angular/jslib.module", "@bitwarden/components", "@bitwarden/official-auth-popup/account-switching/current-account.component", "@bitwarden/browser-popup/components/pop-out.component", "@bitwarden/ui-common", "../../../auth/official-account-switcher.adapter", "../../../../auth/account-session-store", "../../../layout/popup-header.component", "../../../layout/popup-page.component", "../../../official-ui/official-components", "./official-account.component"],
  },
} as const;

type Manifest = {
  readonly revision: string;
  readonly license: Record<string, string>;
  readonly authorities: readonly { readonly path: string; readonly sha256: string }[];
  readonly localRuntimes: readonly { readonly path: string; readonly sha256: string }[];
  readonly exactPartitions: readonly {
    readonly authority: string;
    readonly memberMappings?: readonly {
      readonly upstreamMember: string;
      readonly disposition: "retained" | "adapted" | "removed";
      readonly runtime: {
        readonly path: string;
        readonly className: string;
        readonly member: string;
      } | null;
    }[];
  }[];
  readonly resolverDecision: readonly string[];
};

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function imports(source: ts.SourceFile): string[] {
  return source.statements.filter(ts.isImportDeclaration).map(
    (statement) => (statement.moduleSpecifier as ts.StringLiteral).text,
  );
}

function classes(source: ts.SourceFile): Record<string, string[]> {
  return Object.fromEntries(source.statements.filter(ts.isClassDeclaration).flatMap((declaration) =>
    declaration.name
      ? [[declaration.name.text, declaration.members.map((member) => member.name?.getText(source)).filter((member): member is string => Boolean(member))]]
      : [],
  ));
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function transformSwitcherTemplate(authority: string): string {
  const marker = "  </popup-header>\n";
  expect(authority.split(marker)).toHaveLength(2);
  return authority
    .replaceAll(' (loading)="loading = $event"', "")
    .replace(
      marker,
      `${marker}\n  <bit-callout *ngIf="error$ | async as error" type="danger">\n    <p bitTypography="body1" role="alert">{{ error }}</p>\n  </bit-callout>\n`,
    )
    .replace(
      '  <div *ngIf="currentAccount$ | async as currentAccount">\n',
      '  <div *ngIf="currentAccount$ | async as currentAccount">\n    <bit-callout\n      *ngIf="(currentAuthorization$ | async) === \'recovery-required\'"\n      type="warning"\n      urgency="assertive"\n    >\n      <p role="status">{{ "i18nSessionRestoreStatus" | i18n }}</p>\n      <button type="button" bitButton buttonType="secondary" (click)="recover(currentAccount.id)">\n        {{ "i18nRetrySession" | i18n }}\n      </button>\n    </bit-callout>\n',
    )
    .replace(
      "[disabled]=\"currentAccount.status === lockedStatus || !activeUserCanLock\"",
      "[disabled]=\"(currentAuthorization$ | async) !== 'unlocked' || !activeUserCanLock\"",
    );
}

function transformAccountTemplate(authority: string): string {
  const matches = authority.match(/status\.text (?:===|!==) 'active'/g) ?? [];
  expect(matches).toHaveLength(4);
  return authority
    .replaceAll("status.text === 'active'", "account.isActive")
    .replaceAll("status.text !== 'active'", "!account.isActive")
    .replaceAll('class="tw-max-w-64 tw-truncate"', 'class="tw-max-w-64 tw-truncate macos-account-label"')
    .replaceAll('class="tw-max-w-64 tw-truncate tw-text-sm"', 'class="tw-max-w-64 tw-truncate tw-text-sm macos-account-label"')
    .replace(' [attr.aria-hidden]="account.isActive"', "");
}

function validateMemberMappings(manifest: Manifest): string[] {
  const errors: string[] = [];
  for (const partition of manifest.exactPartitions) {
    const authority = sourceFile(join(vendorRoot, partition.authority));
    const upstreamMembers = Object.values(classes(authority)).flat();
    const mappings = partition.memberMappings;
    if (!mappings) {
      errors.push(`${partition.authority} has no memberMappings`);
      continue;
    }
    const mappedUpstreamMembers = mappings.map((mapping) => mapping.upstreamMember);
    if (JSON.stringify(sorted(mappedUpstreamMembers)) !== JSON.stringify(sorted(upstreamMembers))) {
      errors.push(`${partition.authority} member coverage mismatch`);
    }
    for (const mapping of mappings) {
      if (mapping.disposition === "removed") {
        if (mapping.runtime !== null) {
          errors.push(`${partition.authority}.${mapping.upstreamMember} removed mapping has runtime`);
        }
        continue;
      }
      if (!mapping.runtime) {
        errors.push(`${partition.authority}.${mapping.upstreamMember} has no runtime mapping`);
        continue;
      }
      const runtimeClasses = classes(sourceFile(join(root, mapping.runtime.path)));
      if (!runtimeClasses[mapping.runtime.className]?.includes(mapping.runtime.member)) {
        errors.push(
          `${partition.authority}.${mapping.upstreamMember} maps to missing ${mapping.runtime.className}.${mapping.runtime.member}`,
        );
      }
    }
  }
  return errors;
}

describe("official account switching overlays", () => {
  it("requires the external digest-pinned transform manifest", () => {
    expect(existsSync(manifestPath), "account switcher transform manifest").toBe(true);
  });

  it("pins revision, GPL metadata, authority bytes, local runtimes, and manifest digest", () => {
    const manifest = readManifest();
    expect(readFileSync(join(vendorRoot, ".source-revision"), "utf8")).toBe(expectedRevision);
    expect(manifest.revision).toBe("f47b6946e01aed474875789081966d311d5b8289");
    expect(manifest.authorities).toEqual(authorityHashes.map(([path, hash]) => ({ path, sha256: hash })));
    for (const [path, hash] of authorityHashes) {
      expect(sha256(join(vendorRoot, path)), path).toBe(hash);
    }
    expect(manifest.license).toEqual({
      rootPackageSha256: sha256(join(root, "package.json")),
      rootLicenseSha256: sha256(join(root, "LICENSE")),
      upstreamPackageSha256: "4b7a570f8438e21a03e6f793ce5c11fa3c0f6b3d858edc7080ba436a5d210c84",
      upstreamGplSha256: "b98fbb37db5b23bc5cfdcd16793206a5a7120a7b01f75374e5e0888376e4691c",
    });
    expect(sha256(join(root, "package.json"))).toBe(manifest.license.rootPackageSha256);
    for (const runtime of manifest.localRuntimes) {
      expect(sha256(join(root, runtime.path)), runtime.path).toBe(runtime.sha256);
    }
    expect(sha256(manifestPath)).toBe(manifestDigest);
  });

  it("retains the official templates with only fixed-error insertion and row-loading removal", () => {
    expect(readFileSync(join(overlayRoot, "official-account.component.html"), "utf8")).toBe(
      transformAccountTemplate(readFileSync(join(vendorRoot, authorityHashes[5][0]), "utf8")),
    );
    expect(readFileSync(join(overlayRoot, "official-account-switcher.component.html"), "utf8")).toBe(
      transformSwitcherTemplate(readFileSync(join(vendorRoot, authorityHashes[3][0]), "utf8")),
    );
  });

  it("partitions every upstream member and import into retained, adapted, or removed sets", () => {
    const manifest = readManifest();
    for (const partition of Object.values(upstreamPartitions)) {
      const authority = sourceFile(join(vendorRoot, partition.authority));
      const authorityClasses = Object.values(classes(authority)).flat();
      expect(sorted([...partition.members.retained, ...partition.members.adapted, ...partition.members.removed])).toEqual(sorted(authorityClasses));
      expect(sorted([...partition.imports.retained, ...partition.imports.adapted, ...partition.imports.removed])).toEqual(sorted(imports(authority)));
      const mappings = manifest.exactPartitions.find(
        (candidate) => candidate.authority === partition.authority,
      )?.memberMappings ?? [];
      for (const disposition of ["retained", "adapted", "removed"] as const) {
        expect(sorted(
          mappings
            .filter((mapping) => mapping.disposition === disposition)
            .map((mapping) => mapping.upstreamMember),
        )).toEqual(sorted(partition.members[disposition]));
      }
    }
  });

  it("maps every non-removed upstream member to an existing runtime member path", () => {
    expect(validateMemberMappings(readManifest())).toEqual([]);
  });

  it("rejects a mutated upstream-to-runtime member mapping", () => {
    const manifest = structuredClone(readManifest());
    const mapped = manifest.exactPartitions
      .flatMap((partition) => partition.memberMappings ?? [])
      .find((mapping) => mapping.runtime !== null);
    expect(mapped).toBeDefined();
    if (!mapped?.runtime) {
      return;
    }
    (mapped.runtime as { member: string }).member = "incorrectRuntimeMember";

    expect(validateMemberMappings(manifest).join("\n")).toContain("incorrectRuntimeMember");
  });

  it("pins local class members, import modules, and exact imported bindings", () => {
    for (const graph of Object.values(localGraph)) {
      const source = sourceFile(join(root, graph.path));
      expect(classes(source)).toEqual(graph.classes);
      expect(imports(source)).toEqual(graph.imports);
      for (const statement of source.statements.filter(ts.isImportDeclaration)) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          expect(bindings.elements.every((binding) => binding.name.text.length > 0)).toBe(true);
        }
      }
    }
  });

  it("records direct CurrentAccount and guarded overlay resolver decisions", () => {
    const manifest = readManifest();
    expect(manifest.resolverDecision).toEqual([
      "CurrentAccountComponent resolves directly to the pinned authority with its exact static dependency graph",
      "production account hierarchy is PopupHeaderActionsComponent/OfficialAccountSwitcherComponent -> CurrentAccountComponent plus guarded account and switcher overlays -> OfficialAccountSwitcherAdapter -> AuthFacade",
      "browser events, tabs/runtime, Safari flags, biometrics autoprompt, foreground-lock and extension logout messages, signup, and registration are deleted rather than resolved",
    ]);
    expect(officialSourceMappings.find((mapping) => mapping.localModule.endsWith("popup-header-actions.component.ts"))?.mode).toBe("direct");
    expect(officialSourceMappings.find((mapping) => mapping.localModule.endsWith("official-account-switcher.transform-manifest.json"))?.mode).toBe("guard");
  });

  it.each([
    "chrome.runtime.onMessage",
    "BrowserApi",
    "fromChromeEvent",
    "isSafariApi",
    "SafariAccountSwitching",
    "setShouldAutopromptNow",
    "foreground-lock",
    "switchAccountFinish",
    "signup",
    "registration",
    "browser.tabs",
    "chrome.tabs",
  ])("rejects excluded production integration %s", (token) => {
    const production = Object.values(localGraph).map((graph) => readFileSync(join(root, graph.path), "utf8")).join("\n");
    expect(production).not.toContain(token);
  });
});
