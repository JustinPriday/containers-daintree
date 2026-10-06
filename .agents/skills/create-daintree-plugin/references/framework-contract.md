# Framework Contract

Audited against released Daintree 0.41.0 and the separately pinned development snapshot. Read the version policy for feature floors; verify exact SDK signatures and target schema before using examples.

## Origin, identity and contribution restrictions

Installed plugins belong to the user and are app-wide. Project plugins declare `scope: "project"`, live under the project root's `.daintree/plugins/`, run only after folder trust, and are bound to that project. Worktrees inherit project trust; only the project root is scanned. Returning IDs remain known; newly discovered IDs in a trusted project are staged until activated. Discovery reads manifests while untrusted but executes no runtime code. Trust survives code edits, pulls and branch switches; capability consent and agent access are separate decisions.

Project discovery identifies the manifest name, not the directory name, but name directories after the manifest for tooling. Installed directory names must match the installed ID. Use `host.pluginInfo` for manifest/instance/origin/project identity, and `host.panelKindId()` for qualified kinds. Renderer props supply the runtime instance ID. Use relative asset imports; never hardcode opaque `plugin://` authorities or generation paths.

| Contribution | Installed third-party | Project-local third-party |
| --- | --- | --- |
| Panels, panel/settings views, commands, toolbar, context menus, keybindings, settings | Supported | Scoped to own project |
| Databases | Local only | Project or local, bound to own project |
| agentMcp | Supported, per-project access | Own project only |
| surfaces.emptyCanvas | Refused | Supported; user chooses claimant/stock surface |
| menuItems, agents, skills, recipes, file decorations, processTools, mcpServers, tours | Supported subject to each contract | Refused because their consumer/registry is app-wide |
| forgeProviders | Cannot supply usable worker implementation | Refused |
| fileEditors, previewTools, guestAdapters | Built-in only | Built-in only |
| Themes | No public contribution | No public contribution |

Strict validation rejects unknown fields, invalid origin contributions, duplicates and dangling references. A panel view matches a panel ID. A settings view has its own ID, no paired panel, and at most one exists. Panels may declare up to five menu entries, each a fully qualified own-plugin action dispatched with `{ panelId }`; foreign/built-in actions and PTY-panel menus are refused. Ordinary plugin panels are dockable unless opted out. From 0.41.0 view panels can declare up to three own-action `toolbar` entries, with label/icon/status and `{ panelId }` dispatch; duplicates, foreign actions and PTY-panel entries are refused. Arbitrary injected header UI and third-party PTY view rendering are not public surfaces. Icon IDs in panels/app toolbar/process tools/header entries can reference bundled lowercase `./…svg` files; see the UI-kit reference for containment, bounds and packaging.

Project command handlers register from `main` during activation; the host never reads source or runs a build. Commit runtime output with source, and verify fresh-checkout loadability. Installed convention handlers are compiled `src/<id>.js` or `.mjs`, receiving args only. Prefer manifest-declared actions with imperative handlers for host-aware commands. `requires` narrows derived command danger, grants no authority and must be a subset of manifest capabilities.

Recipes and tours are installed-only. Recipes remain constrained by host launch/consent policy. Tours require scene modules plus valid generated chapter timing/audio and matching panel IDs where used; ship runtime scenes/audio, not raw recordings. Use the canonical tours guide/CLI, host tour/kit/mock-app import-map modules and theme tokens. Do not copy the guide's historical `>=0.38.0` tour example: first released tour support is 0.39.0.

## Lifecycle, authority and context

Contributions register eagerly; worker `main` activation is lazy unless an activation event requests it. Activation is bounded (5 seconds); register and subscribe then, do heavy work later. Every third-party worker is out-of-process and unsandboxed. Capabilities constrain/disclose host-mediated operations; raw Node access bypasses them. Socket scopes remain disclosure-only.

Most reads require declared capabilities without prompting. From 0.41.0 `terminal:read` separately requires first-use consent to read terminal screen text; `agent:read` does not imply it. Host filesystem/Git writes, process spawn and agent input can require first-use capability consent. A refused/timed-out prompt rejects; do not automatically retry it or wait on it in `activate()`. Retain disposers and cleanup every process/watch/timer/stream; failed activation must also release resources.

Worker handler context is `(ctx, args)` with project/worktree/webContents/plugin provenance. Action handlers receive args only. Agent tool caller is a separate launch credential provenance with project/terminal but no worktree/panel field. Do not substitute global active context for either.

Project hosts bind settings/storage/worktree/fs root resolution to the owner. Installed hosts resolve active project/worktree for those APIs at call time, even inside an agent tool or custom settings handler. `settingsContext` does not bind the global worker. Scope multi-project data explicitly, and avoid caller-sensitive active-root operations where no explicit public binding exists. `getWorktreesResult()` distinguishes unavailable/read failure from an empty valid result; `onDidWake()` supports refresh after sleep. View project focus changes are separate from worker global active events.

The installed-project dispatch path, released in 0.41.0, requires `project:dispatch` and Allow project targeting; project hosts cannot escape their binding. Default installed dispatch still follows the foreground project. Dispatch respects action validation/restriction/confirmation and a timeout does not cancel a possible side effect.

## Snapshot delivery and bulk reads

From 0.41.0 worktree/active-worktree/agent subscriptions coalesce by default at 100 ms, with `debounceMs: 0` for every event. Worktree callbacks report net added/removed/changed IDs relative to the previous delivery. Agent events coalesce per terminal, so previousState can name an unseen transition. DB change events coalesce self/external commits over 50 ms, with external origin winning a mixed window and a final delivery on close.

`fs.readFiles` returns ordered per-path success/error for up to 1,024 paths with an 8 MiB total content bound; handle TOO_LARGE/RESULT_TOO_LARGE and batch. `fs.walk` supports globs, gitignore, sizes and truncation: default 10,000/max 50,000 results, depth 64, 8 MiB result, 200,000 examined entries and 1,000,000 glob tests. Symlinks/special files are skipped, unreadable subdirectories can be omitted without truncation. Reuse target checks rather than treating either as unlimited traversal. Both retain scoped read authority.

## Files and conflict handling

`host.fs` enforces realpath containment and matching read/write capabilities on host calls. `${project}`/`${worktree}` roots fail closed when context is absent. Reads support cancellation and verified file identity; writes serialize per path and recheck containment after consent/queue waits. `writeFile` returns a SHA-256 revision, writes atomically, and accepts `expectedRevision` (null for exclusive create). Conflict errors carry `code` and `currentRevision` through the worker bridge. It is not a lock against an external process writing between the comparison and rename.

Use `readFileWithRevision` or SDK `/data` `editFile` for collaborative edits; apply a transform to fresh contents on a bounded conflict retry, never resubmit stale bytes. `mkdir`, `appendFile`, detailed `readdir` and recursive/debounced/allowMissing watch are public. Append uses append semantics; a partial append can still have written bytes on failure. Watch events are invalidations, not a complete change journal. Avoid recursively watching a whole dependency-filled worktree on Linux.

SDK `/files` supplies listing/git-status helpers; `/data` supplies YAML frontmatter, JSONL, revisions and checked edits. Zero-build workers can use the host SDK fallback on 0.39.0. A broken installed SDK is reported, not masked; an absent export can fall back. Raw views cannot import these bare SDK entries and use worker channels instead.

## Databases and export

Declare every database ID and location. `host.db.open` uses worker-owned `node:sqlite`, bound to one file. Installed databases are local/shared; project databases default to `.daintree/data/<manifestId>/<id>.db`, with project write authority and consent. Local project-plugin DBs are per project and machine. Open lazily; readonly opens never create/migrate and reject missing files. `node:sqlite` support is a runtime requirement (`SQLITE_UNAVAILABLE`/`DB_UNSUPPORTED` where missing).

Append immutable numbered migrations; never edit/reorder shipped ones. Each migrates under a write transaction and bumps SQLite `user_version`; a newer schema refuses to open under an older migration list. Idempotent `definitions` apply when their text/schema hash changes, for views/triggers. `query/get/run/columns` accept one statement, `exec` batches, and calls serialize per handle. Transactions do not coordinate separate handles beyond SQLite locking. `ATTACH`, `DETACH`, `VACUUM INTO`, directory pragmas and extension loading are refused.

Use declared delete journal mode for repository-portable data unless WAL is deliberately handled; WAL sidecars must not be omitted from a live copy. Replacements/deletions reopen under containment checks and emit external change notifications. Integers beyond JavaScript safety are bigint: normalize before JSON/agent transport. Keep relational/business integrity in CHECK constraints and triggers as well as tools, since direct agent sqlite3 sessions need not enable foreign keys.

`backup` produces a consistent staged snapshot, checks destination write authority/consent/containment and refuses source/journal aliases, symlinks and destination sidecars. A host Back up data menu is added for declared DBs; the live file should not be put in a sync folder. Never store credentials in DBs.

`host.documents.renderPdf` accepts exactly inline HTML or contained htmlPath, plus absolute PDF output. It needs a matching write capability and consent, existing output parent and contained local inputs. No scripts or network load; supply complete HTML and local/data assets. Handle bounded render slots, busy/timeout/cancel errors; mock output is only a placeholder. The returned revision interoperates with checked filesystem writes.

## Settings and trust

Declared settings choose user/project/local scope and provide defaults. Explicit scope must agree; `settings.set` enforces declaration/JSON serialization but not type/range/enum. Reads notice file replacement; external edits do not emit `onDidChange`, so re-read on relevant mounts/wake/context changes. `required` tracks explicitly stored values (defaults are not setup), `missingRequired()` and `settings.open()` integrate host setup/navigation.

Secret settings are encrypted strings through a real OS backend; saving refuses when unavailable. Project secrets keep project API scope but reside in local machine storage. Existing plaintext values need user-driven replacement/cleanup; do not copy credentials into documentation or another unencrypted fallback. Private storage remains plaintext. Custom settings views edit declared `editor: "view"` fields through worker channels without returning stored secrets to the renderer.

Installed hashes protect archive integrity/update binding, not publisher identity. Do not treat code trust, filesystem containment, agent access levels, capability consent or adapter hashes as a general sandbox.
