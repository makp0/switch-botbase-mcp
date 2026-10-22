import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Botbase } from "../src/botbase.ts";
import { usbCommands } from "../src/usb.ts";
import { createServer } from "../src/server.ts";

test("MCP exposes controls, returns images, and rejects invalid input before USB access", async () => {
  let connections = 0;
  let command = "";
  let body: Buffer | undefined;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const bot = new Botbase(() => {
    connections++;
    return usbCommands({
      async write(data) { if (data.toString() === "pixelPeek" || data.toString() === "getVersion") command = data.toString(); },
      async read() {
        if (body) { const data = body; body = undefined; return data; }
        body = command === "pixelPeek" ? jpeg : Buffer.from("2.5");
        const header = Buffer.alloc(4); header.writeUInt32LE(body.length); return header;
      },
      async close() {},
    });
  });
  const server = createServer(bot);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(["switch_status", "switch_screenshot", "switch_act", "switch_stop"]);
    const invalid = await client.callTool({ name: "switch_act", arguments: { actions: [{ type: "buttons", buttons: ["INVALID"] }] } });
    expect(invalid.isError).toBe(true);
    expect(connections).toBe(0);
    const screenshot = await client.callTool({ name: "switch_screenshot", arguments: {} });
    expect(screenshot.content).toEqual([{ type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" }]);
    const status = await client.callTool({ name: "switch_status", arguments: {} });
    expect(status.isError).not.toBe(true);
    const action = await client.callTool({ name: "switch_act", arguments: { actions: [{ type: "buttons", buttons: ["B"], durationMs: 50 }], settleMs: 0 } });
    expect(action.content).toEqual(screenshot.content);
    expect(connections).toBe(1);
  } finally {
    await bot.close();
    await client.close();
    await server.close();
  }
});
