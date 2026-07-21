// Daintree 0.27+ exposes stable host React facades for packaged third-party views.
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PanelViewProps } from "@daintreehq/plugin-sdk";
import { useHostChannel, usePluginPanelEvent } from "./daintree/reactHooks.js";
import type {
  DockerContainer,
  DockerContainerOperation,
  DockerContainerOperationResult,
  DockerLogBatch,
  DockerOperationResult,
  DockerProjectOperation,
  DockerProjectSnapshot,
} from "./docker/types.js";
import { dockerPanelStyles } from "./panelStyles.js";
import {
  appendLogBatch,
  emptyConsoleLogState,
  filterLogRecords,
  formatLogRecordsForClipboard,
  formatLogTimestamp,
  getServiceColor,
  isLoggableContainerState,
  resolveFollowingAfterScroll,
} from "./shared/logConsole.js";
import { parseDockerPanelBinding, type DockerPanelBinding } from "./shared/binding.js";

interface ResolveBindingArgs {
  panelId: string;
  initialArgs?: Record<string, unknown>;
}

interface SaveBindingArgs {
  panelId: string;
  binding: DockerPanelBinding;
  dockerProjectPath: string;
}

interface DockerProjectArgs {
  panelId: string;
  initialArgs?: Record<string, unknown>;
}

interface DockerProjectOperationArgs extends DockerProjectArgs {
  operation: DockerProjectOperation;
}

interface DockerContainerOperationArgs extends DockerProjectArgs {
  containerId: string;
  operation: DockerContainerOperation;
}

interface DockerLogsConnectArgs extends DockerProjectArgs {
  containerIds: string[];
  tail?: number;
}

interface DockerLogsConnectResult {
  containerIds: string[];
  connected: true;
}

interface DockerLogsDisconnectArgs {
  panelId: string;
}

interface DockerLogsDisconnectResult {
  disconnected: boolean;
}

interface DockerLogsDisconnectedEvent {
  containerId: string;
  error: string | null;
}

interface CopyLogsArgs {
  text: string;
}

interface CopyLogsResult {
  copied: true;
}

type IconName =
  | "play"
  | "stop"
  | "restart"
  | "pause"
  | "refresh"
  | "settings"
  | "layers"
  | "chevron-right"
  | "arrow-down"
  | "trash"
  | "clock"
  | "copy"
  | "check"
  | "sidebar-close"
  | "sidebar-open";

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  play: <path d="m7 5 10 7-10 7Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  restart: <><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></>,
  pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-4" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.9 4" /><path d="M20 20v-5h-5" /></>,
  settings: <><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1H9.6V21a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1V9.6h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1 .4h.1v4H21a1.7 1.7 0 0 0-1.6 1.1Z" /></>,
  layers: <><path d="m12 2 9 5-9 5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "arrow-down": <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 14h10l1-14" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  "sidebar-close": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="m15 9-3 3 3 3" /></>,
  "sidebar-open": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="m13 9 3 3-3 3" /></>,
};

function Icon({ name }: { name: IconName }): React.ReactElement {
  return <svg className="dc-icon" viewBox="0 0 24 24" aria-hidden="true">{ICON_PATHS[name]}</svg>;
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger";
  active?: boolean;
  showLabel?: boolean;
}

function IconButton({ icon, label, onClick, disabled, tone, active, showLabel }: IconButtonProps) {
  const className = ["dc-button", showLabel ? "" : "icon", tone ?? "", active ? "active" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={className} type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}

function stateClass(container: DockerContainer): string {
  const state = (container.health === "unhealthy" ? "error" : container.state).toLowerCase();
  return state.replace(/[^a-z-]/g, "");
}

function serviceLabel(container: DockerContainer): string {
  return container.serviceName || container.name;
}

export default function DockerConsolePanel({
  panelId,
  pluginId,
  initialArgs,
}: PanelViewProps): React.ReactElement {
  const initialBinding = parseDockerPanelBinding(initialArgs);
  const [binding, setBinding] = useState<DockerPanelBinding | null>(initialBinding);
  const [targetPath, setTargetPath] = useState(initialBinding?.dockerProjectPath ?? "");
  const [showBinding, setShowBinding] = useState(false);
  const [snapshot, setSnapshot] = useState<DockerProjectSnapshot | null>(null);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [logs, setLogs] = useState(emptyConsoleLogState);
  const [disconnected, setDisconnected] = useState<Record<string, string>>({});
  const [streamRevision, setStreamRevision] = useState(0);
  const [following, setFollowing] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showServices, setShowServices] = useState(true);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const logViewportRef = useRef<HTMLDivElement>(null);
  const userScrollIntentRef = useRef(false);
  const scrollIntentTimerRef = useRef<number | null>(null);

  const resolver = useHostChannel<ResolveBindingArgs, DockerPanelBinding | null>(pluginId, "binding.resolve");
  const saver = useHostChannel<SaveBindingArgs, DockerPanelBinding>(pluginId, "binding.setDockerProjectPath");
  const project = useHostChannel<DockerProjectArgs, DockerProjectSnapshot>(pluginId, "docker.project.get");
  const operator = useHostChannel<DockerProjectOperationArgs, DockerOperationResult>(pluginId, "docker.project.operate");
  const containerOperator = useHostChannel<DockerContainerOperationArgs, DockerContainerOperationResult>(pluginId, "docker.container.operate");
  const logConnector = useHostChannel<DockerLogsConnectArgs, DockerLogsConnectResult>(pluginId, "docker.logs.connect");
  const logDisconnector = useHostChannel<DockerLogsDisconnectArgs, DockerLogsDisconnectResult>(pluginId, "docker.logs.disconnect");
  const logCopier = useHostChannel<CopyLogsArgs, CopyLogsResult>(pluginId, "docker.logs.copy");

  usePluginPanelEvent<DockerLogBatch>(pluginId, "docker.logs.batch", panelId, (batch) => {
    setLogs((current) => appendLogBatch(current, batch));
  });
  usePluginPanelEvent<DockerLogsDisconnectedEvent>(pluginId, "docker.logs.disconnected", panelId, (event) => {
    setDisconnected((current) => ({
      ...current,
      [event.containerId]: event.error ?? "Log stream ended",
    }));
  });
  usePluginPanelEvent<DockerProjectSnapshot>(pluginId, "docker.project.snapshot", panelId, (next) => {
    setSnapshot(next);
  });

  useEffect(() => {
    let cancelled = false;
    void resolver.invoke({ panelId, initialArgs }).then(async (resolved) => {
      if (!resolved || cancelled) return;
      setBinding(resolved);
      setTargetPath(resolved.dockerProjectPath);
      const nextSnapshot = await project.invoke({ panelId, initialArgs });
      if (!cancelled && nextSnapshot) setSnapshot(nextSnapshot);
    });
    return () => { cancelled = true; };
  }, [panelId, initialArgs]);

  const loggableContainerIds = useMemo(
    () => (snapshot?.containers ?? []).filter((container) => isLoggableContainerState(container.state)).map((container) => container.id).sort(),
    [snapshot]
  );
  const loggableKey = loggableContainerIds.join("\u0000");

  useEffect(() => {
    if (!binding) return;
    setDisconnected({});
    void logConnector.invoke({ panelId, initialArgs, containerIds: loggableContainerIds, tail: 120 });
    return () => { void logDisconnector.invoke({ panelId }); };
  }, [panelId, initialArgs, binding?.dockerProjectPath, loggableKey, streamRevision]);

  const visibleRecords = useMemo(
    () => filterLogRecords(logs.records, selectedContainerId),
    [logs.records, selectedContainerId]
  );

  useEffect(() => {
    if (!following) return;
    const frame = requestAnimationFrame(() => {
      const viewport = logViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleRecords.length, following]);

  useEffect(() => {
    const viewport = logViewportRef.current;
    if (!viewport || !following || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight;
      });
    });
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [following]);

  useEffect(() => {
    setFollowing(true);
  }, [selectedContainerId]);

  useEffect(() => {
    if (!copyConfirmed) return;
    const timer = window.setTimeout(() => setCopyConfirmed(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copyConfirmed]);

  useEffect(() => () => {
    if (scrollIntentTimerRef.current !== null) {
      window.clearTimeout(scrollIntentTimerRef.current);
    }
  }, []);

  if (!binding) {
    return (
      <div className="dc-root">
        <style>{dockerPanelStyles}</style>
        <div className="dc-empty-project"><div><strong>Container Console</strong>Open this panel with “Containers: Open Console” to bind it to a worktree.</div></div>
      </div>
    );
  }

  const refresh = async (): Promise<void> => {
    const next = await project.invoke({ panelId, initialArgs });
    if (next) setSnapshot(next);
    setStreamRevision((value) => value + 1);
  };

  const operate = async (operation: DockerProjectOperation): Promise<void> => {
    const result = await operator.invoke({ panelId, initialArgs, operation });
    if (result) setSnapshot(result.snapshot);
  };

  const operateContainer = async (containerId: string, operation: DockerContainerOperation): Promise<void> => {
    const result = await containerOperator.invoke({ panelId, initialArgs, containerId, operation });
    if (result) setSnapshot(result.snapshot);
  };

  const saveTarget = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await saver.invoke({ panelId, binding, dockerProjectPath: targetPath });
    if (!result) return;
    setBinding(result);
    setLogs(emptyConsoleLogState());
    setSelectedContainerId(null);
    const next = await project.invoke({ panelId, initialArgs });
    if (next) setSnapshot(next);
    setShowBinding(false);
  };

  const containers = snapshot?.containers ?? [];
  const composeProjects = snapshot?.composeProjects ?? [];
  const composeProjectTitle = composeProjects.length === 1
    ? composeProjects[0]!
    : composeProjects.length > 1
      ? `${composeProjects.length} Compose projects`
      : binding.worktreeName;
  const composeProjectTooltip = composeProjects.length > 0
    ? composeProjects.join(", ")
    : "No matching Compose project discovered";
  const selectedContainer = containers.find((container) => container.id === selectedContainerId) ?? null;
  const runningCount = containers.filter((container) => container.state === "running").length;
  const connectionReady = snapshot?.connection.state === "ready";
  const busy = project.loading || operator.loading || containerOperator.loading;
  const consoleTitle = selectedContainer ? serviceLabel(selectedContainer) : "All services";
  const consoleSubtitle = selectedContainer
    ? selectedContainer.status
    : `${runningCount}/${containers.length} running`;
  const disconnectedCount = Object.keys(disconnected).length;

  const scrollToLive = (): void => {
    setFollowing(true);
    const viewport = logViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  };

  const releaseUserScrollIntent = (): void => {
    if (scrollIntentTimerRef.current !== null) {
      window.clearTimeout(scrollIntentTimerRef.current);
    }
    scrollIntentTimerRef.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      scrollIntentTimerRef.current = null;
    }, 180);
  };

  const armUserScrollIntent = (): void => {
    userScrollIntentRef.current = true;
    releaseUserScrollIntent();
  };

  const holdUserScrollIntent = (): void => {
    if (scrollIntentTimerRef.current !== null) {
      window.clearTimeout(scrollIntentTimerRef.current);
      scrollIntentTimerRef.current = null;
    }
    userScrollIntentRef.current = true;
  };

  const copyVisibleLogs = async (): Promise<void> => {
    const text = formatLogRecordsForClipboard(visibleRecords, showTimestamps);
    if (!text) return;
    const result = await logCopier.invoke({ text });
    if (result?.copied) setCopyConfirmed(true);
  };

  return (
    <div className="dc-root" data-panel-id={panelId}>
      <style>{dockerPanelStyles}</style>

      <header className="dc-toolbar">
        <span className={`dc-status-dot ${connectionReady ? "running" : "error"}`} />
        <div className="dc-project">
          <div className="dc-project-title">
            <span title={composeProjectTooltip}>{composeProjectTitle}</span>
            {composeProjects.length > 0 ? <span className="dc-project-kind">Compose</span> : null}
            <span style={{ color: "var(--dc-faint)", fontSize: 10, fontWeight: 500 }}>
              {connectionReady ? `Docker ${snapshot?.connection.daemon?.version ?? "ready"}` : snapshot?.connection.state ?? "Connecting"}
            </span>
          </div>
          <div className="dc-project-path" title={`Worktree: ${binding.worktreeName}\nDocker target: ${binding.dockerProjectPath}`}>
            <span className="dc-project-context">Worktree</span> {binding.worktreeName}
            <span className="dc-project-separator">·</span>
            <span className="dc-project-context">Target</span> {binding.dockerProjectPath}
          </div>
        </div>
        <div className="dc-toolbar-actions">
          <IconButton icon="refresh" label="Refresh" onClick={() => void refresh()} disabled={busy} showLabel />
          <IconButton icon="play" label="Start" onClick={() => void operate("start")} disabled={busy || !connectionReady} tone="primary" showLabel />
          <IconButton icon="stop" label="Stop" onClick={() => void operate("stop")} disabled={busy || !connectionReady} tone="danger" showLabel />
          <IconButton icon="restart" label="Restart" onClick={() => void operate("restart")} disabled={busy || !connectionReady} showLabel />
          <IconButton icon="settings" label="Change Docker project binding" onClick={() => setShowBinding((value) => !value)} active={showBinding} />
        </div>
      </header>

      {showBinding ? (
        <form className="dc-binding" onSubmit={(event) => void saveTarget(event)}>
          <input aria-label="Docker project path" value={targetPath} onChange={(event) => setTargetPath(event.target.value)} />
          <button className="dc-button" type="submit" disabled={saver.loading || targetPath.trim().length === 0}>{saver.loading ? "Saving…" : "Bind"}</button>
          <button className="dc-button" type="button" onClick={() => { setTargetPath(binding.dockerProjectPath); setShowBinding(false); }}>Cancel</button>
        </form>
      ) : null}

      {snapshot?.connection.error || project.error || operator.error || containerOperator.error || logConnector.error ? (
        <div className="dc-alert">
          {snapshot?.connection.error ?? project.error?.message ?? operator.error?.message ?? containerOperator.error?.message ?? logConnector.error?.message}
        </div>
      ) : null}

      {containers.length > 0 ? (
        <div className="dc-body">
          {showServices ? <aside className="dc-services" aria-label="Compose services">
            <div className="dc-services-heading"><span>Services</span><IconButton icon="sidebar-close" label="Hide services" onClick={() => setShowServices(false)} /></div>
            <div className="dc-service-scroll">
              <div className={`dc-service ${selectedContainerId === null ? "selected" : ""}`}>
                <button className="dc-service-select" type="button" onClick={() => setSelectedContainerId(null)} aria-pressed={selectedContainerId === null}>
                  <Icon name="layers" />
                  <span className="dc-service-copy">
                    <span className="dc-service-name">All services</span>
                    <span className="dc-service-detail">{runningCount}/{containers.length} running</span>
                  </span>
                  <span className="dc-open-console">Console <Icon name="chevron-right" /></span>
                </button>
              </div>
              {containers.map((container) => {
                const active = container.id === selectedContainerId;
                const running = container.state === "running";
                const paused = container.state === "paused";
                return (
                  <div key={container.id} className={`dc-service ${active ? "selected" : ""}`}>
                    <button className="dc-service-select" type="button" onClick={() => setSelectedContainerId(container.id)} aria-pressed={active}>
                      <span className={`dc-status-dot ${stateClass(container)}`} title={container.health ?? container.status} />
                      <span className="dc-service-copy">
                        <span className="dc-service-name" title={serviceLabel(container)}>{serviceLabel(container)}</span>
                        <span className="dc-service-detail" title={`${container.name} · ${container.status} · ${container.image}`}>{container.name} · {container.status}</span>
                      </span>
                      <span className="dc-open-console">Logs <Icon name="chevron-right" /></span>
                    </button>
                    <div className="dc-row-actions" aria-label={`${serviceLabel(container)} controls`}>
                      {!running && !paused ? <IconButton icon="play" label={`Start ${serviceLabel(container)}`} onClick={() => void operateContainer(container.id, "start")} disabled={busy} tone="primary" /> : null}
                      {running || paused ? <IconButton icon="stop" label={`Stop ${serviceLabel(container)}`} onClick={() => void operateContainer(container.id, "stop")} disabled={busy} tone="danger" /> : null}
                      {running ? <IconButton icon="pause" label={`Pause ${serviceLabel(container)}`} onClick={() => void operateContainer(container.id, "pause")} disabled={busy} /> : null}
                      {paused ? <IconButton icon="play" label={`Resume ${serviceLabel(container)}`} onClick={() => void operateContainer(container.id, "unpause")} disabled={busy} tone="primary" /> : null}
                      <IconButton icon="restart" label={`Restart ${serviceLabel(container)}`} onClick={() => void operateContainer(container.id, "restart")} disabled={busy} />
                    </div>
                  </div>
                );
              })}
            </div>
          </aside> : null}

          <main className="dc-console">
            <div className="dc-console-head">
              {!showServices ? <IconButton icon="sidebar-open" label="Show services" onClick={() => setShowServices(true)} /> : null}
              <div className="dc-console-title"><span className="dc-console-kicker">Console</span>{consoleTitle} <span className="dc-console-subtitle">{consoleSubtitle}</span></div>
              <div className="dc-console-actions">
                <IconButton icon="clock" label={showTimestamps ? "Hide timestamps" : "Show timestamps"} onClick={() => setShowTimestamps((value) => !value)} active={showTimestamps} />
                <IconButton icon={copyConfirmed ? "check" : "copy"} label={copyConfirmed ? "Copied" : "Copy visible console"} onClick={() => void copyVisibleLogs()} disabled={visibleRecords.length === 0 || logCopier.loading} active={copyConfirmed} />
                <IconButton icon="trash" label="Clear log buffer" onClick={() => setLogs(emptyConsoleLogState())} disabled={logs.records.length === 0} />
              </div>
            </div>
            <div
              ref={logViewportRef}
              className="dc-log-viewport"
              tabIndex={0}
              aria-label={`${consoleTitle} log output`}
              onWheel={armUserScrollIntent}
              onKeyDown={(event) => {
                if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
                  armUserScrollIntent();
                }
              }}
              onPointerDown={holdUserScrollIntent}
              onPointerUp={releaseUserScrollIntent}
              onPointerCancel={releaseUserScrollIntent}
              onScroll={(event) => {
                const element = event.currentTarget;
                setFollowing((current) => resolveFollowingAfterScroll(
                  current,
                  userScrollIntentRef.current,
                  element
                ));
              }}
            >
              {visibleRecords.length === 0 ? (
                <div className="dc-log-empty">{logConnector.loading ? "Connecting to Docker logs…" : "Waiting for log output."}</div>
              ) : visibleRecords.map((record, index) => {
                const color = getServiceColor(record.serviceName || record.containerName);
                return (
                  <div className="dc-log-row" key={`${record.containerId}-${record.timestamp ?? "untimed"}-${index}`} style={{ borderLeftColor: color }}>
                    <span className="dc-log-service" style={{ color }} title={record.serviceName || record.containerName}>{record.serviceName || record.containerName}</span>
                    <span className={`dc-log-message ${record.stream === "stderr" ? "stderr" : ""}`}>
                      {showTimestamps && record.timestamp ? <span className="dc-log-time">{formatLogTimestamp(record.timestamp)}</span> : null}
                      {record.text}
                    </span>
                  </div>
                );
              })}
            </div>
            <footer className="dc-console-status">
              <span className="dc-live">{logConnector.loading ? "Connecting" : `${loggableContainerIds.length} streams`}</span>
              <span>{visibleRecords.length.toLocaleString()} lines</span>
              {logs.missedBatches > 0 ? <span style={{ color: "var(--dc-paused)" }}>{logs.missedBatches} sequence gap(s)</span> : null}
              {disconnectedCount > 0 ? (
                <IconButton icon="refresh" label={`Reconnect ${disconnectedCount} disconnected stream${disconnectedCount === 1 ? "" : "s"}`} onClick={() => setStreamRevision((value) => value + 1)} showLabel />
              ) : null}
              <span className="dc-status-spacer" />
              {!following ? <IconButton icon="arrow-down" label="Resume live tail" onClick={scrollToLive} showLabel /> : <span>Following live output</span>}
            </footer>
          </main>
        </div>
      ) : (
        <div className="dc-empty-project">
          <div><strong>No Compose services found</strong>No containers match this Docker project path.</div>
        </div>
      )}
    </div>
  );
}
