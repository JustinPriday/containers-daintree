import { StringDecoder } from "node:string_decoder";
import type { DockerLogStream } from "./types.js";

export const MAX_LOG_LINE = 16_384;
export const MAX_DOCKER_FRAME = 1024 * 1024;
const TRUNCATED = " [line truncated]";
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\S+)\s(.*)$/s;

export interface ParsedDockerLogLine {
  stream: DockerLogStream;
  timestamp: string | null;
  text: string;
}

export class DockerLogLineDecoder {
  private readonly decoders = new Map<DockerLogStream, StringDecoder>();
  private readonly truncating = new Set<DockerLogStream>();
  private readonly pending = new Map<DockerLogStream, string>();

  push(stream: DockerLogStream, bytes: Buffer): ParsedDockerLogLine[] {
    const decoder = this.decoders.get(stream) ?? new StringDecoder("utf8");
    this.decoders.set(stream, decoder);
    let text = decoder.write(bytes);
    if (this.truncating.has(stream)) {
      const end = text.indexOf("\n");
      if (end < 0) return [];
      text = text.slice(end + 1);
      this.truncating.delete(stream);
    }
    const lines = ((this.pending.get(stream) ?? "") + text).split("\n");
    const unfinished = lines.pop() ?? "";
    const result = lines.map((line) =>
      this.parse(
        stream,
        line.length > MAX_LOG_LINE
          ? line.slice(0, MAX_LOG_LINE) + TRUNCATED
          : line.replace(/\r$/, ""),
      ),
    );
    if (unfinished.length > MAX_LOG_LINE) {
      result.push(
        this.parse(stream, unfinished.slice(0, MAX_LOG_LINE) + TRUNCATED),
      );
      this.pending.set(stream, "");
      this.truncating.add(stream);
    } else this.pending.set(stream, unfinished);
    return result;
  }

  flush(): ParsedDockerLogLine[] {
    const result: ParsedDockerLogLine[] = [];
    for (const [stream, decoder] of this.decoders) {
      const value = (this.pending.get(stream) ?? "") + decoder.end();
      if (value.length > 0)
        result.push(this.parse(stream, value.replace(/\r$/, "")));
    }
    this.truncating.clear();
    this.pending.clear();
    this.decoders.clear();
    return result;
  }

  private parse(stream: DockerLogStream, line: string): ParsedDockerLogLine {
    const match = line.match(TIMESTAMP);
    return match
      ? { stream, timestamp: match[1] ?? null, text: match[2] ?? "" }
      : { stream, timestamp: null, text: line };
  }
}

export class DockerMultiplexDecoder {
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(bytes: Buffer): Array<{ stream: DockerLogStream; payload: Buffer }> {
    this.pending =
      this.pending.length === 0 ? bytes : Buffer.concat([this.pending, bytes]);
    const frames: Array<{ stream: DockerLogStream; payload: Buffer }> = [];
    while (this.pending.length >= 8) {
      const size = this.pending.readUInt32BE(4);
      if (size > MAX_DOCKER_FRAME) {
        this.pending = Buffer.alloc(0);
        throw new Error(
          "Docker log frame exceeds 1 MiB; reconnect with a smaller tail.",
        );
      }
      if (this.pending.length < 8 + size) break;
      const stream = this.pending[0] === 2 ? "stderr" : "stdout";
      frames.push({ stream, payload: this.pending.subarray(8, 8 + size) });
      this.pending = this.pending.subarray(8 + size);
    }
    return frames;
  }
}
