import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const publish = args.includes("--publish");
const forcePrerelease = args.includes("--prerelease");
const skipChecks = args.includes("--skip-checks");
const notesIndex = args.indexOf("--notes-file");
const notesFile = notesIndex >= 0 ? args[notesIndex + 1] : null;

if (args.includes("--help")) {
  console.log(`Usage: npm run release -- [options]

Creates and uploads a GitHub Release for the version in package.json and plugin.json.
Releases are drafts by default so they can be reviewed before publication.

Options:
  --notes-file <path>  Use Markdown release notes from a file
  --prerelease         Mark the GitHub Release as a prerelease
  --publish            Publish immediately instead of creating a draft
  --skip-checks        Reuse an existing archive without running release:prepare
  --help               Show this help
`);
  process.exit(0);
}

if (notesIndex >= 0 && !notesFile) {
  throw new Error("--notes-file requires a path");
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  })?.trim();
}

function capture(command, commandArgs) {
  return run(command, commandArgs, { capture: true });
}

function tryCapture(command, commandArgs) {
  try {
    return capture(command, commandArgs);
  } catch {
    return null;
  }
}

function requireCleanAndPushedCommit() {
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error("The worktree is not clean. Commit or stash changes before releasing.");
  }
  const origin = tryCapture("git", ["remote", "get-url", "origin"]);
  if (!origin) throw new Error("Git remote 'origin' is not configured.");

  const upstream = tryCapture("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (!upstream) throw new Error("The current branch does not have an upstream branch.");
  const [behind, ahead] = capture("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"])
    .split(/\s+/)
    .map(Number);
  if (behind !== 0 || ahead !== 0) {
    throw new Error(`The current branch must match its upstream (behind ${behind}, ahead ${ahead}).`);
  }
}

const packageManifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
const pluginManifest = JSON.parse(await readFile(path.join(projectRoot, "plugin.json"), "utf8"));
const versions = new Set([
  packageManifest.version,
  packageLock.version,
  packageLock.packages?.[""]?.version,
  pluginManifest.version,
]);
if (versions.size !== 1) {
  throw new Error(
    "Version mismatch across package.json, package-lock.json, and plugin.json; run npm run version:set -- <version>"
  );
}

const version = packageManifest.version;
const tag = `v${version}`;
const archive = `${pluginManifest.name}-${version}.dntr`;
const archivePath = path.join(projectRoot, archive);
const checksumPath = `${archivePath}.sha256`;
const panelPaths = (pluginManifest.contributes?.views ?? []).map((view) => view.componentPath);
if (panelPaths.some((componentPath) => componentPath?.includes("panel-") && !componentPath.includes(version))) {
  throw new Error("A versioned panel componentPath does not match the manifest version.");
}

requireCleanAndPushedCommit();
capture("gh", ["auth", "status", "--hostname", "github.com"]);

if (!skipChecks) run("npm", ["run", "release:prepare"]);
await access(archivePath);
await access(checksumPath);

const tagCommit = tryCapture("git", ["rev-list", "-n", "1", tag]);
const headCommit = capture("git", ["rev-parse", "HEAD"]);
if (tagCommit && tagCommit !== headCommit) {
  throw new Error(`${tag} already points to a different commit (${tagCommit}).`);
}

if (tryCapture("gh", ["release", "view", tag])) {
  throw new Error(`GitHub Release ${tag} already exists.`);
}

if (!tagCommit) run("git", ["tag", "--annotate", tag, "--message", `Containers ${version}`]);
run("git", ["push", "origin", tag]);

const releaseArgs = [
  "release",
  "create",
  tag,
  archivePath,
  checksumPath,
  "--verify-tag",
  "--title",
  `Containers ${version}`,
];
if (!publish) releaseArgs.push("--draft");
if (forcePrerelease || version.includes("-")) releaseArgs.push("--prerelease");
if (notesFile) releaseArgs.push("--notes-file", path.resolve(projectRoot, notesFile));
else releaseArgs.push("--generate-notes");

run("gh", releaseArgs);
console.log(
  publish
    ? `Published ${tag} with ${archive} and its checksum`
    : `Created draft ${tag} with ${archive} and its checksum. Review it on GitHub, then publish it.`
);
