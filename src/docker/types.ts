import { z } from "zod";

export const dockerConnectionStateSchema = z.enum(["ready", "unavailable", "error"]);

export const dockerDaemonSchema = z.object({
  version: z.string(),
  apiVersion: z.string(),
  os: z.string(),
  arch: z.string(),
  containers: z.number().int().nonnegative(),
  containersRunning: z.number().int().nonnegative(),
  containersPaused: z.number().int().nonnegative(),
  containersStopped: z.number().int().nonnegative(),
  images: z.number().int().nonnegative(),
});

export const dockerConnectionSchema = z.object({
  state: dockerConnectionStateSchema,
  endpointLabel: z.string().nullable(),
  daemon: dockerDaemonSchema.nullable(),
  error: z.string().nullable(),
});

export const dockerContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  serviceName: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  health: z.string().nullable(),
  composeProject: z.string(),
  workingDir: z.string(),
});

export const dockerProjectSnapshotSchema = z.object({
  projectPath: z.string(),
  connection: dockerConnectionSchema,
  composeProjects: z.array(z.string()),
  containers: z.array(dockerContainerSchema),
  capturedAt: z.string(),
});

export const dockerProjectOperationSchema = z.enum(["start", "stop", "restart"]);
export const dockerContainerOperationSchema = z.enum([
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
]);

export const dockerLogStreamSchema = z.enum(["stdout", "stderr", "console"]);

export const dockerLogRecordSchema = z.object({
  containerId: z.string(),
  containerName: z.string(),
  serviceName: z.string(),
  stream: dockerLogStreamSchema,
  timestamp: z.string().nullable(),
  text: z.string(),
});

export const dockerLogBatchSchema = z.object({
  containerId: z.string(),
  sequence: z.number().int().nonnegative(),
  records: z.array(dockerLogRecordSchema),
});

export const dockerOperationResultSchema = z.object({
  operation: dockerProjectOperationSchema,
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.array(
    z.object({
      containerId: z.string(),
      containerName: z.string(),
      error: z.string(),
    })
  ),
  snapshot: dockerProjectSnapshotSchema,
});

export const dockerContainerOperationResultSchema = z.object({
  operation: dockerContainerOperationSchema,
  containerId: z.string(),
  containerName: z.string(),
  performed: z.boolean(),
  snapshot: dockerProjectSnapshotSchema,
});

export type DockerConnection = z.infer<typeof dockerConnectionSchema>;
export type DockerContainer = z.infer<typeof dockerContainerSchema>;
export type DockerProjectSnapshot = z.infer<typeof dockerProjectSnapshotSchema>;
export type DockerProjectOperation = z.infer<typeof dockerProjectOperationSchema>;
export type DockerContainerOperation = z.infer<typeof dockerContainerOperationSchema>;
export type DockerOperationResult = z.infer<typeof dockerOperationResultSchema>;
export type DockerContainerOperationResult = z.infer<typeof dockerContainerOperationResultSchema>;
export type DockerLogStream = z.infer<typeof dockerLogStreamSchema>;
export type DockerLogRecord = z.infer<typeof dockerLogRecordSchema>;
export type DockerLogBatch = z.infer<typeof dockerLogBatchSchema>;

export interface DockerLogSubscription {
  close(): void;
}

export interface DockerBackend {
  getProjectSnapshot(projectPath: string): Promise<DockerProjectSnapshot>;
  operateProject(
    projectPath: string,
    operation: DockerProjectOperation
  ): Promise<DockerOperationResult>;
  operateContainer(
    projectPath: string,
    containerId: string,
    operation: DockerContainerOperation
  ): Promise<DockerContainerOperationResult>;
  subscribeContainerLogs(
    projectPath: string,
    containerId: string,
    onRecord: (record: DockerLogRecord) => void,
    options?: { tail?: number; onDisconnect?: (error: string | null) => void }
  ): Promise<DockerLogSubscription>;
  dispose(): void;
}
