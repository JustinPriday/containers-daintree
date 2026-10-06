# Panels and Transport

## Runtime split

Keep privileged integrations in the worker and interaction/rendering in the view.

```text
view -- typed invoke --> worker handler --> external service
view <-- targeted push -- worker subscription <-- external service
```

Use request/response for snapshots and explicit mutations. Use targeted push for live deltas.

## Typed request/response

Register Zod-backed channels:

```ts
await host.registerHandler(
  "device.select",
  { args: selectArgsSchema, result: selectedDeviceSchema },
  async (_context, args) => selectDevice(args)
);
```

The host validates inputs before the handler and results before returning them. Add channel capability requirements when appropriate.

`useHostChannel` invokes every call. If calls overlap, only the latest one changes `loading`/`error` and can return its result. A superseded invocation finishes its bridge/worker work but resolves to `undefined`; its error is ignored. Therefore:

- use it directly for infrequent user actions;
- debounce replaceable queries;
- serialize ordered mutations;
- use explicit operation IDs for long work; and
- never treat it as an ordered terminal/log stream.

## Targeted push

Push panel-owned events with the instance ID:

```ts
await host.postToPanel("run.output", batch, panelId);
```

Subscribe with a panel-targeted hook/bridge using the same `panelId`. Broadcasting is appropriate only for truly shared state.

Push has no acknowledgement and unmounted panels miss events. Maintain a snapshot endpoint or reconnectable source when correctness depends on recovery.

From 0.41.0 pushes are snapshotted/size-checked at the call, batched per task/renderer without event coalescing, and routed to the panel owner. They retain push order across channels/plugins and flush before related host effects, but have no ordering against invoke replies. Subscribe first then pull, and keep revisions to reject stale snapshots. `hasListeners`/`onDidChangeListeners` are conservative producer hints, never delivery filters; only skip recoverable work. Workers watch at most 256 channels, then err toward listening.

Handler invokes default to five-minute deadlines, with per-handler timeoutMs and 0 to disable. Arguments/results/push payloads cap at 4/16/1 MiB and fail with named errors. Timeout rejects the caller without interrupting the handler; late worker results are dropped. Make mutation retries safe. Actions do not have this handler deadline.

## Sustained output protocol

For logs, stats, tests, or device output:

- one worker-owned upstream session per intended resource owner;
- panel ID and durable binding attached to the session;
- time and byte/record batching;
- global sequence per panel feed;
- bounded renderer history;
- gap detection;
- reconnect/resnapshot command;
- explicit disconnect channel; and
- plugin-wide idempotent cleanup.

Measure peak and sustained messages/bytes per second. If targeted IPC cannot meet the measured load, report the result before requesting a backpressured stream API.

## Binding a contextual panel

Hide a context-required panel from the generic palette. A public action should:

1. resolve the visible worktree/project;
2. let the user choose if ambiguous;
3. create versioned binding arguments;
4. dispatch `panel.openPluginPanel` with `kind`, `worktreeId`, `initialArgs`, and `reuseExisting`;
5. persist any per-panel override; and
6. refresh badge and initial snapshot.

Validate restored bindings against current public worktree snapshots. Do not trust arbitrary renderer arguments to authorize external control.

Model identities separately. Depending on the product, show worktree, package/project root, external project/session, service/process, and selected target/device.

## Native header actions

From 0.41.0 a view panel can declare up to three own actions in `toolbar`, each dispatched with `{ panelId }`. The host draws busy automatically for running handlers, however triggered. `runningActions`/`useActionRunning` supports matching body controls; this is plugin-wide action state, not a per-resource operation lock.

`setToolbarItemState`/`usePanelToolbarItem` sets busy/disabled, tooltip, tone, text, updatedAt and staleAfterMs; each call replaces state, null resets it, and text/tooltip cap at 120 characters. State persists across ordinary view hiding/remounting, resets on reload/close, and stale mount setters do nothing. The setter is absent on surfaces/settings/dialog views, so use the hook's boolean for a body fallback. No arbitrary header UI injection or PTY toolbar is provided. Do not duplicate the host title bar.

## Panel lifecycle

Daintree 0.28+ provides the native header, focus, drag/reorder, maximize, context menu, and close behavior. The plugin view supplies the body.

The worker is plugin-lifetime oriented; authoritative per-panel lifecycle events have existed since the earlier 0.30.1 contract. Combine:

- renderer `disposeSignal` and effect cleanup;
- renderer `panelRemovedSignal` for panel-record-local cleanup;
- `host.onDidChangePanelLifecycle` in the worker for `mounted`, `hidden`, `backgrounded`, `trashed`, `restored`, `removed`, and `render-failed`;
- durable worker sessions keyed by `panelId` and released only on `removed`; and
- final plugin cleanup.

The renderer may unmount for backgrounding or resource pressure and later restore. `disposeSignal` is therefore not deletion. Decide whether external work should stop, pause, or continue, and encode that behavior explicitly. Lifecycle subscription replays current nonterminal state so lazy activation does not miss the opening panel.

A saved panel whose plugin kind is unavailable during initial hydration must recover when the plugin later activates in Daintree 0.30.1. Treat a panel that remains stuck on “Plugin unavailable” until close/reopen as a host regression and capture a generic saved-layout reproduction.

## Layout

For every flex ancestor that contains a scroll area, set `min-height: 0` and usually `min-width: 0`. A dependable scroll child uses:

```css
.scroll-region {
  height: 0;
  min-height: 0;
  flex: 1 1 0;
  overflow: auto;
}
```

Test after adjacent panels are added/removed, maximize/restore, and at narrow/short dimensions.

## Live tail

Do not interpret every scroll event as user intent. Layout changes and programmatic `scrollTop` updates also emit scroll.

Track intent from wheel, touch, pointer, or navigation keys. Only an intentional move away from the bottom should pause following. While following:

- scroll after new content;
- observe viewport resize and re-anchor;
- schedule DOM reads/writes with `requestAnimationFrame`; and
- show an explicit Resume live tail action when paused.

## Renderer build and reload

Use separate Node/browser builds and `@daintreehq/plugin-vite`; it externalizes only mapped host React/ReactDOM, tour and plugin-UI specifiers. Built views bundle their pinned SDK hooks. From 0.41.0 raw views can bare-import host-served SDK `/react`; SDK root/files/data/testing are not renderer import-map entries. Raw views use shipped relative ESM and createElement, not uncompiled JSX. Keep worker dependencies bundled or deliberately shipped. Host runtime Tailwind supplies scoped semantic utilities; the preset rejects another Tailwind compiler/preflight. Use complete class strings, container queries and `styleRootAttributes` on portal roots. For host Markdown import `@daintreehq/plugin-ui`; its types come from the matching SDK `/plugin-ui` entry, not a standalone npm package.

Stable renderer filenames are correct: the host mints `plugin://<authority>/__dtv-<generation>/...` URLs. Since 0.35.0 installed dev reload reconciles manifest, contributions, worker and renderer generation; open panels remount onto new code without disable/enable or Force Reload. Project plugins likewise reload built artifacts in place. Relative imports inherit generation identity; handcrafted absolute plugin URLs do not. Retired ESM modules accumulate until window reload.

`requestReload`/`host.reloadPanel` remount the view (0.38.0), not replace its module or worker. Track unsaved state with `setHasUnsavedChanges`; use `persistState` with `stateVersion` for panel-record UI state. Validate old state and durable bindings before restore. `createViewScope(disposeSignal)` releases resources you adopt and handles late arrivals; it does not track arbitrary listeners you created elsewhere.

## Retained document packages

Read canonical `docs/plugins/document-packages.md` for editor/custom-element/class-identity integrations (0.36.0). Configure `daintreePlugin({ documentPackages: { "@acme/editor": { entry: "src/editor-adapter.ts", version: "1.0.0", scope: "document" } } })` with entries keyed by exact package name and an adapter's version/entry and optional scope; consume the generated `virtual:daintree-document-package/<name>` loader. Keep the entire editor integration graph in the adapter, not also statically imported into a reloadable panel. Confirm exact configuration shape in the matching preset before copying it.

The build emits one self-contained adapter and SHA-256 identity: no CSS/secondary assets or unresolved non-host externals. Default plugin scope shares within one instance; document scope deliberately shares among cooperating plugins in the project document. Exact version and build hash must match. First compatible request selects the module; conflicting builds refuse before evaluation, and failed imports stay latched until window reload. An incompatible retained editor upgrade needs document replacement, not panel remount or reinstall. The descriptor hash is not a runtime integrity verification or sandbox.

Keep per-panel content, undo history, host objects, secrets and listeners out of shared module initialization. Pass text/callbacks into one editor instance per panel, await required element registration, check disposal after async loads, and destroy instances on view disposal. Do not fetch assets relative to a provider authority after it unloads. Browser-global custom-element names can conflict even with plugin scope; use document sharing or separate documents deliberately.

## Settings views

One optional `location: "settings"` view (0.39.0) uses an ID distinct from panel IDs. It receives a per-settings-home panelId for targeted channels, pluginId, settingsContext, styleRootAttributes and lifecycle signals, but that ID names no panel record. It has no worktree/initialArgs/persistState/requestReload contract. Use its settingsContext to identify the settings home, without assuming that context binds an installed worker's active-project APIs. `editor: "view"` moves the declared field editor to this section. Use worker channels for validated settings writes and return status rather than decrypted credentials. Stopped plugins keep generated fields visible but cannot run a custom view; reload retires the previous section and mounts fresh code.

## UI quality

- Use actual buttons, not clickable text.
- Provide accessible labels/tooltips for icon buttons.
- Show disabled and busy states during operations.
- Keep errors local and actionable.
- Supply empty states for no target, disconnected target, and target with no items.
- Show the identity the operation will affect before destructive actions.
- Do not recreate Daintree's native pane title bar inside the view.
