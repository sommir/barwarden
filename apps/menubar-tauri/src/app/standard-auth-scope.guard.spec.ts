import "@angular/compiler";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Routes } from "@angular/router";

import { routes } from "./app.routes";
import { popupParityManifest } from "./popup-parity-manifest";

const removedFiles = [
  "apps/menubar-tauri/src/app/auth/sso-page.component.ts",
  "apps/menubar-tauri/src/app/auth/sso-page.component.spec.ts",
  "apps/menubar-tauri/src/app/auth/signup-page.component.ts",
  "apps/menubar-tauri/src/app/auth/signup-page.component.spec.ts",
] as const;

const excludedRoutePaths = [
  "sso",
  "signup",
  "finish-signup",
  "login-with-device",
  "login-with-passkey",
] as const;

const removedManifestIds = [
  "auth.signup",
  "auth.sso",
  "auth.device-approval",
  "auth.passkey-handoff",
  "handoff.premium",
  "handoff.admin",
] as const;

const auditPath = "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md";
const comparisonPath = "docs/superpowers/specs/2026-07-10-bitwarden-popup-function-comparison.md";
const reuseMapPath = "docs/upstream-reuse-map.md";
const sourceParityDesignPath = "docs/superpowers/specs/2026-07-11-popup-complete-source-parity-design.md";
const productScopeDesignPath = "docs/superpowers/specs/2026-07-11-standard-server-product-scope-design.md";
const sourceRoot = "apps/menubar-tauri/src";

const forbiddenProductionPatterns = [
  { description: "SSO route surface", pattern: /["'`]\/sso["'`]/ },
  { description: "signup route surface", pattern: /["'`]\/signup["'`]/ },
  { description: "finish-signup route surface", pattern: /["'`]\/finish-signup["'`]/ },
  { description: "login-with-device route surface", pattern: /["'`]\/login-with-device["'`]/ },
  { description: "login-with-passkey route surface", pattern: /["'`]\/login-with-passkey["'`]/ },
  { description: "premium route surface", pattern: /["'`]\/premium["'`]/ },
  { description: "admin route surface", pattern: /["'`]\/admin["'`]/ },
  { description: "download marketing route surface", pattern: /["'`]\/download-bitwarden["'`]/ },
  { description: "product marketing route surface", pattern: /["'`]\/more-from-bitwarden["'`]/ },
  { description: "signup register request type", pattern: /\bRegisterSendVerificationEmailRequest\b/ },
  { description: "signup register api call", pattern: /\bpostRegisterSendVerificationEmail\b/ },
  { description: "signup register endpoint", pattern: /\/accounts\/register\/send-verification-email/ },
  { description: "Key Connector surface", pattern: /\bKey Connector\b/ },
  { description: "key-connector surface", pattern: /\bkey-connector\b/i },
  { description: "auth-request approval surface", pattern: /\bauth-request approval\b/i },
  { description: "login-initiated approval surface", pattern: /\blogin-initiated approval\b/i },
  { description: "admin approval surface", pattern: /\badmin approval\b/i },
  { description: "Duo two-factor surface", pattern: /\bDuo\b/ },
  { description: "WebAuthn two-factor surface", pattern: /\bWebAuthn\b/ },
  { description: "initial-password setup surface", pattern: /\binitial-password\b/i },
  { description: "local master-password mutation surface", pattern: /\bmaster-password change\b/i },
  { description: "local key rotation surface", pattern: /\bkey rotation\b/i },
  { description: "local account password removal surface", pattern: /\b(?:account|master)[ -]password removal\b/i },
  { description: "browser native messaging surface", pattern: /\bnativeMessaging\b/ },
] as const;

describe("standard authentication scope guard", () => {
  it("keeps excluded authentication files, routes, manifest ids, and production surfaces absent", () => {
    for (const file of removedFiles) {
      expect(existsSync(resolve(process.cwd(), file))).toBe(false);
    }

    expect(flattenRoutes(routes)).not.toEqual(expect.arrayContaining(excludedRoutePaths.map((path) => `/${path}`)));
    expect(popupParityManifest.map((entry) => entry.id)).not.toEqual(expect.arrayContaining(removedManifestIds));

    for (const file of listProductionTypeScriptFiles(join(process.cwd(), sourceRoot))) {
      const relativeFile = file.replace(`${process.cwd()}/`, "");
      const source = readFileSync(file, "utf8");
      for (const forbidden of forbiddenProductionPatterns) {
        expect(source, `${relativeFile} should not contain ${forbidden.description}`).not.toMatch(forbidden.pattern);
      }
    }
  });

  it.skipIf(
    ![auditPath, comparisonPath, sourceParityDesignPath, productScopeDesignPath].every((path) =>
      existsSync(resolve(process.cwd(), path)),
    ),
  )("keeps the active baseline documents aligned to the supported authentication and exclusion boundary", () => {
    const audit = readWorkspaceFile(auditPath);
    const comparison = readWorkspaceFile(comparisonPath);
    const reuseMap = readWorkspaceFile(reuseMapPath);
    const sourceParityDesign = readWorkspaceFile(sourceParityDesignPath);
    const productScopeDesign = readWorkspaceFile(productScopeDesignPath);

    expect(audit).toContain("<!-- parity-summary missing=0 partial=69 complete=0 -->");
    expect(audit).toContain(
      "Current authentication baseline is password login, provider `0` authenticator app or provider `1` email two-factor, new-device email OTP, password hint, master-password unlock, process-lifetime 6-8 digit PIN unlock, native macOS Touch ID unlock, logout, and Keychain-backed account switching on Bitwarden US, Bitwarden EU, and self-hosted servers.",
    );
    expect(audit).toContain(
      "Key Connector, login with device, auth-request approval, login-initiated approval, admin approval, Duo/WebAuthn two-factor, initial-password setup, password removal, local master-password mutation/key rotation, premium/admin/billing, enterprise identity management, and product/download marketing are product exclusions. The only retained Web Vault handoff is environment-aware master-password change for an existing supported account.",
    );
    expect(audit).toContain(
      "Plan A retains Vault timeout, process-lifetime PIN, native macOS Touch ID, and the environment-aware existing-account master-password-change handoff. Browser native messaging, shared desktop unlock, device, key-rotation, and enterprise controls are absent.",
    );
    expect(audit).toContain(
      "Premium/admin/billing/enterprise and product/download marketing routes are product exclusions and absent from the retained manifest and UI.",
    );
    expect(audit).not.toContain("master-password change, unlock methods and full security settings are not.");
    expect(audit).not.toContain("Scope decision needed");

    expect(comparison).toContain(
      "Authentication scope is limited to password login, provider `0` and `1` two-factor, new-device email OTP, password hint, master-password unlock, process-lifetime 6-8 digit PIN unlock, native macOS Touch ID unlock, logout, and account switching across Bitwarden US, Bitwarden EU, and standard compatible self-hosted servers.",
    );
    expect(comparison).toContain(
      "SSO, Key Connector, passkey/WebAuthn login, login with device, auth-request approval, login-initiated approval, admin approval, Duo/WebAuthn two-factor, initial-password setup, password removal, local master-password mutation/key rotation, signup completion, premium/admin/billing, enterprise identity management, and product/download marketing are product exclusions. The only retained Web Vault handoff is environment-aware master-password change for an existing supported account.",
    );
    expect(comparison).toContain(
      "Plan A retains Vault timeout, process-lifetime PIN, native macOS Touch ID, and `/settings-password` for an existing account. Browser native messaging, shared desktop unlock, device, password-removal, and key-rotation controls are absent.",
    );
    expect(comparison).not.toContain("in-client master-password change/key-rotation still deferred");
    expect(comparison).not.toContain("signup posts `/accounts/register/send-verification-email`");
    expect(comparison).toContain(
      "Excluded from Plan A; no notification or domain-administration route is reachable.",
    );
    expect(comparison).not.toContain("passkey/save/update notification toggles need browser-safe menubar equivalents or remain unsupported");

    expect(reuseMap).toContain(
      "The retained standard authentication surface is split into the 12 Authentication/Accounts acceptance rows.",
    );
    expect(reuseMap).not.toContain("`auth.signup`");
    expect(reuseMap).not.toContain("`auth.sso`");
    expect(reuseMap).not.toContain("`auth.device-approval`");
    expect(reuseMap).not.toContain("`auth.passkey-handoff`");

    expect(sourceParityDesign).toContain(
      "The only retained Web Vault hand-off is the environment-aware master-password change entry for an existing supported account.",
    );
    expect(sourceParityDesign).toContain(
      "`/signup`, `/finish-signup` | Product exclusion; no route, local form, hand-off, or backlog claim.",
    );
    expect(sourceParityDesign).not.toContain("Premium purchase and subscription management.");
    expect(sourceParityDesign).not.toContain("Product/download marketing destinations.");
    expect(sourceParityDesign).not.toContain("organization administration remains a Web Vault hand-off");
    expect(sourceParityDesign).not.toContain("administration remains external");
    expect(sourceParityDesign).not.toContain("unsupported key rotation/2FA administration opens active Web Vault");
    expect(sourceParityDesign).not.toContain("Official labeled external links resolved from the active environment");
    expect(productScopeDesign).toContain(
      "Account creation, billing, organization administration, and product/download marketing are not retained hand-offs.",
    );
  });
});

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function flattenRoutes(routeConfig: Routes, prefix = ""): string[] {
  return routeConfig.flatMap((route) => {
    const routePath = route.path ?? "";
    const fullPath = routePath === "" ? prefix || "/" : `${prefix}/${routePath}`.replace(/\/+/g, "/");
    const children = route.children ? flattenRoutes(route.children, fullPath === "/" ? "" : fullPath) : [];

    return [fullPath, ...children];
  });
}

function listProductionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listProductionTypeScriptFiles(fullPath);
    }
    if (!entry.isFile() || !fullPath.endsWith(".ts") || fullPath.endsWith(".spec.ts")) {
      return [];
    }
    return [fullPath];
  });
}
