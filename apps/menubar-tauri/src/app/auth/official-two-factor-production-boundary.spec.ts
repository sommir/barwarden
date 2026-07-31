import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const app = (path: string) => join(root, "apps/menubar-tauri/src/app", path);

const requiredRuntimeFiles = [
  "auth/official-challenge.adapter.ts",
  "upstream-overlays/auth/two-factor/official-two-factor.component.ts",
  "upstream-overlays/auth/two-factor/official-two-factor.component.html",
  "upstream-overlays/auth/two-factor/official-two-factor-options.component.ts",
  "upstream-overlays/auth/two-factor/official-two-factor-options.component.html",
  "upstream-overlays/auth/two-factor/official-two-factor-email.component.ts",
  "upstream-overlays/auth/two-factor/official-two-factor-email.component.html",
  "upstream-overlays/auth/two-factor/official-two-factor-authenticator.component.ts",
  "upstream-overlays/auth/two-factor/official-two-factor-authenticator.component.html",
  "upstream-overlays/auth/two-factor/official-two-factor.transform-manifest.json",
] as const;

describe("official retained two-factor production boundary", () => {
  it("requires the complete guarded two-factor runtime before replacing the route", () => {
    expect(requiredRuntimeFiles.filter((path) => !existsSync(app(path)))).toEqual([]);
  });

  it("makes the production route a thin official anonymous-shell composition", () => {
    const source = readFileSync(app("auth/two-factor-page.component.ts"), "utf8");

    expect(source).toContain("OfficialAnonymousShellComponent");
    expect(source).toContain("OfficialTwoFactorComponent");
    expect(source).toContain("<bw-official-anonymous-shell");
    expect(source).toContain("<bw-official-two-factor");
    expect(source).not.toContain("official-login-");
    expect(source).not.toContain("supportedTwoFactorProviders");
    expect(source).not.toContain("AuthFacade");
  });

  it("keeps excluded providers and browser-only challenge surfaces out of production two-factor code", () => {
    const existingSources = requiredRuntimeFiles
      .filter((path) => !path.endsWith(".json") && existsSync(app(path)))
      .map((path) => readFileSync(app(path), "utf8"))
      .join("\n");
    const forbidden = [
      "TwoFactorAuthDuoComponent",
      "TwoFactorAuthWebAuthnComponent",
      "TwoFactorAuthYubikeyComponent",
      "OrganizationDuo",
      "use2faRecoveryCode",
      "launchDuo",
      "extendPopupWidthIfRequired",
      "chrome.runtime",
      "browser.runtime",
      "webRequest",
      "webNavigation",
      "nativeMessaging",
    ];

    for (const token of forbidden) {
      expect(existingSources, token).not.toContain(token);
    }
  });

  it("disposes the official provider subscription with the route lifecycle", () => {
    const source = readFileSync(
      app("upstream-overlays/auth/two-factor/official-two-factor.component.ts"),
      "utf8",
    );
    expect(source).toContain("DestroyRef");
    expect(source).toContain("takeUntilDestroyed(this.destroyRef)");
  });
});
