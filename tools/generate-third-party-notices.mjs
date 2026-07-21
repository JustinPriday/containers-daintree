import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(projectRoot, "package-lock.json");
const outputPath = path.join(projectRoot, "THIRD_PARTY_NOTICES.md");
const checkOnly = process.argv.includes("--check");

const lock = JSON.parse(await readFile(lockPath, "utf8"));
const packages = lock.packages ?? {};
const root = packages[""];

if (!root?.dependencies) {
  throw new Error("package-lock.json does not contain root production dependencies");
}

function parentPackageKey(packageKey) {
  const marker = packageKey.lastIndexOf("/node_modules/");
  return marker >= 0 ? packageKey.slice(0, marker) : "";
}

function resolveDependencyKey(parentKey, dependencyName) {
  let searchFrom = parentKey;
  while (true) {
    const candidate = searchFrom
      ? `${searchFrom}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!searchFrom) return null;
    searchFrom = parentPackageKey(searchFrom);
  }
}

const queue = Object.keys(root.dependencies).map((name) => {
  const key = resolveDependencyKey("", name);
  if (!key) throw new Error(`Production dependency is missing from package-lock.json: ${name}`);
  return key;
});
const dependencyKeys = new Set();

while (queue.length > 0) {
  const key = queue.shift();
  if (dependencyKeys.has(key)) continue;
  dependencyKeys.add(key);
  const entry = packages[key];
  const children = { ...entry.dependencies, ...entry.optionalDependencies };
  for (const name of Object.keys(children)) {
    const childKey = resolveDependencyKey(key, name);
    if (childKey) queue.push(childKey);
  }
}

async function existingLicenseFiles(packageDir) {
  const entries = await readdir(packageDir);
  return entries
    .filter((entry) => /^(license|licence|copying|notice)([._-]|$)/i.test(entry))
    .sort((a, b) => a.localeCompare(b));
}

function fallbackLicense(manifest) {
  if (manifest.license !== "ISC") return null;
  const author =
    typeof manifest.author === "string"
      ? manifest.author
      : manifest.author?.name ?? manifest.name;
  return {
    filename: "LICENSE (reconstructed from the package's ISC declaration)",
    text: `Copyright (c) ${author}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  };
}

function repositoryUrl(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.url === "string") return value.url;
  return null;
}

function normalizeLicenseText(value) {
  return value.replace(/\r\n?/g, "\n").trim();
}

const records = [];
for (const key of dependencyKeys) {
  const packageDir = path.join(projectRoot, key);
  const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  const licenseFiles = await existingLicenseFiles(packageDir);
  const fallback = fallbackLicense(manifest);
  if (licenseFiles.length === 0 && !fallback) {
    throw new Error(`No license or notice file found for ${manifest.name}@${manifest.version}`);
  }
  records.push({
    name: manifest.name,
    version: manifest.version,
    declaredLicense:
      manifest.license ??
      manifest.licenses?.map((license) => license.type).filter(Boolean).join(" OR ") ??
      "See included license text",
    source: repositoryUrl(manifest.repository) ?? manifest.homepage ?? null,
    files:
      licenseFiles.length > 0
        ? await Promise.all(
            licenseFiles.map(async (filename) => ({
              filename,
              text: normalizeLicenseText(
                await readFile(path.join(packageDir, filename), "utf8")
              ),
            }))
          )
        : [fallback],
  });
}

records.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const lines = [
  "# Third-Party Notices",
  "",
  "Containers for Daintree includes the following third-party software in its compiled distribution.",
  "The project license does not replace the licenses reproduced below.",
  "",
  "> This file is generated from the installed production dependency tree by",
  "> `npm run licenses`. Do not edit it manually.",
  "",
];

for (const record of records) {
  lines.push(`## ${record.name} ${record.version}`, "", `Declared license: ${record.declaredLicense}`);
  if (record.source) lines.push(`Source: ${record.source}`);
  lines.push("");
  for (const file of record.files) {
    lines.push(`### ${file.filename}`, "", "```text", file.text, "```", "");
  }
}

const generated = `${lines.join("\n").trimEnd()}\n`;

if (checkOnly) {
  try {
    await access(outputPath);
  } catch {
    throw new Error("THIRD_PARTY_NOTICES.md is missing; run npm run licenses");
  }
  const current = await readFile(outputPath, "utf8");
  if (current !== generated) {
    throw new Error("THIRD_PARTY_NOTICES.md is stale; run npm run licenses");
  }
  console.log(`Verified THIRD_PARTY_NOTICES.md (${records.length} packages)`);
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(`Wrote THIRD_PARTY_NOTICES.md (${records.length} packages)`);
}
