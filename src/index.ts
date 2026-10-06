import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  PluginHostApi,
  PluginIpcContext,
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
  type DockerLogBatch,
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

// Storage updates are shared across panels; serialize read/modify/write cycles.
const storageQueues = new WeakMap<PluginHostApi, Promise<unknown>>();
function updateStorage<T>(
  host: PluginHostApi,
  operation: () => Promise<T>,
): Promise<T> {
  const next = (storageQueues.get(host) ?? Promise.resolve())
    .catch(() => {})
    .then(operation);
  storageQueues.set(host, next);
  return next;
}
const snapshotVersions = new WeakMap<
  PluginHostApi,
  { epoch: string; revision: number }
>();
function versionSnapshot(
  host: PluginHostApi,
  snapshot: DockerProjectSnapshot,
): DockerProjectSnapshot {
  let version = snapshotVersions.get(host);
  if (!version) {
    version = { epoch: randomUUID(), revision: 0 };
    snapshotVersions.set(host, version);
  }
  return { ...snapshot, epoch: version.epoch, revision: ++version.revision };
}
const TARGETS_STORAGE_KEY = "panel-docker-project-paths";
const BINDINGS_STORAGE_KEY = "panel-bindings";
const PREFERENCES_STORAGE_KEY = "panel-preferences";

const openArgsSchema = z
  .object({
    worktreeId: z.string().min(1).max(4096).optional(),
    dockerProjectPath: z.string().min(1).max(4096).optional(),
    reuseExisting: z.boolean().optional(),
  })
  .optional();

const resolveBindingArgsSchema = z.object({
  panelId: z.string().min(1).max(4096),
  initialArgs: z.record(z.string(), z.unknown()).optional(),
});

const saveBindingArgsSchema = z.object({
  panelId: z.string().min(1).max(4096),
  binding: dockerPanelBindingSchema,
  dockerProjectPath: z.string().min(1).max(4096),
});

const panelPreferencesSchema = z.object({
  selectedContainerId: z.string().min(1).max(4096).nullable(),
  showServices: z.boolean(),
});

const panelPreferencesArgsSchema = z.object({
  panelId: z.string().min(1).max(4096),
});

const savePanelPreferencesArgsSchema = panelPreferencesArgsSchema.extend({
  preferences: panelPreferencesSchema,
});

const dockerProjectArgsSchema = z.object({
  panelId: z.string().min(1).max(4096),
  initialArgs: z.record(z.string(), z.unknown()).optional(),
});

const dockerProjectOperationArgsSchema = dockerProjectArgsSchema.extend({
  operation: dockerProjectOperationSchema,
});

const dockerContainerOperationArgsSchema = dockerProjectArgsSchema.extend({
  containerId: z.string().min(1).max(4096),
  operation: dockerContainerOperationSchema,
});

const dockerLogsConnectArgsSchema = dockerProjectArgsSchema.extend({
  containerIds: z.array(z.string().min(1).max(4096)).max(100),
  tail: z.number().int().min(0).max(10_000).optional(),
});

const dockerLogsDisconnectArgsSchema = z.object({
  panelId: z.string().min(1).max(4096),
});

const copyLogsArgsSchema = z.object({
  text: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 1024 * 1024,
      "Copy is limited to 1 MiB. Filter the logs or clear older history.",
    ),
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
type PanelPreferences = z.infer<typeof panelPreferencesSchema>;
type StoredPanelPreferences = Record<string, PanelPreferences>;

const DEFAULT_PANEL_PREFERENCES: PanelPreferences = {
  selectedContainerId: null,
  showServices: true,
};

interface PanelLogSession {
  containerId: string;
  records: DockerLogRecord[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  subscription: DockerLogSubscription | null;
}

interface PanelLogGroup {
  targetPath: string;
  epoch: string;
  history: DockerLogBatch[];
  historyBytes: number;
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
  requestedWorktreeId?: string,
): Promise<PluginWorktreeSnapshot | null> {
  const worktrees = await host.getWorktrees();
  if (requestedWorktreeId) {
    const requested = worktrees.find(
      (worktree) =>
        worktree.id === requestedWorktreeId ||
        worktree.worktreeId === requestedWorktreeId,
    );
    if (!requested)
      throw new Error(`Worktree not found: ${requestedWorktreeId}`);
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
      const id =
        "id" in current && typeof current.id === "string" ? current.id : null;
      const currentPath =
        "path" in current && typeof current.path === "string"
          ? current.path
          : null;
      const match = worktrees.find(
        (worktree) =>
          (id !== null && (worktree.id === id || worktree.worktreeId === id)) ||
          (currentPath !== null && worktree.path === currentPath),
      );
      if (match) return match;
    }
  }

  const currentCandidates = worktrees.filter((worktree) => worktree.isCurrent);
  if (currentCandidates.length === 1) return currentCandidates[0] ?? null;
  const candidates =
    currentCandidates.length > 1 ? currentCandidates : worktrees;

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

async function readTargetOverrides(
  host: PluginHostApi,
): Promise<TargetOverrides> {
  const value = await host.storage.get<unknown>(TARGETS_STORAGE_KEY, "user");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 &&
        typeof entry[1] === "string" &&
        entry[1].length > 0,
    ),
  );
}

async function readPanelBindings(host: PluginHostApi): Promise<PanelBindings> {
  const value = await host.storage.get<unknown>(BINDINGS_STORAGE_KEY, "user");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([panelId, candidate]) => {
      const parsed = dockerPanelBindingSchema.safeParse(candidate);
      return panelId.length > 0 && parsed.success
        ? [[panelId, parsed.data] as const]
        : [];
    }),
  );
}

async function savePanelBinding(
  host: PluginHostApi,
  panelId: string,
  binding: DockerPanelBinding,
): Promise<void> {
  await updateStorage(host, async () => {
    const bindings = await readPanelBindings(host);
    bindings[panelId] = binding;
    await host.storage.set(BINDINGS_STORAGE_KEY, bindings, "user");
  });
}

async function readPanelPreferences(
  host: PluginHostApi,
): Promise<StoredPanelPreferences> {
  const value = await host.storage.get<unknown>(
    PREFERENCES_STORAGE_KEY,
    "user",
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([panelId, candidate]) => {
      const parsed = panelPreferencesSchema.safeParse(candidate);
      return panelId.length > 0 && parsed.success
        ? [[panelId, parsed.data] as const]
        : [];
    }),
  );
}

async function resolvePanelPreferences(
  host: PluginHostApi,
  panelId: string,
): Promise<PanelPreferences> {
  const preferences = await readPanelPreferences(host);
  return preferences[panelId] ?? DEFAULT_PANEL_PREFERENCES;
}

async function savePanelPreferences(
  host: PluginHostApi,
  panelId: string,
  preferences: PanelPreferences,
): Promise<PanelPreferences> {
  await updateStorage(host, async () => {
    const stored = await readPanelPreferences(host);
    stored[panelId] = preferences;
    await host.storage.set(PREFERENCES_STORAGE_KEY, stored, "user");
  });
  return preferences;
}

async function resolvePanelBinding(
  host: PluginHostApi,
  panelId: string,
  initialArgs?: Record<string, unknown>,
  expectedProjectId?: string | null,
): Promise<DockerPanelBinding | null> {
  const bindings = await readPanelBindings(host);
  const candidate = bindings[panelId] ?? parseDockerPanelBinding(initialArgs);
  if (!candidate) return null;
  const result = await host.getWorktreesResult();
  if (
    result.status !== "ok" ||
    (expectedProjectId !== undefined &&
      expectedProjectId !== result.projectId) ||
    (candidate.projectId && candidate.projectId !== result.projectId)
  ) {
    throw new Error(
      "Focus this panel's owning project, then Refresh to verify its worktree. The saved Docker target has not changed.",
    );
  }
  const matches = result.worktrees.some(
    (worktree) =>
      (worktree.id === candidate.worktreeId ||
        worktree.worktreeId === candidate.worktreeId) &&
      path.normalize(worktree.path) === path.normalize(candidate.worktreePath),
  );
  if (!matches)
    throw new Error(
      "The bound worktree is no longer available. Reopen Containers from its owning worktree.",
    );
  if (
    !path.isAbsolute(candidate.dockerProjectPath) ||
    !path.isAbsolute(candidate.worktreePath)
  ) {
    throw new Error("Docker binding paths must be absolute.");
  }
  const overrides = await readTargetOverrides(host);
  const binding = {
    ...candidate,
    schemaVersion: 2 as const,
    projectId: result.projectId,
    dockerProjectPath: overrides[panelId] ?? candidate.dockerProjectPath,
  };
  if (JSON.stringify(binding) !== JSON.stringify(bindings[panelId]))
    await savePanelBinding(host, panelId, binding);
  return binding;
}

function panelIdFromDispatchResult(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("panelId" in result))
    return null;
  return typeof result.panelId === "string" && result.panelId.length > 0
    ? result.panelId
    : null;
}

function badgeForSnapshot(snapshot: DockerProjectSnapshot): PluginPanelBadge {
  if (snapshot.connection.state === "unavailable") {
    return {
      kind: "label",
      text: "OFF",
      color: "warning",
      tooltip: snapshot.connection.error ?? "Docker unavailable",
    };
  }
  if (snapshot.connection.state === "error") {
    return {
      kind: "label",
      text: "ERR",
      color: "error",
      tooltip: snapshot.connection.error ?? "Docker error",
    };
  }
  if (snapshot.containers.length === 0) {
    return {
      kind: "label",
      text: "EMPTY",
      color: "default",
      tooltip: "No Compose containers match this Docker project",
    };
  }

  const running = snapshot.containers.filter(
    (container) => container.state === "running",
  ).length;
  if (running === snapshot.containers.length) {
    return {
      kind: "dot",
      color: "success",
      tooltip: `All ${running} containers running`,
    };
  }
  if (running === 0) {
    return {
      kind: "label",
      text: "STOP",
      color: "warning",
      tooltip: `All ${snapshot.containers.length} containers stopped`,
    };
  }
  const ratio = `${running}/${snapshot.containers.length}`;
  return ratio.length <= 6
    ? {
        kind: "label",
        text: ratio,
        color: "warning",
        tooltip: `${running} of ${snapshot.containers.length} containers running`,
      }
    : {
        kind: "dot",
        color: "warning",
        tooltip: `${running} of ${snapshot.containers.length} containers running`,
      };
}

async function publishSnapshot(
  host: PluginHostApi,
  panelId: string,
  snapshot: DockerProjectSnapshot,
): Promise<void> {
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (bytes > 8 * 1024 * 1024)
    throw new Error(
      "Docker project snapshot exceeds 8 MiB. Reduce the Compose target before refreshing.",
    );
  await host.setPanelBadge(panelId, badgeForSnapshot(snapshot));
  if (bytes <= 512 * 1024)
    await host.postToPanel("docker.project.snapshot", snapshot, panelId);
  else
    await host.postToPanel(
      "docker.project.invalidated",
      { epoch: snapshot.epoch, revision: snapshot.revision },
      panelId,
    );
}

async function refreshPanel(
  host: PluginHostApi,
  backend: DockerBackend,
  panelId: string,
  binding: DockerPanelBinding,
  push = true,
): Promise<DockerProjectSnapshot> {
  const snapshot = versionSnapshot(
    host,
    await backend.getProjectSnapshot(binding.dockerProjectPath),
  );
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 8 * 1024 * 1024)
    throw new Error(
      "Docker project snapshot exceeds 8 MiB. Reduce the Compose target before refreshing.",
    );
  if (push) await publishSnapshot(host, panelId, snapshot);
  return snapshot;
}

async function openBoundPanel(
  host: PluginHostApi,
  worktree: PluginWorktreeSnapshot,
  requestedDockerProjectPath?: string,
  reuseExisting = true,
): Promise<{ panelId: string; binding: DockerPanelBinding }> {
  const dockerProjectPath = requestedDockerProjectPath ?? worktree.path;
  if (!path.isAbsolute(dockerProjectPath))
    throw new Error("Docker project path must be absolute");
  const owner = await host.getWorktreesResult();
  if (
    owner.status !== "ok" ||
    !owner.worktrees.some(
      (item) => item.id === worktree.id && item.path === worktree.path,
    )
  ) {
    throw new Error(
      "The project changed while selecting a worktree. Open Containers again.",
    );
  }
  const initialBinding = {
    ...createDockerPanelBinding(worktree, path.normalize(dockerProjectPath)),
    schemaVersion: 2 as const,
    projectId: owner.projectId,
  };
  const result = await host.dispatch("panel.openPluginPanel", {
    kind: host.panelKindId("console"),
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
    : (existing[panelId] ?? initialBinding);
  if (
    binding.worktreeId !== initialBinding.worktreeId ||
    binding.worktreePath !== initialBinding.worktreePath ||
    (binding.projectId && binding.projectId !== initialBinding.projectId)
  )
    throw new Error(
      "Reused panel has a different worktree owner. Open a new console.",
    );
  await savePanelBinding(host, panelId, binding);
  return { panelId, binding };
}

export async function activate(
  host: PluginHostApi,
  dependencies: ContainersPluginDependencies = {},
): Promise<() => void> {
  const backend =
    dependencies.dockerBackend ??
    new DockerodeBackend({
      getConfiguredSocket: async () => {
        const value = await host.settings.get<unknown>("dockerSocketPath");
        return typeof value === "string" && value.trim().length > 0
          ? value.trim()
          : undefined;
      },
    });
  const logGroups = new Map<string, PanelLogGroup>();
  const knownPanels = new Map<string, string>();
  const resourceJobs = new Map<string, Promise<unknown>>();
  let disposed = false;
  let unsubscribe = () => {};
  const assertPanel = (panelId: string, context?: PluginIpcContext): void => {
    if (
      disposed ||
      !knownPanels.has(panelId) ||
      knownPanels.get(panelId) === "removed"
    )
      throw new Error(
        "This Containers panel is unavailable. Reopen the console.",
      );
    if (context && context.pluginId !== host.pluginId)
      throw new Error("Panel caller does not belong to Containers.");
  };
  const inResource = async <T>(
    target: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = resourceJobs.get(target) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => {
        if (disposed) throw new Error("Containers has unloaded.");
        return operation();
      });
    resourceJobs.set(target, next);
    try {
      return await next;
    } finally {
      if (resourceJobs.get(target) === next) resourceJobs.delete(target);
    }
  };
  const resolveBinding = async (
    context: PluginIpcContext | undefined,
    panelId: string,
    initialArgs?: Record<string, unknown>,
  ) => {
    assertPanel(panelId, context);
    const binding = await resolvePanelBinding(
      host,
      panelId,
      initialArgs,
      context?.projectId,
    );
    if (binding && context && binding.projectId !== context.projectId)
      throw new Error("Panel belongs to another project.");
    return binding;
  };

  const flushLogSession = (
    panelId: string,
    group: PanelLogGroup,
    session: PanelLogSession,
  ): void => {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    if (session.records.length === 0) return;
    const batch = dockerLogBatchSchema.parse({
      targetPath: group.targetPath,
      epoch: group.epoch,
      containerId: session.containerId,
      sequence: group.sequence++,
      records: session.records,
    });
    group.history.push(batch);
    group.historyBytes += Buffer.byteLength(JSON.stringify(batch), "utf8");
    while (group.historyBytes > 512 * 1024 || group.history.length > 128) {
      const removed = group.history.shift();
      if (removed)
        group.historyBytes -= Buffer.byteLength(
          JSON.stringify(removed),
          "utf8",
        );
    }
    session.records = [];
    session.bytes = 0;
    void Promise.resolve(
      host.postToPanel("docker.logs.batch", batch, panelId),
    ).catch(() => {});
  };

  const disconnectLogSession = (
    panelId: string,
    group: PanelLogGroup,
    containerId: string,
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
    record: DockerLogRecord,
  ): void => {
    if (
      logGroups.get(panelId) !== group ||
      group.sessions.get(session.containerId) !== session
    )
      return;
    const bounded = {
      ...record,
      text:
        record.text.length > 16_384
          ? record.text.slice(0, 16_384) + " [line truncated]"
          : record.text,
      containerName: record.containerName.slice(0, 256),
      serviceName: record.serviceName.slice(0, 256),
    };
    const bytes = Buffer.byteLength(JSON.stringify(bounded), "utf8");
    if (session.bytes + bytes > 128 * 1024)
      flushLogSession(panelId, group, session);
    session.records.push(bounded);
    session.bytes += bytes;
    if (session.bytes >= 32 * 1024 || session.records.length >= 256) {
      flushLogSession(panelId, group, session);
    } else if (!session.timer) {
      session.timer = setTimeout(
        () => flushLogSession(panelId, group, session),
        16,
      );
    }
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    for (const panelId of [...logGroups.keys()]) disconnectLogs(panelId);
    backend.dispose();
  };
  try {
    unsubscribe = await host.onDidChangePanelLifecycle((event) => {
      if (event.panelKindId !== host.panelKindId("console")) return;
      knownPanels.set(event.panelId, event.phase);
      if (
        [
          "hidden",
          "backgrounded",
          "trashed",
          "render-failed",
          "removed",
        ].includes(event.phase)
      )
        disconnectLogs(event.panelId);
      if (event.phase === "removed") {
        knownPanels.delete(event.panelId);
        void updateStorage(host, async () => {
          for (const key of [
            BINDINGS_STORAGE_KEY,
            TARGETS_STORAGE_KEY,
            PREFERENCES_STORAGE_KEY,
          ]) {
            const stored = await host.storage.get<Record<string, unknown>>(
              key,
              "user",
            );
            if (stored && event.panelId in stored) {
              delete stored[event.panelId];
              await host.storage.set(key, stored, "user");
            }
          }
        }).catch((error) => host.logger.warn(String(error)));
      }
    });
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
          args?.reuseExisting ?? true,
        );
        knownPanels.set(opened.panelId, "mounted");
        const snapshot = await inResource(
          opened.binding.dockerProjectPath,
          () => refreshPanel(host, backend, opened.panelId, opened.binding),
        );
        return {
          opened: true,
          binding: opened.binding,
          result: { panelId: opened.panelId },
          snapshot,
        };
      },
    );

    const registerProjectAction = async (
      id: string,
      title: string,
      description: string,
      operation?: DockerProjectOperation,
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
        async (rawArgs) => {
          const args = z
            .object({ panelId: z.string().min(1).max(4096).optional() })
            .optional()
            .parse(rawArgs);
          let opened: { panelId: string; binding: DockerPanelBinding };
          if (args?.panelId) {
            const binding = await resolveBinding(undefined, args.panelId);
            if (!binding)
              throw new Error(
                "No authoritative Docker binding exists for this panel",
              );
            opened = { panelId: args.panelId, binding };
          } else {
            const worktree = await chooseWorktree(host);
            if (!worktree) return { opened: false };
            opened = await openBoundPanel(host, worktree);
            knownPanels.set(opened.panelId, "mounted");
          }
          if (!operation) {
            const snapshot = await inResource(
              opened.binding.dockerProjectPath,
              () => refreshPanel(host, backend, opened.panelId, opened.binding),
            );
            const running = snapshot.containers.filter(
              (container) => container.state === "running",
            ).length;
            await host.showToast({
              type: snapshot.connection.state === "ready" ? "info" : "warning",
              message:
                snapshot.connection.state === "ready"
                  ? `${running}/${snapshot.containers.length} project containers running.`
                  : (snapshot.connection.error ?? "Docker is unavailable."),
            });
            return { opened: true, snapshot };
          }

          await host.setPanelBadge(opened.panelId, {
            kind: "label",
            text: "BUSY",
            color: "default",
            tooltip: `${title} in progress`,
          });
          const result = await inResource(
            opened.binding.dockerProjectPath,
            async () => {
              try {
                assertPanel(opened.panelId);
                const result = await backend.operateProject(
                  opened.binding.dockerProjectPath,
                  operation,
                );
                return {
                  ...result,
                  snapshot: versionSnapshot(host, result.snapshot),
                };
              } catch (error) {
                await refreshPanel(
                  host,
                  backend,
                  opened.panelId,
                  opened.binding,
                ).catch(() => {});
                throw error;
              }
            },
          );
          await publishSnapshot(host, opened.panelId, result.snapshot);
          await host.showToast({
            type: result.failed.length === 0 ? "success" : "warning",
            message: `${title}: ${result.succeeded}/${result.attempted} succeeded${
              result.failed.length > 0 ? `, ${result.failed.length} failed` : ""
            }.`,
          });
          return { opened: true, result };
        },
      );
    };

    await registerProjectAction(
      "refresh",
      "Containers: Refresh Project",
      "Refresh Docker daemon and Compose container status for the active worktree.",
    );
    await registerProjectAction(
      "start",
      "Containers: Start Project Containers",
      "Start stopped Compose containers associated with the active worktree.",
      "start",
    );
    await registerProjectAction(
      "stop",
      "Containers: Stop Project Containers",
      "Stop running Compose containers associated with the active worktree.",
      "stop",
    );
    await registerProjectAction(
      "restart",
      "Containers: Restart Project Containers",
      "Restart Compose containers associated with the active worktree.",
      "restart",
    );

    await host.registerHandler(
      "binding.resolve",
      {
        args: resolveBindingArgsSchema,
        result: dockerPanelBindingSchema.nullable(),
      },
      async (context, args) => {
        return resolveBinding(context, args.panelId, args.initialArgs);
      },
      { timeoutMs: 10000 },
    );

    await host.registerHandler(
      "binding.setDockerProjectPath",
      { args: saveBindingArgsSchema, result: dockerPanelBindingSchema },
      async (context, args) => {
        if (!path.isAbsolute(args.dockerProjectPath)) {
          throw new Error("Docker project path must be absolute");
        }
        const authoritative = await resolveBinding(
          context,
          args.panelId,
          args.binding,
        );
        if (!authoritative)
          throw new Error(
            "No authoritative Docker binding exists for this panel",
          );
        disconnectLogs(args.panelId);
        const dockerProjectPath = path.normalize(args.dockerProjectPath);
        await updateStorage(host, async () => {
          const overrides = await readTargetOverrides(host);
          overrides[args.panelId] = dockerProjectPath;
          await host.storage.set(TARGETS_STORAGE_KEY, overrides, "user");
        });
        const binding = withDockerProjectPath(authoritative, dockerProjectPath);
        await savePanelBinding(host, args.panelId, binding);
        return binding;
      },
      { timeoutMs: 10000 },
    );

    await host.registerHandler(
      "preferences.resolve",
      { args: panelPreferencesArgsSchema, result: panelPreferencesSchema },
      async (context, args) => {
        assertPanel(args.panelId, context);
        return resolvePanelPreferences(host, args.panelId);
      },
      { timeoutMs: 10000 },
    );

    await host.registerHandler(
      "preferences.save",
      { args: savePanelPreferencesArgsSchema, result: panelPreferencesSchema },
      async (context, args) => {
        assertPanel(args.panelId, context);
        return savePanelPreferences(host, args.panelId, args.preferences);
      },
      { timeoutMs: 10000 },
    );

    await host.registerHandler(
      "docker.project.get",
      { args: dockerProjectArgsSchema, result: dockerProjectSnapshotSchema },
      async (context, args) => {
        const binding = await resolveBinding(
          context,
          args.panelId,
          args.initialArgs,
        );
        if (!binding)
          throw new Error(
            "No authoritative Docker binding exists for this panel",
          );
        return inResource(binding.dockerProjectPath, () =>
          refreshPanel(host, backend, args.panelId, binding, false),
        );
      },
      { timeoutMs: 30000 },
    );

    await host.registerHandler(
      "docker.project.operate",
      {
        args: dockerProjectOperationArgsSchema,
        result: dockerOperationResultSchema,
      },
      async (context, args) => {
        const binding = await resolveBinding(
          context,
          args.panelId,
          args.initialArgs,
        );
        if (!binding)
          throw new Error(
            "No authoritative Docker binding exists for this panel",
          );
        await host.setPanelBadge(args.panelId, {
          kind: "label",
          text: "BUSY",
          color: "default",
          tooltip: `${args.operation} in progress`,
        });
        const result = await inResource(binding.dockerProjectPath, async () => {
          try {
            assertPanel(args.panelId, context);
            const result = await backend.operateProject(
              binding.dockerProjectPath,
              args.operation,
            );
            return {
              ...result,
              snapshot: versionSnapshot(host, result.snapshot),
            };
          } catch (error) {
            await refreshPanel(host, backend, args.panelId, binding).catch(
              () => {},
            );
            throw error;
          }
        });
        await publishSnapshot(host, args.panelId, result.snapshot);
        return result;
      },
      { timeoutMs: 300000 },
    );

    await host.registerHandler(
      "docker.container.operate",
      {
        args: dockerContainerOperationArgsSchema,
        result: dockerContainerOperationResultSchema,
      },
      async (context, args) => {
        const binding = await resolveBinding(
          context,
          args.panelId,
          args.initialArgs,
        );
        if (!binding)
          throw new Error(
            "No authoritative Docker binding exists for this panel",
          );
        const result = await inResource(binding.dockerProjectPath, async () => {
          try {
            assertPanel(args.panelId, context);
            const result = await backend.operateContainer(
              binding.dockerProjectPath,
              args.containerId,
              args.operation,
            );
            return {
              ...result,
              snapshot: versionSnapshot(host, result.snapshot),
            };
          } catch (error) {
            await refreshPanel(host, backend, args.panelId, binding).catch(
              () => {},
            );
            throw error;
          }
        });
        await publishSnapshot(host, args.panelId, result.snapshot);
        return result;
      },
      { timeoutMs: 120000 },
    );

    await host.registerHandler(
      "docker.logs.connect",
      {
        args: dockerLogsConnectArgsSchema,
        result: dockerLogsConnectResultSchema,
      },
      async (context, args) => {
        const binding = await resolveBinding(
          context,
          args.panelId,
          args.initialArgs,
        );
        if (!binding)
          throw new Error(
            "No authoritative Docker binding exists for this panel",
          );
        if (
          ["hidden", "backgrounded", "trashed", "removed"].includes(
            knownPanels.get(args.panelId) ?? "",
          )
        )
          throw new Error(
            "Panel is inactive; logs will reconnect when restored.",
          );
        const desiredContainerIds = [...new Set(args.containerIds)];
        let group = logGroups.get(args.panelId);
        if (!group) {
          group = {
            targetPath: binding.dockerProjectPath,
            epoch: randomUUID(),
            sequence: 0,
            sessions: new Map(),
            history: [],
            historyBytes: 0,
          };
          logGroups.set(args.panelId, group);
        }
        const desired = new Set(desiredContainerIds);
        for (const containerId of [...group.sessions.keys()]) {
          if (!desired.has(containerId))
            disconnectLogSession(args.panelId, group, containerId);
        }

        try {
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
                  (record) =>
                    queueLogRecord(args.panelId, group, session, record),
                  {
                    tail: args.tail,
                    onDisconnect: (error) => {
                      if (
                        logGroups.get(args.panelId) !== group ||
                        group.sessions.get(containerId) !== session
                      )
                        return;
                      flushLogSession(args.panelId, group, session);
                      group.sessions.delete(containerId);
                      const event = dockerLogsDisconnectedEventSchema.parse({
                        containerId,
                        error,
                      });
                      void Promise.resolve(
                        host.postToPanel(
                          "docker.logs.disconnected",
                          event,
                          args.panelId,
                        ),
                      ).catch(() => {});
                    },
                  },
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
                if (group.sessions.get(containerId) === session)
                  group.sessions.delete(containerId);
                throw error;
              }
            }),
          );
        } catch (error) {
          disconnectLogs(args.panelId);
          throw error;
        }
        return { containerIds: desiredContainerIds, connected: true as const };
      },
      { timeoutMs: 30000 },
    );

    await host.registerHandler(
      "docker.logs.disconnect",
      {
        args: dockerLogsDisconnectArgsSchema,
        result: dockerLogsDisconnectResultSchema,
      },
      async (context, args) => {
        assertPanel(args.panelId, context);
        return { disconnected: disconnectLogs(args.panelId) };
      },
      { timeoutMs: 10000 },
    );

    await host.registerHandler(
      "docker.logs.copy",
      { args: copyLogsArgsSchema, result: copyLogsResultSchema },
      async (context, args) => {
        await host.clipboard.writeText(copyLogsArgsSchema.parse(args).text);
        return { copied: true as const };
      },
      { timeoutMs: 10000 },
    );

    await host.registerHandler(
      "docker.logs.recover",
      {
        args: z.object({ panelId: z.string().min(1).max(4096) }),
        result: z.object({
          epoch: z.string().nullable(),
          batches: z.array(dockerLogBatchSchema),
        }),
      },
      async (context, args) => {
        await resolveBinding(context, args.panelId);
        const group = logGroups.get(args.panelId);
        if (group)
          for (const session of group.sessions.values())
            flushLogSession(args.panelId, group, session);
        return { epoch: group?.epoch ?? null, batches: group?.history ?? [] };
      },
    );
    await host.registerHandler(
      "settings.open",
      { args: z.object({}), result: z.object({ opened: z.literal(true) }) },
      async () => {
        await host.settings.open("dockerSocketPath");
        return { opened: true as const };
      },
    );
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}

export type { DockerPanelBinding };
