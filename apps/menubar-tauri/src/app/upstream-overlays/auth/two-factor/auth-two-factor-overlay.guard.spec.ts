import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pinned = (path: string) => join(root, "vendor/bitwarden-clients", path);
const overlay = (path: string) => join(root, "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor", path);
const manifestDigest = "0025ba8bf8ccd4b3e2466552fd0ee6b0efba352759ca2d705a0e0fdd2702528f";

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
  readonly localImports: readonly {
    readonly module: string;
    readonly bindings: readonly string[];
  }[];
};

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

function assertLocalRuntime(runtime: string, partition: ExactPartition): void {
  const source = ts.createSourceFile(partition.runtime, runtime, ts.ScriptTarget.Latest, true);
  expect(new Set(classMembers(source))).toEqual(new Set(partition.localMembers));
  const actualImports = source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => ({
      module: (statement.moduleSpecifier as ts.StringLiteral).text,
      bindings: normalizedBindings(statement.importClause),
    }));
  expect(new Set(actualImports.map((entry) => entry.module))).toEqual(
    new Set(partition.localImports.map((entry) => entry.module)),
  );
  for (const expected of partition.localImports) {
    expect(actualImports.find((entry) => entry.module === expected.module)?.bindings)
      .toEqual([...expected.bindings].sort());
  }
}

describe("official retained two-factor source overlays", () => {
  it("pins every parent, options, email, and authenticator TS/HTML authority", () => {
    const manifest = JSON.parse(readFileSync(overlay("official-two-factor.transform-manifest.json"), "utf8")) as {
      readonly revision: string;
      readonly authorities: readonly { readonly path: string; readonly sha256: string }[];
      readonly localRuntimes: readonly { readonly path: string; readonly sha256: string }[];
    };
    expect(manifest.revision).toBe("f47b6946e01aed474875789081966d311d5b8289");
    expect(manifest.authorities).toHaveLength(11);
    for (const authority of manifest.authorities) {
      expect(sha256(pinned(authority.path)), authority.path).toBe(authority.sha256);
    }
    expect(manifest.localRuntimes).toHaveLength(9);
    for (const runtime of manifest.localRuntimes) {
      expect(sha256(join(root, runtime.path)), runtime.path).toBe(runtime.sha256);
    }
    expect(sha256(overlay("official-two-factor.transform-manifest.json"))).toBe(manifestDigest);
  });

  it("retains both official child templates exactly except the documented email test hook", () => {
    const authenticator = readFileSync(
      pinned("libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.html"),
      "utf8",
    );
    const email = readFileSync(
      pinned("libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.html"),
      "utf8",
    );
    expect(readFileSync(overlay("official-two-factor-authenticator.component.html"), "utf8"))
      .toBe(authenticator
        .replace("  <bit-form-field>\n", '  <bit-form-field class="macos-field-owner">\n')
        .replace("      bitInput\n", '      bitInput\n      class="macos-control-visible"\n'));
    expect(readFileSync(overlay("official-two-factor-email.component.html"), "utf8"))
      .toBe(email
        .replace('class="!tw-mb-0"', 'class="!tw-mb-0 macos-field-owner"')
        .replace("    bitInput\n", '    bitInput\n    class="macos-control-visible"\n')
        .replace('    class="tw-text-main"', '    class="tw-text-main macos-auth-alternative macos-hit-target macos-pressable"')
        .replace("    (click)=\"sendEmail(true)\"\n", "    data-testid=\"two-factor-email-resend\"\n    (click)=\"sendEmail(true)\"\n"));
  });

  it("retains official parent/options structures while statically deleting excluded providers", () => {
    const parentAuthority = readFileSync(
      pinned("libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html"),
      "utf8",
    );
    const optionsAuthority = readFileSync(
      pinned("libs/auth/src/angular/two-factor-auth/two-factor-options.component.html"),
      "utf8",
    );
    const parent = readFileSync(overlay("official-two-factor.component.html"), "utf8");
    const options = readFileSync(overlay("official-two-factor-options.component.html"), "utf8");
    for (const fragment of [
      "[bitSubmit]=\"submit\"",
      "[formGroup]=\"form\"",
      "formControlName=\"remember\"",
      "buttonType=\"primary\"",
      "selectAnotherMethod",
    ]) {
      expect(parentAuthority).toContain(fragment);
      expect(parent).toContain(fragment);
    }
    for (const fragment of ["bitDialogTitle", "bitDialogContent", "bit-item-group", "bit-item-content", "bitDialogFooter"]) {
      expect(optionsAuthority).toContain(fragment);
      expect(options).toContain(fragment);
    }
    const runtime = [parent, options,
      readFileSync(overlay("official-two-factor.component.ts"), "utf8"),
      readFileSync(overlay("official-two-factor-options.component.ts"), "utf8"),
    ].join("\n");
    for (const forbidden of [
      "TwoFactorAuthDuo", "OrganizationDuo", "WebAuthn", "Yubikey", "YubiKey",
      "use2faRecoveryCode", "launchDuo", "extendPopupWidthIfRequired", "KeyConnector",
      "chrome.runtime", "browser.runtime", "webRequest", "webNavigation", "nativeMessaging",
    ]) {
      expect(runtime, forbidden).not.toContain(forbidden);
    }
  });

  it("partitions every upstream member/import and every local member/import binding exactly", () => {
    const manifest = JSON.parse(readFileSync(overlay("official-two-factor.transform-manifest.json"), "utf8")) as {
      readonly exactPartitions: readonly ExactPartition[];
    };
    expect(manifest.exactPartitions).toHaveLength(4);
    for (const partition of manifest.exactPartitions) {
      const upstreamPath = pinned(partition.authority);
      const upstream = ts.createSourceFile(
        upstreamPath,
        readFileSync(upstreamPath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      expect(new Set([
        ...partition.upstreamMembers.retained,
        ...partition.upstreamMembers.adapted,
        ...partition.upstreamMembers.removed,
      ])).toEqual(new Set(classMembers(upstream)));
      expect(new Set([
        ...partition.upstreamImports.retained,
        ...partition.upstreamImports.adapted,
        ...partition.upstreamImports.removed,
      ])).toEqual(new Set(imports(upstream)));
      assertLocalRuntime(readFileSync(overlay(partition.runtime), "utf8"), partition);
    }
  });

  it("rejects changed, removed, and extra local modules and bindings", () => {
    const manifest = JSON.parse(readFileSync(overlay("official-two-factor.transform-manifest.json"), "utf8")) as {
      readonly exactPartitions: readonly ExactPartition[];
    };
    const partition = manifest.exactPartitions.find(
      (candidate) => candidate.runtime === "official-two-factor.component.ts",
    )!;
    const runtime = readFileSync(overlay(partition.runtime), "utf8");
    expect(() => assertLocalRuntime(runtime.replace('from "@angular/common"', 'from "@angular/common-mutated"'), partition)).toThrow();
    expect(() => assertLocalRuntime(runtime.replace("CommonModule", "CommonModule as RenamedCommonModule"), partition)).toThrow();
    expect(() => assertLocalRuntime(runtime.replace("OnDestroy, ", ""), partition)).toThrow();
    expect(() => assertLocalRuntime(`${runtime}\nimport { readFileSync } from "node:fs";\n`, partition)).toThrow();
  });
});
