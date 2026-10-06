import { cp, copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "plugin.json"), "utf8"),
);
const legalFiles = ["LICENSE", "THIRD_PARTY_NOTICES.md"];
const outputDir = path.join(
  projectRoot,
  "build",
  "install",
  `${manifest.name}-${manifest.version}`,
);

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "dist"), { recursive: true });
await cp(path.join(projectRoot, "icons"), path.join(outputDir, "icons"), {
  recursive: true,
});
await copyFile(
  path.join(projectRoot, "plugin.json"),
  path.join(outputDir, "plugin.json"),
);
await Promise.all(
  legalFiles.map((entry) =>
    copyFile(path.join(projectRoot, entry), path.join(outputDir, entry)),
  ),
);

const runtimeBundles = (await readdir(path.join(projectRoot, "dist"))).filter(
  (entry) => entry.endsWith(".js"),
);
await Promise.all(
  runtimeBundles.map((entry) =>
    copyFile(
      path.join(projectRoot, "dist", entry),
      path.join(outputDir, "dist", entry),
    ),
  ),
);

console.log(`Staged directory install at ${outputDir}`);
