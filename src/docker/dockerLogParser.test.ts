import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  DockerLogLineDecoder,
  DockerMultiplexDecoder,
} from "./dockerLogParser.js";

function frame(stream: 1 | 2, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe("Docker log decoding", () => {
  it("reassembles split multiplexed stdout and stderr frames", () => {
    const decoder = new DockerMultiplexDecoder();
    const bytes = Buffer.concat([
      frame(1, Buffer.from("stdout\n")),
      frame(2, Buffer.from("stderr\n")),
    ]);

    expect(decoder.push(bytes.subarray(0, 11))).toEqual([]);
    expect(decoder.push(bytes.subarray(11))).toEqual([
      { stream: "stdout", payload: Buffer.from("stdout\n") },
      { stream: "stderr", payload: Buffer.from("stderr\n") },
    ]);
  });

  it("preserves split UTF-8 and partial lines while extracting Docker timestamps", () => {
    const decoder = new DockerLogLineDecoder();
    const bytes = Buffer.from("2026-07-16T09:00:00.123456789Z café\npartial");
    const splitInsideAccent = bytes.indexOf(0xc3) + 1;

    expect(
      decoder.push("stdout", bytes.subarray(0, splitInsideAccent)),
    ).toEqual([]);
    expect(decoder.push("stdout", bytes.subarray(splitInsideAccent))).toEqual([
      {
        stream: "stdout",
        timestamp: "2026-07-16T09:00:00.123456789Z",
        text: "café",
      },
    ]);
    expect(decoder.flush()).toEqual([
      { stream: "stdout", timestamp: null, text: "partial" },
    ]);
  });
});

it("bounds an unfinished line and resumes after its terminator", () => {
  const decoder = new DockerLogLineDecoder();
  const truncated = decoder.push("stdout", Buffer.from("x".repeat(20000)));
  expect(truncated).toHaveLength(1);
  expect(truncated[0]?.text).toMatch(/\[line truncated\]$/);
  expect(truncated[0]!.text.length).toBeLessThan(17000);
  expect(decoder.push("stdout", Buffer.from("x".repeat(20000)))).toEqual([]);
  expect(decoder.push("stdout", Buffer.from("ignored\nready\n"))).toEqual([
    { stream: "stdout", timestamp: null, text: "ready" },
  ]);
  expect(decoder.flush()).toEqual([]);
});

it("refuses an oversized multiplex frame before buffering its body", () => {
  const decoder = new DockerMultiplexDecoder();
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(2 * 1024 * 1024, 4);
  expect(() => decoder.push(header)).toThrow(/exceeds 1 MiB/);
  expect(decoder.push(frame(1, Buffer.from("ready")))).toEqual([
    { stream: "stdout", payload: Buffer.from("ready") },
  ]);
});
