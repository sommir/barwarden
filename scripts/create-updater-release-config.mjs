import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function createReleaseConfig({ baseConfig, endpoint, pubkey }) {
  if (typeof pubkey !== "string" || !pubkey.trim()) {
    throw new Error("A Tauri updater public key is required");
  }
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !/^\/[^/]+\/[^/]+\/releases\/latest\/download\/latest\.json$/u.test(url.pathname)
  ) {
    throw new Error("Updater endpoint must be a GitHub Releases latest.json HTTPS URL");
  }
  return {
    ...baseConfig,
    bundle: { ...baseConfig.bundle, createUpdaterArtifacts: true },
    plugins: {
      ...baseConfig.plugins,
      updater: { pubkey: pubkey.trim(), endpoints: [url.toString()] },
    },
  };
}

function runBuild() {
  const endpoint = process.env.BARWARDEN_UPDATER_ENDPOINT;
  const pubkey = process.env.BARWARDEN_UPDATER_PUBKEY;
  const configPath = "apps/menubar-tauri/src-tauri/tauri.conf.json";
  const config = createReleaseConfig({
    baseConfig: JSON.parse(readFileSync(configPath, "utf8")),
    endpoint,
    pubkey,
  });
  const directory = mkdtempSync(join(tmpdir(), "barwarden-updater-config-"));
  const generatedConfig = join(directory, "tauri.conf.json");
  try {
    writeFileSync(generatedConfig, `${JSON.stringify(config, null, 2)}\n`);
    const result = spawnSync("npx", ["tauri", "build", "--config", generatedConfig], {
      stdio: "inherit",
      env: process.env,
    });
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  runBuild();
}
