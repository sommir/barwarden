import angular from "@analogjs/vite-plugin-angular";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { buildOfficialLoginDetailAliases } from "./apps/menubar-tauri/official-login-detail-aliases";
import { buildOfficialLoginFormAliases } from "./apps/menubar-tauri/official-login-form-aliases";
import {
  buildOfficialGeneratorAliases,
  buildOfficialGeneratorInternalBoundaryPlugin,
} from "./apps/menubar-tauri/official-generator-aliases";

const packageVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };
const officialAuthAliases = [
  ["@bitwarden/official-auth-popup/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component", "./vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts"],
  ["@bitwarden/angular/auth/environment-selector/environment-selector.component", "./vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts"],
  ["@bitwarden/angular/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component", "./vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts"],
  ["@bitwarden/auth/angular/login/login.component", "./vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts"],
  ["@bitwarden/auth/angular/login/login-component.service", "./vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts"],
  ["@bitwarden/auth/angular/password-hint/password-hint.component", "./vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-auth.component", "./vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-options.component", "./vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-auth-email.component", "./vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-auth-authenticator.component", "./vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts"],
  ["@bitwarden/auth/angular/new-device-verification/new-device-verification.component", "./vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts"],
  ["@bitwarden/key-management-ui/lock/components/lock.component", "./vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts"],
  ["@bitwarden/key-management-ui/lock/components/master-password-lock/master-password-lock.component", "./vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts"],
  ["@bitwarden/official-auth-popup/account-switching/current-account.component", "./vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts"],
] as const;
const officialVaultAliases = [
  ["@bitwarden/official-vault-popup/vault-header.component", "./apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts"],
  ["@bitwarden/official-vault-popup/new-item-dropdown.component", "./apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts"],
  ["@bitwarden/vault", "./apps/menubar-tauri/src/app/vault/official-vault-boundary.ts"],
  ["@bitwarden/common/vault/services/search.service", "./apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/common/vault/services/search.service.ts"],
  ["@bitwarden/common/vault/services/restricted-item-types.service", "./apps/menubar-tauri/src/app/vault/retained-restricted-item-types.service.ts"],
] as const;
function exactAliasPattern(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

export default defineConfig({
  define: {
    __BARWARDEN_VERSION__: JSON.stringify(packageVersion.version),
  },
  resolve: {
    alias: [
      ...officialAuthAliases.map(([specifier, source]) => ({
        find: exactAliasPattern(specifier),
        replacement: fileURLToPath(new URL(source, import.meta.url)),
      })),
      ...officialVaultAliases.map(([specifier, source]) => ({
        find: exactAliasPattern(specifier),
        replacement: fileURLToPath(new URL(source, import.meta.url)),
      })),
      ...buildOfficialLoginDetailAliases(process.cwd()),
      ...buildOfficialLoginFormAliases(process.cwd()),
      ...buildOfficialGeneratorAliases(process.cwd()),
      {
        find: /^@bitwarden\/state$/,
        replacement: fileURLToPath(new URL("./apps/menubar-tauri/src/app/official-ui/official-state-types.adapter.ts", import.meta.url)),
      },
      {
        find: /^@bitwarden\/state-internal$/,
        replacement: fileURLToPath(new URL("./apps/menubar-tauri/src/app/official-ui/official-state-internal.adapter.ts", import.meta.url)),
      },
      {
        find: "ngx-toastr/toastr",
        replacement: fileURLToPath(
          new URL("./apps/menubar-tauri/src/styles/official-toastr.css", import.meta.url),
        ),
      },
      {
        find: "~@bitwarden/components/src/webfonts/inter.woff2",
        replacement: fileURLToPath(
          new URL("./vendor/bitwarden-clients/libs/components/src/webfonts/inter.woff2", import.meta.url),
        ),
      },
      {
        find: "~@bitwarden/angular/src/scss/bwicons/fonts",
        replacement: fileURLToPath(
          new URL(
            "./vendor/bitwarden-clients/libs/angular/src/scss/bwicons/fonts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/client-type",
        replacement: fileURLToPath(
          new URL("./vendor/bitwarden-clients/libs/client-type/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/components",
        replacement: fileURLToPath(
          new URL("./apps/menubar-tauri/official-components-overlay", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/browser-popup/components/popup-focus-wrap.directive",
        replacement: fileURLToPath(
          new URL(
            "./vendor/bitwarden-clients/apps/browser/src/platform/popup/components/popup-focus-wrap.directive.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/browser-popup/components/pop-out.component",
        replacement: fileURLToPath(
          new URL(
            "./apps/menubar-tauri/src/app/upstream-overlays/pop-out/pop-out.component.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/browser-popup/layout/popup-page.component",
        replacement: fileURLToPath(
          new URL(
            "./vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-page.component.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/browser-popup/layout/popup-header.component",
        replacement: fileURLToPath(
          new URL(
            "./apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-header.component.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/browser-popup/layout/popup-footer.component",
        replacement: fileURLToPath(
          new URL(
            "./vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-footer.component.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/logging",
        replacement: fileURLToPath(
          new URL(
            "./apps/menubar-tauri/src/app/official-ui/official-logging.adapter.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/angular/jslib.module",
        replacement: fileURLToPath(
          new URL(
            "./apps/menubar-tauri/src/app/upstream-overlays/popup-header/jslib.module.adapter.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/assets/svg",
        replacement: fileURLToPath(
          new URL("./vendor/bitwarden-clients/libs/assets/src/svg/index.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/assets",
        replacement: fileURLToPath(
          new URL("./vendor/bitwarden-clients/libs/assets/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/common/platform/misc/utils",
        replacement: fileURLToPath(
          new URL(
            "./apps/menubar-tauri/src/app/official-ui/official-common-utils.adapter.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/common",
        replacement: fileURLToPath(
          new URL("./vendor/bitwarden-clients/libs/common/src", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/ui-common",
        replacement: fileURLToPath(
          new URL("./apps/menubar-tauri/src/app/official-ui/official-ui-common.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/platform",
        replacement: fileURLToPath(
          new URL(
            "./apps/menubar-tauri/src/app/official-ui/official-platform.adapter.ts",
            import.meta.url,
          ),
        ),
      },
    ],
    preserveSymlinks: true,
  },
  plugins: [
    buildOfficialGeneratorInternalBoundaryPlugin(fileURLToPath(new URL(".", import.meta.url))),
    angular({
      tsconfig: fileURLToPath(new URL("./apps/menubar-tauri/tsconfig.spec.json", import.meta.url)),
    }),
  ],
  test: {
    css: true,
    environment: "jsdom",
    globals: true,
    // Bound the Angular/SDK workers so native/WASM crypto and source-graph
    // guards do not starve each other and exceed otherwise healthy timeouts.
    maxWorkers: 4,
    testTimeout: 15_000,
    setupFiles: [
      fileURLToPath(new URL("./apps/menubar-tauri/src/test-setup.ts", import.meta.url)),
    ],
    server: {
      deps: {
        inline: ["@bitwarden/sdk-internal"],
      },
    },
    // Playwright owns the external e2e harness except for credential-free live contracts.
    include: [
      "apps/**/src/**/*.spec.ts",
      "apps/**/e2e/live/live-test-protocol.spec.ts",
      "apps/**/e2e/live/live-auth-contract.spec.ts",
      "apps/**/e2e/live/live-vault-scenarios.spec.ts",
      "apps/**/e2e/live/live-text-send-scenarios.spec.ts",
    ],
  },
});
