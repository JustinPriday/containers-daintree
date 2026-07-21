import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import Docker from "dockerode";
import { DockerLogLineDecoder, DockerMultiplexDecoder } from "./dockerLogParser.js";
import type {
  DockerBackend,
  DockerConnection,
  DockerContainer,
  DockerContainerOperation,
  DockerContainerOperationResult,
  DockerLogRecord,
  DockerLogSubscription,
  DockerOperationResult,
  DockerProjectOperation,
  DockerProjectSnapshot,
} from "./types.js";

const COMPOSE_PROJECT = "com.docker.compose.project";
const COMPOSE_SERVICE = "com.docker.compose.service";
const COMPOSE_WORKING_DIR = "com.docker.compose.project.working_dir";

interface DockerodeBackendOptions {
  getConfiguredSocket?: () => Promise<string | undefined>;
  getDockerHost?: () => string | undefined;
  socketCandidates?: () => Array<{ path: string; label: string }>;
  pathExists?: (candidate: string) => Promise<boolean>;
  createClient?: (socketPath: string) => Docker;
  timeoutMs?: number;
  now?: () => Date;
}

interface ResolvedSocket {
  path: string;
  label: string;
}

function defaultSocketCandidates(): Array<{ path: string; label: string }> {
  const home = homedir();
  return [
    { path: path.join(home, ".docker/run/docker.sock"), label: "Docker Desktop" },
    { path: "/var/run/docker.sock", label: "Default Docker socket" },
    { path: path.join(home, ".colima/default/docker.sock"), label: "Colima" },
    { path: path.join(home, ".colima/docker.sock"), label: "Colima (legacy)" },
    { path: path.join(home, ".rd/docker.sock"), label: "Rancher Desktop" },
  ];
}

function parseUnixDockerHost(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("unix://")) return value.slice("unix://".length);
  return path.isAbsolute(value) ? value : null;
}

function normalizeProjectPath(value: string): string {
  const normalized = path.normalize(value);
  return normalized.length > path.parse(normalized).root.length && normalized.endsWith(path.sep)
    ? normalized.slice(0, -1)
    : normalized;
}

function healthFromStatus(status: string): string | null {
  const match = status.match(/\((healthy|unhealthy|health: starting)\)/i);
  return match?.[1]?.toLowerCase().replace("health: ", "") ?? null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export class DockerodeBackend implements DockerBackend {
  private readonly options: Required<Omit<DockerodeBackendOptions, "getConfiguredSocket">> &
    Pick<DockerodeBackendOptions, "getConfiguredSocket">;
  private client: Docker | null = null;
  private resolvedSocket: ResolvedSocket | null = null;
  private readonly logSubscriptions = new Set<DockerLogSubscription>();

  constructor(options: DockerodeBackendOptions = {}) {
    this.options = {
      getConfiguredSocket: options.getConfiguredSocket,
      getDockerHost: options.getDockerHost ?? (() => process.env.DOCKER_HOST),
      socketCandidates: options.socketCandidates ?? defaultSocketCandidates,
      pathExists:
        options.pathExists ??
        (async (candidate) => {
          try {
            await access(candidate);
            return true;
          } catch {
            return false;
          }
        }),
      createClient: options.createClient ?? ((socketPath) => new Docker({ socketPath })),
      timeoutMs: options.timeoutMs ?? 4_000,
      now: options.now ?? (() => new Date()),
    };
  }

  private async discoverSocket(): Promise<ResolvedSocket | null> {
    const configured = parseUnixDockerHost(await this.options.getConfiguredSocket?.());
    if (configured && (await this.options.pathExists(configured))) {
      return { path: configured, label: "Configured Docker socket" };
    }

    const fromEnvironment = parseUnixDockerHost(this.options.getDockerHost());
    if (fromEnvironment && (await this.options.pathExists(fromEnvironment))) {
      return { path: fromEnvironment, label: "DOCKER_HOST" };
    }

    for (const candidate of this.options.socketCandidates()) {
      if (await this.options.pathExists(candidate.path)) return candidate;
    }
    return null;
  }

  private async getConnection(): Promise<DockerConnection> {
    const socket = await this.discoverSocket();
    if (!socket) {
      this.dispose();
      return {
        state: "unavailable",
        endpointLabel: null,
        daemon: null,
        error: "No supported local Docker socket was found.",
      };
    }

    if (!this.client || this.resolvedSocket?.path !== socket.path) {
      this.client = this.options.createClient(socket.path);
      this.resolvedSocket = socket;
    }

    try {
      await withTimeout(this.client.ping(), this.options.timeoutMs, "Docker ping");
      const [version, info] = await withTimeout(
        Promise.all([this.client.version(), this.client.info()]),
        this.options.timeoutMs,
        "Docker daemon information"
      );
      return {
        state: "ready",
        endpointLabel: socket.label,
        daemon: {
          version: version.Version ?? "unknown",
          apiVersion: version.ApiVersion ?? "unknown",
          os: version.Os ?? "unknown",
          arch: version.Arch ?? "unknown",
          containers: info.Containers ?? 0,
          containersRunning: info.ContainersRunning ?? 0,
          containersPaused: info.ContainersPaused ?? 0,
          containersStopped: info.ContainersStopped ?? 0,
          images: info.Images ?? 0,
        },
        error: null,
      };
    } catch (error) {
      this.client = null;
      return {
        state: "error",
        endpointLabel: socket.label,
        daemon: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async listProjectContainers(projectPath: string): Promise<DockerContainer[]> {
    if (!this.client) return [];
    const expectedPath = normalizeProjectPath(projectPath);
    const containers = await withTimeout(
      this.client.listContainers({ all: true, filters: { label: [COMPOSE_WORKING_DIR] } }),
      this.options.timeoutMs,
      "Docker container listing"
    );

    return containers
      .filter((container) => {
        const workingDir = container.Labels?.[COMPOSE_WORKING_DIR];
        return workingDir !== undefined && normalizeProjectPath(workingDir) === expectedPath;
      })
      .map((container) => {
        const labels = container.Labels ?? {};
        const status = container.Status ?? "";
        return {
          id: container.Id,
          name: (container.Names?.[0] ?? "").replace(/^\//, ""),
          serviceName: labels[COMPOSE_SERVICE] ?? (container.Names?.[0] ?? "").replace(/^\//, ""),
          image: container.Image,
          state: container.State,
          status,
          health: healthFromStatus(status),
          composeProject: labels[COMPOSE_PROJECT] ?? "",
          workingDir: labels[COMPOSE_WORKING_DIR] ?? "",
        };
      })
      .sort((left, right) =>
        left.serviceName.localeCompare(right.serviceName) || left.name.localeCompare(right.name)
      );
  }

  async getProjectSnapshot(projectPath: string): Promise<DockerProjectSnapshot> {
    const normalizedPath = normalizeProjectPath(projectPath);
    const connection = await this.getConnection();
    let containers: DockerContainer[] = [];
    if (connection.state === "ready") {
      try {
        containers = await this.listProjectContainers(normalizedPath);
      } catch (error) {
        return {
          projectPath: normalizedPath,
          connection: {
            ...connection,
            state: "error",
            error: error instanceof Error ? error.message : String(error),
          },
          composeProjects: [],
          containers: [],
          capturedAt: this.options.now().toISOString(),
        };
      }
    }

    return {
      projectPath: normalizedPath,
      connection,
      composeProjects: [...new Set(containers.map((container) => container.composeProject).filter(Boolean))],
      containers,
      capturedAt: this.options.now().toISOString(),
    };
  }

  async operateProject(
    projectPath: string,
    operation: DockerProjectOperation
  ): Promise<DockerOperationResult> {
    const before = await this.getProjectSnapshot(projectPath);
    if (before.connection.state !== "ready" || !this.client) {
      throw new Error(before.connection.error ?? "Docker daemon is unavailable.");
    }

    const targets = before.containers.filter((container) => {
      if (operation === "start") return container.state !== "running";
      if (operation === "stop") return container.state === "running" || container.state === "paused";
      return true;
    });
    const failed: DockerOperationResult["failed"] = [];
    let succeeded = 0;

    for (const target of targets) {
      try {
        const container = this.client.getContainer(target.id);
        if (operation === "start") await container.start();
        else if (operation === "stop") await container.stop({ t: 10 });
        else await container.restart({ t: 10 });
        succeeded += 1;
      } catch (error) {
        failed.push({
          containerId: target.id,
          containerName: target.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      operation,
      attempted: targets.length,
      succeeded,
      failed,
      snapshot: await this.getProjectSnapshot(projectPath),
    };
  }

  async operateContainer(
    projectPath: string,
    containerId: string,
    operation: DockerContainerOperation
  ): Promise<DockerContainerOperationResult> {
    const before = await this.getProjectSnapshot(projectPath);
    if (before.connection.state !== "ready" || !this.client) {
      throw new Error(before.connection.error ?? "Docker daemon is unavailable.");
    }
    const target = before.containers.find((container) => container.id === containerId);
    if (!target) throw new Error("Container does not belong to the bound Docker project.");

    const shouldPerform =
      operation === "restart" ||
      (operation === "start" && target.state !== "running") ||
      (operation === "stop" && (target.state === "running" || target.state === "paused")) ||
      (operation === "pause" && target.state === "running") ||
      (operation === "unpause" && target.state === "paused");
    if (shouldPerform) {
      const container = this.client.getContainer(containerId);
      if (operation === "start") await container.start();
      else if (operation === "stop") await container.stop({ t: 10 });
      else if (operation === "restart") await container.restart({ t: 10 });
      else if (operation === "pause") await container.pause();
      else await container.unpause();
    }

    return {
      operation,
      containerId,
      containerName: target.name,
      performed: shouldPerform,
      snapshot: await this.getProjectSnapshot(projectPath),
    };
  }

  async subscribeContainerLogs(
    projectPath: string,
    containerId: string,
    onRecord: (record: DockerLogRecord) => void,
    options: { tail?: number; onDisconnect?: (error: string | null) => void } = {}
  ): Promise<DockerLogSubscription> {
    const snapshot = await this.getProjectSnapshot(projectPath);
    if (snapshot.connection.state !== "ready" || !this.client) {
      throw new Error(snapshot.connection.error ?? "Docker daemon is unavailable.");
    }
    const summary = snapshot.containers.find((container) => container.id === containerId);
    if (!summary) throw new Error("Container does not belong to the bound Docker project.");

    const container = this.client.getContainer(containerId);
    const inspection = await withTimeout(
      container.inspect(),
      this.options.timeoutMs,
      "Docker container inspection"
    );
    const output = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: Math.max(0, Math.min(options.tail ?? 200, 10_000)),
    });
    if (Buffer.isBuffer(output)) {
      throw new Error("Docker returned a finite log buffer instead of a follow stream.");
    }

    const stream = output as Readable;
    const lineDecoder = new DockerLogLineDecoder();
    const multiplexDecoder = new DockerMultiplexDecoder();
    let closed = false;

    const publish = (source: "stdout" | "stderr" | "console", payload: Buffer): void => {
      for (const line of lineDecoder.push(source, payload)) {
        onRecord({
          containerId: summary.id,
          containerName: summary.name,
          serviceName: summary.serviceName,
          ...line,
        });
      }
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (inspection.Config?.Tty) publish("console", bytes);
      else {
        for (const frame of multiplexDecoder.push(bytes)) publish(frame.stream, frame.payload);
      }
    };
    const finish = (error: string | null): void => {
      for (const line of lineDecoder.flush()) {
        onRecord({
          containerId: summary.id,
          containerName: summary.name,
          serviceName: summary.serviceName,
          ...line,
        });
      }
      options.onDisconnect?.(error);
      subscription.close();
    };
    const onEnd = (): void => finish(null);
    const onError = (error: Error): void => finish(error.message);
    const subscription: DockerLogSubscription = {
      close: () => {
        if (closed) return;
        closed = true;
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("close", onEnd);
        stream.off("error", onError);
        stream.destroy();
        this.logSubscriptions.delete(subscription);
      },
    };
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("close", onEnd);
    stream.once("error", onError);
    this.logSubscriptions.add(subscription);
    return subscription;
  }

  dispose(): void {
    for (const subscription of [...this.logSubscriptions]) subscription.close();
    this.client = null;
    this.resolvedSocket = null;
  }
}

export { normalizeProjectPath, parseUnixDockerHost };
