# Performance and Diagnostics

Use this reference for live data, large views or measured slowness. Canonical `docs/plugins/patterns.md`, `host-api.md`, `views.md` and `dev-loop.md` provide matching target examples. The APIs below first ship in 0.41.0; actual bundled SDK/CLI artifacts must contain them.

## Select the data path

| Workload | Pattern |
| --- | --- |
| Infrequent explicit action | useHostChannel; serialize ordered mutations |
| Repeated read across mounts | useCachedHostChannel; shared in-flight requests, cached-first paint, explicit stale/error state |
| One slice of a pushed snapshot | usePluginEventSelector/useHostStore with equality |
| Latest progress/status | useThrottledCallback; intermediate values intentionally replaced |
| Appended logs/events | useStreamBuffer; bounded items, batches and dropped count |
| Worker-owned keyed collection | Await createSyncedCollection in activate; useSyncedCollection in view |
| Hundreds of rows | useProgressiveList |
| Thousands of rows | useVirtualList or kit VirtualList/DataTable |
| Relative times | useNow; shared per-interval timer that pauses for hidden/cached views |
| Canvas/simulation | useAnimationFrame with visibility/disposal handling |
| Heavy editor/dialog/tab | lazyWithPreload/usePreloadOnIntent |

useHostChannel ignores superseded results but still performs every request. Throttling is not lossless; a stream buffer is lossless only within its configured history bound. useCachedHostChannel supports one or multiple invalidateOn channels, with default 100 ms debounce; resetHostChannelCache between tests because its cache is module-global. Its 50-entry target may be exceeded by mounted/in-flight entries. Preserve cached data alongside refresh errors rather than showing stale data as fresh.

createSyncedCollection registers a snapshot handler asynchronously: await it during activation. Default flush 16 ms and delta budget 512 KiB. It splits updates across revisions, sends resync for an oversized item, recovers gaps and worker epochs, and avoids production while no consumer has pulled/listens. Snapshot responses still fit the 16 MiB invoke cap; page an oversized model. flush waits for the first post attempt, not delivery/retries; no acknowledgement or replay is created.

## Bounds and event semantics

Invokes: five-minute default deadline, per-handler timeoutMs, zero disables. Timeout rejects without interrupting work; make retries safe. Actions have no handler deadline. Structured-clone estimates cap arguments/results/pushes at 4/16/1 MiB and report timeout/oversize/uncloneable errors.

Push batching preserves every event and order across channels/plugins, splitting batches above 256 entries/1 MiB. Targeted pushes route to panel owners within scope. Host effects flush earlier pushes, but invoke replies are not ordered with pushes. Subscribe before pulling and compare revisions. Unmounted/new subscribers get no replay.

hasListeners/onDidChangeListeners are producer hints with conservative true defaults; they never filter transport delivery. Only pause work recoverable from a later pull. The hint can race a newly mounted subscriber; never skip a one-off event on it. Workers watch at most 256 channels before erring toward true.

Worktree, active-worktree and agent subscriptions coalesce by default at 100 ms; zero opts out. Nonzero windows clamp to 50–60,000 ms, with continuous bursts delivered at least every four windows. Worktree change IDs are relative to the previous delivered snapshot; per-terminal agent callbacks may omit intermediate states. DB self/external changes coalesce over 50 ms with external origin winning a mixed window.

Bulk reads use fs.readFiles (1,024 paths, 8 MiB content, ordered per-entry errors) and fs.walk (bounded depth/entries/bytes/examined/glob tests). Check truncation, omitted unreadable directories and per-file TOO_LARGE/RESULT_TOO_LARGE. Neither bypasses read capabilities or containment.

## Measure and diagnose

Settings → Plugins → Performance and Styles, dev CLI metrics and renderer DevTools expose host observations. `shared/config/pluginBudgets.ts` defines observational budgets:

| Metric                    | Budget           |
| ------------------------- | ---------------- |
| Activation                | 500 ms           |
| View load / first paint   | 300 / 500 ms     |
| p95 React commit / invoke | 16 / 250 ms      |
| Sustained pushes          | 60/s and 1 MiB/s |
| Worker RSS                | 256 MiB          |

These do not throttle/block a plugin and a plugin overlapping a long frame did not necessarily cause it. Capture representative steady-state and opening/reload behavior with exact host/SDK/build versions; do not present upstream timings as your measurements. Clear test cache and settle kit loading before asserting rendered output. For hidden/cached views confirm timers/animation/subscriptions recover appropriately.

Run matching CLI lint when present: JSON output supports analysis and --strict fails warnings, but warnings remain heuristic review prompts. It detects bundled React, view polling, dropped disposers, whole-state pushes, invalid semantic classes, raw controls/portals, global keys and avoidable bundled icon/editor/grid/dnd libraries. Custom visuals can legitimately need an exception; trace the component and explain the decision instead of suppressing blindly. Published 0.1.0 lacks lint; use a matching workspace CLI or report the missing step. Never pretend current npx latest ran a command it does not ship.

Use the narrowest meaningful plugin checks for a fix, then the required release artifact/acceptance checks. The skill does not authorize a host-wide benchmark, E2E sweep or implementation change. Keep measured host gaps separate from plugin product requirements.
