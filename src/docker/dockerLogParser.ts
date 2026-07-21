import { StringDecoder } from "node:string_decoder";
import type { DockerLogStream } from "./types.js";

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\S+)\s(.*)$/s;

export interface ParsedDockerLogLine {
  stream: DockerLogStream;
  timestamp: string | null;
  text: string;
}

export class DockerLogLineDecoder {
  private readonly decoders = new Map<DockerLogStream, StringDecoder>();
  private readonly pending = new Map<DockerLogStream, string>();

  push(stream: DockerLogStream, bytes: Buffer): ParsedDockerLogLine[] {
    const decoder = this.decoders.get(stream) ?? new StringDecoder("utf8");
    this.decoders.set(stream, decoder);
    const value = (this.pending.get(stream) ?? "") + decoder.write(bytes);
    const lines = value.split("\n");
    this.pending.set(stream, lines.pop() ?? "");
    return lines.map((line) => this.parse(stream, line.replace(/\r$/, "")));
  }

  flush(): ParsedDockerLogLine[] {
    const result: ParsedDockerLogLine[] = [];
    for (const [stream, decoder] of this.decoders) {
      const value = (this.pending.get(stream) ?? "") + decoder.end();
      if (value.length > 0) result.push(this.parse(stream, value.replace(/\r$/, "")));
    }
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
    this.pending = this.pending.length === 0 ? bytes : Buffer.concat([this.pending, bytes]);
    const frames: Array<{ stream: DockerLogStream; payload: Buffer }> = [];
    while (this.pending.length >= 8) {
      const size = this.pending.readUInt32BE(4);
      if (this.pending.length < 8 + size) break;
      const stream = this.pending[0] === 2 ? "stderr" : "stdout";
      frames.push({ stream, payload: this.pending.subarray(8, 8 + size) });
      this.pending = this.pending.subarray(8 + size);
    }
    return frames;
  }
}
