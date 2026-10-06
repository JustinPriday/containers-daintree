# Known Boundaries

Audited against released Daintree 0.41.0 and the separately pinned development source. Revalidate against the target release before reporting a gap.

## Current boundaries

- Native panel headers accept badges, own-action menus and up to three declarative own-action toolbar buttons with live state; arbitrary injected header UI remains unavailable.
- Targeted postToPanel is fire-and-forget; no general acknowledged stream, worker-to-panel request/response or plugin screenshot API. Use bounded sequences and snapshot recovery.
- Agent tools now exist and receive project/terminal credential provenance, but not host-derived worktree/panel identity or transient renderer state. Validate explicit session ownership.
- Installed declared databases have raw agent read access across all projects' rows. Own filtered tools do not remove automatic DB tools. Read only describes the offered tools, not arbitrary SQL/file sandboxing.
- Installed settings/storage/fs active-context APIs are not bound to an agent caller; settingsContext does not change the global worker. Released 0.41.0 supports explicit installed-plugin project dispatch under project:dispatch plus the user's permission switch; this does not bind other active-context APIs to a caller.
- Terminal agents never receive mcpServers tools. They receive agentMcp/databases only through supported additive launch mechanisms and after access is granted. Existing agents cannot discover a newly added server without relaunch.
- All third-party workers are unsandboxed Node and inline views share the trusted host document. Capabilities, socket disclosure, scope tokens and adapter hashes are not a general security boundary or publisher authentication.
- Retained document adapters pin exact version/hash until document replacement. They solve trusted module identity, not untrusted execution isolation. Reload cannot unregister browser custom elements or upgrade incompatible retained code.
- Forge providers require synchronous routing unavailable over worker IPC. fileEditors, previewTools, guestAdapters are reserved for builtins; manifest presence/types do not grant third-party support. Themes remain unavailable as a public contribution. Custom SVG assets are supported in iconId slots and view icons accept any Lucide name; these are distinct namespaces.
- Process duplex writes are unacknowledged and lack backpressure; trailing output can be lost on child exit. There is no general lossless bulk stdio transport guarantee.
- PDF rendering uses no network or scripts; mock tests never render a real PDF. Local asset admission uses stat size, not a hard bound on bytes from a file that grows after admission.
- engines.daintree mismatch is warning-only on 0.38+. New strict schema fields may still refuse older hosts. A support range must be backed by actual checks.
- Published SDK 0.1.0 lags workspace features. A host fallback cannot fix missing renderer build-time exports. Verify actual package artifacts rather than matching source package version labels.

The audited CLI packager checks top-level SVG refs but omits nested panel-toolbar refs from its required-file check. Validate those icons and explicitly inspect the archive; use the supplemental auditor with --archive-files when a file list is available.

Existing public CSS surface/text/border/overlay/activity tokens cover ordinary workbench chrome. CSS vocabulary is broader than the kit's JavaScript theme-token map; consult both before claiming a missing token. Missing API keys do not make the CSS token unavailable. Report a host gap only after a correct-role minimal reproduction fails on the target; unknown names or fixed-palette fallbacks are plugin defects.

## Resolved historical boundaries

The original guidance's “worker-only dev reload”, “no contextual worker tools” and “plaintext secret fallback” are no longer current. Full artifact reload shipped 0.35.0; contextual agentMcp 0.37.0; schema enforcement, view cleanup/remount and refused plaintext secrets 0.38.0; DB tools/settings/PDF/tours/expanded agent wiring 0.39.0. Keep old behavior only in explicit compatibility sections.

0.41.0 resolves the raw-view SDK hook, custom icon, native declared header button and released project-targeting gaps. It also adds fleet/screen observation, bounded transport, data hooks and diagnostics; none supplies screenshot/RPC/acknowledged stream APIs or widens MCP caller provenance.

Existing earlier features remain: ${project}/${worktree} scoped roots, ordinary panel chrome/docking, lifecycle removed signals, managed pipe/PTY processes, image clipboard and scoped file reveal, processTools, cache-distinct production view URLs and late restored-panel recovery. Historical React/import-map and archive failures must be reproduced on the target rather than carried forward as gaps.

## Reporting a gap

Trace the public API and production consumer, distinguish built-in from third-party support, and produce a minimal generic reproduction with measured lifecycle/context/load requirements. Cite exact release/source evidence and separate a plugin defect from host behavior. Propose the smallest public portal that unblocks the measured need. Do not edit the host or create external issues unless authorized.
