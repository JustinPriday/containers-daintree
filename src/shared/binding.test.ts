import { describe, expect, it } from "vitest";
import {
  createDockerPanelBinding,
  parseDockerPanelBinding,
  withDockerProjectPath,
} from "./binding.js";

describe("Docker panel binding", () => {
  it("keeps panel ownership distinct from its Docker target", () => {
    const original = createDockerPanelBinding(
      { id: "wt-feature", name: "feature", path: "/repo/feature" },
      "/repo/main"
    );
    const restored = parseDockerPanelBinding(JSON.parse(JSON.stringify(original)));

    expect(restored).toEqual({
      schemaVersion: 1,
      worktreeId: "wt-feature",
      worktreeName: "feature",
      worktreePath: "/repo/feature",
      dockerProjectPath: "/repo/main",
    });
  });

  it("changes only the Docker target", () => {
    const original = createDockerPanelBinding({
      id: "wt-feature",
      name: "feature",
      path: "/repo/feature",
    });
    const updated = withDockerProjectPath(original, "/repo/main");

    expect(updated.worktreeId).toBe(original.worktreeId);
    expect(updated.worktreePath).toBe(original.worktreePath);
    expect(updated.dockerProjectPath).toBe("/repo/main");
  });
});
