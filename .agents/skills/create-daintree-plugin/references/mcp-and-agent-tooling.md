# MCP and Agent Tooling

Use this reference for tools, skills, agent identities, handoffs and collaborative panels. Feature floors are in the version policy. Trace the actual intended consumer and verify its call path in acceptance.

## Two MCP directions

| Contribution | Client/consumer | Execution | Terminal agents |
| --- | --- | --- | --- |
| `mcpServers` | Daintree; tools consumed by its in-app Assistant through pluginMcp IPC | Plugin-owned supervised stdio subprocess | Never bridged here |
| `agentMcp` | Supported Daintree-launched CLI, granted per plugin/project | Worker `host.mcp.registerTools`, host loopback server | Supported |
| `databases` | Same per-plugin agent server, with read access | Host readonly database workers | Supported without mcp:expose or plugin activation |
| `skills` | Built-in Daintree MCP skills.search/load | Declarative Markdown | When caller surface includes skills |

Project plugins may use agentMcp/databases, not mcpServers/skills/agents. Installed agent identity contributions require `agent:register`; they add a CLI/detection identity, not model providers, hooks or interception of other tools.

## Worker agent tools

Declare `mcp:expose` and one `contributes.agentMcp` entry (`id`, `name`, optional `description`, `mode: "tools"`). During activation await `host.mcp.registerTools(endpointId, tools)`. Each definition supplies description, object inputSchema, optional object outputSchema/caution annotations, and `execute(args, caller, signal)`.

Example (runtime resource checks stay in the implementation):

```ts
await host.mcp.registerTools("records", {
  list_records: {
    description: "List records for the calling project.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
    },
    async execute(args, caller, signal) {
      return listRecordsForProject(caller.projectId, args.limit ?? 20, signal);
    },
  },
});
```

The host freezes caller provenance: projectId, terminalId, credentialId and optional launchAgentIdHint. This identifies the credential's launch, not the authenticated process presenting it. No worktree/panel ID is supplied. Installed plugins must scope every operation to the caller project; project plugins are owner-bound. Do not use active-project settings/storage/fs tokens to authorize a multi-project caller or infer a live panel from foreground focus. Use an explicit resource/session ID and verify ownership, resolving automatically only when unambiguous.

## Roster and schema requirements

- One endpoint per plugin. From 0.39.0, 1–16 own tools; earlier hosts allow 8 and reject a larger roster whole. Automatic database tools are additional and reserve `database_schema`/`database_query`.
- Names match `^[a-z][a-z0-9_]{0,31}$`; nonempty descriptions at most 400 UTF-8 bytes; each schema at most 8 KiB serialized and a plain `type: "object"` root.
- From 0.38.0 schemas compile at registration and validate arguments/results without coercion, defaults or stripping. Use JSON Schema 2020-12 or declared draft-07 consistently; internal refs only, no remote refs/dynamic or recursive refs/async schemas, recognized formats only. Keep regexes simple and bound string lengths: validation runs in main.
- From 0.39.0 only caution annotations: destructiveHint/openWorldHint may only be true, idempotentHint either boolean. readOnly/readOnlyHint, false destructive/open-world claims and unknown hints reject the entire roster. Hints do not guarantee client confirmation.
- Schemas/execute functions are snapshotted; register again to replace them. Replacement aborts in-flight calls, sends tools/list_changed and makes the old disposer inert.
- Results serialize as JSON text; undefined becomes null. With outputSchema, return a matching JSON object, also delivered as structuredContent. It is duplicated, not removed from text/token cost. Keep below the 256 KiB result ceiling, normalize bigint, and avoid secret-bearing errors.
- Propagate signal: 60-second request deadline includes activation; agent cancellation, session close, credential revoke and roster replacement abort it. Ignoring it does not stop code from mutating after the host stops waiting. Maximum 16 concurrent calls per session at the audited target.
- Main checks declaration/capability after a worker registration message; worker-side await/catch does not observe every main-side activation failure. Inspect activation diagnostics.

A mutation may complete before result serialization/output validation fails or a timeout occurs. Do not blindly retry. Use operation IDs/revision preconditions where repeated mutation matters.

## Access, launch and reload

Daintree serves one server per plugin, `daintree-<mcpName>` (manifest mcpName is optional; defaults to last manifest-name segment, with collision suffix). One setting grants Off (default), Read only (DB tools), or Read and write (DB plus own tools). A plugin without DB has Off/Read and write; DB-only has Off/Read only. Installed and project copies of one manifest have separate instance settings.

Project settings override an installed every-project default. A project `.daintree/mcp.json` can default only its own project plugins, using `{ "plugins": { "acme.app": "read-write" } }`; explicit user settings beat it. Repository defaults cannot authorize installed user data. Project folder trust is needed independently. Legacy endpoint-list defaults are read for compatibility; write the new access-level form.

The host MCP listener must be enabled; a project's built-in MCP tier may be Off while its plugin endpoints are granted. The plugin must be loaded and the CLI launched afterwards. On 0.39.0 the additive mechanisms cover Claude Code, Codex, Gemini CLI, opencode, GitHub Copilot CLI, Amp, Qwen Code and Mistral Vibe. Verify registry `capabilities.launchMcp` and `shared/config/launchMcp.ts` on the target. Other CLIs and in-app Assistant/help sessions are not handed these endpoints. Gemini additionally requires trusted folders.

Servers are fixed at CLI launch. Granting access or first loading a plugin requires relaunching the agent, not Daintree or just reconnecting `/mcp`. Host-owned files live 0600 under userData and are deleted on terminal exit; bearers travel in those files or environment, not argv. User CLI configs remain untouched.

From 0.39.0 reload can retain credentials only when declared capabilities, scopes, endpoint, databases and mcpName match; re-registered tools notify retained clients. Changed declarations/naming, ordinary unload, disable/uninstall/trust revoke/project close or lowered access revoke credentials and require agent relaunch where applicable. Verify kept/revoked behavior separately.

## Database exposure and fallback

Declaring a database automatically makes host `database_schema` and `database_query` available with read access; they inspect existing files and never create/migrate. Queries are readonly, bounded, isolated in utility processes and scoped to this plugin's declared DBs. Read access is no row-level sandbox.

An installed local DB is shared by every project. Its raw query tool can read all projects' rows regardless of caller.projectId. Filtered own tools do not close that path. For strict project isolation use project plugins, or avoid declaring the shared store for automatic exposure and serve filtered own tools over another storage model. The host cannot express “own tools yes, automatic DB tools no” at Read and write.

For project data, document its schema, integrity rules and direct file/sqlite3 route in the plugin's own data contract when the user authorizes creating it. Agents without wired endpoints can use it; a local DB outside the project has no repository-path fallback. Keep business invariants in constraints/triggers as well as validated tools. No tool accesses transient panel state or screenshots automatically; canonical state should live in the worker/database/document and panels subscribe to it.

## Supervised stdio servers

mcpServers uses local stdio MCP 2025-06-18, lazy enumeration, bounded two-tier discovery and cached tools. Diagnostics go to stderr; stdout is protocol-only. The subprocess receives a minimal environment plus manifest env. Declare required env explicitly, preferably user secret-setting tokens. `${settings:key}` resolves user settings at spawn; relevant setting changes debounce a restart of a previously started server. Crashes reject calls and require manual restart, not automatic backoff.

The pluginMcp guarded call path uses consent tiers, TOFU fingerprints, rate limits and audit. This is distinct from agentMcp access/cancellation/annotations; do not promise the same per-call consent flow for both. A capability tier cap can deny destructive stdio tools. These contributed tools do not join the inbound built-in Daintree action roster.

## Agent observation and attention features

From 0.41.0 choose the observation API by scope:

| Need | API and authority | Boundary |
| --- | --- | --- |
| Local panes for handoff | `agents.list()`, agent:read | Installed host follows focused project; project host is owner-bound |
| Fleet dashboard/attention queue | `agents.listAll()` + `onDidChangeAllAgents()`, agent:read | Installed/builtin only; includes open project/scratch even without loaded views; project plugins refused |
| Attribute a state transition | `onDidChangeAgentState`, agent:read | Optional terminalId/workspaceId; no cwd/worktree/content; coalesced per terminal by default |
| Current terminal snapshot | `terminals.readScreen(id, { lines })`, terminal:read + consent | Current screen only, no scrollback or input; project hosts read only their project |

Subscribe during activation before pulling. Fleet snapshots include agents and degraded/lastSuccessfulAt: stale or empty degraded data means unknown, not an empty fleet. observedState is a heuristic; terminal IDs can survive respawns. State callbacks default to 100 ms coalescing and may omit intermediate transitions; opt out with debounceMs: 0 for a transition ledger.

Screen reads return ok (including blank), exited, not-found or unavailable. Default 20/max 100 logical lines, 16 KiB, 60 calls/second/plugin; keep newest text and inspect truncated. Unknown/disallowed/non-user terminal IDs share not-found. Avoid background polling when nobody needs the snapshot and never persist or send terminal text off-machine accidentally. The host does not log/store it; plugin code remains responsible once received. terminal:read is separate from agent:read, and legacy output/copy action routes remain blocked.

These enable multi-project agent dashboards, per-terminal attention queues, user-requested summaries and snapshot cards. They do not add general pause/resume/interrupt/tool interception, authenticated agent identity, launch interception, screenshot access or a universal unattended orchestration grant. Keep user handoff explicit and enforce resource ownership; use existing launch/action/MCP contracts for operations.

## Handoff and orchestration

For user-selected work, `host.sendToAgent` and drag payloads create a literal bounded draft tagged daintree-context, never submit it. sendToAgent requires agent:input/consent and returns accepted/cancelled/refused outcomes; inspect them. `host.agents.list` needs agent:read and observes panes in the appropriate project. A user-performed drag needs no capability. `sendToActiveAgent({ submit: true })` differs: it submits under its grant. Use host actions for launching visible agents, with explicit context where supported.

Daintree's built-in inbound MCP remains a separate curated, tiered, versioned surface. Consult mcp.surface/tools/list instead of hardcoding counts or expecting plugins to widen it. Result validation can fail after side effects. No fullToolSurface widening flag, interception hooks, general worker-to-view RPC or screenshot portal is supplied by agentMcp. Test a real intended-agent discovery/call instead of inferring reachability from a registered roster or a mock host.

Explicit installed-plugin project dispatch is released in 0.41.0: `host.dispatch(action, args, { projectId })` needs project:dispatch and the off-by-default Allow project targeting switch, an existing project view and normal action authority. Global discovery does not widen sendToAgent, active-context settings/fs, or MCP caller fields. Never silently fall back to foreground targeting or retry a timed-out launch.
