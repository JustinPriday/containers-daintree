import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const auditor = fileURLToPath(new URL("./audit_plugin.mjs", import.meta.url));
const checker = fileURLToPath(new URL("./check_guidance_version.mjs", import.meta.url));
const hostRoot = fileURLToPath(new URL("../../../../", import.meta.url));

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "daintree-guidance-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "dist"));
  await mkdir(path.join(dir, "icons"));
  const manifest = {
    name: "acme.sample",
    version: "1.0.0",
    engines: { daintree: ">=0.41.0" },
    main: "dist/index.mjs",
    contributes: {
      panels: [
        {
          id: "main",
          iconId: "./icons/panel.svg",
          hasPty: false,
          toolbar: [{ actionId: "acme.sample.refresh", iconId: "./icons/refresh.svg" }],
        },
      ],
      views: [{ id: "main", location: "panel", componentPath: "dist/panel.mjs" }],
    },
  };
  const writeManifest = () => writeFile(path.join(dir, "plugin.json"), JSON.stringify(manifest));
  await writeManifest();
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: manifest.name, version: manifest.version })
  );
  await writeFile(path.join(dir, "dist/index.mjs"), "export function activate() {}\n");
  await writeFile(
    path.join(dir, "dist/panel.mjs"),
    "import React from 'react'; import { useActionRunning } from '@daintreehq/plugin-sdk/react'; export default function Panel() { return null; }\n"
  );
  for (const file of ["panel.svg", "refresh.svg"])
    await writeFile(
      path.join(dir, "icons", file),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h5"/></svg>'
    );
  return {
    dir,
    manifest,
    writeManifest,
    run: (...args) => {
      const result = spawnSync(process.execPath, [auditor, dir, ...args], { encoding: "utf8" });
      return { code: result.status, output: result.stdout + result.stderr };
    },
  };
}

test("valid raw hooks and custom SVG header actions pass without the old fallback warning", async (t) => {
  const f = await fixture(t);
  const r = f.run();
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /host copy/);
  assert.doesNotMatch(r.output, /will fall back to 'terminal'/);
});

test("missing nested toolbar asset fails", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.dir, "icons/refresh.svg"));
  const r = f.run();
  assert.equal(r.code, 1);
  assert.match(r.output, /toolbar\[0\].iconId does not exist/);
});

test("archive list detects a nested toolbar SVG dropped by shipping policy", async (t) => {
  const f = await fixture(t);
  const list = path.join(f.dir, "archive.json");
  await writeFile(
    list,
    JSON.stringify(["plugin.json", "dist/index.mjs", "dist/panel.mjs", "icons/panel.svg"])
  );
  let r = f.run("--archive-files", list);
  assert.equal(r.code, 1);
  assert.match(r.output, /absent from the archive.*refresh.svg/);
  await writeFile(
    list,
    JSON.stringify([
      "plugin.json",
      "dist/index.mjs",
      "dist/panel.mjs",
      "icons/panel.svg",
      "icons/refresh.svg",
    ])
  );
  r = f.run("--archive-files", list);
  assert.equal(r.code, 0, r.output);
});

test("foreign, repeated and PTY header actions fail", async (t) => {
  const f = await fixture(t);
  const p = f.manifest.contributes.panels[0];
  p.hasPty = true;
  p.toolbar = [{ actionId: "other.sample.refresh" }, { actionId: "other.sample.refresh" }];
  await f.writeManifest();
  const r = f.run();
  assert.equal(r.code, 1);
  assert.match(r.output, /own-plugin action/);
  assert.match(r.output, /duplicates action/);
  assert.match(r.output, /PTY panel/);
});

test("too many header actions fail", async (t) => {
  const f = await fixture(t);
  f.manifest.contributes.panels[0].toolbar = Array.from({ length: 4 }, (_, i) => ({
    actionId: `acme.sample.action${i}`,
  }));
  await f.writeManifest();
  const r = f.run();
  assert.equal(r.code, 1);
  assert.match(r.output, /exceeds three/);
});

test("escaping symlink and malformed SVG refs fail", async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(), "daintree-icon-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "icon.svg"), "<svg/>");
  await rm(path.join(f.dir, "icons/refresh.svg"));
  await symlink(path.join(outside, "icon.svg"), path.join(f.dir, "icons/refresh.svg"));
  let r = f.run();
  assert.equal(r.code, 1);
  assert.match(r.output, /resolves outside/);
  f.manifest.contributes.panels[0].toolbar[0].iconId = "./Icons/../escape.svg";
  await f.writeManifest();
  r = f.run();
  assert.equal(r.code, 1);
  assert.match(r.output, /lowercase/);
});

test("oversize SVG fails", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.dir, "icons/refresh.svg"), "x".repeat(65537));
  const r = f.run();
  assert.equal(r.code, 1);
  assert.match(r.output, /64 KiB/);
});

test("project-only contributions are still refused", async (t) => {
  const f = await fixture(t);
  f.manifest.scope = "project";
  f.manifest.contributes.processTools = [{ command: "customtool", iconId: "./icons/panel.svg" }];
  await f.writeManifest();
  const r = f.run();
  assert.equal(r.code, 1);
  assert.match(r.output, /Project plugins cannot contribute processTools/);
});

test("legacy SDK reports missing ambient kit types and newer hooks", async (t) => {
  const f = await fixture(t);
  const sdk = path.join(f.dir, "legacy-sdk");
  await mkdir(sdk);
  await writeFile(
    path.join(sdk, "package.json"),
    JSON.stringify({
      name: "@daintreehq/plugin-sdk",
      version: "0.1.0",
      exports: { "./react": { types: "./react.d.ts" } },
    })
  );
  await writeFile(path.join(sdk, "react.d.ts"), "export declare function useHostChannel(): void;");
  await writeFile(
    path.join(f.dir, "dist/panel.mjs"),
    "import React from 'react'; import { Button } from '@daintreehq/plugin-ui'; import { useActionRunning } from '@daintreehq/plugin-sdk/react';"
  );
  const r = f.run("--sdk-root", sdk);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /does not directly mention useActionRunning/);
  assert.match(r.output, /lacks .\/plugin-ui/);
});

test("metadata checker succeeds without claiming a target was verified", () => {
  const r = spawnSync(process.execPath, [checker], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Metadata and reference coherence checked only/);
});

test("SDK type entries requested in tsconfig are inspected", async (t) => {
  const f = await fixture(t);
  const sdk = path.join(f.dir, "sdk");
  await mkdir(sdk);
  await writeFile(
    path.join(sdk, "package.json"),
    JSON.stringify({ name: "@daintreehq/plugin-sdk", version: "0.1.0", exports: {} })
  );
  await writeFile(
    path.join(f.dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { types: ["@daintreehq/plugin-sdk/view-globals"] } })
  );
  const r = f.run("--sdk-root", sdk);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /lacks .\/view-globals/);
});

test("invented host variables with dark fallbacks are rejected against the actual target", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.dir, "dist/panel.mjs"),
    "import React from 'react'; const css = 'background:var(--theme-bg-primary,#11161b); border-color:var(--theme-border,#667);';"
  );
  const r = f.run("--host-root", hostRoot);
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /Unknown host CSS token --theme-bg-primary/);
  assert.match(r.output, /Unknown host CSS token --theme-border/);
});

test("documented surface and terminal tokens pass target-token inspection", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.dir, "dist/panel.mjs"),
    "import React from 'react'; const css = 'background:var(--theme-surface-panel); color:var(--theme-text-primary); border-color:var(--color-border-default); --log-bg:var(--theme-terminal-background);';"
  );
  const r = f.run("--host-root", hostRoot);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Checked 4 literal CSS token reference/);
  assert.doesNotMatch(r.output, /Unknown host CSS token/);
});
