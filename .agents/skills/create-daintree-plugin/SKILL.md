---
name: create-daintree-plugin
description: Design, scaffold, implement, test, package, review, or diagnose third-party Daintree plugins, including project-local apps, contextual agent MCP tools, databases, settings views, tours, document packages, and Daintree compatibility migrations.
---

# Create Daintree Plugin

Build against the target host's public plugin contract. Choose installed or project scope deliberately, validate every worker/view/agent boundary, and verify the exact distributed artifact on the supported host versions.

Guidance `2.1.1` is source-audited against Daintree `0.41.0` and a separately pinned development snapshot. The skill-local [documentation-version.json](documentation-version.json) records both; [Documentation Version Policy](references/version-policy.md) gives feature floors and package caveats. This source audit does not claim production acceptance.

## Discover the actual target

1. Read the repository instructions, manifest, package/build configuration, entry points, tests, and relevant existing documentation.
2. Record target Daintree version, release/source commit, plugin origin, host `PLUGIN_UI_VERSION`, import-map exports, and the installed authoring packages' resolved versions and exports. A matching app version string is insufficient for a development build.
3. Compare the target schema, SDK API report, tests and production consumers with canonical `docs/plugins/`. Prefer runtime/source and schema over documentation examples when they disagree.
4. Read [Framework Contract](references/framework-contract.md) for manifest, scope, authority and data design. Read [Panels and Transport](references/panels-and-transport.md) and [UI Kit and Icons](references/ui-kit-and-icons.md) for visual plugins; [Performance and Diagnostics](references/performance-and-diagnostics.md) for live data or measured slowness; [MCP and Agent Tooling](references/mcp-and-agent-tooling.md) for agent integrations; [Testing and Release](references/testing-and-release.md) for validation and distribution.
5. For migrations, inventory the plugin's used APIs and manifest fields before raising its minimum version. Classify each change as required repair, optional adoption, or unavailable on the supported release.

`engines.daintree` is advisory from 0.38.0: an out-of-range plugin still loads with a warning. New manifest keys can still fail an older strict schema before activation, and missing APIs can still fail at runtime. Use a truthful feature-derived lower bound, conditional API use where feasible, and explicit unsupported-host diagnostics. Avoid caret ranges for Daintree 0.x: `^0.39.0` excludes 0.40.0. An upper bound is a tested support policy, not a host-enforced block.

Published npm packages and the app are independent versions. At this audit npm latest is 0.1.0 and lacks several workspace APIs, including `/data`, `/plugin-ui`, `/view-globals`, new hooks, databases, PDF export and custom settings views. The shipped host kit is 1.0.0, independent of app 0.41.0 and package 0.1.0. New CLI lint is not in published 0.1.0. Inspect the actual installed declarations and exports. Use a matching workspace build or packed package for missing build-time support; do not assume `npm install ...@latest` supplies current source APIs. Do not silently rewrite user dependencies or release versions.

## Select scope and plugin shape

- Installed plugin: app-wide user tool, distributed as `.dntr`. Its worker is global; active-project APIs are not bound to the project that invoked an agent tool.
- Project plugin: `scope: "project"`, under `<projectRoot>/.daintree/plugins/<manifestId>/`, distributed with committed runtime output. It loads only in its owning project after project trust. Build locally, commit source and `dist/` together; the host never compiles or installs dependencies.
- Command: imperative `registerAction()` from `activate()`. Installed plugins also support compiled `src/<commandId>.js`/`.mjs` convention handlers; project plugins do not.
- Visual tool/app: panel/view plus worker, or a project-only `surfaces.emptyCanvas` claim.
- Data app: declared `host.db` database or revision-checked files; human views and agent tools share one documented data model.
- Terminal-agent tools: declared `agentMcp` plus `host.mcp.registerTools`; declared databases add host read-only tools. `mcpServers` is a different direction, consumed by Daintree and its in-app Assistant, never terminal agents.
- Installed-only additions: recipes, tours, skills, agent identities, process-tool detection and app-wide contributions. Check the complete project restrictions in the framework reference.

Bind panels to durable project/worktree/resource identity using validated `initialArgs`. Use `host.pluginInfo` and `host.panelKindId(bareId)` instead of constructing instance IDs or qualified panel kinds. Renderer `pluginId` is a runtime instance identifier, not always the manifest name.

## Develop and reload

Keep package and manifest versions equal and unchanged during ordinary iteration.

- Installed plugin: `daintree-plugin dev` validates, builds, creates the marked development symlink, and watches artifacts. A real installed directory is left untouched; uninstall it explicitly if moving to a dev link. Keep `.dev-marker` ignored.
- Project plugin: build/watch in place, not `daintree-plugin dev`. The host watches `plugin.json` and `dist/`, not `src/`; use `doctor --offline` and verify a fresh checkout contains the build.
- From 0.35.0, installed dev reload reconciles the whole settled artifact: manifest, contributions, worker and a fresh renderer generation. Open panels remount automatically. The old worker-only reload workaround belongs only to older hosts.
- Production replacement install also mints a new view generation; same-version install is valid for production-path checks. Use a new plugin SemVer for an actual release or upgrade test.
- `requestReload()` and `host.reloadPanel(panelId)` (0.38.0) remount a view, not replace its cached module or restart the worker. Report unsaved changes through the supported prop before offering reload.
- Browser-global registrations survive generation replacement. Use retained document packages for an editor/library that requires stable class or custom-element identity; see the panel reference. Window reload resets that lifetime.

## Design the public contract

Declare the minimum host, contribution IDs, action references, capabilities/scopes, runtime entries, versioned binding/state, typed channels, targeted event shapes, database schema/migrations, resource owners and teardown. Define peak stream volume and recovery behavior for a live integration.

Use `showInPalette: false` for context-required panels. Resolve explicit context before dispatching `panel.openPluginPanel` with the host-qualified kind, stable `initialArgs`, owning worktree and reuse policy. Never silently retarget restored content to current foreground focus.

Registrations and subscriptions belong in fast `activate(host)`; queries and lifetime operations can run later. Await asynchronous registrations. Defer writes, consent-gated DB opens, process spawn and expensive connection work until needed: an unanswered prompt outlasts the activation budget. Return idempotent cleanup and release resources on every failed startup path.

Worker handlers receive `(context, args)`, actions receive `(args)`, agent tools receive `(args, caller, signal)`. Context and caller are distinct contracts. Validate inputs, results, resource ownership and revision preconditions. Use targeted `postToPanel(..., panelId)` for per-instance events; batch and sequence sustained output with bounded history and snapshot recovery. `useHostChannel` suppresses stale hook results but still sends every call; serialize ordered mutations.

From 0.41.0 handler invokes default to five-minute deadlines, with per-handler `timeoutMs` and 0 to opt out; args/results/push payloads cap at 4/16/1 MiB. Timeout does not interrupt work: make retries safe. Pushes batch in order but have no acknowledgement/replay or ordering against invoke replies. Subscribe then pull with revisions. Prefer synced collections for worker-owned lists, cached/selector hooks for queries, stream buffers for appended events, and shared clocks/visibility-aware animation. Listener hints may skip only recoverable production work. Bursty host subscriptions coalesce at 100 ms by default; use `debounceMs: 0` when every transition matters.

Prefer host APIs and actions, then structured worker libraries, then supervised processes. `pipe` is output-only, `duplex` has writable stdin and separated stdout/stderr, `pty` merges output and supports resize. Frame protocol chunks yourself and do not assume write acknowledgement/backpressure or complete trailing output on child exit.

## Views, settings and documents

Build controls, forms, lists, settings, overlays and feedback with host `@daintreehq/plugin-ui` first; it is a host module, not an npm runtime package. Types come from matching SDK `/plugin-ui`. Use custom token-styled content where the kit lacks the surface. Render the body; Daintree owns pane chrome. Use host semantic Tailwind utilities, container queries and `min-h-0`/`min-w-0` scroll ancestors. The host compiles and scopes utilities at runtime; do not ship another Tailwind compiler/preflight. Prefer kit `Portal`; raw portals need `styleRootAttributes` on their container. Await `whenPluginUiReady()` when testing or measuring kit output; Markdown loads separately. Use namespace imports and feature detection when supporting older facades that lack new named exports. Stock colours, `dark:`, `prose` and `@apply` are not the plugin styling contract.

Before styling, read the target `docs/plugins/views.md` Styling section, `docs/plugins/ui-kit.md` Theme section and `src/styles/design-contract.css`; use exact documented token names, not remembered or invented aliases. Neutral pane/toolbars/controls use surface/text/border roles, activity and errors use their matching roles, and category/brand hue stays in meaningful content or the icon. A tokenized blue background is still the wrong role for neutral chrome. Do not hide a missing core token behind a fixed dark fallback. Check literal CSS references with `audit_plugin.mjs --host-root <target>`. Accept visual integration only after switching the same mounted view dark → Bondi → dark, checking all meaningful states, overlays and readability; record a pending check if not exercised. Bondi's terminal palette is intentionally dark: only actual terminal/ANSI content uses that paired palette. See [UI Kit and Icons](references/ui-kit-and-icons.md) for role mapping and theme-switch acceptance.

Use separate Node/browser builds and `@daintreehq/plugin-vite` where a build is needed. Externalize only host-mapped React/React DOM, tour and plugin-UI specifiers; bundle SDK hooks in views. Raw ESM views can use host-served `@daintreehq/plugin-sdk/react` hooks from 0.41.0 or `window.electron.plugin`. The raw import map does not serve SDK root/files/data or arbitrary npm imports; ship relative ESM and no uncompiled JSX. Built views keep bundling their pinned SDK hooks. Zero-build workers can use the host-served SDK root, `/files` and `/data` on 0.39.0, but not `/react` or `/testing`.

View icon props accept kit names, any Lucide kebab-case name, or a custom element; avoid bundling lucide-react. Manifest chrome uses generic icon IDs or bundled lowercase `./…svg` assets, not arbitrary Lucide view names. From 0.41.0 a view panel may declare up to three own-action header buttons. Use `usePanelToolbarItem` for status and `useActionRunning` for handler runs; keep resource-specific operation ownership in the worker and body fallbacks where no header setter exists.

View ownership: `disposeSignal` ends one mount attempt, `panelRemovedSignal` ends a panel record. Use `createViewScope` (0.38.0) for adopted listeners/timers/observers/workers and asynchronous continuations; unregistered resources remain your responsibility. Worker panel sessions survive hiding/backgrounding/trashing when intended and release on lifecycle `removed` plus plugin unload. Persist panel UI through `persistState` and versioned `stateVersion`, not module globals.

Keep settings in their host-provided home. From 0.39.0 declare at most one `location: "settings"` view with its own ID; it has no paired panel. Mark fields `editor: "view"` to move their editor there, use `required` and `missingRequired()` for setup, and `settings.open(key?)` for navigation. Validate worker writes yourself; declaration types do not validate `settings.set` values. Secrets are declared string secret settings, never storage/DB values; a missing keychain rejects saving, and project secrets route to machine-local storage.

Use host `Markdown` from `@daintreehq/plugin-ui` (types via SDK `/plugin-ui`) for document rendering. Use `host.documents.renderPdf` for contained HTML export: fully rendered HTML, bundled/local assets, no JavaScript or network, existing destination parent, write capability/consent and bounded concurrency. Handle coded errors without retrying refused permissions from a timer.

## Agent tools and project targeting

From 0.41.0 installed plugins can observe all open projects with `agents.listAll()`/`onDidChangeAllAgents()` behind `agent:read`; project plugins remain local. Handle degraded snapshots and heuristic observed states. Agent events carry optional terminal/workspace attribution. `terminals.readScreen()` separately requires `terminal:read` plus consent, returns current-screen text only, and has line/byte/rate caps. Global discovery does not widen `sendToAgent` or bind active-context APIs to an MCP caller.

Read the MCP reference before coding. Declare `mcp:expose` and one `agentMcp` endpoint, register its bounded schema-validated roster during activation, and enforce data ownership using `caller.projectId`. Caller fields are credential provenance, not proof of agent identity; there is no host-provided worktree or panel ID in this caller. Pass the cancellation signal onward and keep results compact.

Access is Off by default, Read only for automatic database tools, Read and write for your tools too. The MCP listener must run; supported CLI launches receive endpoints only after access is granted. Agents already launched need relaunch for a newly added server. Unchanged declared agent surfaces can keep credentials across reloads; changed capabilities/scopes/endpoint/databases/`mcpName`, other unloads or lowered access revoke them. Do not modify user-owned CLI configuration.

Installed-plugin databases are shared across projects, and their automatic database tools do not row-filter by caller project. If that is inappropriate, avoid declaring the shared database for automatic exposure and offer project-filtered custom tools over another store, or use project-local plugins. Merely adding filtered custom tools does not remove automatic raw database reads.

Explicit `host.dispatch(..., { projectId })` for an installed plugin is released in 0.41.0. It requires `project:dispatch` and the user's off-by-default Allow project targeting switch. It never opens a missing project view and does not widen action authority. A project plugin stays bound to its own project. Do not substitute foreground dispatch when explicit targeting is unavailable; see the version policy.

## Validate and deliver

Run the skill's version check against the target checkout, then the plugin's meaningful static/unit checks, strict target manifest validation, production build and supplemental `audit_plugin.mjs`. Run matching target CLI `lint` when available, reviewing its heuristics and Styles findings; report it unavailable with published 0.1.0. Inspect Performance measurements under representative load, not as proof of causation. Use current SDK `/testing` for mock-host tests and understand its omissions; it does not prove trust, consent, worker IPC, real SQLite/PDF rendering or agent reachability.

For installed release candidates, stage runtime artifacts only, inspect a verbose packaging dry-run and the archive (including nested panel-toolbar SVGs, which the audited packager omits from its required-file check), then accept the exact `.dntr` on the minimum and newest supported production hosts. Project plugins need a fresh-checkout/trusted-project test instead of packaging. Include scope isolation, multi-panel lifecycle, settings/secrets, permissions, data conflicts, reload, agent discovery/call/revocation and OS-specific behavior as relevant. Never claim production acceptance from unit tests or source review.

Run only user-authorized Daintree E2E specs or buckets. Do not change host implementation just to make a plugin work unless the user asks for that host change. This task's authorization may explicitly include host work; the skill adds no approval gate of its own.

For host gaps, read [Known Boundaries](references/known-boundaries.md), try the supported portal, trace its consumer, and report a generic reproduction, measured requirement, source evidence and smallest needed host addition. Keep framework gaps separate from plugin product specs; put requested audit/spec documentation in the project's prescribed AI-doc folder.
