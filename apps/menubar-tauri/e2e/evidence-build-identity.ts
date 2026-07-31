import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep, win32 } from "node:path";

export interface EvidenceBuildIdentity {
  productionBundleTreeSha256: string;
  packageLockSha256: string;
  playwrightVersion: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  architecture: string;
  authorityBrowserName: "Chromium";
  authorityBrowserVersion: string;
  authorityBrowserExecutableSha256: string;
  authorityBrowserRuntimeTreeSha256: string;
  runtimeIdentitySha256: string;
}

export interface EvidenceAuthorityHash {
  fileName: string;
  sha256: string;
}

export function collectEvidenceBuildIdentity(
  repositoryRoot: string,
  authorityBrowserVersion: string,
  authorityBrowserExecutablePath: string,
): EvidenceBuildIdentity {
  const productionBundleTreeSha256 = sha256DirectoryTree(
    join(repositoryRoot, "apps/menubar-tauri/dist"),
  );
  const packageLockSha256 = sha256File(join(repositoryRoot, "package-lock.json"));
  const playwrightPackage = JSON.parse(
    readFileSync(join(repositoryRoot, "node_modules/@playwright/test/package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof playwrightPackage.version !== "string" || playwrightPackage.version.length === 0) {
    throw new Error("Installed Playwright package version is unavailable");
  }

  const runtime = {
    productionBundleTreeSha256,
    packageLockSha256,
    playwrightVersion: playwrightPackage.version,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    authorityBrowserName: "Chromium" as const,
    authorityBrowserVersion,
    authorityBrowserExecutableSha256: sha256File(authorityBrowserExecutablePath),
    authorityBrowserRuntimeTreeSha256: sha256ChromiumRuntimeTree(
      authorityBrowserExecutablePath,
      process.platform,
      authorityBrowserVersion,
    ),
  };
  return {
    ...runtime,
    runtimeIdentitySha256: sha256Canonical(runtime),
  };
}

export function sha256ChromiumRuntimeTree(
  executablePath: string,
  platform: NodeJS.Platform,
  browserVersion: string,
): string {
  return sha256DirectoryTree(
    deriveChromiumRuntimeRoot(executablePath, platform, browserVersion),
  );
}

export function deriveChromiumRuntimeRoot(
  executablePath: string,
  platform: NodeJS.Platform,
  browserVersion: string,
): string {
  if (platform === "win32") return win32.dirname(executablePath);
  if (platform !== "darwin") return dirname(executablePath);

  let candidate = resolve(executablePath);
  while (candidate !== dirname(candidate) && !basename(candidate).endsWith(".app")) {
    candidate = dirname(candidate);
  }
  if (!basename(candidate).endsWith(".app")) {
    throw new Error(`Chromium executable is not inside a macOS app bundle: ${executablePath}`);
  }
  const applicationName = basename(candidate, ".app");
  return join(
    candidate,
    "Contents",
    "Frameworks",
    `${applicationName} Framework.framework`,
    "Versions",
    browserVersion,
  );
}

export function assertEvidenceBuildIdentityUnchanged(
  beforeCapture: EvidenceBuildIdentity,
  beforeCanonicalInstall: EvidenceBuildIdentity,
): void {
  const keys = Object.keys(beforeCapture) as (keyof EvidenceBuildIdentity)[];
  const changed = keys.filter((key) => beforeCapture[key] !== beforeCanonicalInstall[key]);
  const added = Object.keys(beforeCanonicalInstall)
    .filter((key) => !(key in beforeCapture));
  if (changed.length > 0 || added.length > 0) {
    throw new Error(
      `Evidence build identity changed before canonical install: ${[...changed, ...added].join(", ")}`,
    );
  }
}

export function computeEvidenceSetSha256(
  identity: EvidenceBuildIdentity,
  authorities: readonly EvidenceAuthorityHash[],
  schema = "m12-text-send-evidence-set-v1",
): string {
  return sha256Canonical({
    schema,
    runtimeIdentitySha256: identity.runtimeIdentitySha256,
    authorities: [...authorities].sort((left, right) => left.fileName.localeCompare(right.fileName)),
  });
}

export function sha256DirectoryTree(directory: string): string {
  const root = resolve(directory);
  const files = collectRegularFiles(root, root);
  if (files.length === 0) throw new Error(`Evidence build directory is empty: ${directory}`);

  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const relativePath = relative(root, file).split(sep).join("/");
    const contents = readFileSync(file);
    hash.update(`${Buffer.byteLength(relativePath)}:${relativePath}\0${contents.byteLength}:`);
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function collectRegularFiles(root: string, directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) {
      throw new Error(`Evidence build tree contains a symbolic link: ${relative(root, path)}`);
    }
    if (status.isDirectory()) {
      files.push(...collectRegularFiles(root, path));
    } else if (status.isFile()) {
      files.push(path);
    } else {
      throw new Error(`Evidence build tree contains an unsupported entry: ${relative(root, path)}`);
    }
  }
  return files;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
