import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stageRoot = await mkdtemp(path.join(tmpdir(), "daintree-containers-package-"));
const dryRun = process.argv.includes("--dry-run");
const forwardedArgs = process.argv.slice(2);
const legalFiles = ["LICENSE", "THIRD_PARTY_NOTICES.md"];

async function copyRuntimeFiles() {
  await mkdir(path.join(stageRoot, "dist"), { recursive: true });
  const runtimeBundles = (await readdir(path.join(projectRoot, "dist"))).filter((entry) =>
    entry.endsWith(".js")
  );
  await Promise.all([
    copyFile(path.join(projectRoot, "plugin.json"), path.join(stageRoot, "plugin.json")),
    ...legalFiles.map((entry) =>
      copyFile(path.join(projectRoot, entry), path.join(stageRoot, entry))
    ),
    ...runtimeBundles.map((entry) =>
      copyFile(path.join(projectRoot, "dist", entry), path.join(stageRoot, "dist", entry))
    ),
  ]);
}

async function runPackager() {
  const cliPath = path.join(projectRoot, "node_modules", "daintree-plugin", "dist", "cli.js");
  const args = [cliPath, "package", "--skip-build", ...forwardedArgs];
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: stageRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Packager exited with ${signal ?? `code ${code}`}`));
    });
  });
}

try {
  await copyRuntimeFiles();
  await runPackager();
  if (!dryRun) {
    const archive = (await readdir(stageRoot)).find((entry) => entry.endsWith(".dntr"));
    if (!archive) throw new Error("Packager did not produce a .dntr archive");
    await copyFile(path.join(stageRoot, archive), path.join(projectRoot, archive));
    console.log(`Copied ${archive} to ${projectRoot}`);
  }
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}
