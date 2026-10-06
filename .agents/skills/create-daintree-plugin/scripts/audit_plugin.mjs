#!/usr/bin/env node

import { access, readFile, readdir, stat, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const root = path.resolve(process.argv[2] ?? process.cwd());
const options = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!["--archive-files", "--sdk-root", "--host-root"].includes(key) || !process.argv[i + 1]) {
    throw new Error(
      "Usage: audit_plugin.mjs <plugin-root> [--archive-files <json>] [--sdk-root <sdk-directory>] [--host-root <daintree-directory>]"
    );
  }
  options.set(key, process.argv[i + 1]);
}
const failures = [];
const warnings = [];
const passes = [];
let archiveFiles;
if (options.has("--archive-files")) {
  const list = JSON.parse(await readFile(path.resolve(options.get("--archive-files")), "utf8"));
  if (!Array.isArray(list) || list.some((item) => !safeRelativePath(item))) {
    throw new Error("--archive-files must contain a JSON array of safe plugin-relative paths");
  }
  archiveFiles = new Set(list.map((item) => item.replaceAll("\\", "/").replace(/^\.\//, "")));
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function pass(message) {
  passes.push(message);
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    fail(
      `Cannot read valid ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

function safeRelativePath(candidate) {
  return (
    typeof candidate === "string" &&
    candidate.length > 0 &&
    !path.isAbsolute(candidate) &&
    !candidate.includes("://") &&
    !candidate.split(/[\\/]/).includes("..")
  );
}

async function assertFile(label, relativePath) {
  if (!safeRelativePath(relativePath)) {
    fail(`${label} must be a safe plugin-relative path: ${String(relativePath)}`);
    return false;
  }
  const absolute = path.join(root, relativePath);
  try {
    const metadata = await stat(absolute);
    if (!metadata.isFile()) {
      fail(`${label} is not a file: ${relativePath}`);
      return false;
    }
    pass(`${label} exists: ${relativePath}`);
    return true;
  } catch {
    fail(`${label} does not exist after build: ${relativePath}`);
    return false;
  }
}

function duplicateIds(entries, label) {
  if (!Array.isArray(entries)) return;
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string") continue;
    if (seen.has(entry.id)) fail(`Duplicate ${label} id: ${entry.id}`);
    seen.add(entry.id);
  }
}

const processToolCommandPattern = /^[a-z0-9][a-z0-9._-]*$/;
const processToolExtensionPattern = /\.(?:exe|cmd|bat|com|ps1|m?jsx?|cjs|tsx?|py|rb|php|pl)$/i;
const reservedProcessToolCommands = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "exec",
  "dlx",
  "x",
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ash",
  "ksh",
  "csh",
  "tcsh",
  "nu",
  "pwsh",
  "powershell",
  "cmd",
  "env",
  "sudo",
  "doas",
  "su",
  "command",
  "nohup",
  "setsid",
  "xargs",
  "time",
  "timeout",
  "nice",
  "stdbuf",
]);
const pluginIconIds = new Set([
  "terminal",
  "package",
  "puzzle",
  "globe",
  "monitor",
  "monitor-play",
  "file-text",
  "file-diff",
  "folder-tree",
  "git-branch",
  "git-pull-request",
  "sticky-note",
  "gauge",
  "list",
  "sparkles",
  "layout-panel-top",
  "daintree",
  "wallet",
  "receipt",
  "chart-column",
  "chart-line",
  "chart-pie",
  "calendar",
  "clock",
  "kanban",
  "check-square",
  "list-todo",
  "users",
  "contact",
  "handshake",
  "briefcase",
  "inbox",
  "mail",
  "image",
  "palette",
  "book-open",
  "bookmark",
  "notebook",
  "newspaper",
  "megaphone",
  "target",
  "heart-pulse",
  "flame",
  "dumbbell",
  "utensils",
  "tag",
  "shopping-cart",
  "boxes",
  "database",
  "table",
  "layout-grid",
  "map",
  "star",
  "rocket",
  "lightbulb",
  "flask",
]);

async function checkIcon(label, ref) {
  if (typeof ref !== "string" || ref.length === 0) {
    fail(`${label} must be a non-empty string`);
    return;
  }
  if (!ref.startsWith("./")) {
    if (!pluginIconIds.has(ref))
      warn(
        `${label} '${ref}' is not an audited generic manifest icon; verify the target registry or expect a fallback (view Lucide names are a different namespace)`
      );
    return;
  }
  const segments = ref.slice(2).split("/");
  if (
    ref.length > 64 ||
    ref !== ref.toLowerCase() ||
    !ref.endsWith(".svg") ||
    /[\\?#%:\x00-\x1f\x7f]/.test(ref) ||
    segments.some((part) => ["", ".", ".."].includes(part))
  ) {
    fail(
      `${label} must be a lowercase ./…svg POSIX reference of at most 64 characters, with no traversal or URL syntax`
    );
    return;
  }
  if (await assertFile(label, ref)) {
    const actual = await realpath(path.join(root, ref));
    const relative = path.relative(await realpath(root), actual);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      fail(`${label} resolves outside the plugin directory`);
    else if ((await stat(actual)).size > 64 * 1024)
      fail(`${label} exceeds the 64 KiB SVG asset cap`);
    else
      pass(
        `${label} is contained and within the SVG asset cap; target CLI must validate SVG content`
      );
  }
  if (archiveFiles && !archiveFiles.has(ref.slice(2)))
    fail(`${label} is absent from the archive file list: ${ref}`);
}

async function inspectSdk(sources) {
  const imports = [];
  for (const filename of await readdir(root)) {
    if (/^tsconfig(?:\.[\w-]+)?\.json$/.test(filename)) {
      sources.push(await readFile(path.join(root, filename), "utf8"));
    }
  }
  for (const entry of ["plugin-ui", "view-globals"]) {
    if (sources.some((source) => source.includes(`@daintreehq/plugin-sdk/${entry}`)))
      imports.push({ specifier: `@daintreehq/plugin-sdk/${entry}`, names: [] });
  }
  for (const source of sources) {
    for (const match of source.matchAll(
      /(?:import|export)\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s*["'](@daintreehq\/plugin-sdk(?:\/[a-z-]+)?)["']/g
    )) {
      imports.push({
        specifier: match[2],
        names: match[1].startsWith("{")
          ? match[1]
              .slice(1, -1)
              .split(",")
              .map(
                (item) =>
                  item
                    .trim()
                    .replace(/^type\s+/, "")
                    .split(/\s+as\s+/)[0]
              )
              .filter(Boolean)
          : [],
      });
    }
  }
  if (sources.some((source) => source.includes("@daintreehq/plugin-ui")))
    imports.push({ specifier: "@daintreehq/plugin-sdk/plugin-ui", names: [] });
  if (!imports.length && !options.has("--sdk-root")) return;
  let sdkRoot = options.get("--sdk-root");
  if (!sdkRoot) {
    try {
      let candidate = path.dirname(
        createRequire(path.join(root, "package.json")).resolve("@daintreehq/plugin-sdk")
      );
      while (path.dirname(candidate) !== candidate) {
        try {
          if (
            JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")).name ===
            "@daintreehq/plugin-sdk"
          ) {
            sdkRoot = candidate;
            break;
          }
        } catch {}
        candidate = path.dirname(candidate);
      }
    } catch {}
  }
  if (!sdkRoot) {
    warn(
      "No installed SDK artifact resolved: raw views may use host-served hooks/kit without an SDK, but built views need matching exports/types; use --sdk-root to inspect the actual artifact"
    );
    return;
  }
  try {
    const pkg = JSON.parse(await readFile(path.join(sdkRoot, "package.json"), "utf8"));
    if (pkg.name !== "@daintreehq/plugin-sdk") {
      fail("--sdk-root is not @daintreehq/plugin-sdk");
      return;
    }
    pass(
      `Inspecting SDK artifact ${pkg.version} at ${path.resolve(sdkRoot)}; version label alone does not establish API parity`
    );
    for (const { specifier, names } of imports) {
      const key =
        specifier === "@daintreehq/plugin-sdk"
          ? "."
          : `.${specifier.slice("@daintreehq/plugin-sdk".length)}`;
      const entry = pkg.exports?.[key];
      if (!entry) {
        warn(
          `Installed SDK lacks ${key}; supply matching artifacts/types for a build (host-served raw runtime is separate)`
        );
        continue;
      }
      const target =
        typeof entry === "string" ? entry : (entry.types ?? entry.import ?? entry.default);
      if (typeof target !== "string") {
        warn(`Inspect SDK conditions manually for ${key}`);
        continue;
      }
      const declarations = await readFile(path.join(sdkRoot, target), "utf8");
      for (const name of names)
        if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(declarations))
          warn(
            `SDK ${key} entry does not directly mention ${name}; verify re-exports/declarations before building`
          );
    }
  } catch (error) {
    fail(`Cannot inspect SDK artifact: ${error.message}`);
  }
}

async function inspectThemeTokens(sources) {
  if (!options.has("--host-root")) return;
  const hostRoot = path.resolve(options.get("--host-root"));
  try {
    const contract = await readFile(path.join(hostRoot, "src/styles/design-contract.css"), "utf8");
    const model = await readFile(path.join(hostRoot, "shared/theme/types.ts"), "utf8");
    const keysBlock = model.match(
      /export const APP_THEME_TOKEN_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/
    );
    if (!keysBlock)
      throw new Error(
        "Cannot read target APP_THEME_TOKEN_KEYS; inspect the target token contract manually"
      );
    const known = new Set(
      [...contract.matchAll(/--(?:theme|color)-[a-z0-9-]+/g)].map((match) => match[0])
    );
    for (const match of keysBlock[1].matchAll(/["']([a-z0-9-]+)["']/g))
      known.add(`--theme-${match[1]}`);
    const used = new Set(
      sources.flatMap((source) =>
        [...source.matchAll(/var\(\s*(--(?:theme|color)-[a-z0-9-]+)/g)].map((match) => match[1])
      )
    );
    for (const token of used) {
      if (!known.has(token))
        fail(
          `Unknown host CSS token ${token}: absent from target design contract/token model; a literal fallback can conceal theme-switch failure`
        );
    }
    pass(
      `Checked ${used.size} literal CSS token reference(s) against ${hostRoot}; dynamic references, token roles and runtime contrast still need review`
    );
  } catch (error) {
    fail(`Cannot inspect target theme token contract: ${error.message}`);
  }
}

async function walk(directory) {
  const output = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(absolute)));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

const manifest = await readJson("plugin.json");
const packageJson = await readJson("package.json");

if (manifest) {
  if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(manifest.name ?? "")) {
    fail(`plugin.json name is not a publisher.plugin-name id: ${String(manifest.name)}`);
  } else {
    pass(`Plugin id is scoped: ${manifest.name}`);
  }

  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    fail("plugin.json must contain a version");
  }

  if (!manifest.engines || typeof manifest.engines.daintree !== "string") {
    fail("plugin.json must declare engines.daintree");
  } else {
    pass(`Daintree compatibility is declared: ${manifest.engines.daintree}`);
  }

  if (packageJson?.version !== manifest.version) {
    fail(
      `Version mismatch: package.json=${String(packageJson?.version)} plugin.json=${String(manifest.version)}`
    );
  } else {
    pass(`Package and manifest versions match: ${manifest.version}`);
  }

  if (packageJson?.name !== manifest.name) {
    warn(
      `package.json name (${String(packageJson?.name)}) differs from plugin id (${String(manifest.name)})`
    );
  }

  const contributes = manifest.contributes ?? {};
  for (const [key, entries] of Object.entries(contributes)) duplicateIds(entries, key);

  const processTools = Array.isArray(contributes.processTools) ? contributes.processTools : [];
  const seenProcessToolCommands = new Set();
  for (const [index, tool] of processTools.entries()) {
    const command = tool?.command;
    if (typeof command !== "string" || !processToolCommandPattern.test(command)) {
      fail(`processTools[${index}].command must be a bare lowercase executable name`);
      continue;
    }
    if (seenProcessToolCommands.has(command)) fail(`Duplicate processTools command: ${command}`);
    seenProcessToolCommands.add(command);
    if (reservedProcessToolCommands.has(command))
      fail(`processTools command is a reserved shell, wrapper, or exec token: ${command}`);
    if (processToolExtensionPattern.test(command))
      fail(`processTools command must omit its executable or script extension: ${command}`);
    await checkIcon(`processTools[${index}].iconId`, tool?.iconId);
  }

  const panels = Array.isArray(contributes.panels) ? contributes.panels : [];
  for (const [index, panel] of panels.entries()) {
    await checkIcon(`panels[${index}].iconId`, panel?.iconId);
    if (panel.toolbar !== undefined && !Array.isArray(panel.toolbar)) {
      fail(`panels[${index}].toolbar must be an array`);
      continue;
    }
    const toolbar = panel.toolbar ?? [];
    if (toolbar.length > 3) fail(`panels[${index}].toolbar exceeds three actions`);
    if (panel.hasPty && toolbar.length)
      fail(`panels[${index}].toolbar is unsupported on a PTY panel`);
    const seen = new Set();
    for (const [slot, item] of toolbar.entries()) {
      const id = item?.actionId;
      if (
        typeof id !== "string" ||
        !id.startsWith(`${manifest.name}.`) ||
        id.length <= manifest.name.length + 1
      )
        fail(`panels[${index}].toolbar[${slot}] must reference an own-plugin action`);
      if (seen.has(id)) fail(`panels[${index}].toolbar duplicates action ${id}`);
      seen.add(id);
      if (item?.iconId !== undefined)
        await checkIcon(`panels[${index}].toolbar[${slot}].iconId`, item.iconId);
    }
  }
  for (const [index, item] of (contributes.toolbarButtons ?? []).entries())
    await checkIcon(`toolbarButtons[${index}].iconId`, item?.iconId);
  if (
    panels.some((panel) => panel.toolbar?.length) ||
    manifest.capabilities?.includes("terminal:read")
  )
    warn(
      "Panel toolbar and terminal:read first ship in 0.41.0; verify a feature-derived engine lower bound against the target schema"
    );
  const views = Array.isArray(contributes.views) ? contributes.views : [];
  const panelIds = new Set(panels.map((panel) => panel?.id).filter(Boolean));
  const viewIds = new Set(
    views
      .filter((view) => view?.location === "panel")
      .map((view) => view?.id)
      .filter(Boolean)
  );
  const settingsViews = views.filter((view) => view?.location === "settings");
  if (settingsViews.length > 1) fail("At most one settings view is supported");
  for (const view of settingsViews) {
    if (panelIds.has(view.id))
      fail(`Settings view '${view.id}' must have its own ID, not a panel ID`);
  }
  for (const setting of contributes.settings ?? []) {
    if (setting.editor === "view" && settingsViews.length === 0)
      fail(`Setting '${setting.id}' uses editor:view without a settings view`);
  }
  const origin = manifest.scope === "project" ? "project" : "installed";
  pass(`Plugin origin: ${origin}`);
  if (origin === "project") {
    for (const key of [
      "menuItems",
      "agents",
      "skills",
      "recipes",
      "fileDecorationProviders",
      "processTools",
      "mcpServers",
      "experimental_mcpServers",
      "tours",
      "forgeProviders",
    ]) {
      if (contributes[key]?.length) fail(`Project plugins cannot contribute ${key}`);
    }
    warn(
      "Verify committed runtime artifacts with target CLI doctor --offline and a fresh checkout"
    );
  } else if (Object.values(contributes.surfaces ?? {}).some(Boolean)) {
    fail("Surface claims require project scope");
  }
  for (const key of ["fileEditors", "previewTools", "guestAdapters"]) {
    if (contributes[key]?.length)
      fail(`${key} is built-in-only, unavailable to third-party plugins`);
  }
  if (contributes.forgeProviders?.length)
    warn("Worker plugins cannot implement synchronous forge providers");
  if ((contributes.agentMcp?.length ?? 0) > 1) fail("At most one agentMcp endpoint is supported");
  if (contributes.agentMcp?.length && !manifest.capabilities?.includes("mcp:expose"))
    fail("agentMcp requires mcp:expose");
  for (const db of contributes.databases ?? []) {
    if (origin === "installed" && db.location === "project")
      fail("Installed plugins can only declare local databases");
    if (db.location === "project" && !manifest.capabilities?.includes("fs:project-write"))
      fail(`Project database '${db.id}' requires fs:project-write`);
  }
  if (origin === "installed" && contributes.databases?.length)
    warn(
      "Automatic database agent tools can read every project's rows in an installed shared database"
    );
  if (manifest.capabilities?.includes("project:dispatch"))
    warn(
      "project:dispatch is released in 0.41.0 and needs the user's off-by-default Allow project targeting switch; no foreground fallback"
    );

  for (const id of viewIds) {
    if (!panelIds.has(id)) fail(`View '${id}' has no matching panel contribution`);
  }
  for (const id of panelIds) {
    if (!viewIds.has(id) && !panels.find((panel) => panel?.id === id)?.hasPty) {
      warn(`Panel '${id}' has no matching view contribution`);
    }
  }

  if (typeof manifest.main === "string") await assertFile("Worker main", manifest.main);
  else if (views.length > 0)
    warn("Panel plugin has no worker main; confirm it is intentionally renderer-only");

  const viewFiles = [];
  for (const view of views) {
    if (!["panel", "settings"].includes(view?.location))
      fail(`View '${String(view?.id)}' must use location 'panel' or 'settings'`);
    if (await assertFile(`View '${String(view?.id)}'`, view?.componentPath)) {
      viewFiles.push({ id: view.id, relativePath: view.componentPath });
    }
  }

  for (const tour of contributes.tours ?? []) {
    await assertFile(`Tour '${String(tour?.id)}'`, tour?.componentPath);
    for (const chapter of tour?.chapters ?? []) {
      if (typeof chapter.audioUrl === "string" && !chapter.audioUrl.startsWith("https://"))
        await assertFile(`Tour audio '${String(chapter?.id)}'`, chapter.audioUrl);
    }
  }

  const commands = new Set(
    (Array.isArray(contributes.commands) ? contributes.commands : [])
      .map((command) => command?.id)
      .filter(Boolean)
      .map((id) => `${manifest.name}.${id}`)
  );
  for (const collection of [
    contributes.toolbarButtons,
    contributes.menuItems,
    contributes.contextMenus,
  ]) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      const actionId = entry?.actionId;
      if (typeof actionId !== "string" || actionId.length === 0) {
        fail(`Contribution '${String(entry?.id ?? entry?.label ?? "unknown")}' has no actionId`);
      } else if (actionId.startsWith(`${manifest.name}.`) && !commands.has(actionId)) {
        warn(`Plugin action reference is not manifest-declared as a command: ${actionId}`);
      }
    }
  }

  const forbiddenReact = [
    { pattern: /node_modules\/react\//, label: "bundled React implementation" },
    {
      pattern: /process\.env\.NODE_ENV/,
      label: "React Node/CommonJS environment branch",
    },
  ];
  const externalReact = /\bfrom\s*["']react(?:\/jsx-(?:dev-)?runtime)?["']/;

  const sources = [];
  if (safeRelativePath(manifest.main)) {
    try {
      sources.push(await readFile(path.join(root, manifest.main), "utf8"));
    } catch {}
  }
  for (const sourceFile of await walk(path.join(root, "src"))) {
    if (
      /\.(?:[cm]?[jt]sx?|css)$/.test(sourceFile) &&
      (await stat(sourceFile)).size <= 2 * 1024 * 1024
    )
      sources.push(await readFile(sourceFile, "utf8"));
  }
  for (const viewFile of viewFiles) {
    const source = await readFile(path.join(root, viewFile.relativePath), "utf8");
    sources.push(source);
    if (source.includes("@daintreehq/plugin-sdk/react"))
      pass(
        `View '${viewFile.id}' imports SDK hooks: raw 0.41.0 views may use the host copy; built views must bundle their pinned hooks`
      );
    if (!externalReact.test(source)) {
      warn(`View '${viewFile.id}' has no visible external React import; inspect bundler output`);
    } else {
      pass(`View '${viewFile.id}' retains a host-resolved React import`);
    }
    for (const forbidden of forbiddenReact) {
      if (forbidden.pattern.test(source)) fail(`View '${viewFile.id}' contains ${forbidden.label}`);
    }
  }
  await inspectThemeTokens(sources);
  await inspectSdk(sources);
}

try {
  await access(path.join(root, "dist"));
  const distFiles = await walk(path.join(root, "dist"));
  if (distFiles.some((file) => file.endsWith(".map"))) {
    warn(
      "dist contains source maps; exclude them from release staging unless intentionally distributed"
    );
  }
} catch {
  warn("No dist directory found; run this audit after the production build");
}

warn(
  "Supplemental artifact audit only: run strict validation against each target host schema; this script does not prove engine compatibility or runtime acceptance"
);

for (const message of passes) console.log(`PASS  ${message}`);
for (const message of warnings) console.warn(`WARN  ${message}`);
for (const message of failures) console.error(`FAIL  ${message}`);

console.log(
  `\nAudit summary: ${passes.length} passed, ${warnings.length} warning(s), ${failures.length} failure(s)`
);
process.exitCode = failures.length === 0 ? 0 : 1;
