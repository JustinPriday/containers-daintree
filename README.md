# Containers for Daintree

Worktree-aware Docker Engine and Docker Compose controls inside [Daintree](https://github.com/daintreehq/daintree).

Containers gives each Daintree worktree its own persistent container console. Inspect Compose services, follow combined or per-service logs, and perform common lifecycle operations without switching to another application.

> Containers was authored entirely inside Daintree—a plugin built from within the environment it extends.

> [!IMPORTANT]
> Containers is preparing for its first public prerelease. Interfaces and installation details may change while the Daintree plugin framework evolves.

## Why Containers?

Docker tools normally organize workloads around engines, contexts, and Compose projects. Daintree organizes development around projects and worktrees. Containers connects those models:

- The pane belongs to a specific Daintree worktree.
- Its Docker target is stored independently and can point at that worktree or a shared Compose project.
- The header distinguishes the owning worktree, bound path, Compose project, and actual container identities.
- Restored panes retain their original binding instead of following whichever worktree happens to be active later.

This is particularly useful when several worktrees run parallel stacks—or when multiple worktrees intentionally share one stack.

## Features

- Aggregated **All services** console and per-service log views.
- Live log streaming with bounded history, follow-tail mode, timestamps, service colours, and stderr distinction.
- Scroll-away detection with an explicit **Resume live tail** control.
- Clipboard export for the currently selected console.
- Collapsible service rail for narrow panes.
- Compose project, worktree, target path, service, and container identity at a glance.
- Project-level Start, Stop, Restart, and Refresh controls.
- Per-container Start, Stop, Restart, Pause, and Resume controls.
- Native Daintree pane focus, drag, reorder, maximise, close, and status badges.
- Automatic local socket discovery for Docker Desktop, Colima, Rancher Desktop, and `/var/run/docker.sock`.
- Optional socket override through plugin settings or `DOCKER_HOST`.

Project operations act on containers that already exist and match the bound Compose project. They are intentionally not substitutes for `docker compose up`, `down`, profile selection, or dependency reconciliation.

## Requirements

| Requirement | Current support |
| --- | --- |
| Daintree | 0.28.0 or newer |
| Host OS | macOS first |
| Container API | Local Docker-compatible Unix socket |
| Project discovery | Docker Compose labels, including `com.docker.compose.project.working_dir` |

Remote Docker-over-SSH connections, TCP contexts, Windows named pipes, Kubernetes, and non-Docker runtimes are not currently supported. Linux may work with `/var/run/docker.sock`, but it has not yet received the same acceptance testing as macOS.

## Installation

When the first prerelease is published:

1. Download `justinpriday.containers-<version>.dntr` from the repository's Releases page.
2. In Daintree, open **Preferences → Plugins**.
3. Choose **Install from file…** and select the archive.
4. Approve the `clipboard:write` permission used by **Copy console**.
5. Run **Containers: Open Console** from the Command Palette or use the Containers toolbar action.

The plugin requires no Docker-side installation. It communicates with the local engine through its Unix socket.

## Using the console

Opening a console binds it to the current worktree and initially uses that worktree's path as its Docker target. Containers then discovers Compose containers whose working-directory label matches that path.

- Select **All services → Console** for an interleaved project-wide stream.
- Select **Logs →** on a service to filter the existing stream locally.
- Scroll upward to pause follow-tail; choose **Resume live tail** to return to current output.
- Use the sidebar control to hide or restore the service rail.
- Use the binding control in the project toolbar when a worktree should reuse a different worktree's Docker stack.

Lifecycle controls affect real containers immediately. Use Stop, Restart, and Pause only when interrupting the bound stack is safe.

## Permissions and trust

The manifest requests only `clipboard:write`, used when you explicitly copy console output.

The plugin worker also connects directly to the selected local Docker socket through Dockerode. Access to a Docker socket is effectively privileged access to the Docker host. Daintree's current plugin capability vocabulary does not expose a local-socket permission, so this authority cannot yet be represented as a manifest capability. Install only from a source you trust.

Container logs remain local to the Daintree plugin process. Containers does not include telemetry or a remote service.

## Architecture

Containers uses a split plugin architecture:

```text
Daintree panel (React)
    ↕ validated plugin channels and targeted panel events
Plugin worker (Node.js)
    ↕ Dockerode
Local Docker Engine socket
```

- The React bundle owns presentation, local filtering, bounded log state, and user interaction.
- The Node worker owns authoritative worktree bindings, Docker connections, lifecycle operations, and log subscriptions.
- Zod schemas validate renderer-to-worker requests and worker responses.
- Each panel has an independent binding and log-session group; events are targeted by panel ID.

## Development

The current source setup expects a Daintree checkout at `../../Daintree` because the SDK, testing helpers, Vite preset, and CLI are referenced through local `file:` dependencies. Use Node.js 22.13.0 or newer from the Node 22 release line, matching Daintree's development environment.

```text
Developer/
└── Electron/
    ├── Daintree/                       # Daintree v0.28.0 or compatible newer checkout
    └── DaintreePlugins/
        └── ContainersDaintree/          # this repository
```

Prepare Daintree first. The plugin has been validated against Daintree 0.28 and newer compatible development builds:

```sh
cd ../../Daintree
git checkout v0.28.0
npm install
npm run packages:build
```

You may use a newer Daintree checkout instead, but plugin framework changes can affect the build. Return to this repository, verify the expected layout, and install the locked dependencies:

```sh
cd ../DaintreePlugins/ContainersDaintree
test -f ../../Daintree/packages/plugin-sdk/package.json
node --version
npm ci
```

Then run the project checks:

```sh
npm run typecheck
npm test
npm run build
npm run validate
```

Create a production plugin archive with:

```sh
npm run package
```

The archive is written to the repository root as:

```text
justinpriday.containers-<version>.dntr
```

Inspect the exact package selection without keeping an archive:

```sh
npm run package:dry-run
```

## Repository guide

```text
src/index.ts                 Node plugin worker and host registrations
src/panel.react.tsx          Container Console React view
src/panelStyles.ts           Panel design system and responsive layout
src/docker/                  Dockerode backend, log parser, and domain types
src/shared/                  Binding and console-state logic shared with tests
tools/                       Deterministic build and packaging helpers
```

## Current limitations

- macOS is the only fully tested host platform.
- Only local Unix Docker sockets are supported.
- Discovery depends on Docker Compose labels and an exact normalized working-directory match.
- Project controls manage existing containers; they do not create or remove a Compose stack.
- Interactive `docker exec` terminals are not part of the current release.
- Daintree 0.28 does not yet allow non-PTY plugin panels to opt into **Move to dock**.
- Daintree does not currently render plugin-provided custom icon assets.

## Project identity

- Product: **Containers for Daintree**
- In-app name: **Containers**
- Plugin ID: `justinpriday.containers`
- Panel: **Container Console**

Docker-specific implementation names remain where they accurately describe the supported API and runtime. The broader product name does not imply support for Podman, containerd, or Kubernetes.

## Contributing

Bug reports and focused pull requests are welcome, particularly for reproducible Docker socket, Compose discovery, log-streaming, and Daintree plugin-lifecycle issues. Include the Daintree version, host OS, Docker provider, and whether the problem survives a Daintree Force Reload.

## Trademark notice

Docker and the Docker logo are trademarks or registered trademarks of Docker, Inc. Containers for Daintree is an independent project and is not affiliated with or endorsed by Docker, Inc.

## License

Containers for Daintree is licensed under the [Apache License 2.0](LICENSE).
Bundled dependency licenses and attributions are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and included in every
installable `.dntr` archive.
