# Documentation Version Policy

Read the skill-local `../documentation-version.json`. Guidance 2.1.1 pins released Daintree 0.41.0 to `v0.41.0` at `90032dbe231f0f73d283ebb3655f5dd95d549e92`, and separately records audited development source `f12266eaef7afdc270c56c15e128104744946001`. These two commits have identical tracked trees. The host UI kit contract is 1.0.0. The local merge commit and package version do not replace either evidence pin.

## Feature floors

These are first released tags containing the introducing commits, verified by `git merge-base --is-ancestor <commit> <tag>`. They are availability floors, not proof a particular plugin passed acceptance on that release. Later fixes can justify a higher tested minimum.

| Feature | First release | Introducing evidence |
| --- | --- | --- |
| Recipes; managed-process duplex mode | 0.33.0 | `4dceda6408`, `39e5fc35b5` |
| Project-local scope, bound host and empty-canvas surface | 0.35.0 | `df394fd06c`, `432269ea1f` |
| Full dev artifact reconciliation and view generations | 0.35.0 | `a322e5accb`, `132e3d081e` |
| Worktree unavailable-result API; wake signal | 0.35.0 | `aa18fdc0a9`, `0e92b7002a` |
| Detailed readdir, SDK files helpers, panel state persistence | 0.35.0 | `c8622a688e`, `55d66d3c3f`, `6781e6047d` |
| Runtime semantic Tailwind styling | 0.35.0 | `afc897c9b9` |
| Retained document packages | 0.36.0 | `effa509b40`, `d94c7bf1e9` |
| Worker agent MCP endpoints and contextual caller | 0.37.0 | `5595fcd8b1`, `21628374d4` |
| Revision-checked atomic writeFile | 0.37.0 | `424b0926c8` |
| File editor / preview tool / guest adapter contributions, built-in only | 0.37.0 | `9b9bad2d1b`, `b9c63693d4` |
| Agent MCP schema compilation/enforcement | 0.38.0 | `5f0b68913f` |
| Advisory engine mismatch; refused plaintext secrets | 0.38.0 | `6acf75f634`, `01da27c088` |
| All writes/reads checked; createViewScope; panel reload | 0.38.0 | `7595a21110`, `bf55be4f02`, `21d174bb8f` |
| Databases, readonly/columns/backup, automatic agent DB tools | 0.39.0 | `ff8aa48354`, `8ad52f437e`, `2b7698bfb6`, `65b9d107c9` |
| mkdir, appendFile, readFileWithRevision, recursive/allowMissing watch | 0.39.0 | `7e0369f248`, `9fb921622f` |
| HTML-to-PDF, zero-build worker SDK and data helpers | 0.39.0 | `73eb0614be`, `179c89a2d9` |
| Host Markdown UI and app-shaped icons | 0.39.0 | `acfb8336b9`, `df1f84df3f` |
| Draft handoff, custom settings views/required setup, own panel menu | 0.39.0 | `14d1d733c5`, `7d82d59826`, `98de298d33`, `adfc1e234f` |
| Installed tours and tour CLI | 0.39.0 | `77ee1a105b`, `00faf6487f` |
| Eight wired launch CLIs, one named plugin MCP server/access level | 0.39.0 | `442c482679`, `cdeb834e40` |
| Retained agent credentials on unchanged reloads | 0.39.0 | `326837aaf6`, `7aac97c013` |
| Caution annotations; 16 own tools rather than 8 | 0.39.0 | `8323bf952f`, `75ad551e93`, `f4fd1053a9` |
| Installed-plugin explicit project dispatch and permission switch | 0.41.0 | `54decab631`, `3bfc84fb67` |
| Full host UI kit, theme, icons, performance hooks | 0.41.0 | `a9039f21fd`, `2e2cbb19ea` |
| Invoke bounds, owner routing and ordered push batching | 0.41.0 | `747f09c597` |
| Default subscription coalescing, bulk filesystem APIs | 0.41.0 | `1081aceb7c`, `a9bc385e29` |
| Performance/Styles diagnostics and source lint | 0.41.0 | `013457eda8`, `bd94d83d3f`, `b1a9f4f638` |
| Raw-view SDK React hooks | 0.41.0 | `16bc146cb6` |
| Custom SVG icon assets | 0.41.0 | `1905f54678` |
| Panel header toolbar and live state | 0.41.0 | `67841973b5` |
| Multi-channel invalidation and cache reset | 0.41.0 | `66b2f72324` |
| All-project agent snapshots; terminal/workspace event attribution | 0.41.0 | `be24da5bfe`, `0442dd9199` |
| Terminal screen reads and terminal:read consent | 0.41.0 | `a742def62a`, `fe71db7eb8` |
| Running action tracking and feedback fixes | 0.41.0 | `8094597b3b` |

The new kit, SVG icons, toolbar, raw-view hooks, bounded transport, coalescing/bulk reads, diagnostics and fleet/screen APIs first ship in 0.41.0. Introducing commits are absent from v0.40.0 and contained in v0.41.0. Historical feature-branch subjects naming kit 1.1/1.2/1.3 do not establish public kit versions: all audited kit exports ship under 1.0.0. App version alone still cannot identify a development build.

## App, package, guidance and schema versions

The app's version controls runtime availability. Author-package versions control build-time exports/types/validation, and can lag independently. Guidance versions identify this audit. Database `user_version`, panel `stateVersion`, and document-adapter exact version/hash are separate migration axes.

As checked directly against npm on 2026-10-04, SDK, Vite preset, CLI and scaffolder latest are all 0.1.0. The published SDK exports root, `/react`, `/files`, `/testing`; it has no `/data`, `/plugin-ui` or `/view-globals` entry. The latter two are type-only workspace entries. New CLI lint and the SDK performance hooks also lag in the published release. Its declarations lack `PluginDatabaseApi`, `PluginDocumentsApi`, `PluginSettingsViewContext`, `PluginMcpToolAnnotations`, `PluginDispatchOptions`, `missingRequired` and `createViewScope`. The workspace still labels packages 0.1.0, so the numeric version alone cannot identify these source additions. Inspect actual exports/declarations and pin matching packed artifacts/lockfiles or wait for a newer publish.

A host-served worker fallback can resolve `/data` on 0.39.0; an installed older SDK can shadow it. It cannot repair a bundler's missing build-time export. From 0.41.0 the renderer import map separately serves SDK `/react` to raw views; built views bundle their pinned hooks. The host UI kit is always served, never an npm runtime dependency. For older hosts use namespace feature detection: missing named exports fail ESM linking before an API guard can run. Check `npm view <package> version dist-tags` again before relying on this dated registry observation.

From 0.38.0 `engines.daintree` mismatch warns and loads; it does not enforce support. Unknown fields and unsupported origin contributions still fail schema validation. Derive the lower bound from used behavior, avoid caret ranges on 0.x, guard optional APIs, and give actionable diagnostics for unsupported hosts. A fundamentally new manifest contribution may require separate legacy/current artifacts rather than a runtime fallback.

## Maintaining this skill

Update existing references, helper scripts and skill-local metadata together. Increment guidance patch for factual corrections, minor for added coverage, major for changed workflows. Keep source and released evidence distinct. Run `node <skill>/scripts/check_guidance_version.mjs <daintree-root>`; it verifies pins and target history without requiring another repository's guide/cookbook files. An exact audit pin passes; a different target needs explicit source revalidation even when descended from the release.

Run `node --test <skill>/scripts/test_guidance.mjs` after helper changes, and check local links/formatting. Resolve annotated tags with `<tag>^{commit}` for evidence pins; the tag object ID is not the release commit.

Do not create commits, release tags or distribution archives unless requested. Preserve historical guidance in Git when the user actually publishes it.
