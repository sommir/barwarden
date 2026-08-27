# Barwarden

<p align="center">
  <img src="apps/menubar-tauri/src-tauri/icons/icon.png" width="128" alt="Barwarden icon">
</p>

<p align="center">
  Fast access to your Bitwarden-compatible vault, right from the macOS menu bar.
</p>

<p align="center">
  <a href="README.md">中文</a> · English
</p>

## The core experience: the menu bar

Barwarden stays in the menu bar, so you can search your vault, use a credential,
or open the generator without switching to a full desktop app.

<p align="center">
  <img src="docs/assets/barwarden-menubar-en.gif" width="420" alt="Barwarden menu-bar mode demo">
</p>

When you need more room, the same view can pop out into a standalone window
without losing its current state.

<details>
<summary>View standalone-window mode</summary>

<p align="center">
  <img src="docs/assets/barwarden-window-en.gif" width="720" alt="Barwarden standalone-window mode demo">
</p>

</details>

## Server compatibility

Barwarden is a client and does not include a server. You can connect it to:

- The official [Bitwarden](https://bitwarden.com/) cloud service (US/EU), or a
  self-hosted [Bitwarden Server](https://github.com/bitwarden/server).
- A self-hosted [Vaultwarden](https://github.com/dani-garcia/vaultwarden)
  instance, a community-maintained implementation compatible with the Bitwarden
  API.

Self-hosted services must use HTTPS. Actual compatibility depends on the
server's API implementation.

## Highlights

- Stay in the menu bar and quickly open your vault, search items, and use the
  field you need.
- Get AutoFill suggestions for the current app and domain, then fill a username,
  password, or verification code into the previously focused input area.
- Use macOS Password AutoFill, an optional input-field suggestion icon, and
  either copy-only or copy-and-paste fill modes.
- Sign in, unlock, lock, sign out, and synchronize a vault.
- Browse and manage personal vault items; quickly copy or paste a field.
- Generate passwords, passphrases, and usernames.
- Use Text Send, PIN unlock, and Touch ID unlock where macOS supports it.
- Switch to a standalone window when you need a larger workspace.
- Check for and install signature-verified updates from About.

## Install

1. Download a DMG from [Releases](../../releases).
2. Open it and drag `Barwarden.app` to Applications.
3. Launch Barwarden; it remains available from the macOS menu bar.

Use only packages published by this repository. Check the corresponding Release
for its Developer ID signing and Apple notarization status.

## First setup

1. Sign in to a Bitwarden-compatible service. For a self-hosted service, set its
   HTTPS server URL on the sign-in page first.
2. In Barwarden, open Settings > AutoFill, choose a copy mode, and optionally
   enable the input-field suggestion icon.
3. To detect the current app, domain, or previously focused input area, follow
   the in-app prompt and allow Barwarden in System Settings > Privacy & Security
   > Accessibility.
4. To use system Password AutoFill, enable Barwarden in the password or AutoFill
   settings provided by your macOS version. The exact setting name varies by
   macOS version.
5. If Barwarden reports that its background AutoFill service needs attention,
   allow Barwarden AutoFill in System Settings > General > Login Items, then try
   again.
6. Record or clear the global shortcut for opening Barwarden in Settings >
   Keyboard Shortcuts.

Accessibility permission lets Barwarden detect the current app and input area,
then fill a selected field into the previously focused location.

## Documentation

- [Contributing](CONTRIBUTING.md)
- [Privacy](PRIVACY.md)
- [License](LICENSE)
- [Upstream and copyright notices](NOTICE.md)
- [Third-party open-source components](THIRD_PARTY_NOTICES.md)

Barwarden is an independent open-source project. It is not an official
Bitwarden product and is not affiliated with Bitwarden, Inc. Bitwarden-related
trademarks belong to their respective owners; see [NOTICE.md](NOTICE.md).
