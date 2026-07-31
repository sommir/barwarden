const officialBaseConfig = require("./vendor/bitwarden-clients/libs/components/tailwind.config.base.js");

module.exports = {
  ...officialBaseConfig,
  content: [
    "./apps/menubar-tauri/src/**/*.{html,ts}",
    "./vendor/bitwarden-clients/libs/assets/src/svg/**/*.{html,ts}",
    "./vendor/bitwarden-clients/libs/components/src/**/*.{html,ts}",
    "./vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/**/*.{html,ts}",
    "./vendor/bitwarden-clients/libs/vault/src/**/*.{html,ts}",
  ],
};
