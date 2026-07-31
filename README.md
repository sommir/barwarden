# Barwarden

<p align="center">
  <img src="apps/menubar-tauri/src-tauri/icons/icon.png" width="128" alt="Barwarden logo">
</p>

<p align="center">
  Independent macOS menu-bar client compatible with Bitwarden® services.<br>
  独立的 macOS 菜单栏客户端，兼容 Bitwarden® 服务。
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

> Barwarden is not an official Bitwarden product and is not affiliated with
> Bitwarden, Inc. Bitwarden is a trademark or registered trademark of Bitwarden,
> Inc. in the United States and/or other countries.
>
> Barwarden 不是 Bitwarden 官方产品，也不隶属于 Bitwarden, Inc.；Bitwarden 是
> Bitwarden, Inc. 在美国和/或其他国家/地区的商标或注册商标。

---

<a id="中文"></a>

## 中文

### 这是什么

Barwarden 是一个面向 macOS 菜单栏的开源密码管理客户端。它使用 Tauri 与
Angular 构建，可连接 Bitwarden US、Bitwarden EU 和兼容的 HTTPS 自托管服务。
项目复用了部分 Bitwarden 客户端开源代码，并保留相应的上游许可证、版权和声明。

它适合希望从菜单栏快速访问个人保险库、复制登录信息或生成凭据的用户。Barwarden
是独立项目，不由 Bitwarden 提供支持；有关 Barwarden 的问题请提交到本仓库，而非
Bitwarden 官方支持渠道。

| 项目 | 当前支持 |
| --- | --- |
| 平台 | macOS 13.0（Ventura）及更高版本 |
| 服务 | Bitwarden US、Bitwarden EU、兼容的 HTTPS 自托管服务 |
| 分发 | GitHub Releases 的 DMG；GitHub Actions 构建的签名更新包 |
| 许可证 | [GPL-3.0-only](LICENSE) |

### 主要功能

- 登录、解锁、锁定、退出和保险库同步。
- 浏览、搜索、收藏及更新个人保险库条目；一键复制或粘贴所选字段。
- 密码、通行短语和用户名生成器。
- 文本 Send、常用设置、PIN 解锁，以及 macOS 可用时的 Touch ID 解锁。
- 从“关于”设置中检查更新；发布的更新包由 Tauri 更新签名校验后才会安装。

### 当前边界

Barwarden 不是完整的 Bitwarden 客户端替代品。当前不提供浏览器自动填充、附件、
文件 Send、SSO、导入/导出、组织管理或通行密钥流程。兼容性取决于目标服务端的
API 行为；第三方实现或非 HTTPS 服务不保证可用。

### 安装

1. 在本仓库的 [Releases](../../releases) 页面下载 DMG。
2. 打开 DMG，将 `Barwarden.app` 拖到“应用程序”目录。
3. 从“应用程序”或 Launchpad 启动 Barwarden；它会驻留在菜单栏。
4. 首次启动若被 macOS 拦截，请确认下载页的发布说明、签名状态和 SHA-256 校验值，
   再按系统提示打开。

只信任本仓库 Releases 中的发布包。Developer ID 签名和 Apple notarization 是否完成，
以对应 Release 的明确说明为准；不要把本地构建产物当作已公证的发行包。

### 从源码运行与构建

前提条件：macOS 13+、Node.js 22+、npm、Rust stable 工具链，以及 Xcode Command
Line Tools。

```bash
git clone <your-fork-or-clone-url> barwarden
cd barwarden
npm ci
npm run test:brand
npm run build:web
npm run tauri:dev
```

构建 DMG：

```bash
npm run tauri:build
```

构建输出位于 `apps/menubar-tauri/src-tauri/target/release/bundle/`。这是生成目录，
不得提交到 Git。发布前可运行：

```bash
npm test
npm run verify:macos-bundle
```

### 维护者发布流程

GitHub Actions 在推送 `v*` 标签时构建 Release。标签版本必须与 `package.json` 中的
版本一致；工作流会构建 DMG、Tauri 更新归档、签名文件和 `latest.json` 更新清单。

发布更新需要在仓库 Secrets 中配置：

- `BARWARDEN_UPDATER_PUBKEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE`（base64 编码的 Developer ID Application `.p12`）
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`（App Store Connect API Key ID）
- `APPLE_API_KEY_BASE64`（base64 编码的 API 私钥 `.p8`）

发布 Job 使用名为 `release` 的 GitHub Environment。仓库维护者应为该 Environment
配置必要的审批人和分支/标签保护规则；签名秘密只提供给构建签名产物的步骤。API 私钥
仅在 Runner 临时目录中生成，并在步骤结束时删除。证书、私钥、密码、签名身份及其实际
值均不得提交到仓库。

发布前请确认 CI 全部通过、Release 说明标明支持的 CPU 架构与签名/公证状态，并附上
DMG 的 SHA-256 校验值。工作流会在上传前验证 Developer ID 签名、公证票据和
Gatekeeper 接受状态。

### 许可证、上游与安全

Barwarden 采用 [GNU GPL v3.0 only](LICENSE) 发布。上游来源、版权和许可证说明见
[NOTICE.md](NOTICE.md)；复用的上游源码与原始声明保留在
`vendor/bitwarden-clients`。

数据保存、钥匙串、剪贴板和网络行为见 [PRIVACY.md](PRIVACY.md)。

请勿在 Issue、日志、截图或提交中包含密码、访问令牌、恢复码、私有服务地址或真实
保险库数据。安全漏洞请遵循 [SECURITY.md](SECURITY.md) 的私密披露流程；参与开发请
阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

<a id="english"></a>

## English

### What is Barwarden?

Barwarden is an open-source password-manager client for the macOS menu bar. It
is built with Tauri and Angular and connects to Bitwarden US, Bitwarden EU, and
compatible HTTPS self-hosted services. Selected open-source Bitwarden client
code is reused with its applicable upstream licenses, copyright notices, and
attribution retained.

It is for people who want fast menu-bar access to a personal vault, credential
copying, and credential generation. Barwarden is an independent project and is
not supported by Bitwarden; please report Barwarden issues in this repository,
not through Bitwarden support channels.

| Item | Current support |
| --- | --- |
| Platform | macOS 13.0 (Ventura) or later |
| Services | Bitwarden US, Bitwarden EU, and compatible HTTPS self-hosted services |
| Distribution | DMGs on GitHub Releases; signed update artifacts built by GitHub Actions |
| License | [GPL-3.0-only](LICENSE) |

### Highlights

- Sign in, unlock, lock, sign out, and synchronize a vault.
- Browse, search, favorite, and update personal vault items; copy or paste a
  selected field in one action.
- Password, passphrase, and username generators.
- Text Send, essential settings, PIN unlock, and Touch ID unlock where macOS
  supports it.
- Check for updates from About settings; published updates are verified with the
  Tauri updater signature before installation.

### Current scope

Barwarden is not a full replacement for every Bitwarden client. Browser
autofill, attachments, File Send, SSO, import/export, organization management,
and passkey flows are not currently included. Compatibility depends on the
target server's API behavior; third-party implementations and non-HTTPS
services are not guaranteed to work.

### Install

1. Download a DMG from [Releases](../../releases).
2. Open it and drag `Barwarden.app` to Applications.
3. Launch Barwarden from Applications or Launchpad; it remains available from
   the menu bar.
4. If macOS blocks the first launch, verify the release notes, signing status,
   and SHA-256 checksum before following the system prompt to open it.

Trust only packages published in this repository's Releases. Developer ID
signing and Apple notarization are complete only when the specific release says
so; a local build is not a notarized distribution artifact.

### Run and build from source

Requirements: macOS 13+, Node.js 22+, npm, the Rust stable toolchain, and Xcode
Command Line Tools.

```bash
git clone <your-fork-or-clone-url> barwarden
cd barwarden
npm ci
npm run test:brand
npm run build:web
npm run tauri:dev
```

Build a DMG:

```bash
npm run tauri:build
```

Build output is written to `apps/menubar-tauri/src-tauri/target/release/bundle/`.
It is generated and must not be committed. Before a release, run:

```bash
npm test
npm run verify:macos-bundle
```

### Maintainer release flow

GitHub Actions builds a Release when a `v*` tag is pushed. The tag version must
match `package.json`. The workflow builds a DMG, Tauri updater archive, signature
file, and `latest.json` update feed.

The following repository Secrets are required for signed updates:

- `BARWARDEN_UPDATER_PUBKEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE` (base64-encoded Developer ID Application `.p12`)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY` (App Store Connect API key ID)
- `APPLE_API_KEY_BASE64` (base64-encoded API private key `.p8`)

The release job uses a GitHub Environment named `release`. Repository
maintainers should configure required reviewers and branch or tag protection
rules for that environment. Signing secrets are exposed only to the step that
builds signed artifacts. The API private key is materialized only in the
runner's temporary directory and deleted when the step exits. Certificates,
private keys, passwords, signing identities, and their actual values must never
be committed.

Before publishing, ensure CI passes, state the supported CPU architectures and
signing/notarization status in the release notes, and include a SHA-256 checksum
for each DMG. Before upload, the workflow verifies the Developer ID signature,
stapled notarization ticket, and Gatekeeper acceptance.

### License, upstream, and security

Barwarden is released under [GNU GPL v3.0 only](LICENSE). See [NOTICE.md](NOTICE.md)
for upstream source, copyright, and license attribution. Reused upstream source
and notices are retained in `vendor/bitwarden-clients`.

See [PRIVACY.md](PRIVACY.md) for local storage, Keychain, clipboard, and network
behavior.

Never put passwords, access tokens, recovery codes, private service URLs, or
real vault data in issues, logs, screenshots, or commits. Follow
[SECURITY.md](SECURITY.md) for private vulnerability reporting and
[CONTRIBUTING.md](CONTRIBUTING.md) when contributing.
