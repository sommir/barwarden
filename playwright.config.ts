import { defineConfig } from "@playwright/test";

const deterministicChromiumLaunchOptions = {
  args: [
    "--disable-gpu",
    "--disable-font-subpixel-positioning",
    "--disable-lcd-text",
    "--disable-skia-runtime-opts",
    "--run-all-compositor-stages-before-draw",
  ],
};

export default defineConfig({
  testDir: ".",
  testMatch: ["apps/menubar-tauri/e2e/**/*.spec.ts"],
  testIgnore: [
    "**/live/live-test-protocol.spec.ts",
    "**/live/live-auth-contract.spec.ts",
    "**/live/live-vault-scenarios.spec.ts",
    "**/live/live-text-send-scenarios.spec.ts",
  ],
  reporter: "list",
  forbidOnly: true,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
    viewport: { width: 480, height: 600 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", launchOptions: deterministicChromiumLaunchOptions },
    },
    {
      name: "chromium-read-only",
      testMatch: ["**/official-settings-workflows.spec.ts"],
      use: { browserName: "chromium", launchOptions: deterministicChromiumLaunchOptions },
    },
    {
      name: "webkit-read-only",
      testMatch: ["**/official-settings-workflows.spec.ts"],
      use: { browserName: "webkit" },
    },
    {
      name: "webkit",
      testMatch: [
        "**/official-personal-cipher-workflows.spec.ts",
        "**/official-recovery-workflows.spec.ts",
        "**/official-generator-workflows.spec.ts",
        "**/official-send-workflows.spec.ts",
        "**/installed-ui-regressions.spec.ts",
        "**/m16-release-visual-accessibility.spec.ts",
        "**/macos-ui-visual-accessibility.spec.ts",
        "**/vault-main.spec.ts",
        "**/vault-personal-cipher-workflows.spec.ts",
        "**/vault-folders.spec.ts",
      ],
      use: { browserName: "webkit" },
    },
    {
      name: "webkit-official",
      testMatch: [
        "**/g1-5-task-4.spec.ts",
        "**/generator-account-settings.spec.ts",
        "**/live/official-auth-live.spec.ts",
        "**/official-auth-accounts.spec.ts",
        "**/official-login-workflow.spec.ts",
      ],
      use: { browserName: "webkit" },
    },
    {
      name: "webkit-retained",
      testMatch: [
        "**/official-popup-shell.spec.ts",
        "**/official-vault-main.spec.ts",
        "**/popup-fidelity-phase-2.spec.ts",
        "**/task-2-async-actions-teardown.spec.ts",
        "**/task-3-popup-shell.spec.ts",
        "**/vault-folders.spec.ts",
        "**/vault-login-workflow.spec.ts",
      ],
      use: { browserName: "webkit" },
    },
  ],
  webServer: {
    command: "VITE_BW_VAULT_EVIDENCE=true npm run build:web && VITE_BW_VAULT_EVIDENCE=true npx vite preview --config apps/menubar-tauri/vite.config.ts --host 127.0.0.1 --port 1420 --strictPort",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
