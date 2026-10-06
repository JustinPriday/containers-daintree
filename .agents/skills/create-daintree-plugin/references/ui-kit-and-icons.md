# UI Kit and Icons

Use this reference for visual plugins. The audited 0.41.0 host serves kit contract 1.0.0. Canonical `docs/plugins/ui-kit.md` gives exhaustive props; `shared/types/plugin-sdk-react.ts`, SDK `plugin-ui.d.ts`, the runtime facade and its pinned export list are the contract. Read matching target source instead of copying this release's full catalogue into a plugin.

## Choose the surface

| Need | Prefer |
| --- | --- |
| Controls and menus | Button/IconButton, host inputs/pickers, DropdownMenu/ContextMenu, Dialog/Popover |
| Settings | SettingsSection → SettingsGroup → SettingsRow; FormField for form-owned inputs |
| Small row list | ListRow and progressive rendering |
| Large list | VirtualList/GroupedVirtualList and stable keys |
| Grid or short ledger | DataTable: selection/grouping/editing/menus; virtualize=false for content-sized short tables; numeric columns and totals |
| Tree or structured value | TreeView/FileTree/ObjectInspector |
| Narrow pane layout | Stack/Cluster/AutoGrid/PaneLayout, MasterDetail/Inspector/Drawer, container queries |
| Dashboard hierarchy | Card, Heading, Figure/StatCard, status feedback and host charts |
| Code, diff or Markdown editing | CodeEditor/DiffView/MarkdownEditor; these do not grant fileEditors contributions |
| Reordering and board | SortableList/Kanban/DragDropProvider |
| Agent interaction | AgentPicker, SendToAgentButton, ContextDragSource; TerminalSnapshot displays supplied data |
| Workflow/record review | OperationStatus/ToolCallCard, StructuredDiff/DecisionRequest, attachments/citations |
| Custom diagram/canvas | Semantic tokens and theme API; do not force an unsuitable kit chart |

The kit handles native keyboard/focus/overlay behavior and theme changes. Prefer it for standard controls rather than recreating a host surface or bundling editor/grid/dnd/icon libraries. Custom content remains appropriate where the kit lacks the product behavior; lint warnings are heuristics, not a ban on legitimate custom visuals. SecretInput only edits a value: actual secrets still use declared host secret settings.

## Loading and compatibility

`@daintreehq/plugin-ui` has no npm runtime package. The host serves it through its import map and the preset externalizes it. Add SDK `/plugin-ui` to compilerOptions.types (or a reference directive) for ambient declarations. The matching workspace has `/view-globals` for typed browser bridge globals; it is also type-only. Published SDK 0.1.0 lacks both entries.

The host panel loader prepares activation, styles and lazy kit adapters before committing the view. Await `whenPluginUiReady()` in tests/custom measurement paths; failures can retry. `preloadPluginUi()` starts loading without awaiting it. Markdown loads separately and is not covered by kit readiness. Preserve plugin loading/error states.

Kit 1.0.0 is independent of Daintree 0.41.0 and SDK 0.1.0. Within a kit major, exports/props/accepted values/core theme tokens are not removed or narrowed; extended tokens may change with a minor and need fallbacks. <=0.40 serves Markdown only and no kit version. When deliberately supporting such a host, import a namespace and choose available exports: a missing named export fails linking before a guard can run. A new manifest toolbar key can fail an older strict parser even when the view has fallbacks; select a suitable artifact/minimum version.

Raw views can import host SDK `/react` on 0.41.0. Built views bundle their pinned hooks. Neither shape bundles the host UI kit. Raw views require relative shipped ESM for other dependencies and no uncompiled JSX; worker fallback imports are a separate Node mechanism.

## Portals, focus and theme

Kit overlays own their chrome; style the content you supply, not the host overlay shell. Kit content/Portal retains plugin style-root and owner attribution. A raw createPortal requires styleRootAttributes on its container. Use nested dialog layering inside another modal surface and verify focus restoration/keyboard access. Menus on clickable rows may need stopPropagation because React portal events bubble through React ancestors.

Use semantic theme utilities and container queries for the pane. Keep scroll ancestors min-h-0/min-w-0. Do not ship Tailwind preflight, stock palette classes, @apply or viewport-driven panel layout. Read getDaintreeTheme/onDidChangeDaintreeTheme/useDaintreeTheme for canvas/WebGL; core tokens are stable, extended terminal/syntax/activity/category tokens need a fallback. Keep accent to one meaningful signal per region.

## Exact token names and semantic roles

Before writing custom CSS, read the actual target `docs/plugins/views.md` → Styling and `docs/plugins/ui-kit.md` → Theme. `src/styles/design-contract.css` is the public CSS utility/alias vocabulary; `shared/theme/types.ts` defines semantic theme keys. Refer to those files, not a remembered palette or an invented `--theme-bg-*` naming scheme. CSS `--theme-*`/`--color-*` variables and the kit JavaScript theme-token map are different contracts: the CSS set includes roles such as surface-toolbar and border-input that the audited JS map omits.

| Element or meaning | Host role / example |
| --- | --- |
| Pane body | bg-surface-panel / var(--theme-surface-panel), text-text-primary |
| Command/filter strip | bg-surface-toolbar or the nearest kit's neutral surface; border-border-divider |
| Recessed non-terminal content | bg-surface-inset with matching workbench text |
| Editable field | Kit Input/Select; custom field uses surface-input, border-input and text-primary |
| Supporting label/icon | text-text-secondary; muted only for nonessential fine print |
| Hover/selection/pressed state | Kit state treatment or surface-hover/surface-active/overlay roles; no brand wash |
| Primary action | Kit Button contrast or one accent action per region, with its paired foreground |
| Running/idle activity | activity-working/activity-idle with text/glyph, not a permanent success wash |
| Error or warning | Kit Callout/Badge/SeverityIcon; status-danger/status-warning and matching surface tokens |
| Category or plugin identity | Category hue in a meaningful mark/chart/icon; never the entire neutral workbench |
| Actual terminal/ANSI output | Kit TerminalOutput/AnsiText or terminal-background + terminal-foreground/ANSI as a pair |

Two separate checks matter: **does the token exist, and is its role right here?** A whole toolbar using category-blue is tokenized but still does not match neutral Daintree chrome. A blue Flutter brand mark can be appropriate; a blue background for all controls is a separate design decision. Preserve the user's content hierarchy without copying a self-contained product palette into the host.

Do not use `--theme-bg-primary`, `--theme-bg-secondary`, `--theme-bg-tertiary`, `--theme-border` or `--theme-text-tertiary` on the audited host; they are not its documented names. For example:

```css
/* Use in a shipped stylesheet or custom content where a kit surface is unsuitable. */
.plugin-body {
  background: var(--theme-surface-panel);
  color: var(--theme-text-primary);
  border-color: var(--theme-border-default);
}
```

`var(--theme-bg-primary, #11161b)` is a concealed failure, not compatibility: an unknown name leaves the panel on the dark fallback in a light theme. Use actual core roles with a truthful host minimum; optional/extended-token fallbacks should resolve to another appropriate live host role. Do not override host-owned --theme/--color variables or force color-scheme: dark across workbench controls. Pair foreground and background from the same role, avoid text alpha, and prefer the host's derived status surfaces over arbitrary tinted mixes. Readability of disabled/focus/hover states still needs review.

Bondi is a light workbench with an intentionally dark terminal palette. A console may remain dark when it uses the terminal foreground/ANSI palette as well; its target picker, console tabs, command strips, labels and inputs still follow workbench tokens. Raw screenshots/media retain their own colours. Do not require all pixels to become light, or use terminal colours to excuse a dark whole-panel shell.

For literal CSS var references run `audit_plugin.mjs <plugin> --host-root <target>`. It detects unknown host names in the inspected source/view output, including names with plausible dark fallbacks; it is not a CSS evaluator and does not establish contrast or correct roles. Still run matching target lint/Styles diagnostics, inspect custom styles and perform the live switch check below. Do not copy internal host component classes/extensions as a substitute for public kit/semantic roles.

## Theme-switch acceptance

Keep the same view mounted and exercise dark → Bondi → dark without reload. Cover the body, command rows, inputs, selected tabs/rows, icons, focus/hover/disabled/busy states, loading/empty/error content, tooltips/menus/dialogs and narrow panes. Workbench neutral surfaces and readable ink must change together; compare with adjacent native host controls. Running/idle/error state remains meaningful with both a glyph/text and the theme's state colours.

For canvas/WebGL/custom pixel rendering, use useDaintreeTheme/onDidChangeDaintreeTheme and repaint on changes; a one-time getComputedStyle or resolved theme snapshot can preserve old colours. Review portalled content outside the style root. If high-contrast/reduced-motion behavior is in scope, verify it too. Record the host build, themes, states exercised and outcome. Static token checks or one attractive dark screenshot cannot count as visual theme acceptance; if the app cannot be exercised, state the check is pending.

Before requesting a new host token, demonstrate the missing semantic role using supported tokens/kit on at least the dark/Bondi pair. Separate a genuinely absent role, a CSS role missing from the JS theme API, a kit component defect and a plugin's misuse. Report a minimal reproduction and needed role rather than another plugin-specific hex colour; no host change is authorized merely by a plugin styling problem.

## View icons versus manifest icons

View Icon and component icon props accept PluginIconSource: kit names, any valid Lucide kebab-case name, or your own element. Kit names render immediately; other Lucide names load lazily with a fixed-size placeholder. Invalid names draw nothing and warn in development. Use currentColor for custom glyphs. No lucide-react dependency is needed. An inline SVG may trigger heuristic lint but remains a supported custom source.

Manifest iconId accepts generic plugin registry IDs or `./icons/name.svg`. Arbitrary Lucide view names are not a manifest namespace. Assets are supported for panels, app toolbar buttons, process tools and nested panel-toolbar buttons; project-origin restrictions still apply to those contributions.

Paths must be lowercase POSIX relative SVG references, at most 64 characters, with no traversal/control characters/backslashes/URL syntax. Files are contained by realpath, bounded at 64 KiB, checked as UTF-8/single SVG root and sanitized. Supply xmlns and viewBox. The host draws a monochrome currentColor mask, so a multicolour brand SVG will not preserve its palette. Bad runtime assets fall back; current target CLI validation treats them as errors.

```json
{
  "id": "ledger",
  "name": "Ledger",
  "iconId": "./icons/ledger.svg",
  "color": "category-blue",
  "hasPty": false,
  "toolbar": [
    {
      "actionId": "acme.ledger.refresh",
      "iconId": "./icons/refresh.svg",
      "label": "Refresh",
      "status": true
    }
  ]
}
```

This is a panel contribution fragment; declare a matching view and register the own action. Confirm color/schema details on the target rather than treating a fragment as a whole valid manifest.

Include SVG files in distributed runtime assets. The audited packager's required-path check omits nested toolbar icon refs, although validation reads them: a `.dntrignore` exclusion can silently drop one. Inspect verbose dry-run and archive contents for every icon slot. Supplemental `audit_plugin.mjs --archive-files <json>` can compare custom refs to a JSON path list, but does not parse or accept a `.dntr` by itself. Project plugins need committed assets verified in a fresh checkout.

## Native header actions

Declare at most three own actions in a view panel's toolbar; actions receive panelId. Use usePanelToolbarItem for live status and useActionRunning for host-tracked handler runs. The header already draws busy while a handler runs from any entry point. State persists across ordinary remounts and resets on reload/close; retired setters do nothing. A surface/settings/dialog has no header setter, so draw a body fallback. Track resource-specific jobs in the worker; do not equate plugin-wide runningActions with a per-record lock.
