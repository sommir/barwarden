# Notices

Barwarden is an independent GPL-3.0-only project. It is not an official
Bitwarden product and is not affiliated with Bitwarden.

## Distribution metadata

- Product name: `Barwarden`
- Bundle identifier: `com.sommir.barwarden`
- Application version: `0.1.0`
- Local bundle targets: macOS application (`app`) and disk image (`dmg`)
- Minimum system version: macOS 13.0
- Root license: GPL-3.0-only; the complete license text is bundled with the application

Local builds are unsigned development artifacts. Developer ID signing and Apple
notarization are separate release gates and must use credentials supplied
outside this repository. No signing, notarization, service, or test credentials
belong in this repository.

## Upstream notices

Barwarden vendors and adapts selected source from the official Bitwarden clients
repository at commit `f47b6946e01aed474875789081966d311d5b8289`.

- Upstream: https://github.com/bitwarden/clients
- Root project license: GPL-3.0-only
- Upstream license and copyright notices: retained under `vendor/bitwarden-clients`

The upstream repository also contains modules under the Bitwarden License v1.0.
This repository does not vendor that module directory; `LICENSE_BITWARDEN.txt` is
retained only as an upstream notice. All currently vendored source files are GPL
v3.0 by default unless a file states otherwise. Local changes should remain
outside the vendor tree where possible; if a vendor change is unavoidable,
preserve its patch and notices.

## Public Suffix List

The native browser matching engine includes a generated form of the Public
Suffix List from revision `e1b8015c3b2f0f4f8c18659c2480fc1a22c07b20`.

- Source: https://publicsuffix.org/list/public_suffix_list.dat
- License: Mozilla Public License 2.0
- Generated resource: `apps/macos-autofill/Agent/DomainMatchRules.json`
