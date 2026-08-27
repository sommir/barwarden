import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function computeBundleManifestHash(bundlePath) {
  const root = resolve(bundlePath);
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink()) throw new Error("NATIVE_AUTOFILL_SYMLINK_FORBIDDEN");
  if (!rootMetadata.isDirectory()) throw new Error("NATIVE_AUTOFILL_APP_ARTIFACT_INVALID");

  const entries = [{ path: ".", type: "directory", mode: rootMetadata.mode & 0o7777 }];
  const visit = (path) => {
    for (const name of readdirSync(path).sort()) {
      const child = resolve(path, name);
      const metadata = lstatSync(child);
      const relativePath = relative(root, child).split(sep).join("/");
      if (metadata.isSymbolicLink()) throw new Error("NATIVE_AUTOFILL_SYMLINK_FORBIDDEN");
      if (metadata.isDirectory()) {
        entries.push({ path: relativePath, type: "directory", mode: metadata.mode & 0o7777 });
        visit(child);
      } else if (metadata.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          mode: metadata.mode & 0o7777,
          sha256: sha256(readFileSync(child)),
        });
      } else {
        throw new Error("NATIVE_AUTOFILL_INVENTORY_UNEXPECTED");
      }
    }
  };
  visit(root);
  return sha256(`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 3) throw new Error("NATIVE_AUTOFILL_ARGUMENT_INVALID");
    process.stdout.write(`${computeBundleManifestHash(process.argv[2])}\n`);
  } catch (error) {
    console.error(error?.message?.startsWith("NATIVE_AUTOFILL_") ? error.message : "NATIVE_AUTOFILL_INTERNAL_ERROR");
    process.exit(1);
  }
}
