import angular from "@analogjs/vite-plugin-angular";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { buildOfficialLoginDetailAliases } from "./official-login-detail-aliases";
import { buildOfficialLoginFormAliases } from "./official-login-form-aliases";
import { buildOfficialPersonalDetailAliases } from "./official-personal-detail-aliases";
import { buildOfficialPersonalFormAliases } from "./official-personal-form-aliases";
import { buildOfficialRecoveryAliases } from "./official-recovery-aliases";
import {
  buildOfficialGeneratorAliases,
  buildOfficialGeneratorInternalBoundaryPlugin,
} from "./official-generator-aliases";
import { buildOfficialSendAliases } from "./official-send-aliases";
import { buildOfficialSettingsAliases } from "./official-settings-aliases";

const evidenceEnabled = process.env.VITE_BW_VAULT_EVIDENCE === "true";
const packageVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };
const retainedSdkWasm = fileURLToPath(
  new URL("./.generated/bitwarden_wasm_internal_bg.wasm", import.meta.url),
);

function enforceProductionRuntimeClosurePlugin() {
  return {
    name: "enforce-production-runtime-closure",
    enforce: "pre" as const,
    transform(source: string, id: string) {
      if (id.endsWith("/@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.js")) {
        const disposePattern =
          /^if \(Symbol\.dispose\) [A-Za-z0-9_]+\.prototype\[Symbol\.dispose\] = [A-Za-z0-9_]+\.prototype\.free;\n/gm;
        const registrations = source.match(disposePattern)?.length ?? 0;
        if (registrations === 0) {
          throw new Error("Pinned SDK dispose registrations were not found");
        }

        const sendsMethodPattern = /    \/\*\*\n     \* Send related operations\.\n     \* @returns \{SendClient\}\n     \*\/\n    sends\(\) \{\n        const ret = wasm\.passwordmanagerclient_sends\(this\.__wbg_ptr\);\n        return SendClient\.__wrap\(ret\);\n    \}\n/;
        if (!sendsMethodPattern.test(source)) {
          throw new Error("Pinned SDK PasswordManagerClient.sends method was not found");
        }

        return {
          code: source.replace(disposePattern, "").replace(sendsMethodPattern, ""),
          map: null,
        };
      }

      if (id.includes("/zone.js/") && source.includes("__load_patch('FileReader'")) {
        const fileReaderPatchPattern = /\s*Zone\.__load_patch\('FileReader', \(global, Zone, api\) => \{\n\s*patchClass\('FileReader'\);\n\s*\}\);/;
        if (!fileReaderPatchPattern.test(source)) {
          throw new Error("Pinned Zone.js FileReader patch was not found");
        }
        return { code: source.replace(fileReaderPatchPattern, ""), map: null };
      }

      return null;
    },
  };
}
const officialAuthAliases = [
  ["@bitwarden/official-auth-popup/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component", "../../vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts"],
  ["@bitwarden/angular/auth/environment-selector/environment-selector.component", "../../vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts"],
  ["@bitwarden/angular/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component", "../../vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts"],
  ["@bitwarden/auth/angular/login/login.component", "../../vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts"],
  ["@bitwarden/auth/angular/login/login-component.service", "../../vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts"],
  ["@bitwarden/auth/angular/password-hint/password-hint.component", "../../vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-auth.component", "../../vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-options.component", "../../vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-auth-email.component", "../../vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts"],
  ["@bitwarden/auth/angular/two-factor-auth/two-factor-auth-authenticator.component", "../../vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts"],
  ["@bitwarden/auth/angular/new-device-verification/new-device-verification.component", "../../vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts"],
  ["@bitwarden/key-management-ui/lock/components/lock.component", "../../vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts"],
  ["@bitwarden/key-management-ui/lock/components/master-password-lock/master-password-lock.component", "../../vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts"],
  ["@bitwarden/official-auth-popup/account-switching/current-account.component", "../../vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts"],
] as const;
const officialVaultAliases = [
  ["@bitwarden/official-vault-popup/vault-header.component", "./src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts"],
  ["@bitwarden/official-vault-popup/new-item-dropdown.component", "./src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts"],
  ["@bitwarden/vault", "./src/app/vault/official-vault-boundary.ts"],
  ["@bitwarden/common/vault/services/search.service", "./src/app/upstream-overlays/vault-main/browser-src/common/vault/services/search.service.ts"],
  ["@bitwarden/common/vault/services/restricted-item-types.service", "./src/app/vault/retained-restricted-item-types.service.ts"],
] as const;
function exactAliasPattern(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

export default defineConfig({
  root: "apps/menubar-tauri",
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
      ...buildOfficialLoginFormAliases(fileURLToPath(new URL("../..", import.meta.url))),
      ...buildOfficialPersonalDetailAliases(fileURLToPath(new URL("../..", import.meta.url))),
      ...buildOfficialPersonalFormAliases(fileURLToPath(new URL("../..", import.meta.url))),
      ...buildOfficialRecoveryAliases(fileURLToPath(new URL("../..", import.meta.url))),
      ...buildOfficialGeneratorAliases(fileURLToPath(new URL("../..", import.meta.url))),
      ...buildOfficialSendAliases(fileURLToPath(new URL("../..", import.meta.url))),
      ...buildOfficialSettingsAliases(fileURLToPath(new URL("../..", import.meta.url))),
      {
        find: /^@bitwarden\/sdk-internal\/bitwarden_wasm_internal_bg\.wasm$/,
        replacement: retainedSdkWasm,
      },
      {
        find: /^@bitwarden\/state$/,
        replacement: fileURLToPath(new URL("./src/app/official-ui/official-state-types.adapter.ts", import.meta.url)),
      },
      {
        find: /^@bitwarden\/state-internal$/,
        replacement: fileURLToPath(new URL("./src/app/official-ui/official-state-internal.adapter.ts", import.meta.url)),
      },
      ...(!evidenceEnabled
        ? [
            {
              find: /^\.\/evidence\/evidence-providers$/,
              replacement: fileURLToPath(
                new URL("./src/app/evidence/evidence-providers.production.ts", import.meta.url),
              ),
            },
            {
              find: /^(?:\.\/recovery-workflow-evidence|\.\.\/evidence\/recovery-workflow-evidence)$/,
              replacement: fileURLToPath(
                new URL("./src/app/evidence/recovery-workflow-evidence.production.ts", import.meta.url),
              ),
            },
            {
              find: /^\.\/vault\/vault-main-evidence-preview$/,
              replacement: fileURLToPath(
                new URL("./src/app/vault/vault-main-evidence-preview.production.ts", import.meta.url),
              ),
            },
            {
              find: /^\.\/send\/send-evidence-preview$/,
              replacement: fileURLToPath(
                new URL("./src/app/send/send-evidence-preview.production.ts", import.meta.url),
              ),
            },
            {
              find: /^\.\/settings\/settings-evidence-preview$/,
              replacement: fileURLToPath(
                new URL(
                  "./src/app/settings/settings-evidence-preview.production.ts",
                  import.meta.url,
                ),
              ),
            },
            {
              find: /^\.\/auth\/auth-evidence-preview$/,
              replacement: fileURLToPath(
                new URL("./src/app/auth/auth-evidence-preview.production.ts", import.meta.url),
              ),
            },
          ]
        : []),
      {
        find: "ngx-toastr/toastr",
        replacement: fileURLToPath(new URL("./src/styles/official-toastr.css", import.meta.url)),
      },
      {
        find: "~@bitwarden/components/src/webfonts/inter.woff2",
        replacement: fileURLToPath(
          new URL("../../vendor/bitwarden-clients/libs/components/src/webfonts/inter.woff2", import.meta.url),
        ),
      },
      {
        find: "~@bitwarden/angular/src/scss/bwicons/fonts",
        replacement: fileURLToPath(
          new URL(
            "../../vendor/bitwarden-clients/libs/angular/src/scss/bwicons/fonts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/client-type",
        replacement: fileURLToPath(
          new URL("../../vendor/bitwarden-clients/libs/client-type/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/components",
        replacement: fileURLToPath(
          new URL("./official-components-overlay", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/browser-popup/components/popup-focus-wrap.directive",
        replacement: fileURLToPath(
          new URL(
            "../../vendor/bitwarden-clients/apps/browser/src/platform/popup/components/popup-focus-wrap.directive.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/browser-popup/components/pop-out.component",
        replacement: fileURLToPath(
          new URL("./src/app/upstream-overlays/pop-out/pop-out.component.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/browser-popup/layout/popup-page.component",
        replacement: fileURLToPath(
          new URL(
            "../../vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-page.component.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/browser-popup/layout/popup-header.component",
        replacement: fileURLToPath(
          new URL("./src/app/upstream-overlays/popup-header/popup-header.component.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/browser-popup/layout/popup-footer.component",
        replacement: fileURLToPath(
          new URL(
            "../../vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-footer.component.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@bitwarden/logging",
        replacement: fileURLToPath(
          new URL("./src/app/official-ui/official-logging.adapter.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/angular/jslib.module",
        replacement: fileURLToPath(
          new URL("./src/app/upstream-overlays/popup-header/jslib.module.adapter.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/assets/svg",
        replacement: fileURLToPath(
          new URL("../../vendor/bitwarden-clients/libs/assets/src/svg/index.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/assets",
        replacement: fileURLToPath(
          new URL("../../vendor/bitwarden-clients/libs/assets/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/common/platform/misc/utils",
        replacement: fileURLToPath(
          new URL("./src/app/official-ui/official-common-utils.adapter.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/common",
        replacement: fileURLToPath(
          new URL("../../vendor/bitwarden-clients/libs/common/src", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/ui-common",
        replacement: fileURLToPath(
          new URL("./src/app/official-ui/official-ui-common.ts", import.meta.url),
        ),
      },
      {
        find: "@bitwarden/platform",
        replacement: fileURLToPath(
          new URL("./src/app/official-ui/official-platform.adapter.ts", import.meta.url),
        ),
      },
    ],
    preserveSymlinks: true,
  },
  plugins: [
    enforceProductionRuntimeClosurePlugin(),
    buildOfficialGeneratorInternalBoundaryPlugin(fileURLToPath(new URL("../..", import.meta.url))),
    angular({
      tsconfig: fileURLToPath(new URL("./tsconfig.app.json", import.meta.url)),
    }),
  ],
  build: {
    emptyOutDir: true,
    outDir: "dist",
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
