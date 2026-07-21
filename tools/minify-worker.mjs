import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(projectRoot, "dist");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "plugin.json"), "utf8"));
const panelEntry = path.basename(manifest.contributes.views[0].componentPath);
const workerEntries = (await readdir(distDir)).filter(
  (entry) => entry.endsWith(".js") && entry !== panelEntry
);

for (const entry of workerEntries) {
  const workerPath = path.join(distDir, entry);
  const input = await readFile(workerPath, "utf8");
  const result = await transform(input, {
    format: "esm",
    target: "node18",
    minify: true,
    legalComments: "none",
    sourcemap: false,
    sourcefile: entry,
  });
  await writeFile(workerPath, result.code, "utf8");
  console.log(`Minified ${entry} from ${input.length} bytes to ${result.code.length} bytes.`);
}

const oversized = [];
for (const entry of workerEntries) {
  const size = (await readFile(path.join(distDir, entry))).byteLength;
  if (size > 512 * 1024) oversized.push(`${entry} (${size} bytes)`);
}
if (oversized.length > 0) {
  throw new Error(`Worker runtime entries exceed 512 KiB: ${oversized.join(", ")}`);
}
