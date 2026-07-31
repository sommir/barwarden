import "@angular/compiler";

import { describe, expect, it } from "vitest";
import type { Routes } from "@angular/router";

import { ArchivePageComponent } from "./vault/archive-page.component";
import { FoldersPageComponent } from "./vault/folders-page.component";
import { TrashPageComponent } from "./vault/trash-page.component";
import { routes } from "./app.routes";
import { VaultPasswordHistoryPageComponent } from "./vault/vault-password-history-page.component";
import { OtpPageComponent } from "./vault/otp-page.component";
import { retainedPopupRouteGraph } from "./app.routes";
import { KeyboardShortcutPageComponent } from "./settings/keyboard-shortcut-page.component";
import { globalShortcutSettingsSourceRow } from "./upstream-source-map";
import {
  activeChallengeGuard,
  knownAccountGuard,
  newDeviceChallengeGuard,
  resolveRouteAccess,
  twoFactorChallengeGuard,
  unlockedOnlyGuard,
} from "./auth/auth-route-access";

function flattenRoutes(routeConfig: Routes, prefix = ""): string[] {
  return routeConfig.flatMap((route) => {
    const routePath = route.path ?? "";
    const fullPath = routePath === "" ? prefix || "/" : `${prefix}/${routePath}`.replace(/\/+/g, "/");
    const children = route.children ? flattenRoutes(route.children, fullPath === "/" ? "" : fullPath) : [];

    return [fullPath, ...children];
  });
}

describe("popup routes", () => {
  it("defines the only static route graph eligible for retained popup navigation", () => {
    expect(retainedPopupRouteGraph).toEqual([
      "/tabs/vault",
      "/tabs/otp",
      "/tabs/generator",
      "/tabs/send",
      "/tabs/settings",
      "/vault-settings",
      "/account-security",
      "/settings-password",
      "/autofill",
      "/keyboard-shortcut",
      "/appearance",
      "/new-item",
      "/folders",
      "/archive",
      "/trash",
      "/generator-history",
      "/add-send",
      "/about",
      "/third-party-notices",
      "/third-party-licenses",
    ]);
    expect(retainedPopupRouteGraph.join("\n")).not.toMatch(/(?:account|cipher|item|send)Id/i);
  });

  it("guards challenge, known-account, and unlocked-only routes", () => {
    expect(routes.find((route) => route.path === "2fa")?.canMatch).toEqual([twoFactorChallengeGuard]);
    expect(routes.find((route) => route.path === "new-device-verification")?.canMatch).toEqual([
      newDeviceChallengeGuard,
    ]);
    expect(routes.find((route) => route.path === "lock")?.canMatch).toEqual([knownAccountGuard]);
    expect(routes.find((route) => route.path === "account-switcher")?.canMatch).toEqual([
      knownAccountGuard,
    ]);

    const publicPaths = new Set(["login", "hint", "", "**"]);
    for (const route of routes) {
      if (!publicPaths.has(route.path ?? "") && !["lock", "account-switcher", "2fa", "new-device-verification"].includes(route.path ?? "")) {
        expect(route.canMatch, `route ${route.path} must require an unlocked vault`).toEqual([
          unlockedOnlyGuard,
        ]);
      }
    }
  });

  it("rejects a new-device challenge at /2fa and a two-factor challenge at /new-device-verification", () => {
    const twoFactor = {
      email: "user@example.com",
      isUnlocked: false,
      authChallenge: {
        type: "twoFactor" as const,
        email: "user@example.com",
        serverUrl: "https://vault.example.com",
        providers: ["0"],
      },
    };
    const newDevice = {
      email: "user@example.com",
      isUnlocked: false,
      authChallenge: {
        type: "newDevice" as const,
        email: "user@example.com",
        serverUrl: "https://vault.example.com",
      },
    };

    expect(resolveRouteAccess(newDevice, "challenge", "twoFactor")).toBe("/login");
    expect(resolveRouteAccess(twoFactor, "challenge", "newDevice")).toBe("/login");
    expect(resolveRouteAccess(twoFactor, "challenge", "twoFactor")).toBe(true);
    expect(resolveRouteAccess(newDevice, "challenge", "newDevice")).toBe(true);
    expect(activeChallengeGuard).not.toBe(twoFactorChallengeGuard);
    expect(activeChallengeGuard).not.toBe(newDeviceChallengeGuard);
  });

  it.each([
    "attachments",
    "assign-collections",
    "import",
    "export",
    "at-risk-passwords",
    "device-management",
    "blocked-domains",
    "excluded-domains",
    "notifications",
  ])("does not register deferred Plan A route %s", (path) => {
    expect(routes.some((route) => route.path === path)).toBe(false);
  });

  it("exposes official-style primary tab and secondary routes", () => {
    const paths = routes.map((route) => route.path);

    expect(paths).toContain("login");
    expect(paths).toContain("lock");
    expect(paths).toContain("tabs");
    expect(paths).toContain("view-cipher/:id");
    expect(paths).toContain("add-cipher");
    expect(paths).toContain("edit-cipher");
    expect(paths).toContain("clone-cipher");
    expect(paths).toContain("cipher-password-history");
    expect(paths).toContain("generator-history");
    expect(paths).toContain("add-send");
    expect(paths).toContain("keyboard-shortcut");
    expect(paths).toContain("about");
    expect(paths).toContain("third-party-notices");
    expect(paths).toContain("third-party-licenses");

    const tabs = routes.find((route) => route.path === "tabs")?.children?.map((route) => route.path);
    expect(tabs).toEqual(["vault", "otp", "generator", "send", "settings", ""]);
    expect(
      routes.find((route) => route.path === "tabs")?.children
        ?.find((route) => route.path === "otp")?.component,
    ).toBe(OtpPageComponent);
  });

  it("includes official popup secondary route entries", () => {
    expect(flattenRoutes(routes)).toEqual(
      expect.arrayContaining([
        "/account-switcher",
        "/lock",
        "/2fa",
        "/new-device-verification",
        "/hint",
        "/vault-settings",
        "/account-security",
        "/settings-password",
        "/autofill",
        "/keyboard-shortcut",
        "/appearance",
        "/folders",
        "/archive",
        "/trash",
        "/new-item",
        "/add-cipher",
        "/edit-cipher",
        "/clone-cipher",
        "/cipher-password-history",
        "/add-send",
        "/edit-send",
        "/send-created",
      ]),
    );
  });

  it("gives every reachable unlocked secondary route the same route-level macOS page shell", () => {
    const exempt = new Set(["tabs", "login", "lock", "2fa", "new-device-verification", "hint", "", "**"]);
    const secondaryRoutes = routes.filter((route) =>
      !exempt.has(route.path ?? "") && route.component,
    );

    for (const route of secondaryRoutes) {
      const metadata = (
        route.component as unknown as {
          ɵcmp?: { hostAttrs?: readonly unknown[] | null };
        }
      ).ɵcmp;
      const hostTokens = (metadata?.hostAttrs ?? []).map(String);

      expect(hostTokens, `/${route.path} must own a macos-page host shell`)
        .toContain("macos-page");
      expect(hostTokens, `/${route.path} must use the shared secondary content track`)
        .toContain("macos-page--secondary");
    }
  });

  it("does not register excluded authentication routes", () => {
    const paths = flattenRoutes(routes);

    expect(paths).not.toEqual(
      expect.arrayContaining([
        "/sso",
        "/signup",
        "/finish-signup",
        "/login-with-device",
        "/login-with-passkey",
      ]),
    );
  });

  it("does not register excluded product marketing routes", () => {
    expect(flattenRoutes(routes)).not.toEqual(
      expect.arrayContaining(["/download-bitwarden", "/more-from-bitwarden"]),
    );
  });

  it.each([
    "admin-settings",
    "extension-device-management",
    "blocked-domains",
    "excluded-domains",
    "premium-v2",
    "billing",
    "reports",
    "import-browser",
    "export-browser",
  ])("does not register excluded Settings route %s", (path) => {
    expect(flattenRoutes(routes)).not.toContain(`/${path}`);
    expect(retainedPopupRouteGraph).not.toContain(`/${path}`);
  });

  it("routes folders to the synced folders page instead of the unavailable shell", () => {
    expect(routes.find((route) => route.path === "folders")?.component).toBe(FoldersPageComponent);
  });

  it("routes archive and trash to synced list pages instead of unavailable shells", () => {
    expect(routes.find((route) => route.path === "archive")?.component).toBe(ArchivePageComponent);
    expect(routes.find((route) => route.path === "trash")?.component).toBe(TrashPageComponent);
  });

  it("routes password history to the dedicated official popup page", () => {
    expect(routes.find((route) => route.path === "cipher-password-history")?.component).toBe(
      VaultPasswordHistoryPageComponent,
    );
  });

  it("routes settings-password to a real handoff component", () => {
    const settingsPasswordRoute = routes.find((route) => route.path === "settings-password");

    expect(settingsPasswordRoute?.component).toBeDefined();
    expect(settingsPasswordRoute?.data).toBeUndefined();
  });

  it("routes keyboard-shortcut to the recorder page behind the unlocked-only guard", () => {
    const keyboardShortcutRoute = routes.find((route) => route.path === "keyboard-shortcut");

    expect(keyboardShortcutRoute?.component).toBe(KeyboardShortcutPageComponent);
    expect(keyboardShortcutRoute?.canMatch).toEqual([unlockedOnlyGuard]);
  });

  it("routes third-party notices internally behind the unlocked-only guard", () => {
    const noticesRoute = routes.find((route) => route.path === "third-party-notices");

    expect(noticesRoute?.component).toBeDefined();
    expect(noticesRoute?.canMatch).toEqual([unlockedOnlyGuard]);
    expect(retainedPopupRouteGraph).toContain("/third-party-notices");
  });

  it("routes complete third-party license text internally behind the unlocked-only guard", () => {
    const licensesRoute = routes.find((route) => route.path === "third-party-licenses");

    expect(licensesRoute?.component).toBeDefined();
    expect(licensesRoute?.canMatch).toEqual([unlockedOnlyGuard]);
    expect(retainedPopupRouteGraph).toContain("/third-party-licenses");
  });

  it("maps the native shortcut coordinator and page into a dedicated Settings source boundary", () => {
    expect(globalShortcutSettingsSourceRow).toMatchObject({
      id: "settings.global-shortcut",
      ownership: "native",
      localModules: [
        "apps/menubar-tauri/src/app/settings/global-shortcut-settings.service.ts",
        "apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.ts",
      ],
    });
  });
});
