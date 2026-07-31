import { readFileSync, writeFileSync } from "node:fs";

export function createReleaseFeed({ version, tag = `v${version}`, repository, artifactName, signature, notes = "", publishedAt = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version) || tag !== `v${version}`) throw new Error("version and tag must match");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) throw new Error("invalid repository");
  if (!artifactName.endsWith(".app.tar.gz") || !signature.trim()) throw new Error("signed updater artifact required");
  return { version, notes, pub_date: publishedAt, platforms: { "darwin-aarch64": { url: `https://github.com/${repository}/releases/download/${tag}/${artifactName}`, signature: signature.trim() } } };
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const [version, repository, artifact, signaturePath, output] = process.argv.slice(2);
  if (!version || !repository || !artifact || !signaturePath || !output) throw new Error("usage: VERSION REPOSITORY ARTIFACT SIGNATURE OUTPUT");
  writeFileSync(output, `${JSON.stringify(createReleaseFeed({ version, repository, artifactName: artifact.split("/").at(-1), signature: readFileSync(signaturePath, "utf8") }), null, 2)}\n`);
}
