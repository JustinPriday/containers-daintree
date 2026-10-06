import { z } from "zod";

export const dockerPanelBindingSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    projectId: z.string().min(1).max(4096).optional(),
    worktreeId: z.string().min(1).max(4096),
    worktreeName: z.string().min(1).max(4096),
    worktreePath: z.string().min(1).max(4096),
    dockerProjectPath: z.string().min(1).max(4096),
  })
  .refine(
    (binding) => binding.schemaVersion === 1 || !!binding.projectId,
    "Version 2 bindings require a project owner",
  );

export type DockerPanelBinding = z.infer<typeof dockerPanelBindingSchema>;

export interface WorktreeBindingSource {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export function createDockerPanelBinding(
  worktree: WorktreeBindingSource,
  dockerProjectPath = worktree.path,
): DockerPanelBinding {
  return dockerPanelBindingSchema.parse({
    schemaVersion: 1,
    worktreeId: worktree.id,
    worktreeName: worktree.name,
    worktreePath: worktree.path,
    dockerProjectPath,
  });
}

export function parseDockerPanelBinding(
  value: unknown,
): DockerPanelBinding | null {
  const result = dockerPanelBindingSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function withDockerProjectPath(
  binding: DockerPanelBinding,
  dockerProjectPath: string,
): DockerPanelBinding {
  return dockerPanelBindingSchema.parse({ ...binding, dockerProjectPath });
}
