import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";
const pinnedFiles = new Map([
  ["vendor/bitwarden-clients/tsconfig.base.json", "ab0c5f01701e42ec81f1bb9f03109f236f0d617cfcd9b4d0f21308d2bd0f958f"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/tsconfig.json", "71e9fe857a332eea88403bd7e9c3e03073a4509ec5684b8f642e09722b5f9adc"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts", "c9d704e498be571efda2559c2b45b5aafe0702a309d8dbec2cb3cde8b94ba292"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.html", "fcf21c218089197b85a455966b9c98a8ceecf3c0f6be468251880b1386940cce"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts", "a7fabe8bd6b3ad15c89bc8eb466149cbd772ff2f373f36bf412d55113ee89fac"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.html", "2977d13f6412a4bfc621a2db8ace128e6a94f5e41dd3bd94150ac7d2b9f76332"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts", "8b5ba31f3e52f6a9409097c00447065380249770f132c3732984c052d7868390"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.html", "e6d46ae6bec11d24844a63e01b0d3c5a156e3697035ee66aa57a2c45c9a152f0"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts", "135430d6b059d3e4300b0f44be3c4d10c824670c493e001939cfc3e0bea0093a"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.html", "3e01ed31420c4ca5c77da8ca94a1cb314b1c3f211e04e28ff97246ca71ba8ad2"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts", "7e2e0b41daa1386f9e14ff0b8f337a15224bd3f0636585d1037f7d5206546939"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.html", "1efd6cf34202e02872f62ee18e957a84a5a3f8bd1892bbf01118c3bd48f67aac"],
  ["vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.ts", "135ed3e3f83612bdeb0f03df5db0b4dadddfddd178098b6ae0b40e74d1131bfd"],
  ["vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.html", "71d92f22dbfbfc72db18a85f97d526228b4e31e60609dd4a05c8c2ee48fabdc8"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.ts", "def6a043801b7a02f97c9f7dfc59a4b84732692e9df26489a46a3614a55ffe0b"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.html", "2eef6e1fcc3d03b4685dacff58e9b7afb5204ac62038372f942e21c4b65a28b7"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.ts", "f4eed1dd01f5983b6d961e324b6d18010afcd82962352f501e3bf1ec5b16fd65"],
  ["vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.html", "84f3c4f1a1f8d0288bec387047b7233b9ec039cff39d3b788ab29ee93b1e616e"],
]);

const revision = readFileSync(resolve(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), "utf8").trim();
if (revision !== pinnedRevision) {
  throw new Error(`Pinned Bitwarden revision drift: ${revision}`);
}

for (const [path, expected] of pinnedFiles) {
  const actual = createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
  if (actual !== expected) {
    throw new Error(`Pinned upstream Generator source drift: ${path}`);
  }
}

const upstreamConfig = JSON.parse(
  readFileSync(resolve(root, "apps/menubar-tauri/tsconfig.official-generator-upstream.json"), "utf8"),
);
if (
  upstreamConfig.extends
  !== "../../vendor/bitwarden-clients/libs/tools/generator/components/tsconfig.json"
) {
  throw new Error("Upstream Generator source check no longer extends the official config");
}
if ("strict" in (upstreamConfig.compilerOptions ?? {})) {
  throw new Error("Upstream Generator source check must not relabel the official strict setting");
}

console.log(`Pinned upstream Generator source check passed at ${pinnedRevision}`);
