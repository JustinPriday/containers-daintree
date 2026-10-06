import { createMockHost as createSdkMockHost } from "@daintreehq/plugin-sdk/testing";
import type { PluginWorktreeSnapshot } from "@daintreehq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import type {
  DockerBackend,
  DockerContainerOperation,
  DockerContainerOperationResult,
  DockerLogRecord,
  DockerLogSubscription,
  DockerOperationResult,
  DockerProjectOperation,
  DockerProjectSnapshot,
} from "./docker/types.js";
import { activate } from "./index.js";
import { createDockerPanelBinding } from "./shared/binding.js";

const createMockHost = (
  options: Parameters<typeof createSdkMockHost>[0] = {},
) => createSdkMockHost({ ...options, pluginId: "justinpriday.containers" });
function mountPanel(host: ReturnType<typeof createMockHost>, panelId: string) {
  host.simulatePanelLifecycleChange({
    panelId,
    pluginId: host.pluginId,
    panelKindId: host.panelKindId("console"),
    phase: "mounted",
  });
}

function worktree(
  id: string,
  name: string,
  path: string,
  isCurrent = false,
): PluginWorktreeSnapshot {
  return {
    id,
    worktreeId: id,
    name,
    path,
    isCurrent,
    linked: null,
    status: null,
  };
}

function snapshot(projectPath: string): DockerProjectSnapshot {
  return {
    projectPath,
    connection: {
      state: "ready",
      endpointLabel: "Test Docker",
      daemon: {
        version: "29.4.1",
        apiVersion: "1.54",
        os: "linux",
        arch: "arm64",
        containers: 1,
        containersRunning: 1,
        containersPaused: 0,
        containersStopped: 0,
        images: 1,
      },
      error: null,
    },
    composeProjects: ["fixture"],
    containers: [
      {
        id: "container-1",
        name: "fixture-web-1",
        serviceName: "web",
        image: "fixture-web:latest",
        state: "running",
        status: "Up 10 seconds",
        health: null,
        composeProject: "fixture",
        workingDir: projectPath,
      },
    ],
    capturedAt: "2026-07-16T08:00:00.000Z",
  };
}

class FakeDockerBackend implements DockerBackend {
  readonly snapshots: string[] = [];
  readonly operations: Array<{
    projectPath: string;
    operation: DockerProjectOperation;
  }> = [];
  readonly containerOperations: Array<{
    projectPath: string;
    containerId: string;
    operation: DockerContainerOperation;
  }> = [];
  disposed = false;
  readonly logSubscriptions: Array<{
    projectPath: string;
    containerId: string;
    onRecord: (record: DockerLogRecord) => void;
    closed: boolean;
  }> = [];
  readonly logSubscribeRequests: Array<{
    projectPath: string;
    containerId: string;
  }> = [];
  logSubscribeGate: Promise<void> | null = null;

  async getProjectSnapshot(
    projectPath: string,
  ): Promise<DockerProjectSnapshot> {
    this.snapshots.push(projectPath);
    return snapshot(projectPath);
  }

  async operateProject(
    projectPath: string,
    operation: DockerProjectOperation,
  ): Promise<DockerOperationResult> {
    this.operations.push({ projectPath, operation });
    return {
      operation,
      attempted: 1,
      succeeded: 1,
      failed: [],
      snapshot: snapshot(projectPath),
    };
  }

  async subscribeContainerLogs(
    projectPath: string,
    containerId: string,
    onRecord: (record: DockerLogRecord) => void,
  ): Promise<DockerLogSubscription> {
    this.logSubscribeRequests.push({ projectPath, containerId });
    await this.logSubscribeGate;
    const record = { projectPath, containerId, onRecord, closed: false };
    this.logSubscriptions.push(record);
    return {
      close: () => {
        record.closed = true;
      },
    };
  }

  async operateContainer(
    projectPath: string,
    containerId: string,
    operation: DockerContainerOperation,
  ): Promise<DockerContainerOperationResult> {
    this.containerOperations.push({ projectPath, containerId, operation });
    return {
      operation,
      containerId,
      containerName: "fixture-web-1",
      performed: true,
      snapshot: snapshot(projectPath),
    };
  }

  dispose(): void {
    this.disposed = true;
  }
}

async function activateWithDocker(host: ReturnType<typeof createMockHost>) {
  const dockerBackend = new FakeDockerBackend();
  const dispose = await activate(host, { dockerBackend });
  return { dockerBackend, dispose };
}

describe("Containers activation", () => {
  it("opens a panel with a stable active-worktree binding", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    host.setDispatchResult("panel.openPluginPanel", {
      ok: true,
      result: { panelId: "p-1" },
    });
    await activateWithDocker(host);

    const action = host.registeredActions.find(
      (record) => record.descriptor.id === "open",
    );
    expect(action).toBeDefined();
    await action?.handler(undefined);

    expect(host.dispatchedActions).toContainEqual({
      actionId: "panel.openPluginPanel",
      args: {
        kind: "justinpriday.containers.console",
        worktreeId: "wt-feature",
        initialArgs: {
          schemaVersion: 2,
          projectId: "test-project",
          worktreeId: "wt-feature",
          worktreeName: "feature",
          worktreePath: "/repo/feature",
          dockerProjectPath: "/repo/feature",
        },
        reuseExisting: true,
      },
    });
  });

  it("uses the visible project's current worktree when several projects are loaded", async () => {
    const neo = worktree("wt-neo", "neo", "/repo/neo", true);
    const plugin = worktree(
      "wt-plugin",
      "DockerPlugin",
      "/repo/DockerPlugin",
      true,
    );
    const host = createMockHost({
      activeWorktree: neo,
      worktrees: [neo, plugin],
    });
    host.setDispatchResult("worktree.getCurrent", {
      ok: true,
      result: {
        worktree: {
          id: plugin.id,
          path: plugin.path,
          branch: "main",
          isActive: true,
          isMain: true,
          issueNumber: null,
          issueTitle: null,
          prNumber: null,
          prTitle: null,
          prUrl: null,
          status: null,
          lastCommit: null,
        },
      },
    });
    host.setDispatchResult("panel.openPluginPanel", {
      ok: true,
      result: { panelId: "p-2" },
    });
    await activateWithDocker(host);

    const action = host.registeredActions.find(
      (record) => record.descriptor.id === "open",
    );
    await action?.handler(undefined);

    expect(host.dispatchedActions).toContainEqual({
      actionId: "panel.openPluginPanel",
      args: expect.objectContaining({
        worktreeId: "wt-plugin",
        initialArgs: expect.objectContaining({
          worktreeId: "wt-plugin",
          worktreePath: "/repo/DockerPlugin",
        }),
      }),
    });
  });

  it("requires an explicit pick when no worktree is active", async () => {
    const feature = worktree("wt-feature", "feature", "/repo/feature");
    const main = worktree("wt-main", "main", "/repo/main");
    const host = createMockHost({
      activeWorktree: null,
      worktrees: [feature, main],
    });
    host.simulateQuickPickResponse({
      id: main.id,
      label: main.name,
      detail: main.path,
    });
    host.setDispatchResult("panel.openPluginPanel", {
      ok: true,
      result: { panelId: "p-2" },
    });
    await activateWithDocker(host);

    const action = host.registeredActions.find(
      (record) => record.descriptor.id === "open",
    );
    await action?.handler(undefined);

    expect(host.showQuickPickCalls).toHaveLength(1);
    const panelDispatch = host.dispatchedActions.find(
      (record) => record.actionId === "panel.openPluginPanel",
    );
    expect(panelDispatch?.args).toMatchObject({
      worktreeId: "wt-main",
      initialArgs: { worktreeId: "wt-main", worktreePath: "/repo/main" },
    });
  });

  it("opens no panel when worktree selection is cancelled", async () => {
    const host = createMockHost({
      activeWorktree: null,
      worktrees: [
        worktree("wt-a", "a", "/repo/a"),
        worktree("wt-b", "b", "/repo/b"),
      ],
    });
    await activateWithDocker(host);

    const action = host.registeredActions.find(
      (record) => record.descriptor.id === "open",
    );
    const result = await action?.handler(undefined);

    expect(result).toEqual({ opened: false });
    expect(
      host.dispatchedActions.filter(
        (record) => record.actionId === "panel.openPluginPanel",
      ),
    ).toHaveLength(0);
  });

  it("persists a Docker target by panel without changing worktree ownership", async () => {
    const feature = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: feature,
      worktrees: [feature],
    });
    await activateWithDocker(host);
    mountPanel(host, "panel-feature");
    mountPanel(host, "panel-other");
    const save = host.registeredHandlers.find(
      (record) => record.channel === "binding.setDockerProjectPath",
    );
    const resolve = host.registeredHandlers.find(
      (record) => record.channel === "binding.resolve",
    );
    const binding = createDockerPanelBinding({
      id: "wt-feature",
      name: "feature",
      path: "/repo/feature",
    });
    const context = {
      projectId: "test-project",
      worktreeId: "wt-feature",
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };

    const saved = await save?.handler(context, {
      panelId: "panel-feature",
      binding,
      dockerProjectPath: "/repo/main",
    });
    const restored = await resolve?.handler(context, {
      panelId: "panel-feature",
      initialArgs: binding,
    });
    const otherPanel = await resolve?.handler(context, {
      panelId: "panel-other",
      initialArgs: binding,
    });

    expect(saved).toMatchObject({
      worktreeId: "wt-feature",
      worktreePath: "/repo/feature",
      dockerProjectPath: "/repo/main",
    });
    expect(restored).toEqual(saved);
    expect(otherPanel).toMatchObject({
      ...binding,
      schemaVersion: 2,
      projectId: "test-project",
    });
  });

  it("persists panel UI preferences across panel restoration", async () => {
    const feature = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: feature,
      worktrees: [feature],
    });
    await activateWithDocker(host);
    mountPanel(host, "panel-feature");
    mountPanel(host, "panel-other");
    const save = host.registeredHandlers.find(
      (record) => record.channel === "preferences.save",
    );
    const resolve = host.registeredHandlers.find(
      (record) => record.channel === "preferences.resolve",
    );
    const context = {
      projectId: "test-project",
      worktreeId: "wt-feature",
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };

    expect(
      await resolve?.handler(context, { panelId: "panel-feature" }),
    ).toEqual({
      selectedContainerId: null,
      showServices: true,
    });

    await save?.handler(context, {
      panelId: "panel-feature",
      preferences: {
        selectedContainerId: "container-1",
        showServices: false,
      },
    });

    expect(
      await resolve?.handler(context, { panelId: "panel-feature" }),
    ).toEqual({
      selectedContainerId: "container-1",
      showServices: false,
    });
    expect(await resolve?.handler(context, { panelId: "panel-other" })).toEqual(
      {
        selectedContainerId: null,
        showServices: true,
      },
    );
  });

  it("refreshes the worktree-bound Docker project and sets a native panel badge", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    host.setDispatchResult("panel.openPluginPanel", {
      ok: true,
      result: { panelId: "p-docker" },
    });
    const { dockerBackend } = await activateWithDocker(host);

    const action = host.registeredActions.find(
      (record) => record.descriptor.id === "refresh",
    );
    await action?.handler(undefined);

    expect(dockerBackend.snapshots).toEqual(["/repo/feature"]);
    expect(host.setPanelBadgeCalls).toContainEqual({
      panelId: "p-docker",
      badge: {
        kind: "dot",
        color: "success",
        tooltip: "All 1 containers running",
      },
    });
    expect(host.postToPanelCalls).toContainEqual({
      channel: "docker.project.snapshot",
      payload: expect.objectContaining({ projectPath: "/repo/feature" }),
      panelId: "p-docker",
    });
  });

  it("uses the persisted panel Docker target for project operations", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    host.setDispatchResult("panel.openPluginPanel", {
      ok: true,
      result: { panelId: "p-docker" },
    });
    const { dockerBackend } = await activateWithDocker(host);
    const open = host.registeredActions.find(
      (record) => record.descriptor.id === "open",
    );
    await open?.handler({ dockerProjectPath: "/repo/main" });

    const restart = host.registeredActions.find(
      (record) => record.descriptor.id === "restart",
    );
    await restart?.handler(undefined);

    expect(dockerBackend.operations).toEqual([
      { projectPath: "/repo/main", operation: "restart" },
    ]);
  });

  it("targets sequenced log batches to the subscribing panel and disconnects independently", async () => {
    const first = worktree("wt-first", "first", "/repo/first", true);
    const second = worktree("wt-second", "second", "/repo/second");
    const host = createMockHost({
      activeWorktree: first,
      worktrees: [first, second],
    });
    const { dockerBackend } = await activateWithDocker(host);
    mountPanel(host, "panel-first");
    mountPanel(host, "panel-second");
    const connect = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.connect",
    );
    const disconnect = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.disconnect",
    );
    const context = {
      projectId: "test-project",
      worktreeId: "wt-first",
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };
    const firstBinding = createDockerPanelBinding(first);
    const secondBinding = createDockerPanelBinding(second);

    await connect?.handler(context, {
      panelId: "panel-first",
      initialArgs: firstBinding,
      containerIds: ["container-first"],
    });
    await connect?.handler(context, {
      panelId: "panel-second",
      initialArgs: secondBinding,
      containerIds: ["container-second"],
    });
    dockerBackend.logSubscriptions[0]?.onRecord({
      containerId: "container-first",
      containerName: "first-web-1",
      serviceName: "web",
      stream: "stdout",
      timestamp: "2026-07-16T09:00:00Z",
      text: "first only",
    });
    dockerBackend.logSubscriptions[1]?.onRecord({
      containerId: "container-second",
      containerName: "second-api-1",
      serviceName: "api",
      stream: "stderr",
      timestamp: null,
      text: "second only",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(host.postToPanelCalls).toContainEqual({
      channel: "docker.logs.batch",
      panelId: "panel-first",
      payload: expect.objectContaining({
        containerId: "container-first",
        sequence: 0,
        records: [expect.objectContaining({ text: "first only" })],
      }),
    });
    expect(host.postToPanelCalls).toContainEqual({
      channel: "docker.logs.batch",
      panelId: "panel-second",
      payload: expect.objectContaining({
        containerId: "container-second",
        sequence: 0,
        records: [expect.objectContaining({ text: "second only" })],
      }),
    });

    await disconnect?.handler(context, { panelId: "panel-first" });
    expect(dockerBackend.logSubscriptions[0]?.closed).toBe(true);
    expect(dockerBackend.logSubscriptions[1]?.closed).toBe(false);
  });

  it("streams several project containers into one globally sequenced panel feed", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    const { dockerBackend } = await activateWithDocker(host);
    mountPanel(host, "panel-project");
    const connect = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.connect",
    );
    const disconnect = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.disconnect",
    );
    const context = {
      projectId: "test-project",
      worktreeId: active.id,
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };

    const result = await connect?.handler(context, {
      panelId: "panel-project",
      initialArgs: createDockerPanelBinding(active),
      containerIds: ["container-api", "container-worker"],
    });
    expect(result).toEqual({
      containerIds: ["container-api", "container-worker"],
      connected: true,
    });

    dockerBackend.logSubscriptions[0]?.onRecord({
      containerId: "container-api",
      containerName: "fixture-api-1",
      serviceName: "api",
      stream: "stdout",
      timestamp: null,
      text: "api record",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    dockerBackend.logSubscriptions[1]?.onRecord({
      containerId: "container-worker",
      containerName: "fixture-worker-1",
      serviceName: "worker",
      stream: "stdout",
      timestamp: null,
      text: "worker record",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const batches = host.postToPanelCalls.filter(
      (call) =>
        call.channel === "docker.logs.batch" &&
        call.panelId === "panel-project",
    );
    expect(
      batches.map((entry) => (entry.payload as { sequence: number }).sequence),
    ).toEqual([0, 1]);
    expect(
      batches.map(
        (entry) => (entry.payload as { containerId: string }).containerId,
      ),
    ).toEqual(["container-api", "container-worker"]);

    await disconnect?.handler(context, { panelId: "panel-project" });
    expect(dockerBackend.logSubscriptions.every((entry) => entry.closed)).toBe(
      true,
    );
  });

  it("routes a container control through the panel's authoritative Docker target", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    const { dockerBackend } = await activateWithDocker(host);
    mountPanel(host, "panel-container");
    const operate = host.registeredHandlers.find(
      (record) => record.channel === "docker.container.operate",
    );
    const context = {
      projectId: "test-project",
      worktreeId: active.id,
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };
    const binding = {
      ...createDockerPanelBinding(active),
      dockerProjectPath: "/repo/shared-main",
    };

    await operate?.handler(context, {
      panelId: "panel-container",
      initialArgs: binding,
      containerId: "container-1",
      operation: "pause",
    });

    expect(dockerBackend.containerOperations).toEqual([
      {
        projectPath: "/repo/shared-main",
        containerId: "container-1",
        operation: "pause",
      },
    ]);
  });

  it("copies the renderer-formatted visible console through the host clipboard", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    await activateWithDocker(host);
    const copy = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.copy",
    );
    const context = {
      projectId: "test-project",
      worktreeId: active.id,
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };

    const result = await copy?.handler(context, {
      text: "api | ready\nworker | started",
    });

    expect(result).toEqual({ copied: true });
    expect(host.clipboardWriteCalls).toEqual(["api | ready\nworker | started"]);
  });

  it("closes a log stream that finishes connecting after its panel disconnects", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    const { dockerBackend } = await activateWithDocker(host);
    mountPanel(host, "panel-late");
    let release!: () => void;
    dockerBackend.logSubscribeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connect = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.connect",
    );
    const disconnect = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.disconnect",
    );
    const context = {
      projectId: "test-project",
      worktreeId: active.id,
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };
    const connecting = connect?.handler(context, {
      panelId: "panel-late",
      initialArgs: createDockerPanelBinding(active),
      containerIds: ["container-late"],
    });
    while (dockerBackend.logSubscribeRequests.length === 0)
      await Promise.resolve();

    await disconnect?.handler(context, { panelId: "panel-late" });
    release();
    await connecting;

    expect(dockerBackend.logSubscriptions[0]?.closed).toBe(true);
  });

  it("batches a synthetic 1 MiB burst into bounded sequenced panel deliveries", async () => {
    const active = worktree("wt-feature", "feature", "/repo/feature", true);
    const host = createMockHost({
      activeWorktree: active,
      worktrees: [active],
    });
    const { dockerBackend } = await activateWithDocker(host);
    mountPanel(host, "panel-burst");
    const connect = host.registeredHandlers.find(
      (record) => record.channel === "docker.logs.connect",
    );
    const context = {
      projectId: "test-project",
      worktreeId: active.id,
      webContentsId: 1,
      pluginId: "justinpriday.containers",
    };
    await connect?.handler(context, {
      panelId: "panel-burst",
      initialArgs: createDockerPanelBinding(active),
      containerIds: ["container-burst"],
    });
    const subscription = dockerBackend.logSubscriptions[0];
    const text = "x".repeat(1024);
    for (let index = 0; index < 1024; index += 1) {
      subscription?.onRecord({
        containerId: "container-burst",
        containerName: "fixture-burst-1",
        serviceName: "burst",
        stream: "stdout",
        timestamp: null,
        text,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    const batches = host.postToPanelCalls.filter(
      (call) =>
        call.channel === "docker.logs.batch" && call.panelId === "panel-burst",
    );

    expect(batches.length).toBeGreaterThanOrEqual(32);
    expect(
      batches.map((batch) => (batch.payload as { sequence: number }).sequence),
    ).toEqual(Array.from({ length: batches.length }, (_, index) => index));
    expect(
      batches.flatMap(
        (batch) => (batch.payload as { records: DockerLogRecord[] }).records,
      ),
    ).toHaveLength(1024);
  });

  it("disposes the Docker backend when Daintree unloads the plugin", async () => {
    const host = createMockHost();
    const { dockerBackend, dispose } = await activateWithDocker(host);

    dispose();

    expect(dockerBackend.disposed).toBe(true);
  });
});

const ipc = {
  projectId: "test-project",
  worktreeId: "wt-feature",
  webContentsId: 1,
  pluginId: "justinpriday.containers",
};
async function setupPanel(panelId = "panel-contract") {
  const active = worktree("wt-feature", "feature", "/repo/feature", true);
  const host = createMockHost({ activeWorktree: active, worktrees: [active] });
  const resources = await activateWithDocker(host);
  mountPanel(host, panelId);
  const call = (channel: string, args: unknown, context = ipc) => {
    const handler = host.registeredHandlers.find(
      (entry) => entry.channel === channel,
    );
    if (!handler) throw new Error(`Missing test handler ${channel}`);
    return handler.handler(context, args);
  };
  const binding = createDockerPanelBinding(active);
  await call("binding.resolve", { panelId, initialArgs: binding });
  return { ...resources, active, host, call, binding, panelId };
}

describe("Daintree 0.41 worker contracts", () => {
  it("keeps a header refresh on its saved panel target", async () => {
    const { host, call, panelId, binding, dockerBackend, dispose } =
      await setupPanel();
    await call("binding.setDockerProjectPath", {
      panelId,
      binding,
      dockerProjectPath: "/repo/shared",
    });
    await host.registeredActions
      .find((entry) => entry.descriptor.id === "refresh")
      ?.handler({ panelId });
    expect(dockerBackend.snapshots).toEqual(["/repo/shared"]);
    expect(host.dispatchedActions).toEqual([]);
    dispose();
  });

  it("refuses background-owner verification without changing its binding", async () => {
    const { host, call, panelId, binding, dockerBackend, dispose } =
      await setupPanel();
    host.simulateWorktreesResult({
      status: "ok",
      projectId: "another-project",
      worktrees: [worktree("wt-other", "other", "/other")],
    });
    await expect(
      call("docker.project.operate", { panelId, operation: "restart" }),
    ).rejects.toThrow(/Focus this panel/);
    expect(dockerBackend.operations).toEqual([]);
    host.simulateWorktreesResult(null);
    expect(await call("binding.resolve", { panelId })).toMatchObject({
      ...binding,
      schemaVersion: 2,
      projectId: "test-project",
    });
    dispose();
  });

  it("rejects deleted worktrees and foreign or unknown panel callers", async () => {
    const { host, call, panelId, dispose } = await setupPanel();
    await expect(
      call("binding.resolve", { panelId: "foreign-panel" }),
    ).rejects.toThrow(/unavailable/);
    await expect(
      call(
        "binding.resolve",
        { panelId },
        { ...ipc, pluginId: "foreign-plugin" },
      ),
    ).rejects.toThrow(/caller/);
    await expect(
      call(
        "binding.resolve",
        { panelId },
        { ...ipc, projectId: "foreign-project" },
      ),
    ).rejects.toThrow(/Focus this panel/);
    host.simulateWorktreesResult({
      status: "ok",
      projectId: "test-project",
      worktrees: [],
    });
    await expect(call("binding.resolve", { panelId })).rejects.toThrow(
      /no longer available/,
    );
    dispose();
  });

  it("refuses a fabricated binding when saving a target", async () => {
    const { host, call, binding, dispose } = await setupPanel();
    mountPanel(host, "panel-fabricated");
    await expect(
      call("binding.setDockerProjectPath", {
        panelId: "panel-fabricated",
        binding: { ...binding, worktreePath: "/forged" },
        dockerProjectPath: "/new",
      }),
    ).rejects.toThrow(/no longer available/);
    dispose();
  });

  it("serializes target persistence across panels", async () => {
    const { host, call, panelId, binding, dispose } = await setupPanel();
    mountPanel(host, "panel-second");
    await call("binding.resolve", {
      panelId: "panel-second",
      initialArgs: binding,
    });
    await Promise.all([
      call("binding.setDockerProjectPath", {
        panelId,
        binding,
        dockerProjectPath: "/first",
      }),
      call("binding.setDockerProjectPath", {
        panelId: "panel-second",
        binding,
        dockerProjectPath: "/second",
      }),
    ]);
    expect(await call("binding.resolve", { panelId })).toMatchObject({
      dockerProjectPath: "/first",
    });
    expect(
      await call("binding.resolve", { panelId: "panel-second" }),
    ).toMatchObject({ dockerProjectPath: "/second" });
    dispose();
  });

  it("pauses streams on hide, removes stored targets on removal and cleans up idempotently", async () => {
    const { host, call, panelId, dockerBackend, dispose } = await setupPanel();
    await call("docker.logs.connect", {
      panelId,
      containerIds: ["container-1"],
    });
    host.simulatePanelLifecycleChange({
      panelId,
      pluginId: host.pluginId,
      panelKindId: host.panelKindId("console"),
      phase: "hidden",
    });
    expect(dockerBackend.logSubscriptions[0]?.closed).toBe(true);
    await expect(
      call("docker.logs.connect", { panelId, containerIds: ["container-1"] }),
    ).rejects.toThrow(/inactive/);
    mountPanel(host, panelId);
    await call("docker.logs.connect", {
      panelId,
      containerIds: ["container-1"],
    });
    host.simulatePanelLifecycleChange({
      panelId,
      pluginId: host.pluginId,
      panelKindId: host.panelKindId("console"),
      phase: "removed",
    });
    await expect(call("binding.resolve", { panelId })).rejects.toThrow(
      /unavailable/,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      await host.storage.get<Record<string, unknown>>("panel-bindings", "user"),
    ).not.toHaveProperty(panelId);
    expect(dockerBackend.logSubscriptions.every((entry) => entry.closed)).toBe(
      true,
    );
    dispose();
    dispose();
    expect(dockerBackend.disposed).toBe(true);
  });

  it("serializes mutations across panels controlling the same Docker target", async () => {
    const { host, call, panelId, binding, dockerBackend, dispose } =
      await setupPanel();
    mountPanel(host, "panel-other-resource");
    await call("binding.resolve", {
      panelId: "panel-other-resource",
      initialArgs: binding,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = dockerBackend.operateProject.bind(dockerBackend);
    let active = 0;
    let peak = 0;
    dockerBackend.operateProject = async (target, operation) => {
      active++;
      peak = Math.max(peak, active);
      await gate;
      const result = await original(target, operation);
      active--;
      return result;
    };
    const first = call("docker.project.operate", {
      panelId,
      operation: "start",
    });
    const second = call("docker.project.operate", {
      panelId: "panel-other-resource",
      operation: "restart",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([first, second]);
    expect(peak).toBe(1);
    expect(dockerBackend.operations.map((entry) => entry.operation)).toEqual([
      "start",
      "restart",
    ]);
    dispose();
  });

  it("restores the badge after a failed operation and publishes newer revisions", async () => {
    const { host, call, panelId, dockerBackend, dispose } = await setupPanel();
    dockerBackend.operateProject = async () => {
      throw new Error("operation failed");
    };
    await expect(
      call("docker.project.operate", { panelId, operation: "stop" }),
    ).rejects.toThrow("operation failed");
    expect(host.setPanelBadgeCalls.at(-1)?.badge?.color).toBe("success");
    const first = (await call("docker.project.get", {
      panelId,
    })) as DockerProjectSnapshot;
    const next = (await call("docker.project.get", {
      panelId,
    })) as DockerProjectSnapshot;
    expect(next.epoch).toBe(first.epoch);
    expect(next.revision).toBeGreaterThan(first.revision!);
    dispose();
  });

  it("keeps encoded pushes and recovery below transport caps for a huge Unicode record", async () => {
    const { host, call, panelId, dockerBackend, dispose } = await setupPanel();
    await call("docker.logs.connect", {
      panelId,
      containerIds: ["container-1"],
    });
    dockerBackend.logSubscriptions[0]!.onRecord({
      containerId: "container-1",
      containerName: "api",
      serviceName: "api",
      stream: "stdout",
      timestamp: null,
      text: "😀".repeat(2 * 1024 * 1024),
    });
    const push = host.postToPanelCalls.find(
      (entry) => entry.channel === "docker.logs.batch",
    )!;
    expect(Buffer.byteLength(JSON.stringify(push.payload))).toBeLessThan(
      128 * 1024,
    );
    expect(JSON.stringify(push.payload)).toContain("line truncated");
    const recovered = await call("docker.logs.recover", { panelId });
    expect(Buffer.byteLength(JSON.stringify(recovered))).toBeLessThan(
      1024 * 1024,
    );
    expect(recovered).toMatchObject({ batches: [push.payload] });
    dispose();
  });
});

it("releases worker resources on partial activation failure", async () => {
  const host = createMockHost();
  const backend = new FakeDockerBackend();
  vi.spyOn(host, "registerHandler").mockRejectedValue(
    new Error("registration failed"),
  );
  await expect(activate(host, { dockerBackend: backend })).rejects.toThrow(
    "registration failed",
  );
  expect(backend.disposed).toBe(true);
});

it("rejects oversized UTF-8 copy before writing the clipboard", async () => {
  const { host, call, dispose } = await setupPanel();
  await expect(
    call("docker.logs.copy", { text: "😀".repeat(300000) }),
  ).rejects.toThrow(/Copy is limited/);
  expect(host.clipboardWriteCalls).toEqual([]);
  dispose();
});

it("invalidates an oversized push and lets the view pull the complete bounded snapshot", async () => {
  const { host, call, panelId, dockerBackend, dispose } = await setupPanel();
  dockerBackend.getProjectSnapshot = async (target) => ({
    ...snapshot(target),
    containers: Array.from({ length: 5000 }, (_, index) => ({
      ...snapshot(target).containers[0]!,
      id: String(index),
    })),
  });
  await host.registeredActions
    .find((entry) => entry.descriptor.id === "refresh")!
    .handler({ panelId });
  const result = (await call("docker.project.get", {
    panelId,
  })) as DockerProjectSnapshot;
  expect(result.containers).toHaveLength(5000);
  expect(host.postToPanelCalls.at(-1)?.channel).toBe(
    "docker.project.invalidated",
  );
  expect(
    Buffer.byteLength(JSON.stringify(host.postToPanelCalls.at(-1)?.payload)),
  ).toBeLessThan(1024);
  dispose();
});
