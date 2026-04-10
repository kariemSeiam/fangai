import { describe, it, expect } from "vitest";
import { openCodeEventToAdapterLine } from "../openCodeServeBridge.js";

describe("openCodeEventToAdapterLine", () => {
  const sid = "sess-1";

  it("maps finished text parts to adapter-shaped JSON", () => {
    const line = openCodeEventToAdapterLine(
      {
        type: "message.part.updated",
        properties: {
          sessionID: sid,
          time: 1,
          part: {
            id: "p1",
            sessionID: sid,
            messageID: "m1",
            type: "text",
            text: "hello",
            time: { start: 0, end: 1 },
          },
        },
      },
      sid
    );
    expect(line).toBeTruthy();
    const o = JSON.parse(line!);
    expect(o.type).toBe("text");
    expect(o.part.text).toBe("hello");
  });

  it("ignores text from other sessions", () => {
    const line = openCodeEventToAdapterLine(
      {
        type: "message.part.updated",
        properties: {
          sessionID: "other",
          time: 1,
          part: {
            id: "p1",
            sessionID: "other",
            messageID: "m1",
            type: "text",
            text: "x",
            time: { start: 0, end: 1 },
          },
        },
      },
      sid
    );
    expect(line).toBeNull();
  });
});
