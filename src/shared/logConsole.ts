import type { DockerLogBatch, DockerLogRecord } from "../docker/types.js";

export const MAX_CONSOLE_RECORDS = 5_000;

export interface ConsoleLogState {
  records: DockerLogRecord[];
  nextSequence: number;
  missedBatches: number;
}

export function emptyConsoleLogState(): ConsoleLogState {
  return { records: [], nextSequence: 0, missedBatches: 0 };
}

export function appendLogBatch(
  current: ConsoleLogState,
  batch: DockerLogBatch,
  limit = MAX_CONSOLE_RECORDS
): ConsoleLogState {
  const records = [...current.records, ...batch.records];
  return {
    records: records.slice(-Math.max(1, limit)),
    nextSequence: batch.sequence + 1,
    missedBatches: current.missedBatches + (batch.sequence === current.nextSequence ? 0 : 1),
  };
}

export function filterLogRecords(
  records: readonly DockerLogRecord[],
  containerId: string | null
): readonly DockerLogRecord[] {
  return containerId ? records.filter((record) => record.containerId === containerId) : records;
}

export function isLoggableContainerState(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return normalized === "running" || normalized === "paused" || normalized === "restarting";
}

const SERVICE_COLORS = [
  "#38d4dd",
  "#d29922",
  "#3fb950",
  "#bc8cff",
  "#58a6ff",
  "#ff7b72",
  "#e3b341",
  "#56d364",
] as const;

export function getServiceColor(serviceName: string): string {
  let hash = 5381;
  for (let index = 0; index < serviceName.length; index += 1) {
    hash = ((hash << 5) + hash + serviceName.charCodeAt(index)) | 0;
  }
  return SERVICE_COLORS[Math.abs(hash) % SERVICE_COLORS.length] ?? SERVICE_COLORS[0];
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
  includeTimestamps: boolean
): string {
  return records
    .map((record) => {
      const service = record.serviceName || record.containerName;
      const timestamp = includeTimestamps && record.timestamp
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
  threshold = 48
): boolean {
  if (!userInitiated) return current;
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
}
