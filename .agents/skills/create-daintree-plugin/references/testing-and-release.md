# Testing and Release

## Development verification

Keep `package.json.version` and `plugin.json.version` equal but unchanged during the edit loop. Use `daintree-plugin dev` for a plugin with `main`; use same-version package/install for a plugin without `main` or when intentionally checking the production loader. Never bump SemVer merely to reload edited code.

Before starting a dev link, uninstall a real installed copy occupying the plugin ID. Let the CLI own the symlink and `.dev-marker`, keep the marker ignored by Git, and stop the dev command cleanly when testing ends. Since 0.35.0 settled dev artifacts reconcile manifest, contributions, worker and renderer generation together. No manual disable/enable or Force Reload is normally needed. A view-only remount is different: it does not update the cached module.

Run focused static and unit checks throughout development. Perform release packaging and the full production acceptance matrix only when the implementation is ready for a release candidate, while retaining same-version production-path checks when they are useful.

## Static gate

Require:

- typecheck;
- strict manifest validation;
- `package.json.version === plugin.json.version`;
- manifest `main` and every view `componentPath` exist after build;
- paired panel/view IDs, with a separate unpaired settings-view ID when declared;
- valid fully-qualified action references;
- compatible `engines.daintree`; and
- renderer output free of bundled React.
- every `processTools[].command` canonical, unique within the manifest, and non-conflicting with reserved built-in tools, agents, shells, wrappers, and exec subcommands.

Run matching target CLI `lint` when available; published 0.1.0 lacks it. Review heuristics and Styles findings, and capture representative Performance observations. Run `node <skill>/scripts/audit_plugin.mjs <plugin-root>` after building. Optional `--host-root <daintree-root>` checks literal host CSS references against the target contract; it does not validate token roles, dynamic names, computed paint or theme-switch behavior. Optional `--archive-files <json>` takes a JSON array of packaged POSIX paths to check all custom icon refs, including nested toolbar refs; `--sdk-root <installed-sdk>` inspects used export entries in that actual artifact. Treat warnings as review prompts and failures as release blockers.

## Worker tests

Use `@daintreehq/plugin-sdk/testing` or a faithful mock host. The former separate `@daintreehq/plugin-testing` package is no longer the authoring entry. The published mock may lag current source APIs; inspect its actual declarations. Cover:

- fast successful activation;
- action/handler registration;
- cleanup after successful activation;
- schema failures;
- worktree ambiguity and stable binding;
- restored stale binding rejection;
- `disposeSignal` versus `panelRemovedSignal` behavior;
- worker lifecycle replay and terminal `removed` cleanup;
- target-specific operations;
- per-panel session isolation;
- batching, byte/record limits, and sequence order;
- connection loss and retry;
- no stream/process/socket leakage after disposal; and
- capability failures.

For managed-process plugins, cover pipe `onData`, immediate-output replay, panel targeting, PTY input/resize, restart, cancellation, and safe environment construction. For `processTools`, cover alias matching, extension stripping expectations, icon fallback warnings, unload/reclassification, cross-plugin precedence, and pty-host restart synchronization. For MCP plugins, cover intended-agent reachability, clean stdio, lazy discovery, compact schemas/results, annotations, consent/pinning, rate limits, crash/manual restart, and setting-token restart.

## Renderer policy tests

Extract pure functions for:

- event reduction and bounded history;
- filtering;
- status and identity labels;
- sequence-gap detection;
- live-follow pause/resume decisions; and
- formatting copied/exported content.

Exercise loading, empty, offline, degraded, busy, success, and error states. If UI automation exists, test focusable controls and narrow/short panel layouts.

## Build gate

A panel plugin normally needs:

1. clean `dist`;
2. renderer build;
3. renderer React-bundle audit;
4. worker build without deleting renderer output; and
5. runtime entry audit.

If Daintree's dev tool watches one Vite config, use a second explicit watcher for the worker.

## Clean packaging

Do not package the repository root blindly. Create a temporary staging directory and copy only:

- `plugin.json`;
- required `dist/*.js`; and
- intentionally required runtime assets.

Run the standard Daintree packager in the staging directory. Run `--dry-run --verbose` first and inspect every path. Exclude source maps unless deliberately required for distributed diagnostics.

Keep `.dntr` files out of Git. Attach the exact accepted archive to the release.

## Production acceptance matrix

Install in the production Daintree version named by the compatibility range and verify:

- Plugin Manager identity/version/settings;
- palette command and toolbar/menu entry;
- context resolution and panel binding;
- native header, focus, Cmd/Ctrl+W, close, drag/reorder, maximize/restore;
- narrow and short layouts;
- empty and real target projects;
- multiple independent panel instances;
- destructive-operation confirmation and correct target identity;
- sustained live output, pause/resume, resize anchoring, reconnect;
- update from the previous version without stale renderer code;
- restart and saved-layout restoration;
- late plugin activation recovering a saved plugin panel without close/reopen;
- disable/uninstall cleanup; and
- supported OS-specific integration.

Choose a new SemVer before this matrix only when evaluating an actual release candidate or a real upgrade from the previous published version. A same-version replacement remains valid for non-release production-path verification.

## Production diagnostics

Capture facts before changing code:

- Daintree version/build and operating system;
- installed and attempted plugin versions;
- plugin manager state;
- manifest and built entry names;
- renderer message/stack and worker log;
- exact archive file list and relevant generic entry sizes;
- result after panel reopen, Force Reload, and full restart;
- whether delete/install differs from replacement; and
- whether a minimal generic fixture reproduces it.

Do not give another team private archives or paths as required reproduction steps. Reduce host problems to generated fixtures or a small public sample.

## Common failure signatures

| Failure | Likely cause |
| --- | --- |
| React named export missing | Incompatible/bundled React module |
| `process is not defined` in panel | Node/CommonJS React branch in browser bundle |
| Old view after production update on 0.30.1 | Host failed to mint/reconcile a new view generation; collect the effective `plugin://.../__dtv-*` URL |
| Restored panel stays “Plugin unavailable” after activation | Host panel-kind re-registration failed to recover saved state; collect a generic saved-layout reproduction |
| Old view during dev on 0.35+ | Check settled artifact fingerprint, view generation and reload diagnostics; source-only edits do not reload and remount alone cannot update a module |
| Command entry does nothing | Missing lazy handler or failed activation/action registration |
| Panel has no context | Generic palette opened a context-required panel |
| Panel receives another instance's events | Broadcast rather than targeted push |
| Live following pauses during resize | Passive layout scroll treated as user scroll |
| Settings tabs empty | No settings/content contributed, or host version UI limitation |
| Install spinner never finishes | Host archive/installer issue; collect generic fixture and boundary evidence |

Force Reload is a useful renderer recovery control. It is not the desired routine install/update path.

## Release record

Record:

- plugin version and commit;
- minimum tested Daintree version;
- supported operating systems;
- archive checksum;
- archive contents review;
- automated check results;
- production acceptance result; and
- known host boundaries or direct Node authority.

## Compatibility and new-surface acceptance

Read the version policy, verify actual SDK/preset/CLI exports and build against matching artifacts. Run the skill-local version helper; it does not prove runtime acceptance. `audit_plugin.mjs` is supplemental and does not implement the strict host schema or prove a compatible engine range. Always validate against the actual minimum target's schema too; a current CLI can accept fields an older host refuses. A successful runtime API guard cannot repair a manifest rejected before activation.

Project plugins need `doctor --offline`, index/ignore checks and a fresh committed checkout, not a `.dntr`. Doctor inspects current files/index and does not prove committed bytes are fresh. Test trust disabled/session/persistent, new-ID staging, scope isolation, branch artifact reload, missing plugin recovery, owner-bound roots and settings. Never change trust settings merely to make a test pass without user authorization.

Select relevant additional checks:

- Agent tools: real supported CLI launch after access grant, Off/read-only/read-write, listener-off behavior, caller-project isolation, invalid args/results, cancellation, output-after-mutation errors, schema limits, whole-roster rejection and revocation. Verify unchanged reload keeps credentials and changed declarations/naming revokes; test unsupported CLI fallback separately.
- Databases: lazy consent, readonly missing-file path, appended migrations and too-new schema, definitions, rollback, external replacement, bigint transport, backup/journal refusals, direct sqlite3 invariants and installed shared-row exposure.
- Settings: declaration scope/default/type-write distinctions, disk replacement without change events, required setup, form versus view ownership, stopped-plugin behavior, deep link, no-keychain rejection and project-secret routing.
- Documents: retained adapter concurrent/reload identity, exact hash conflicts and window-reload recovery, per-panel editor state, disposed async mounts, packaged asset inclusion, real PDF output/local assets/network refusal plus busy/timeout/unload paths.
- Theme integration: check exact token names against target docs/design-contract, then exercise dark → Bondi → dark on the same mounted view without reload. Inspect root/toolbars/inputs/tabs/status/content/popovers/loading/errors/disabled/focus/narrow layouts, and live canvas repaint. Neutral chrome must follow workbench surfaces; terminal output can intentionally stay dark only with its matching terminal foreground/ANSI palette. Valid token names and passing lint do not establish correct semantic roles or runtime contrast. Record source-only review or pending visual checks explicitly.
- Kit/transport: namespace detection on old hosts, kit readiness (Markdown separate), nested overlay/focus/Portal ownership, cache reset between tests, snapshot/delta revisions and restart gaps, lossless bounded buffers versus latest-value throttling, caps/uncloneable data, timeout after mutation, listener-hint races and opt-out coalescing. Mock hosts do not enforce transport caps/deadlines.
- Icons/headers: package SVG bytes in every slot including nested header buttons, malformed/missing/escaping icons, monochrome rendering, header action namespace/max-count/PTY refusal, running handlers from every trigger, reload/reset/stale setters and no-header body fallback. The audited packager required-file check omits nested toolbar SVGs; inspect dry-run/archive contents explicitly.
- Observation/bulk reads: local versus all-project discovery, project scope refusal, degraded/unknown fleet, event attribution, terminal read consent/blank/exited/not-found/unavailable/respawn/rate/bytes, ordered per-file errors, walk truncation and symlink scope.
- Views: semantic styling, theme/motion changes, marked portals, persisted state migration, unsaved reload confirmation, own-action menu context and custom settings view teardown.
- Tours/recipes: installed-origin validation, runtime module/audio assets, timing and tour preview, declared own-panel binding and host launch/confirmation rules.
- Project dispatch (released 0.41.0): denied declaration/switch, permitted background target, missing view failure, project-bound escape refusal, timeout without blind retry and persisted permission-save failure. Run against 0.41.0 or a separately validated newer target; 0.40.0 lacks it.

Mocks omit manifest trust/permission UI, real renderer dispatch and worker IPC, actual SQLite replacement/locking, real PDF rendering and CLI endpoint injection. State what was source-reviewed, unit-tested and production-tested separately. Daintree E2E runs only when the user explicitly names a spec or bucket; do not launch a broad suite for a skill/documentation update.
