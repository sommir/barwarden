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
import type { Ios27RouteData } from "./platform/popup-route-metadata";

function flattenRoutes(routeConfig: Routes, prefix = ""): string[] {
  return routeConfig.flatMap((route) => {
    const routePath = route.path ?? "";
    const fullPath = routePath === "" ? prefix || "/" : `${prefix}/${routePath}`.replace(/\/+/g, "/");
    const children = route.children ? flattenRoutes(route.children, fullPath === "/" ? "" : fullPath) : [];

    return [fullPath, ...children];
  });
}

function flattenComponentRoutes(
  routeConfig: Routes,
  prefix = "",
): Array<{ path: string; data: Record<string, unknown> | undefined }> {
  return routeConfig.flatMap((route) => {
    const routePath = route.path ?? "";
    const path = routePath === "" ? prefix || "/" : `${prefix}/${routePath}`.replace(/\/+/g, "/");
    const children = route.children
      ? flattenComponentRoutes(route.children, path === "/" ? "" : path)
      : [];
    const current = route.component
      ? [{ path, data: route.data as Record<string, unknown> | undefined }]
      : [];

    return [...current, ...children];
  });
}

const routeAuthority: ReadonlyArray<readonly [string, Ios27RouteData]> = [
  ["/login", { ios27Family: "auth", popupLayer: "base", bottomNavigation: false }],
  ["/lock", { ios27Family: "auth", popupLayer: "base", bottomNavigation: false }],
  ["/2fa", { ios27Family: "auth", popupLayer: "secondary", bottomNavigation: false }],
  ["/new-device-verification", { ios27Family: "auth", popupLayer: "secondary", bottomNavigation: false }],
  ["/hint", { ios27Family: "auth", popupLayer: "secondary", bottomNavigation: false }],
  ["/tabs", { ios27Family: "shell", popupLayer: "base", bottomNavigation: true }],
  ["/tabs/vault", { ios27Family: "vault", popupLayer: "base", bottomNavigation: true }],
  ["/tabs/otp", { ios27Family: "otp", popupLayer: "base", bottomNavigation: true }],
  ["/tabs/generator", { ios27Family: "generator", popupLayer: "base", bottomNavigation: true }],
  ["/tabs/send", { ios27Family: "send", popupLayer: "base", bottomNavigation: true }],
  ["/tabs/settings", { ios27Family: "settings", popupLayer: "base", bottomNavigation: true }],
  ["/account-switcher", { ios27Family: "auth", popupLayer: "secondary", bottomNavigation: false }],
  ["/vault-settings", { ios27Family: "settings", popupLayer: "secondary", bottomNavigation: false }],
  ["/account-security", { ios27Family: "settings", popupLayer: "secondary", bottomNavigation: false }],
  ["/settings-password", { ios27Family: "settings", popupLayer: "secondary", bottomNavigation: false }],
  ["/autofill", { ios27Family: "settings", popupLayer: "secondary", bottomNavigation: false }],
  ["/keyboard-shortcut", { ios27Family: "settings", popupLayer: "secondary", bottomNavigation: false }],
  ["/appearance", { ios27Family: "settings", popupLayer: "secondary", bottomNavigation: false }],
  ["/new-item", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/folders", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/archive", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/trash", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/view-cipher/:id", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/add-cipher", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/edit-cipher", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/clone-cipher", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/cipher-password-history", { ios27Family: "vault", popupLayer: "secondary", bottomNavigation: false }],
  ["/generator-history", { ios27Family: "generator", popupLayer: "secondary", bottomNavigation: false }],
  ["/add-send", { ios27Family: "send", popupLayer: "secondary", bottomNavigation: false }],
  ["/edit-send", { ios27Family: "send", popupLayer: "secondary", bottomNavigation: false }],
  ["/send-created", { ios27Family: "send", popupLayer: "secondary", bottomNavigation: false }],
  ["/about", { ios27Family: "document", popupLayer: "secondary", bottomNavigation: false }],
  ["/third-party-notices", { ios27Family: "document", popupLayer: "secondary", bottomNavigation: false }],
  ["/third-party-licenses", { ios27Family: "document", popupLayer: "secondary", bottomNavigation: false }],
];

describe("popup routes", () => {
  it("matches the complete route family, layer, and bottom-navigation authority", () => {
    const actual = flattenComponentRoutes(routes);

    expect(actual.map(({ path }) => path)).toEqual(routeAuthority.map(([path]) => path));
    for (const [index, [path, expected]] of routeAuthority.entries()) {
      const row = actual[index]!;
      expect(row.path).toBe(path);
      expect(row.data).toMatchObject(expected);
      expect(Object.hasOwn(row.data ?? {}, "ios27Family"), `${path} family`).toBe(true);
      expect(Object.hasOwn(row.data ?? {}, "popupLayer"), `${path} layer`).toBe(true);
      expect(typeof row.data?.["bottomNavigation"], `${path} bottom navigation`).toBe("boolean");
    }
  });

  it("preserves the account-switcher evidence state alongside typed route metadata", () => {
    expect(routes.find((route) => route.path === "account-switcher")?.data?.["state"])
      .toBe("account-switcher");
  });

  it("redirects the retired standalone AutoFill route to the normal vault", () => {
    expect(routes.find((route) => route.path === "autofill-picker")).toEqual({
      path: "autofill-picker",
      redirectTo: "tabs/vault",
      pathMatch: "full",
    });
  });

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

    // The retired URL remains a public compatibility redirect; the destination
    // still applies the normal unlocked vault guard.
    const publicPaths = new Set(["login", "hint", "autofill-picker", "", "**"]);
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
    expect(settingsPasswordRoute?.data).toMatchObject({
      ios27Family: "settings",
      popupLayer: "secondary",
      bottomNavigation: false,
    });
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
