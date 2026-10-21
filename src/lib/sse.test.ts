import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("parses named events with JSON data", () => {
    const p = createSseParser();
    expect(p.push('event: delta\ndata: {"text":"שלום"}\n\nevent: done\ndata: {"answer":"x"}\n\n')).toEqual([
      { event: "delta", data: '{"text":"שלום"}' },
      { event: "done", data: '{"answer":"x"}' },
    ]);
  });

  it("buffers an event split across chunks", () => {
    const p = createSseParser();
    expect(p.push("event: del")).toEqual([]);
    expect(p.push('ta\ndata: {"te')).toEqual([]);
    expect(p.push('xt":"a"}\n')).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: "delta", data: '{"text":"a"}' }]);
  });

  it("accepts CRLF line endings and skips comments", () => {
    const p = createSseParser();
    expect(p.push(": ping\r\n\r\nevent: error\r\ndata: {}\r\n\r\n")).toEqual([{ event: "error", data: "{}" }]);
  });

  it("defaults the event name and joins multi-line data", () => {
    const p = createSseParser();
    expect(p.push("data: a\ndata: b\n\n")).toEqual([{ event: "message", data: "a\nb" }]);
  });
});
