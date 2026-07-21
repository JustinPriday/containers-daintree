import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "plugin.json"), "utf8"));
const panelPath = path.join(projectRoot, manifest.contributes.views[0].componentPath);
const panelBundle = await readFile(panelPath, "utf8");

const hostReactImport = /\bfrom\s*["']react(?:\/jsx-(?:dev-)?runtime)?["']/;

if (!hostReactImport.test(panelBundle)) {
  throw new Error(
    "The rich panel does not retain an external React import for Daintree's host facade."
  );
}

const forbiddenReactRuntimePatterns = [
  { pattern: /node_modules\/react\//, label: "a bundled React implementation" },
  { pattern: /process\.env\.NODE_ENV/, label: "React's Node/CommonJS environment branch" },
];

for (const { pattern, label } of forbiddenReactRuntimePatterns) {
  if (pattern.test(panelBundle)) {
    throw new Error(`The rich panel contains ${label}; React must come only from Daintree's host facade.`);
  }
}

console.log("Verified rich panel uses only external host React imports for Daintree 0.27+.");
