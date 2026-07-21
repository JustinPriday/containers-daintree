import type Docker from "dockerode";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { DockerodeBackend, parseUnixDockerHost } from "./dockerodeBackend.js";

const projectPath = "/projects/widget";

function fakeClient() {
  const operations = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    unpause: vi.fn(async () => undefined),
  };
  const summaries = [
    {
      Id: "container-web",
      Names: ["/widget-web-1"],
      Image: "widget-web:latest",
      State: "running",
      Status: "Up 20 seconds (healthy)",
      Labels: {
        "com.docker.compose.project": "widget",
        "com.docker.compose.service": "web",
        "com.docker.compose.project.working_dir": projectPath,
      },
    },
    {
      Id: "container-db",
      Names: ["/widget-db-1"],
      Image: "postgres:17",
      State: "exited",
      Status: "Exited (0) 5 minutes ago",
      Labels: {
        "com.docker.compose.project": "widget",
        "com.docker.compose.service": "db",
        "com.docker.compose.project.working_dir": `${projectPath}/`,
      },
    },
    {
      Id: "container-other",
      Names: ["/other-api-1"],
      Image: "other-api:latest",
      State: "running",
      Status: "Up 2 hours",
      Labels: {
        "com.docker.compose.project": "other",
        "com.docker.compose.service": "api",
        "com.docker.compose.project.working_dir": "/projects/other",
      },
    },
  ];
  const logStream = new PassThrough();
  const container = {
    ...operations,
    inspect: vi.fn(async () => ({ Config: { Tty: false } })),
    logs: vi.fn(async () => logStream),
  };
  const client = {
    ping: vi.fn(async () => "OK"),
    version: vi.fn(async () => ({
      Version: "29.4.1",
      ApiVersion: "1.54",
      Os: "linux",
      Arch: "arm64",
    })),
    info: vi.fn(async () => ({
      Containers: 3,
      ContainersRunning: 2,
      ContainersPaused: 0,
      ContainersStopped: 1,
      Images: 5,
    })),
    listContainers: vi.fn(async () => summaries),
    getContainer: vi.fn(() => container),
  };
  return { client: client as unknown as Docker, operations, container, logStream };
}

function logFrame(stream: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe("DockerodeBackend", () => {
  it("parses only local Unix Docker hosts", () => {
    expect(parseUnixDockerHost("unix:///tmp/docker.sock")).toBe("/tmp/docker.sock");
    expect(parseUnixDockerHost("/tmp/docker.sock")).toBe("/tmp/docker.sock");
    expect(parseUnixDockerHost("tcp://127.0.0.1:2375")).toBeNull();
  });

  it("reports unavailable without a socket", async () => {
    const backend = new DockerodeBackend({
      getDockerHost: () => undefined,
      socketCandidates: () => [],
    });

    const snapshot = await backend.getProjectSnapshot(projectPath);

    expect(snapshot.connection).toEqual({
      state: "unavailable",
      endpointLabel: null,
      daemon: null,
      error: "No supported local Docker socket was found.",
    });
    expect(snapshot.containers).toEqual([]);
  });

  it("returns only Compose containers whose working directory matches the bound target", async () => {
    const { client } = fakeClient();
    const backend = new DockerodeBackend({
      socketCandidates: () => [{ path: "/tmp/docker.sock", label: "Test Docker" }],
      pathExists: async () => true,
      createClient: () => client,
      now: () => new Date("2026-07-16T08:00:00.000Z"),
    });

    const snapshot = await backend.getProjectSnapshot(`${projectPath}/`);

    expect(snapshot.connection.state).toBe("ready");
    expect(snapshot.connection.daemon?.version).toBe("29.4.1");
    expect(snapshot.composeProjects).toEqual(["widget"]);
    expect(snapshot.containers.map((container) => container.serviceName)).toEqual(["db", "web"]);
    expect(snapshot.containers.find((container) => container.serviceName === "web")?.health).toBe(
      "healthy"
    );
    expect(snapshot.capturedAt).toBe("2026-07-16T08:00:00.000Z");
  });

  it("authorizes project operations from a fresh bound-project listing", async () => {
    const { client, operations } = fakeClient();
    const backend = new DockerodeBackend({
      socketCandidates: () => [{ path: "/tmp/docker.sock", label: "Test Docker" }],
      pathExists: async () => true,
      createClient: () => client,
    });

    const result = await backend.operateProject(projectPath, "start");

    expect(result).toMatchObject({ operation: "start", attempted: 1, succeeded: 1, failed: [] });
    expect(operations.start).toHaveBeenCalledTimes(1);
    expect(operations.stop).not.toHaveBeenCalled();
    expect(client.getContainer).toHaveBeenCalledWith("container-db");
    expect(client.getContainer).not.toHaveBeenCalledWith("container-other");
  });

  it("streams structured logs only for a container in the bound project", async () => {
    const { client, container, logStream } = fakeClient();
    const backend = new DockerodeBackend({
      socketCandidates: () => [{ path: "/tmp/docker.sock", label: "Test Docker" }],
      pathExists: async () => true,
      createClient: () => client,
    });
    const records: unknown[] = [];

    await expect(
      backend.subscribeContainerLogs(projectPath, "container-other", (record) => records.push(record))
    ).rejects.toThrow("does not belong");
    const subscription = await backend.subscribeContainerLogs(
      projectPath,
      "container-web",
      (record) => records.push(record),
      { tail: 25 }
    );
    logStream.write(
      logFrame(2, "2026-07-16T09:00:00.123456789Z database unavailable\n")
    );

    expect(container.logs).toHaveBeenCalledWith(
      expect.objectContaining({ follow: true, timestamps: true, tail: 25 })
    );
    expect(records).toEqual([
      {
        containerId: "container-web",
        containerName: "widget-web-1",
        serviceName: "web",
        stream: "stderr",
        timestamp: "2026-07-16T09:00:00.123456789Z",
        text: "database unavailable",
      },
    ]);
    subscription.close();
    expect(logStream.destroyed).toBe(true);
  });

  it("authorizes state-specific controls against a fresh project snapshot", async () => {
    const { client, operations } = fakeClient();
    const backend = new DockerodeBackend({
      socketCandidates: () => [{ path: "/tmp/docker.sock", label: "Test Docker" }],
      pathExists: async () => true,
      createClient: () => client,
    });

    const paused = await backend.operateContainer(projectPath, "container-web", "pause");
    const startNoop = await backend.operateContainer(projectPath, "container-web", "start");
    await expect(
      backend.operateContainer(projectPath, "container-other", "stop")
    ).rejects.toThrow("does not belong");

    expect(paused).toMatchObject({
      operation: "pause",
      containerId: "container-web",
      containerName: "widget-web-1",
      performed: true,
    });
    expect(startNoop.performed).toBe(false);
    expect(operations.pause).toHaveBeenCalledTimes(1);
    expect(operations.start).not.toHaveBeenCalled();
    expect(client.getContainer).not.toHaveBeenCalledWith("container-other");
  });

  it.runIf(process.env.DOCKER_LIVE_TEST === "1")(
    "connects to the local Docker daemon through the production adapter",
    async () => {
      const backend = new DockerodeBackend();
      const liveProjectPath = process.env.DOCKER_LIVE_PROJECT_PATH ?? process.cwd();

      const snapshot = await backend.getProjectSnapshot(liveProjectPath);

      expect(snapshot.connection.state).toBe("ready");
      expect(snapshot.connection.daemon?.version).toMatch(/^\d+\./);
      expect(snapshot.projectPath).toBe(liveProjectPath);
      backend.dispose();
    }
  );

  it.runIf(process.env.DOCKER_LIVE_LOG_TEST === "1")(
    "receives a structured line from a disposable Compose container",
    async () => {
      const liveProjectPath = process.env.DOCKER_LIVE_PROJECT_PATH;
      if (!liveProjectPath) throw new Error("DOCKER_LIVE_PROJECT_PATH is required");
      const backend = new DockerodeBackend();
      const snapshot = await backend.getProjectSnapshot(liveProjectPath);
      const target = snapshot.containers[0];
      expect(target).toBeDefined();

      const record = await new Promise<unknown>(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for a Docker log")), 4_000);
        try {
          await backend.subscribeContainerLogs(liveProjectPath, target!.id, (next) => {
            if (!next.text.includes("containers-live")) return;
            clearTimeout(timer);
            resolve(next);
          });
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });

      expect(record).toMatchObject({
        containerId: target?.id,
        serviceName: "logger",
        stream: "stdout",
        text: expect.stringContaining("containers-live"),
      });
      backend.dispose();
    }
  );

  it.runIf(process.env.DOCKER_LIVE_CONTROL_TEST === "1")(
    "pauses and unpauses a disposable Compose container",
    async () => {
      const liveProjectPath = process.env.DOCKER_LIVE_PROJECT_PATH;
      if (!liveProjectPath) throw new Error("DOCKER_LIVE_PROJECT_PATH is required");
      const backend = new DockerodeBackend();
      const snapshot = await backend.getProjectSnapshot(liveProjectPath);
      const target = snapshot.containers[0];
      expect(target).toBeDefined();

      const paused = await backend.operateContainer(liveProjectPath, target!.id, "pause");
      expect(paused.performed).toBe(true);
      expect(paused.snapshot.containers[0]?.state).toBe("paused");
      const unpaused = await backend.operateContainer(liveProjectPath, target!.id, "unpause");
      expect(unpaused.performed).toBe(true);
      expect(unpaused.snapshot.containers[0]?.state).toBe("running");
      backend.dispose();
    }
  );
});
