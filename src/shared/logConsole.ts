import type { DockerLogBatch, DockerLogRecord } from "../docker/types.js";

export const MAX_CONSOLE_RECORDS = 5_000;

export const MAX_CONSOLE_BYTES = 2 * 1024 * 1024;
export const MAX_COPY_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
export function recordBytes(record: DockerLogRecord): number {
  return encoder.encode(JSON.stringify(record)).byteLength;
}
export interface ConsoleLogState {
  records: DockerLogRecord[];
  epoch: string | null;
  nextSequence: number;
  missedBatches: number;
  evictedRecords: number;
  bytes: number;
  retiredEpochs: string[];
}
export function emptyConsoleLogState(): ConsoleLogState {
  return {
    records: [],
    epoch: null,
    nextSequence: 0,
    missedBatches: 0,
    evictedRecords: 0,
    bytes: 0,
    retiredEpochs: [],
  };
}
export function appendLogBatch(
  current: ConsoleLogState,
  batch: DockerLogBatch,
  limit = MAX_CONSOLE_RECORDS,
  byteLimit = MAX_CONSOLE_BYTES,
): ConsoleLogState {
  if (current.retiredEpochs.includes(batch.epoch)) return current;
  const reset = current.epoch !== null && current.epoch !== batch.epoch;
  const base = reset ? emptyConsoleLogState() : current;
  if (
    !reset &&
    base.epoch === batch.epoch &&
    batch.sequence < base.nextSequence
  )
    return current;
  const records = [...base.records, ...batch.records];
  let bytes =
    base.bytes +
    batch.records.reduce((total, record) => total + recordBytes(record), 0);
  let removed = 0;
  while (
    records.length - removed > Math.max(1, limit) ||
    (bytes > byteLimit && removed < records.length)
  ) {
    bytes -= recordBytes(records[removed++]!);
  }
  return {
    retiredEpochs: reset
      ? [...current.retiredEpochs, current.epoch!].slice(-8)
      : current.retiredEpochs,
    records: records.slice(removed),
    bytes,
    epoch: batch.epoch,
    nextSequence: batch.sequence + 1,
    missedBatches:
      (reset ? current.missedBatches : base.missedBatches) +
      (batch.sequence === base.nextSequence ? 0 : 1) +
      (reset ? 1 : 0),
    evictedRecords: base.evictedRecords + removed,
  };
}
export function acceptSnapshot<T extends { epoch?: string; revision?: number }>(
  current: T | null,
  next: T,
): T {
  if (
    current?.epoch === next.epoch &&
    (current?.revision ?? -1) > (next.revision ?? -1)
  )
    return current!;
  return next;
}

export function filterLogRecords(
  records: readonly DockerLogRecord[],
  containerId: string | null,
): readonly DockerLogRecord[] {
  return containerId
    ? records.filter((record) => record.containerId === containerId)
    : records;
}

export function isLoggableContainerState(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return (
    normalized === "running" ||
    normalized === "paused" ||
    normalized === "restarting"
  );
}

const SERVICE_COLORS = [
  "var(--theme-terminal-cyan, var(--theme-terminal-foreground))",
  "var(--theme-terminal-green, var(--theme-terminal-foreground))",
  "var(--theme-terminal-yellow, var(--theme-terminal-foreground))",
  "var(--theme-terminal-magenta, var(--theme-terminal-foreground))",
  "var(--theme-terminal-bright-blue, var(--theme-terminal-foreground))",
];

export function getServiceColor(serviceName: string): string {
  let hash = 5381;
  for (let index = 0; index < serviceName.length; index += 1) {
    hash = ((hash << 5) + hash + serviceName.charCodeAt(index)) | 0;
  }
  return (
    SERVICE_COLORS[Math.abs(hash) % SERVICE_COLORS.length] ?? SERVICE_COLORS[0]
  );
}

export function formatLogTimestamp(timestamp: string | null): string {
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  });
}

export function formatLogRecordsForClipboard(
  records: readonly DockerLogRecord[],
  includeTimestamps: boolean,
): string {
  return records
    .map((record) => {
      const service = record.serviceName || record.containerName;
      const timestamp =
        includeTimestamps && record.timestamp
          ? `${formatLogTimestamp(record.timestamp)} `
          : "";
      return `${timestamp}${service} | ${record.text}`;
    })
    .join("\n");
}

export function resolveFollowingAfterScroll(
  current: boolean,
  userInitiated: boolean,
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 48,
): boolean {
  if (!userInitiated) return current;
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold
  );
}
