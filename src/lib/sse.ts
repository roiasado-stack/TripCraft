/** One server-sent event: its `event:` name (default "message") and its `data:` text. */
export type SseEvent = { event: string; data: string };

/**
 * Incremental text/event-stream parser. Network chunks split anywhere — mid
 * line, mid UTF-8 character is handled by the caller's TextDecoder — so
 * `push` buffers until a blank line ends an event and returns the events
 * completed so far. Comment lines (": ping") and unknown fields are ignored.
 */
export function createSseParser() {
  let buffer = "";
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk.replace(/\r\n?/g, "\n");
      const events: SseEvent[] = [];
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length) events.push({ event, data: data.join("\n") });
      }
      return events;
    },
  };
}
