import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!version || !semver.test(version)) {
  throw new Error("Usage: npm run version:set -- <semver>");
}

async function readJson(filename) {
  return JSON.parse(await readFile(path.join(projectRoot, filename), "utf8"));
}

async function writeJson(filename, value) {
  const target = path.join(projectRoot, filename);
  const temporary = `${target}.version-tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

const packageManifest = await readJson("package.json");
const packageLock = await readJson("package-lock.json");
const pluginManifest = await readJson("plugin.json");
const previousVersion = pluginManifest.version;

packageManifest.version = version;
packageLock.version = version;
if (!packageLock.packages?.[""]) {
  throw new Error("package-lock.json is missing its root package entry");
}
packageLock.packages[""].version = version;
pluginManifest.version = version;

for (const view of pluginManifest.contributes?.views ?? []) {
  if (typeof view.componentPath === "string") {
    view.componentPath = view.componentPath.replace(
      `panel-${previousVersion}.js`,
      `panel-${version}.js`
    );
  }
}

await Promise.all([
  writeJson("package.json", packageManifest),
  writeJson("package-lock.json", packageLock),
  writeJson("plugin.json", pluginManifest),
]);

console.log(`Updated release version from ${previousVersion} to ${version}`);
