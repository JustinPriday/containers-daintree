import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8")
);
const pluginManifest = JSON.parse(
  await readFile(path.join(projectRoot, "plugin.json"), "utf8")
);

if (packageManifest.version !== pluginManifest.version) {
  throw new Error("package.json and plugin.json versions do not match");
}

const archiveName = `${pluginManifest.name}-${pluginManifest.version}.dntr`;
const archivePath = path.join(projectRoot, archiveName);
const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
const checksumPath = `${archivePath}.sha256`;

await writeFile(checksumPath, `${digest}  ${archiveName}\n`, "utf8");
console.log(`Wrote ${path.basename(checksumPath)}`);
