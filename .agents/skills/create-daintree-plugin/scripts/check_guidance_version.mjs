#!/usr/bin/env node

import { readFile, access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(skillRoot, "documentation-version.json"), "utf8")
);
const { guidanceVersion, daintree, development, pluginUi } = manifest;
if (
  typeof guidanceVersion !== "string" ||
  typeof daintree?.version !== "string" ||
  daintree.tag !== `v${daintree.version}` ||
  !/^[a-f0-9]{40}$/.test(daintree.commit ?? "") ||
  !/^[a-f0-9]{40}$/.test(development?.commit ?? "") ||
  !/^\d+\.\d+\.\d+$/.test(pluginUi?.version ?? "") ||
  pluginUi?.source !== "src/pluginUi/index.ts"
) {
  throw new Error(
    "Skill metadata must record guidance version, exact release/development pins and kit contract"
  );
}
const entry = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
if (!entry.includes(guidanceVersion) || !entry.includes(daintree.version)) {
  throw new Error("SKILL.md disagrees with skill-local version metadata");
}
for (const reference of entry.matchAll(/\]\((references\/[^)]+)\)/g)) {
  await access(path.join(skillRoot, reference[1]));
}
const policy = await readFile(path.join(skillRoot, "references/version-policy.md"), "utf8");
if (
  ![guidanceVersion, daintree.commit, development.commit, pluginUi.version].every((value) =>
    policy.includes(value)
  )
) {
  throw new Error("Version policy disagrees with skill-local metadata");
}

if (process.argv[2]) {
  const target = path.resolve(process.argv[2]);
  const git = (...args) => spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  const resolve = (ref) => {
    const result = git("rev-parse", `${ref}^{commit}`);
    if (result.status !== 0) throw new Error(result.stderr.trim() || `Cannot resolve ${ref}`);
    return result.stdout.trim();
  };
  if (resolve(daintree.tag) !== daintree.commit) {
    throw new Error(`Release tag ${daintree.tag} disagrees with the audit pin`);
  }
  resolve(development.commit);
  const head = resolve("HEAD");
  const pkg = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  if (pkg.version !== daintree.version) {
    throw new Error(
      `Target package version ${pkg.version} differs from audit ${daintree.version}; re-audit required`
    );
  }
  let matched;
  for (const [label, commit] of [
    ["released", daintree.commit],
    ["development", development.commit],
  ]) {
    if (head === commit) {
      matched = label;
      break;
    }
    const ancestor = git("merge-base", "--is-ancestor", commit, "HEAD");
    const sameTree = git(
      "diff",
      "--quiet",
      commit,
      "HEAD",
      "--",
      ".",
      ":(exclude)ai_docs/**",
      ":(exclude)reference/**",
      ":(exclude).agents/skills/**"
    );
    if (ancestor.status === 0 && sameTree.status === 0) {
      matched = `${label} (runtime-tree-equivalent merge)`;
      break;
    }
  }
  if (!matched)
    throw new Error(`Target ${head} is outside the exact audited trees; re-audit required`);
  const kitSource = await readFile(path.join(target, pluginUi.source), "utf8");
  const kitVersion = kitSource.match(/export const PLUGIN_UI_VERSION = ["']([^"']+)["']/)?.[1];
  if (kitVersion !== pluginUi.version)
    throw new Error(
      `Target kit ${kitVersion ?? "unknown"} differs from audited ${pluginUi.version}; re-audit required`
    );
  const clean = git("diff", "--quiet", "HEAD", "--");
  if (clean.status !== 0)
    throw new Error("Tracked target edits differ from audited source; re-audit required");
  console.log(
    `Target matches ${matched} evidence at ${head}; untracked files are outside this source check`
  );
}
console.log(
  `Guidance ${guidanceVersion}: release ${daintree.tag}@${daintree.commit}; development ${development.commit}`
);
console.log(
  process.argv[2]
    ? "Source pins and kit verified (AI docs, reference copies and local skills excluded from merge-tree comparison); this does not prove package availability or production acceptance."
    : "Metadata and reference coherence checked only; pass a target repository to verify source pins and kit. This does not prove package availability or production acceptance."
);
