import { z } from "zod";

export const dockerPanelBindingSchema = z.object({
  schemaVersion: z.literal(1),
  worktreeId: z.string().min(1),
  worktreeName: z.string().min(1),
  worktreePath: z.string().min(1),
  dockerProjectPath: z.string().min(1),
});

export type DockerPanelBinding = z.infer<typeof dockerPanelBindingSchema>;

export interface WorktreeBindingSource {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export function createDockerPanelBinding(
  worktree: WorktreeBindingSource,
  dockerProjectPath = worktree.path
): DockerPanelBinding {
  return dockerPanelBindingSchema.parse({
    schemaVersion: 1,
    worktreeId: worktree.id,
    worktreeName: worktree.name,
    worktreePath: worktree.path,
    dockerProjectPath,
  });
}

export function parseDockerPanelBinding(value: unknown): DockerPanelBinding | null {
  const result = dockerPanelBindingSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function withDockerProjectPath(
  binding: DockerPanelBinding,
  dockerProjectPath: string
): DockerPanelBinding {
  return dockerPanelBindingSchema.parse({ ...binding, dockerProjectPath });
}
