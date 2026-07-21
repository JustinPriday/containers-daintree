import { describe, expect, it } from "vitest";
import type { DockerLogBatch, DockerLogRecord } from "../docker/types.js";
import {
  appendLogBatch,
  emptyConsoleLogState,
  filterLogRecords,
  formatLogRecordsForClipboard,
  getServiceColor,
  isLoggableContainerState,
  resolveFollowingAfterScroll,
} from "./logConsole.js";

function record(containerId: string, serviceName: string, text: string): DockerLogRecord {
  return {
    containerId,
    containerName: `${serviceName}-1`,
    serviceName,
    stream: "stdout",
    timestamp: null,
    text,
  };
}

function batch(sequence: number, records: DockerLogRecord[]): DockerLogBatch {
  return { containerId: records[0]?.containerId ?? "mixed", sequence, records };
}

describe("Docker console log state", () => {
  it("keeps project-wide batches ordered and bounds retained history", () => {
    let state = emptyConsoleLogState();
    state = appendLogBatch(state, batch(0, [record("a", "api", "one")]), 3);
    state = appendLogBatch(
      state,
      batch(1, [record("b", "worker", "two"), record("a", "api", "three")]),
      3
    );
    state = appendLogBatch(state, batch(2, [record("b", "worker", "four")]), 3);

    expect(state.records.map((entry) => entry.text)).toEqual(["two", "three", "four"]);
    expect(state.nextSequence).toBe(3);
    expect(state.missedBatches).toBe(0);
  });

  it("counts sequence gaps across interleaved services", () => {
    let state = appendLogBatch(
      emptyConsoleLogState(),
      batch(0, [record("a", "api", "first")])
    );
    state = appendLogBatch(state, batch(2, [record("b", "worker", "third")]));

    expect(state.missedBatches).toBe(1);
  });

  it("filters locally without losing the all-services history", () => {
    const records = [record("a", "api", "one"), record("b", "worker", "two")];
    expect(filterLogRecords(records, null)).toEqual(records);
    expect(filterLogRecords(records, "b").map((entry) => entry.text)).toEqual(["two"]);
  });

  it("recognizes states that can sustain a follow stream", () => {
    expect(isLoggableContainerState("running")).toBe(true);
    expect(isLoggableContainerState("paused")).toBe(true);
    expect(isLoggableContainerState("restarting")).toBe(true);
    expect(isLoggableContainerState("exited")).toBe(false);
  });

  it("assigns stable distinct service colors", () => {
    expect(getServiceColor("api")).toBe(getServiceColor("api"));
    expect(getServiceColor("api")).not.toBe(getServiceColor("postgres"));
  });

  it("formats the visible console selection for clipboard export", () => {
    const records = [record("a", "api", "ready"), record("b", "worker", "started")];
    records[0]!.timestamp = "2026-07-21T12:34:56.789Z";

    expect(formatLogRecordsForClipboard(records, false)).toBe(
      "api | ready\nworker | started"
    );
    expect(formatLogRecordsForClipboard(records, true)).toMatch(
      /^\d{2}:\d{2}:\d{2}\.789 api \| ready\nworker \| started$/
    );
  });

  it("does not mistake layout-driven scroll drift for user intent", () => {
    const drifted = { scrollHeight: 1_000, scrollTop: 650, clientHeight: 300 };
    expect(resolveFollowingAfterScroll(true, false, drifted)).toBe(true);
    expect(resolveFollowingAfterScroll(true, true, drifted)).toBe(false);
    expect(resolveFollowingAfterScroll(false, true, { ...drifted, scrollTop: 700 })).toBe(true);
  });
});
