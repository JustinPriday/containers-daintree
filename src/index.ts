import path from "node:path";
import type {
  PluginHostApi,
  PluginPanelBadge,
  PluginQuickPickItem,
  PluginWorktreeSnapshot,
} from "@daintreehq/plugin-sdk";
import { z } from "zod";
import { DockerodeBackend } from "./docker/dockerodeBackend.js";
import {
  dockerOperationResultSchema,
  dockerContainerOperationResultSchema,
  dockerContainerOperationSchema,
  dockerLogBatchSchema,
  dockerProjectOperationSchema,
  dockerProjectSnapshotSchema,
  type DockerBackend,
  type DockerLogRecord,
  type DockerLogSubscription,
  type DockerProjectOperation,
  type DockerProjectSnapshot,
} from "./docker/types.js";
import {
  createDockerPanelBinding,
  dockerPanelBindingSchema,
  parseDockerPanelBinding,
  withDockerProjectPath,
  type DockerPanelBinding,
} from "./shared/binding.js";

const PANEL_KIND = "justinpriday.containers.console";
const TARGETS_STORAGE_KEY = "panel-docker-project-paths";
const BINDINGS_STORAGE_KEY = "panel-bindings";

const openArgsSchema = z
  .object({
    worktreeId: z.string().min(1).optional(),
    dockerProjectPath: z.string().min(1).optional(),
    reuseExisting: z.boolean().optional(),
  })
  .optional();

const resolveBindingArgsSchema = z.object({
  panelId: z.string().min(1),
  initialArgs: z.record(z.string(), z.unknown()).optional(),
});

const saveBindingArgsSchema = z.object({
  panelId: z.string().min(1),
  binding: dockerPanelBindingSchema,
  dockerProjectPath: z.string().min(1),
});

const dockerProjectArgsSchema = z.object({
  panelId: z.string().min(1),
  initialArgs: z.record(z.string(), z.unknown()).optional(),
});

const dockerProjectOperationArgsSchema = dockerProjectArgsSchema.extend({
  operation: dockerProjectOperationSchema,
});

const dockerContainerOperationArgsSchema = dockerProjectArgsSchema.extend({
  containerId: z.string().min(1),
  operation: dockerContainerOperationSchema,
});

const dockerLogsConnectArgsSchema = dockerProjectArgsSchema.extend({
  containerIds: z.array(z.string().min(1)).max(100),
  tail: z.number().int().min(0).max(10_000).optional(),
});

const dockerLogsDisconnectArgsSchema = z.object({
  panelId: z.string().min(1),
});

const copyLogsArgsSchema = z.object({
  text: z.string().max(8 * 1024 * 1024),
});

const copyLogsResultSchema = z.object({
  copied: z.literal(true),
});

const dockerLogsConnectResultSchema = z.object({
  containerIds: z.array(z.string()),
  connected: z.literal(true),
});

const dockerLogsDisconnectResultSchema = z.object({
  disconnected: z.boolean(),
});

const dockerLogsDisconnectedEventSchema = z.object({
  containerId: z.string(),
  error: z.string().nullable(),
});

type TargetOverrides = Record<string, string>;
type PanelBindings = Record<string, DockerPanelBinding>;

interface PanelLogSession {
  containerId: string;
  records: DockerLogRecord[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  subscription: DockerLogSubscription | null;
}

interface PanelLogGroup {
  sequence: number;
  sessions: Map<string, PanelLogSession>;
}

export interface ContainersPluginDependencies {
  dockerBackend?: DockerBackend;
}

function parseOpenArgs(args: unknown): z.infer<typeof openArgsSchema> {
  const result = openArgsSchema.safeParse(args);
  return result.success ? result.data : undefined;
}

async function chooseWorktree(
  host: PluginHostApi,
  requestedWorktreeId?: string
): Promise<PluginWorktreeSnapshot | null> {
  const worktrees = await host.getWorktrees();
  if (requestedWorktreeId) {
    const requested = worktrees.find(
      (worktree) =>
        worktree.id === requestedWorktreeId || worktree.worktreeId === requestedWorktreeId
    );
    if (!requested) throw new Error(`Worktree not found: ${requestedWorktreeId}`);
    return requested;
  }

  if (worktrees.length === 0) return null;

  // getActiveWorktree() is intentionally global and returns the first current
  // worktree across every loaded project. The renderer action is scoped to the
  // project the user is actually looking at, so prefer it for panel ownership.
  const currentResult = await host.dispatch("worktree.getCurrent");
  if (currentResult.ok) {
    const payload = currentResult.result;
    const current =
      payload && typeof payload === "object" && "worktree" in payload
        ? (payload as { worktree?: unknown }).worktree
        : null;
    if (current && typeof current === "object") {
      const id = "id" in current && typeof current.id === "string" ? current.id : null;
      const currentPath =
        "path" in current && typeof current.path === "string" ? current.path : null;
      const match = worktrees.find(
        (worktree) =>
          (id !== null && (worktree.id === id || worktree.worktreeId === id)) ||
          (currentPath !== null && worktree.path === currentPath)
      );
      if (match) return match;
    }
  }

  const currentCandidates = worktrees.filter((worktree) => worktree.isCurrent);
  if (currentCandidates.length === 1) return currentCandidates[0] ?? null;
  const candidates = currentCandidates.length > 1 ? currentCandidates : worktrees;

  const items: PluginQuickPickItem[] = candidates.map((worktree) => ({
    id: worktree.id,
    label: worktree.name,
    description: worktree.branch,
    detail: worktree.path,
  }));
  const selected = await host.showQuickPick(items, {
    title: "Select the worktree for Containers",
    placeholder: "Choose a worktree",
    matchOnDescription: true,
  });
  if (!selected || Array.isArray(selected)) return null;
  return candidates.find((worktree) => worktree.id === selected.id) ?? null;
}

async function readTargetOverrides(host: PluginHostApi): Promise<TargetOverrides> {
  const value = await host.storage.get<unknown>(TARGETS_STORAGE_KEY, "user");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 && typeof entry[1] === "string" && entry[1].length > 0
    )
  );
}

async function readPanelBindings(host: PluginHostApi): Promise<PanelBindings> {
  const value = await host.storage.get<unknown>(BINDINGS_STORAGE_KEY, "user");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([panelId, candidate]) => {
      const parsed = dockerPanelBindingSchema.safeParse(candidate);
      return panelId.length > 0 && parsed.success ? [[panelId, parsed.data] as const] : [];
    })
  );
}

async function savePanelBinding(
  host: PluginHostApi,
  panelId: string,
  binding: DockerPanelBinding
): Promise<void> {
  const bindings = await readPanelBindings(host);
  bindings[panelId] = binding;
  await host.storage.set(BINDINGS_STORAGE_KEY, bindings, "user");
}

async function resolvePanelBinding(
  host: PluginHostApi,
  panelId: string,
  initialArgs?: Record<string, unknown>
): Promise<DockerPanelBinding | null> {
  const bindings = await readPanelBindings(host);
  const stored = bindings[panelId];
  if (stored) return stored;

  const candidate = parseDockerPanelBinding(initialArgs);
  if (!candidate) return null;
  const worktrees = await host.getWorktrees();
  const belongsToKnownWorktree = worktrees.some(
    (worktree) =>
      (worktree.id === candidate.worktreeId || worktree.worktreeId === candidate.worktreeId) &&
      path.normalize(worktree.path) === path.normalize(candidate.worktreePath)
  );
  if (!belongsToKnownWorktree) return null;

  const overrides = await readTargetOverrides(host);
  const binding = overrides[panelId]
    ? withDockerProjectPath(candidate, overrides[panelId])
    : candidate;
  await savePanelBinding(host, panelId, binding);
  return binding;
}

function panelIdFromDispatchResult(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("panelId" in result)) return null;
  return typeof result.panelId === "string" && result.panelId.length > 0 ? result.panelId : null;
}

function badgeForSnapshot(snapshot: DockerProjectSnapshot): PluginPanelBadge {
  if (snapshot.connection.state === "unavailable") {
    return { kind: "label", text: "OFF", color: "warning", tooltip: snapshot.connection.error ?? "Docker unavailable" };
  }
  if (snapshot.connection.state === "error") {
    return { kind: "label", text: "ERR", color: "error", tooltip: snapshot.connection.error ?? "Docker error" };
  }
  if (snapshot.containers.length === 0) {
    return { kind: "label", text: "EMPTY", color: "default", tooltip: "No Compose containers match this Docker project" };
  }

  const running = snapshot.containers.filter((container) => container.state === "running").length;
  if (running === snapshot.containers.length) {
    return { kind: "dot", color: "success", tooltip: `All ${running} containers running` };
  }
  if (running === 0) {
    return { kind: "label", text: "STOP", color: "warning", tooltip: `All ${snapshot.containers.length} containers stopped` };
  }
  const ratio = `${running}/${snapshot.containers.length}`;
  return ratio.length <= 6
    ? { kind: "label", text: ratio, color: "warning", tooltip: `${running} of ${snapshot.containers.length} containers running` }
    : { kind: "dot", color: "warning", tooltip: `${running} of ${snapshot.containers.length} containers running` };
}

async function refreshPanel(
  host: PluginHostApi,
  backend: DockerBackend,
  panelId: string,
  binding: DockerPanelBinding
): Promise<DockerProjectSnapshot> {
  const snapshot = await backend.getProjectSnapshot(binding.dockerProjectPath);
  await host.setPanelBadge(panelId, badgeForSnapshot(snapshot));
  await host.postToPanel("docker.project.snapshot", snapshot, panelId);
  return snapshot;
}

async function openBoundPanel(
  host: PluginHostApi,
  worktree: PluginWorktreeSnapshot,
  requestedDockerProjectPath?: string,
  reuseExisting = true
): Promise<{ panelId: string; binding: DockerPanelBinding }> {
  const dockerProjectPath = requestedDockerProjectPath ?? worktree.path;
  if (!path.isAbsolute(dockerProjectPath)) throw new Error("Docker project path must be absolute");
  const initialBinding = createDockerPanelBinding(worktree, path.normalize(dockerProjectPath));
  const result = await host.dispatch("panel.openPluginPanel", {
    kind: PANEL_KIND,
    worktreeId: worktree.id,
    initialArgs: initialBinding,
    reuseExisting,
  });
  if (!result.ok) throw new Error(result.error.message);
  const panelId = panelIdFromDispatchResult(result.result);
  if (!panelId) throw new Error("Daintree did not return a panel ID");

  const existing = await readPanelBindings(host);
  const binding = requestedDockerProjectPath
    ? initialBinding
    : existing[panelId] ?? initialBinding;
  await savePanelBinding(host, panelId, binding);
  return { panelId, binding };
}

export async function activate(
  host: PluginHostApi,
  dependencies: ContainersPluginDependencies = {}
): Promise<() => void> {
  const backend =
    dependencies.dockerBackend ??
    new DockerodeBackend({
      getConfiguredSocket: async () => {
        const value = await host.settings.get<unknown>("dockerSocketPath");
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
      },
    });
  const logGroups = new Map<string, PanelLogGroup>();

  const flushLogSession = (
    panelId: string,
    group: PanelLogGroup,
    session: PanelLogSession
  ): void => {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    if (session.records.length === 0) return;
    const batch = dockerLogBatchSchema.parse({
      containerId: session.containerId,
      sequence: group.sequence++,
      records: session.records,
    });
    session.records = [];
    session.bytes = 0;
    void Promise.resolve(host.postToPanel("docker.logs.batch", batch, panelId)).catch(() => {});
  };

  const disconnectLogSession = (
    panelId: string,
    group: PanelLogGroup,
    containerId: string
  ): boolean => {
    const session = group.sessions.get(containerId);
    if (!session) return false;
    group.sessions.delete(containerId);
    flushLogSession(panelId, group, session);
    session.subscription?.close();
    return true;
  };

  const disconnectLogs = (panelId: string): boolean => {
    const group = logGroups.get(panelId);
    if (!group) return false;
    logGroups.delete(panelId);
    for (const containerId of [...group.sessions.keys()]) {
      disconnectLogSession(panelId, group, containerId);
    }
    return true;
  };

  const queueLogRecord = (
    panelId: string,
    group: PanelLogGroup,
    session: PanelLogSession,
    record: DockerLogRecord
  ): void => {
    if (logGroups.get(panelId) !== group || group.sessions.get(session.containerId) !== session) return;
    session.records.push(record);
    session.bytes += Buffer.byteLength(record.text, "utf8");
    if (session.bytes >= 32 * 1024 || session.records.length >= 256) {
      flushLogSession(panelId, group, session);
    } else if (!session.timer) {
      session.timer = setTimeout(() => flushLogSession(panelId, group, session), 16);
    }
  };

  await host.registerAction(
    {
      id: "open",
      title: "Containers: Open Console",
      description:
        "Open a container console permanently bound to a selected worktree and its configured Docker project.",
      category: "Containers",
      kind: "command",
      danger: "safe",
      keywords: ["docker", "container", "compose", "worktree"],
    },
    async (rawArgs) => {
      const args = parseOpenArgs(rawArgs);
      const worktree = await chooseWorktree(host, args?.worktreeId);
      if (!worktree) return { opened: false };

      const opened = await openBoundPanel(
        host,
        worktree,
        args?.dockerProjectPath,
        args?.reuseExisting ?? true
      );
      const snapshot = await refreshPanel(host, backend, opened.panelId, opened.binding);
      return { opened: true, binding: opened.binding, result: { panelId: opened.panelId }, snapshot };
    }
  );

  const registerProjectAction = async (
    id: string,
    title: string,
    description: string,
    operation?: DockerProjectOperation
  ): Promise<void> => {
    await host.registerAction(
      {
        id,
        title,
        description,
        category: "Containers",
        kind: "command",
        danger: operation ? "confirm" : "safe",
        keywords: ["docker", "compose", operation ?? "refresh"],
      },
      async () => {
        const worktree = await chooseWorktree(host);
        if (!worktree) return { opened: false };
        const opened = await openBoundPanel(host, worktree);
        if (!operation) {
          const snapshot = await refreshPanel(host, backend, opened.panelId, opened.binding);
          const running = snapshot.containers.filter((container) => container.state === "running").length;
          await host.showToast({
            type: snapshot.connection.state === "ready" ? "info" : "warning",
            message:
              snapshot.connection.state === "ready"
                ? `${running}/${snapshot.containers.length} project containers running.`
                : snapshot.connection.error ?? "Docker is unavailable.",
          });
          return { opened: true, snapshot };
        }

        await host.setPanelBadge(opened.panelId, {
          kind: "label",
          text: "BUSY",
          color: "default",
          tooltip: `${title} in progress`,
        });
        const result = await backend.operateProject(opened.binding.dockerProjectPath, operation);
        await host.setPanelBadge(opened.panelId, badgeForSnapshot(result.snapshot));
        await host.postToPanel("docker.project.snapshot", result.snapshot, opened.panelId);
        await host.showToast({
          type: result.failed.length === 0 ? "success" : "warning",
          message: `${title}: ${result.succeeded}/${result.attempted} succeeded${
            result.failed.length > 0 ? `, ${result.failed.length} failed` : ""
          }.`,
        });
        return { opened: true, result };
      }
    );
  };

  await registerProjectAction(
    "refresh",
    "Containers: Refresh Project",
    "Refresh Docker daemon and Compose container status for the active worktree."
  );
  await registerProjectAction(
    "start",
    "Containers: Start Project Containers",
    "Start stopped Compose containers associated with the active worktree.",
    "start"
  );
  await registerProjectAction(
    "stop",
    "Containers: Stop Project Containers",
    "Stop running Compose containers associated with the active worktree.",
    "stop"
  );
  await registerProjectAction(
    "restart",
    "Containers: Restart Project Containers",
    "Restart Compose containers associated with the active worktree.",
    "restart"
  );

  await host.registerHandler(
    "binding.resolve",
    { args: resolveBindingArgsSchema, result: dockerPanelBindingSchema.nullable() },
    async (_context, args) => {
      return resolvePanelBinding(host, args.panelId, args.initialArgs);
    }
  );

  await host.registerHandler(
    "binding.setDockerProjectPath",
    { args: saveBindingArgsSchema, result: dockerPanelBindingSchema },
    async (_context, args) => {
      if (!path.isAbsolute(args.dockerProjectPath)) {
        throw new Error("Docker project path must be absolute");
      }
      const authoritative =
        (await resolvePanelBinding(host, args.panelId, args.binding)) ?? args.binding;
      const dockerProjectPath = path.normalize(args.dockerProjectPath);
      const overrides = await readTargetOverrides(host);
      overrides[args.panelId] = dockerProjectPath;
      await host.storage.set(TARGETS_STORAGE_KEY, overrides, "user");
      const binding = withDockerProjectPath(authoritative, dockerProjectPath);
      await savePanelBinding(host, args.panelId, binding);
      return binding;
    }
  );

  await host.registerHandler(
    "docker.project.get",
    { args: dockerProjectArgsSchema, result: dockerProjectSnapshotSchema },
    async (_context, args) => {
      const binding = await resolvePanelBinding(host, args.panelId, args.initialArgs);
      if (!binding) throw new Error("No authoritative Docker binding exists for this panel");
      return refreshPanel(host, backend, args.panelId, binding);
    }
  );

  await host.registerHandler(
    "docker.project.operate",
    { args: dockerProjectOperationArgsSchema, result: dockerOperationResultSchema },
    async (_context, args) => {
      const binding = await resolvePanelBinding(host, args.panelId, args.initialArgs);
      if (!binding) throw new Error("No authoritative Docker binding exists for this panel");
      await host.setPanelBadge(args.panelId, {
        kind: "label",
        text: "BUSY",
        color: "default",
        tooltip: `${args.operation} in progress`,
      });
      const result = await backend.operateProject(binding.dockerProjectPath, args.operation);
      await host.setPanelBadge(args.panelId, badgeForSnapshot(result.snapshot));
      await host.postToPanel("docker.project.snapshot", result.snapshot, args.panelId);
      return result;
    }
  );

  await host.registerHandler(
    "docker.container.operate",
    { args: dockerContainerOperationArgsSchema, result: dockerContainerOperationResultSchema },
    async (_context, args) => {
      const binding = await resolvePanelBinding(host, args.panelId, args.initialArgs);
      if (!binding) throw new Error("No authoritative Docker binding exists for this panel");
      const result = await backend.operateContainer(
        binding.dockerProjectPath,
        args.containerId,
        args.operation
      );
      await host.setPanelBadge(args.panelId, badgeForSnapshot(result.snapshot));
      await host.postToPanel("docker.project.snapshot", result.snapshot, args.panelId);
      return result;
    }
  );

  await host.registerHandler(
    "docker.logs.connect",
    { args: dockerLogsConnectArgsSchema, result: dockerLogsConnectResultSchema },
    async (_context, args) => {
      const binding = await resolvePanelBinding(host, args.panelId, args.initialArgs);
      if (!binding) throw new Error("No authoritative Docker binding exists for this panel");
      const desiredContainerIds = [...new Set(args.containerIds)];
      let group = logGroups.get(args.panelId);
      if (!group) {
        group = { sequence: 0, sessions: new Map() };
        logGroups.set(args.panelId, group);
      }
      const desired = new Set(desiredContainerIds);
      for (const containerId of [...group.sessions.keys()]) {
        if (!desired.has(containerId)) disconnectLogSession(args.panelId, group, containerId);
      }

      await Promise.all(
        desiredContainerIds.map(async (containerId) => {
          if (group.sessions.has(containerId)) return;
          const session: PanelLogSession = {
            containerId,
            records: [],
            bytes: 0,
            timer: null,
            subscription: null,
          };
          group.sessions.set(containerId, session);
          try {
            const subscription = await backend.subscribeContainerLogs(
              binding.dockerProjectPath,
              containerId,
              (record) => queueLogRecord(args.panelId, group, session, record),
              {
                tail: args.tail,
                onDisconnect: (error) => {
                  if (
                    logGroups.get(args.panelId) !== group ||
                    group.sessions.get(containerId) !== session
                  ) return;
                  flushLogSession(args.panelId, group, session);
                  group.sessions.delete(containerId);
                  const event = dockerLogsDisconnectedEventSchema.parse({ containerId, error });
                  void Promise.resolve(
                    host.postToPanel("docker.logs.disconnected", event, args.panelId)
                  ).catch(() => {});
                },
              }
            );
            if (
              logGroups.get(args.panelId) !== group ||
              group.sessions.get(containerId) !== session
            ) {
              subscription.close();
            } else {
              session.subscription = subscription;
            }
          } catch (error) {
            if (group.sessions.get(containerId) === session) group.sessions.delete(containerId);
            throw error;
          }
        })
      );
      return { containerIds: desiredContainerIds, connected: true as const };
    }
  );

  await host.registerHandler(
    "docker.logs.disconnect",
    { args: dockerLogsDisconnectArgsSchema, result: dockerLogsDisconnectResultSchema },
    async (_context, args) => ({ disconnected: disconnectLogs(args.panelId) })
  );

  await host.registerHandler(
    "docker.logs.copy",
    { args: copyLogsArgsSchema, result: copyLogsResultSchema },
    async (_context, args) => {
      await host.clipboard.writeText(args.text);
      return { copied: true as const };
    }
  );

  return () => {
    for (const panelId of [...logGroups.keys()]) disconnectLogs(panelId);
    backend.dispose();
  };
}

export type { DockerPanelBinding };
