import type { PanelViewProps } from "@daintreehq/plugin-sdk";
import { parseDockerPanelBinding } from "./shared/binding.js";

/**
 * Legacy Daintree 0.26 compatibility renderer, retained as a regression fixture.
 *
 * Daintree 0.26.0 maps the documented React module specifiers to an optimized
 * chunk whose public exports are minified. A normal named React import fails
 * before the component mounts. Returning text requires no React runtime import,
 * so this compatibility view still exercises panel creation, worktree binding,
 * persistence, chrome, and layout behavior in the production application.
 *
 * Daintree 0.27 fixed the host React facade contract, so this is no longer the
 * active build entry.
 */
export default function DockerConsolePanel({ initialArgs }: PanelViewProps): string {
  const binding = parseDockerPanelBinding(initialArgs);

  if (!binding) {
    return "Container Console — no valid worktree binding. Open this pane with Containers: Open Console.";
  }

  return [
    "Container Console",
    `Worktree: ${binding.worktreeName}`,
    `Owned by: ${binding.worktreePath}`,
    `Docker project: ${binding.dockerProjectPath}`,
    "Docker worker controls are available from the command palette; the live body UI awaits Daintree's React compatibility fix.",
  ].join("  ·  ");
}
