# Privacy / 隐私说明

Last updated / 最后更新：2026-07-30

## 中文

Barwarden 是在用户 Mac 上运行的独立开源客户端。本项目不运营账户服务，也没有向
Barwarden 运营方发送分析、广告或遥测数据的服务端。

### 本地保存的数据

- 应用的 WebView 本地存储可能保存登录邮箱、当前账户提示、自托管服务器地址、窗口
  大小，以及界面、生成器和剪贴板清理等偏好设置。能访问该 macOS 用户账户或应用
  数据目录的人可能读取这些非加密本地值。
- 登录会话、账户索引、设备标识符、两步登录信任令牌、PIN 解锁材料和生成器历史等
  敏感状态会在相应功能启用时写入 macOS Keychain。发布版使用
  `Barwarden Secure Storage` 钥匙串服务。
- 主密码和两步登录验证码用于完成用户发起的身份验证；项目代码不会故意将它们写入
  日志或遥测服务。

### 剪贴板

复制或粘贴保险库字段时，所选内容会进入 macOS 系统剪贴板。Barwarden 会按照设置的
清理时间尝试清除仍未被替换的剪贴板内容（默认 30 秒，也可关闭或调整）。剪贴板由
操作系统管理，其他具有相应权限的应用可能在清除前读取它。

### 网络通信

Barwarden 会按用户选择连接 Bitwarden 美国区、欧洲区或用户配置的兼容 HTTPS
自托管服务，用于登录、同步、Send 和相关 API 操作。检查更新时，发布版还可能访问
本项目的 GitHub Releases。相关服务运营方、GitHub、Apple、网络提供商和操作系统
可能依据各自政策处理连接元数据；本说明不替代它们的隐私政策。

### 删除本地数据

退出账户会删除该账户的本地会话材料，但部分偏好、账户提示或历史数据可能继续保留。
如需彻底清理，请在退出账户后删除 Barwarden 的应用/WebView 数据，并在 macOS
“钥匙串访问”中删除 `Barwarden Secure Storage`（调试版为 `Barwarden Debug`）
相关项目。删除应用本身不一定删除这些数据。

发现安全问题时，请按 [SECURITY.md](SECURITY.md) 私密报告。请勿在公开 Issue、
日志或截图中提交真实密码、令牌、恢复码、保险库内容或私有服务器地址。

## English

Barwarden is an independent open-source client that runs on the user's Mac.
This project does not operate an account service or a server that receives
analytics, advertising data, or telemetry from Barwarden.

### Data stored locally

- The application's WebView storage may retain the login email, active-account
  hint, self-hosted server URL, window size, and UI, generator, and clipboard
  preferences. A person with access to the macOS account or application data
  directory may be able to read these unencrypted local values.
- Sensitive state such as login sessions, the account index, device identifier,
  two-step-login trust tokens, PIN-unlock material, and generator history is
  stored in macOS Keychain when the corresponding feature is used. Release
  builds use the `Barwarden Secure Storage` Keychain service.
- A master password and two-step-login code are used to complete authentication
  requested by the user. Project code does not intentionally write them to logs
  or a telemetry service.

### Clipboard

Copying or pasting a vault field places the selected value on the macOS system
clipboard. Barwarden attempts to clear the value if it has not been replaced
after the configured interval (30 seconds by default; the interval can be
changed or disabled). The operating system owns the clipboard, and other
authorized applications may read it before it is cleared.

### Network communication

Barwarden communicates with the selected Bitwarden US, Bitwarden EU, or
compatible HTTPS self-hosted service for login, synchronization, Send, and
related API operations. A release build may also contact this project's GitHub
Releases when checking for updates. Service operators, GitHub, Apple, network
providers, and the operating system may process connection metadata under their
own policies; this document does not replace those policies.

### Removing local data

Signing out removes local session material for that account, but some
preferences, account hints, or history may remain. For a complete cleanup, sign
out, remove Barwarden's application/WebView data, and delete entries associated
with `Barwarden Secure Storage` (`Barwarden Debug` for debug builds) in macOS
Keychain Access. Removing the application alone may not remove this data.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
Never place real passwords, tokens, recovery codes, vault content, or private
server addresses in public issues, logs, or screenshots.
