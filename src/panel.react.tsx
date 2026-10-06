import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PanelViewProps } from "@daintreehq/plugin-sdk";
import {
  useActionRunning,
  useHostChannel,
  usePanelToolbarItem,
  usePluginPanelEvent,
  useStreamBuffer,
} from "@daintreehq/plugin-sdk/react";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  ListRow,
  PaneLayout,
  Skeleton,
  StatusBar,
  Tooltip,
  VirtualList,
  whenPluginUiReady,
} from "@daintreehq/plugin-ui";
import type {
  DockerContainerOperation,
  DockerContainerOperationResult,
  DockerLogBatch,
  DockerOperationResult,
  DockerProjectOperation,
  DockerProjectSnapshot,
} from "./docker/types.js";
import { dockerPanelStyles } from "./panelStyles.js";
import {
  acceptSnapshot,
  appendLogBatch,
  emptyConsoleLogState,
  filterLogRecords,
  formatLogRecordsForClipboard,
  formatLogTimestamp,
  getServiceColor,
  isLoggableContainerState,
  MAX_COPY_BYTES,
  resolveFollowingAfterScroll,
} from "./shared/logConsole.js";
import {
  parseDockerPanelBinding,
  type DockerPanelBinding,
} from "./shared/binding.js";

type PanelArgs = { panelId: string; initialArgs?: Record<string, unknown> };
type Preferences = {
  selectedContainerId: string | null;
  showServices: boolean;
};
type ViewState = Preferences & {
  showTimestamps: boolean;
  following: boolean;
  lastStreamEpoch: string | null;
};
type PendingOperation = {
  operation: DockerContainerOperation;
  containerId?: string;
  label: string;
  target: string;
};
function restoredState(args: PanelViewProps["initialArgs"]): ViewState | null {
  const value = args?.ui;
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<ViewState>;
  if (
    typeof state.showServices !== "boolean" ||
    !(
      state.selectedContainerId === null ||
      typeof state.selectedContainerId === "string"
    )
  )
    return null;
  return {
    selectedContainerId: state.selectedContainerId,
    showServices: state.showServices,
    showTimestamps: state.showTimestamps === true,
    following: state.following !== false,
    lastStreamEpoch:
      typeof state.lastStreamEpoch === "string" ? state.lastStreamEpoch : null,
  };
}

export default function DockerConsolePanel(
  props: PanelViewProps,
): React.ReactElement {
  const { panelId, pluginId, initialArgs, persistState } = props;
  const restored = restoredState(initialArgs);
  const [binding, setBinding] = useState(() =>
    parseDockerPanelBinding(initialArgs),
  );
  const [verified, setVerified] = useState(false);
  const [targetPath, setTargetPath] = useState(
    binding?.dockerProjectPath ?? "",
  );
  const [showBinding, setShowBinding] = useState(false);
  const [snapshot, setSnapshot] = useState<DockerProjectSnapshot | null>(null);
  const [logs, setLogs] = useState(() => ({
    ...emptyConsoleLogState(),
    epoch: restored?.lastStreamEpoch ?? null,
  }));
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    restored?.selectedContainerId ?? null,
  );
  const [showServices, setShowServices] = useState(
    restored?.showServices ?? true,
  );
  const [showTimestamps, setShowTimestamps] = useState(
    restored?.showTimestamps ?? false,
  );
  const [following, setFollowing] = useState(restored?.following ?? true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [disconnected, setDisconnected] = useState<Record<string, string>>({});
  const [streamRevision, setStreamRevision] = useState(0);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const viewport = useRef<HTMLElement | null>(null);
  const logContent = useRef<HTMLDivElement>(null);
  const followRef = useRef(following);
  followRef.current = following;
  const clearFloor = useRef<{ epoch: string | null; sequence: number }>({
    epoch: null,
    sequence: 0,
  });
  const intentionalScroll = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryBusy = useRef(false);
  const targetGeneration = useRef(0);
  const activeTarget = useRef(binding?.dockerProjectPath);
  activeTarget.current = binding?.dockerProjectPath;
  const stream = useStreamBuffer<DockerLogBatch>({
    maxItems: 128,
    flush: "frame",
  });
  const recentBatches = useRef<DockerLogBatch[]>([]);
  const args: PanelArgs = { panelId, initialArgs };
  const resolver = useHostChannel<PanelArgs, DockerPanelBinding | null>(
    pluginId,
    "binding.resolve",
  );
  const saver = useHostChannel<
    { panelId: string; binding: DockerPanelBinding; dockerProjectPath: string },
    DockerPanelBinding
  >(pluginId, "binding.setDockerProjectPath");
  const preferences = useHostChannel<{ panelId: string }, Preferences>(
    pluginId,
    "preferences.resolve",
  );
  const project = useHostChannel<PanelArgs, DockerProjectSnapshot>(
    pluginId,
    "docker.project.get",
  );
  const operator = useHostChannel<
    PanelArgs & { operation: DockerProjectOperation },
    DockerOperationResult
  >(pluginId, "docker.project.operate");
  const containerOperator = useHostChannel<
    PanelArgs & { containerId: string; operation: DockerContainerOperation },
    DockerContainerOperationResult
  >(pluginId, "docker.container.operate");
  const connector = useHostChannel<
    PanelArgs & { containerIds: string[]; tail: number },
    { connected: true }
  >(pluginId, "docker.logs.connect");
  const recovery = useHostChannel<
    { panelId: string },
    { epoch: string | null; batches: DockerLogBatch[] }
  >(pluginId, "docker.logs.recover");
  const copier = useHostChannel<{ text: string }, { copied: true }>(
    pluginId,
    "docker.logs.copy",
  );
  const settings = useHostChannel<Record<string, never>, { opened: true }>(
    pluginId,
    "settings.open",
  );
  const headerRefresh = useActionRunning(
    props,
    "justinpriday.containers.refresh",
  );
  const hasHeader = usePanelToolbarItem(
    props,
    "justinpriday.containers.refresh",
    {
      disabled: !binding || saver.loading,
      updatedAt: snapshot ? Date.parse(snapshot.capturedAt) : undefined,
      staleAfterMs: 60_000,
    },
  );
  const applySnapshot = (next: DockerProjectSnapshot) => {
    if (next.projectPath === activeTarget.current)
      setSnapshot((current) => acceptSnapshot(current, next));
  };

  const recover = async (): Promise<void> => {
    if (recoveryBusy.current) return;
    recoveryBusy.current = true;
    const generation = targetGeneration.current;
    try {
      const result = await recovery.invoke({ panelId });
      if (
        !result?.epoch ||
        props.disposeSignal.aborted ||
        generation !== targetGeneration.current
      )
        return;
      setLogs((current) => {
        // Snapshot is bounded; merge pushes received while it was in flight.
        let next = emptyConsoleLogState();
        if (result.epoch === clearFloor.current.epoch) {
          next = {
            ...next,
            epoch: result.epoch,
            nextSequence: clearFloor.current.sequence,
          };
        }
        for (const batch of [
          ...result.batches,
          ...recentBatches.current.filter(
            (batch) => batch.epoch === result.epoch,
          ),
        ]) {
          if (
            batch.epoch !== clearFloor.current.epoch ||
            batch.sequence >= clearFloor.current.sequence
          )
            next = appendLogBatch(next, batch);
        }
        return {
          ...next,
          missedBatches: Math.max(
            current.missedBatches,
            next.missedBatches,
            current.epoch && current.epoch !== result.epoch ? 1 : 0,
          ),
          retiredEpochs: current.retiredEpochs,
        };
      });
    } finally {
      recoveryBusy.current = false;
    }
  };
  usePluginPanelEvent<DockerLogBatch>(
    pluginId,
    "docker.logs.batch",
    panelId,
    (batch) => {
      if (batch.targetPath !== activeTarget.current) return;
      recentBatches.current = [...recentBatches.current.slice(-127), batch];
      stream.push(batch);
    },
  );
  usePluginPanelEvent<{ containerId: string; error: string | null }>(
    pluginId,
    "docker.logs.disconnected",
    panelId,
    (event) => {
      setDisconnected((current) => ({
        ...current,
        [event.containerId]: event.error ?? "Log stream ended",
      }));
    },
  );
  usePluginPanelEvent<DockerProjectSnapshot>(
    pluginId,
    "docker.project.snapshot",
    panelId,
    (next) => {
      applySnapshot(next);
      setVerified(true);
    },
  );
  usePluginPanelEvent(pluginId, "docker.project.invalidated", panelId, () => {
    void project.invoke(args).then((next) => {
      if (next) applySnapshot(next);
    });
  });
  useEffect(() => {
    setLogs((current) =>
      stream.items
        .filter((batch) => batch.targetPath === activeTarget.current)
        .reduce(appendLogBatchWithoutIndex, current),
    );
  }, [stream.items]);
  function appendLogBatchWithoutIndex(
    current: ReturnType<typeof emptyConsoleLogState>,
    batch: DockerLogBatch,
  ) {
    return appendLogBatch(current, batch);
  }
  useEffect(() => {
    if (logs.missedBatches > 0) void recover();
  }, [logs.missedBatches]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      resolver.invoke(args),
      preferences.invoke({ panelId }),
    ]).then(async ([resolved, oldPreferences]) => {
      if (cancelled || props.disposeSignal.aborted) return;
      if (resolved) {
        activeTarget.current = resolved.dockerProjectPath;
        setBinding(resolved);
        setTargetPath(resolved.dockerProjectPath);
        setVerified(true);
        persistState?.(resolved);
      }
      if (!restored && oldPreferences) {
        setSelectedContainerId(oldPreferences.selectedContainerId);
        setShowServices(oldPreferences.showServices);
      }
      setPreferencesReady(true);
      if (resolved) {
        const next = await project.invoke(args);
        if (next && !cancelled) applySnapshot(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [panelId, initialArgs]);
  useEffect(() => {
    if (preferencesReady)
      persistState?.({
        ui: {
          selectedContainerId,
          showServices,
          showTimestamps,
          following,
          lastStreamEpoch: logs.epoch,
        },
      });
  }, [
    preferencesReady,
    selectedContainerId,
    showServices,
    showTimestamps,
    following,
    logs.epoch,
    persistState,
  ]);
  useEffect(() => {
    props.setHasUnsavedChanges?.(
      showBinding && targetPath !== binding?.dockerProjectPath,
    );
  }, [showBinding, targetPath, binding?.dockerProjectPath]);
  const containerIds = useMemo(
    () =>
      (snapshot?.containers ?? [])
        .filter((container) => isLoggableContainerState(container.state))
        .map((container) => container.id)
        .sort(),
    [snapshot],
  );
  const containerKey = containerIds.join("\u0000");
  useEffect(() => {
    if (!verified || !binding || !snapshot) return;
    let cancelled = false;
    setDisconnected({});
    void connector.invoke({ ...args, containerIds, tail: 120 }).then(() => {
      if (!cancelled) void recover();
    });
    // The worker owns stream lifetimes; remount disposal is not panel deletion.
    return () => {
      cancelled = true;
    };
  }, [
    verified,
    panelId,
    binding?.dockerProjectPath,
    containerKey,
    streamRevision,
  ]);
  const visible = useMemo(
    () => filterLogRecords(logs.records, selectedContainerId),
    [logs.records, selectedContainerId],
  );
  useEffect(() => {
    if (!following) return;
    const frame = requestAnimationFrame(() => {
      if (viewport.current)
        viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, following]);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    // Kit VirtualList owns its ref/scroll handler. Bind to our public role in our
    // own content and observe capture events without overriding its virtualiser.
    void whenPluginUiReady()
      .then(() => {
        if (cancelled) return;
        viewport.current =
          logContent.current?.querySelector<HTMLElement>('[role="log"]') ??
          null;
        const element = viewport.current;
        if (!element) return;
        const anchor = () => {
          cancelAnimationFrame(frame);
          if (followRef.current)
            frame = requestAnimationFrame(() => {
              element.scrollTop = element.scrollHeight;
            });
        };
        anchor();
        observer = new ResizeObserver(anchor);
        observer.observe(element);
      })
      .catch((error) => {
        if (!cancelled) setLocalError(String(error));
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      cancelAnimationFrame(frame);
      viewport.current = null;
    };
  }, [visible.length > 0]);
  useEffect(() => {
    if (!copyConfirmed) return;
    const timer = setTimeout(() => setCopyConfirmed(false), 1500);
    return () => clearTimeout(timer);
  }, [copyConfirmed]);
  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  const refresh = async () => {
    setLocalError(null);
    const resolved = await resolver.invoke(args);
    if (!resolved) {
      setVerified(false);
      return;
    }
    setBinding(resolved);
    setVerified(true);
    const next = await project.invoke(args);
    if (next) applySnapshot(next);
    setStreamRevision((value) => value + 1);
  };
  const saveTarget = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!binding) return;
    const saved = await saver.invoke({
      panelId,
      binding,
      dockerProjectPath: targetPath.trim(),
    });
    if (!saved) return;
    targetGeneration.current++;
    activeTarget.current = saved.dockerProjectPath;
    setBinding(saved);
    setVerified(true);
    setTargetPath(saved.dockerProjectPath);
    persistState?.(saved);
    setShowBinding(false);
    setSelectedContainerId(null);
    setSnapshot(null);
    stream.clear();
    recentBatches.current = [];
    setLogs(emptyConsoleLogState());
    const next = await project.invoke(args);
    if (next) applySnapshot(next);
  };
  const requestOperation = (
    operation: DockerContainerOperation,
    containerId?: string,
  ) => {
    if (!binding) return;
    const container = snapshot?.containers.find(
      (item) => item.id === containerId,
    );
    setPending({
      operation,
      containerId,
      label: container
        ? container.serviceName || container.name
        : "project containers",
      target: binding.dockerProjectPath,
    });
  };
  const confirmOperation = async () => {
    if (!pending || !binding || pending.target !== binding.dockerProjectPath) {
      setPending(null);
      return;
    }
    const result = pending.containerId
      ? await containerOperator.invoke({
          ...args,
          containerId: pending.containerId,
          operation: pending.operation,
        })
      : await operator.invoke({
          ...args,
          operation: pending.operation as DockerProjectOperation,
        });
    if (result) {
      applySnapshot(result.snapshot);
      if ("failed" in result && result.failed.length)
        setLocalError(
          `${result.succeeded}/${result.attempted} containers updated. ${result.failed.map((item) => `${item.containerName}: ${item.error}`).join("; ")}`,
        );
    }
    setPending(null);
  };
  const copy = async () => {
    const text = formatLogRecordsForClipboard(visible, showTimestamps);
    if (new TextEncoder().encode(text).byteLength > MAX_COPY_BYTES) {
      setLocalError(
        "Copy is limited to 1 MiB. Select a service or clear older history.",
      );
      return;
    }
    const result = await copier.invoke({ text });
    if (result?.copied) setCopyConfirmed(true);
  };
  const armScroll = () => {
    intentionalScroll.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      intentionalScroll.current = false;
    }, 200);
  };
  const containers = snapshot?.containers ?? [];
  const selected = containers.find(
    (container) => container.id === selectedContainerId,
  );
  const title = selected
    ? selected.serviceName || selected.name
    : "All services";
  const running = containers.filter(
    (container) => container.state === "running",
  ).length;
  const busy = operator.loading || containerOperator.loading || saver.loading;
  const ready = verified && snapshot?.connection.state === "ready";
  const error =
    localError ??
    (!verified ? resolver.error?.message : null) ??
    saver.error?.message ??
    project.error?.message ??
    operator.error?.message ??
    containerOperator.error?.message ??
    connector.error?.message ??
    copier.error?.message ??
    settings.error?.message ??
    snapshot?.connection.error;

  return (
    <div className="dc-root" data-panel-id={panelId}>
      <style>{dockerPanelStyles}</style>
      <PaneLayout
        scroll="none"
        bodyClassName="flex flex-col min-h-0 min-w-0"
        toolbar={
          <>
            <div className="dc-context">
              <div className="dc-target">
                <Tooltip
                  content={
                    binding
                      ? `Worktree: ${binding.worktreePath}\nDocker target: ${binding.dockerProjectPath}`
                      : "No worktree binding"
                  }
                >
                  <div className="dc-target-label">
                    <Icon name="folder" />
                    <strong>
                      {binding?.worktreeName ?? "Container Console"}
                    </strong>
                  </div>
                </Tooltip>
                <div className="dc-target-path">
                  {binding?.dockerProjectPath ??
                    "Open Containers from a worktree"}
                </div>
              </div>
              <Badge tone={ready ? "neutral" : "warning"}>
                {ready
                  ? `${running}/${containers.length} running`
                  : verified
                    ? "Docker offline"
                    : "Verify target"}
              </Badge>
              {!hasHeader && (
                <IconButton
                  icon="refresh"
                  aria-label="Refresh"
                  size="sm"
                  loading={project.loading || headerRefresh}
                  onClick={() => void refresh()}
                />
              )}
              <IconButton
                icon="settings"
                aria-label="Change Docker target"
                size="sm"
                pressed={showBinding}
                disabled={busy || !verified}
                onClick={() => setShowBinding((value) => !value)}
              />
            </div>
            {showBinding && (
              <form
                className="dc-binding"
                onSubmit={(event) => void saveTarget(event)}
              >
                <FormField
                  label="Docker project path"
                  error={saver.error?.message}
                  className="min-w-0 flex-1"
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={targetPath}
                      onValueChange={setTargetPath}
                      density="compact"
                      required
                    />
                  )}
                </FormField>
                <div className="dc-actions">
                  <Button
                    type="submit"
                    size="sm"
                    loading={saver.loading}
                    disabled={!targetPath.trim()}
                  >
                    Bind target
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTargetPath(binding?.dockerProjectPath ?? "");
                      setShowBinding(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {error && (
              <Callout
                severity="error"
                variant="strip"
                role="alert"
                action={
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void refresh()}
                  >
                    Refresh
                  </Button>
                }
              >
                {error}
              </Callout>
            )}
            {ready && (
              <div className="dc-project-actions">
                <span className="text-text-secondary text-2xs">
                  Project containers
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  icon="play"
                  disabled={busy}
                  onClick={() => requestOperation("start")}
                >
                  Start
                </Button>
                <Button
                  size="xs"
                  variant="ghost-danger"
                  icon="square"
                  disabled={busy}
                  onClick={() => requestOperation("stop")}
                >
                  Stop
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  icon="rotate-cw"
                  disabled={busy}
                  onClick={() => requestOperation("restart")}
                >
                  Restart
                </Button>
              </div>
            )}
          </>
        }
        statusBar={
          <StatusBar
            left={[
              `${containerIds.length} log streams`,
              `${visible.length} records`,
              logs.evictedRecords
                ? `${logs.evictedRecords} older records evicted`
                : null,
              logs.missedBatches ? `${logs.missedBatches} gap(s)` : null,
            ]}
            right={
              Object.keys(disconnected).length ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void refresh()}
                >
                  Reconnect logs
                </Button>
              ) : following ? (
                "Following"
              ) : (
                "Paused"
              )
            }
          />
        }
      >
        {!binding ? (
          <EmptyState
            title="No worktree binding"
            description="Open this panel with Containers: Open Console to select a worktree."
            icon="folder"
          />
        ) : !snapshot ? (
          <div className="dc-empty">
            <Skeleton label="Loading container project" />
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Verify and refresh
            </Button>
          </div>
        ) : !containers.length ? (
          <EmptyState
            title={
              ready ? "No matching Compose containers" : "Docker unavailable"
            }
            description={
              ready
                ? "Start a Compose project for this target, then refresh."
                : snapshot.connection.error
            }
            icon="layers"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void settings.invoke({})}
              >
                Docker socket settings
              </Button>
            }
          />
        ) : (
          <div className="dc-body">
            {showServices && (
              <aside className="dc-services" aria-label="Compose services">
                <div className="dc-section">
                  <span>Services</span>
                  <IconButton
                    icon="panel-left-close"
                    aria-label="Hide services"
                    size="xs"
                    onClick={() => setShowServices(false)}
                  />
                </div>
                <div className="dc-service-scroll">
                  <ListRow
                    title="All services"
                    subtitle={`${running}/${containers.length} running`}
                    icon="layers"
                    selected={!selectedContainerId}
                    onSelect={() => {
                      setSelectedContainerId(null);
                      setFollowing(true);
                    }}
                  />
                  {containers.map((container) => (
                    <div key={container.id} className="dc-service">
                      <ListRow
                        title={container.serviceName || container.name}
                        subtitle={`${container.name} · ${container.status}`}
                        selected={selectedContainerId === container.id}
                        onSelect={() => {
                          setSelectedContainerId(container.id);
                          setFollowing(true);
                        }}
                        meta={
                          <Badge
                            tone={
                              container.health === "unhealthy"
                                ? "error"
                                : container.state === "running"
                                  ? "neutral"
                                  : "warning"
                            }
                          >
                            {container.health === "unhealthy"
                              ? "unhealthy"
                              : container.state}
                          </Badge>
                        }
                      />
                      <div className="dc-resource-actions">
                        {container.state !== "running" &&
                          container.state !== "paused" && (
                            <IconButton
                              icon="play"
                              aria-label={`Start ${container.serviceName || container.name}`}
                              size="xs"
                              disabled={busy || !ready}
                              onClick={() =>
                                requestOperation("start", container.id)
                              }
                            />
                          )}
                        {(container.state === "running" ||
                          container.state === "paused") && (
                          <IconButton
                            icon="square"
                            aria-label={`Stop ${container.serviceName || container.name}`}
                            variant="ghost-danger"
                            size="xs"
                            disabled={busy || !ready}
                            onClick={() =>
                              requestOperation("stop", container.id)
                            }
                          />
                        )}
                        {container.state === "running" && (
                          <IconButton
                            icon="pause"
                            aria-label={`Pause ${container.serviceName || container.name}`}
                            size="xs"
                            disabled={busy || !ready}
                            onClick={() =>
                              requestOperation("pause", container.id)
                            }
                          />
                        )}
                        {container.state === "paused" && (
                          <IconButton
                            icon="play"
                            aria-label={`Resume ${container.serviceName || container.name}`}
                            size="xs"
                            disabled={busy || !ready}
                            onClick={() =>
                              requestOperation("unpause", container.id)
                            }
                          />
                        )}
                        <IconButton
                          icon="rotate-cw"
                          aria-label={`Restart ${container.serviceName || container.name}`}
                          size="xs"
                          disabled={busy || !ready}
                          onClick={() =>
                            requestOperation("restart", container.id)
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            )}
            <main className="dc-console">
              <div className="dc-section dc-console-tools">
                {!showServices && (
                  <IconButton
                    icon="panel-left-open"
                    aria-label="Show services"
                    size="xs"
                    onClick={() => setShowServices(true)}
                  />
                )}
                <strong className="dc-console-title">{title}</strong>
                <IconButton
                  icon="clock"
                  aria-label="Show timestamps"
                  size="xs"
                  pressed={showTimestamps}
                  onClick={() => setShowTimestamps((value) => !value)}
                />
                <IconButton
                  icon={copyConfirmed ? "check" : "copy"}
                  aria-label={
                    copyConfirmed ? "Logs copied" : "Copy visible logs"
                  }
                  size="xs"
                  disabled={!visible.length}
                  loading={copier.loading}
                  onClick={() => void copy()}
                />
                <IconButton
                  icon="trash"
                  aria-label="Clear displayed logs"
                  size="xs"
                  onClick={() => {
                    stream.clear();
                    recentBatches.current = [];
                    setLogs((current) => {
                      clearFloor.current = {
                        epoch: current.epoch,
                        sequence: current.nextSequence,
                      };
                      return {
                        ...current,
                        records: [],
                        bytes: 0,
                        evictedRecords: 0,
                      };
                    });
                  }}
                />
                <Button
                  size="xs"
                  variant="ghost"
                  icon={following ? "pause" : "arrow-down"}
                  pressed={following}
                  onClick={() => setFollowing((value) => !value)}
                >
                  {following ? "Pause" : "Resume live"}
                </Button>
              </div>
              {!visible.length ? (
                <div className="dc-log-empty">
                  {connector.loading
                    ? "Connecting to Docker logs…"
                    : "Waiting for log output."}
                </div>
              ) : (
                <div
                  className="dc-log-content"
                  ref={logContent}
                  onScrollCapture={(event) => {
                    const element = event.target as HTMLElement;
                    viewport.current = element;
                    setFollowing((current) =>
                      resolveFollowingAfterScroll(
                        current,
                        intentionalScroll.current,
                        element,
                      ),
                    );
                  }}
                  onWheelCapture={armScroll}
                  onTouchMoveCapture={armScroll}
                  onPointerDownCapture={armScroll}
                  onKeyDownCapture={(event) => {
                    if (
                      [
                        "ArrowUp",
                        "ArrowDown",
                        "PageUp",
                        "PageDown",
                        "Home",
                        "End",
                      ].includes(event.key)
                    )
                      armScroll();
                  }}
                >
                  <VirtualList
                    activeIndex={following ? visible.length - 1 : undefined}
                    aria-label={`${title} logs`}
                    role="log"
                    tabIndex={0}
                    items={visible}
                    estimatedItemSize={24}
                    className="dc-log-viewport"
                    renderItem={(_index, record) => (
                      <div
                        className="dc-log-row"
                        style={{
                          borderLeftColor: getServiceColor(
                            record.serviceName || record.containerName,
                          ),
                        }}
                      >
                        <span
                          className="dc-log-service"
                          style={{
                            color: getServiceColor(
                              record.serviceName || record.containerName,
                            ),
                          }}
                        >
                          {record.serviceName || record.containerName}
                        </span>
                        <span
                          className={`dc-log-message ${record.stream === "stderr" ? "stderr" : ""}`}
                        >
                          {showTimestamps && record.timestamp && (
                            <span className="dc-log-time">
                              {formatLogTimestamp(record.timestamp)}{" "}
                            </span>
                          )}
                          {record.text}
                        </span>
                      </div>
                    )}
                  />
                </div>
              )}
            </main>
          </div>
        )}
      </PaneLayout>
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={`${pending?.operation ?? "Update"} ${pending?.label ?? "containers"}`}
        description="This changes the Docker resources shown below."
        confirmLabel={`${pending?.operation ?? "Update"} containers`}
        variant={
          pending?.operation === "stop" || pending?.operation === "restart"
            ? "destructive"
            : "default"
        }
        loading={operator.loading || containerOperator.loading}
        onConfirm={confirmOperation}
      >
        <div className="flex flex-col gap-2">
          <span>{binding?.worktreeName}</span>
          <code className="text-text-secondary break-all">
            {pending?.target}
          </code>
        </div>
      </ConfirmDialog>
    </div>
  );
}
