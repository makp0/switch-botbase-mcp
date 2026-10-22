import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

test.skipIf(process.env.SWITCH_HARDWARE_TEST !== "1")("real stdio server reads Botbase version and screenshot over configured transport", async () => {
  const client = new Client({ name: "hardware-check", version: "1" });
  const env: Record<string, string> = {};
  for (const name of ["SWITCH_HOST", "SWITCH_PORT"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    stderr: "pipe", env,
  });
  let stderr = "";
  transport.stderr?.on("data", data => { stderr += data.toString(); });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(4);
    const status = await client.callTool({ name: "switch_status", arguments: {} });
    console.error(JSON.stringify(status.content));
    expect(status.isError).not.toBe(true);
    const result = await client.callTool({ name: "switch_screenshot", arguments: {} });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    const image = content.find(c => c.type === "image");
    expect(image?.mimeType).toBe("image/jpeg");
    const jpeg = Buffer.from(image!.data!, "base64");
    expect(jpeg.length).toBeGreaterThan(1000);
    if (process.env.SWITCH_SCREENSHOT_PATH) await Bun.write(process.env.SWITCH_SCREENSHOT_PATH, jpeg);
    console.error(`MCP screenshot: ${jpeg.length} bytes`);
    // Opt in only while HOME is visible; this briefly changes the selected tile.
    if (process.env.SWITCH_CONTROL_TEST === "1") {
      const act = (button: string) => client.callTool({ name: "switch_act", arguments: {
        actions: [{ type: "buttons", buttons: [button], durationMs: 100 }], settleMs: 500,
      } });
      let right;
      try {
        right = await act("DRIGHT");
        expect(right.isError).not.toBe(true);
        const image = (right.content as Array<{ type: string; data: string }>).find(c => c.type === "image")!;
        if (process.env.SWITCH_SCREENSHOT_PATH) await Bun.write(`${process.env.SWITCH_SCREENSHOT_PATH}.right.jpg`, Buffer.from(image.data, "base64"));
      } finally {
        const left = await act("DLEFT");
        expect(left.isError).not.toBe(true);
        const image = (left.content as Array<{ type: string; data: string }>).find(c => c.type === "image")!;
        if (process.env.SWITCH_SCREENSHOT_PATH) await Bun.write(`${process.env.SWITCH_SCREENSHOT_PATH}.restored.jpg`, Buffer.from(image.data, "base64"));
      }
      const stop = await client.callTool({ name: "switch_stop", arguments: {} });
      expect(stop.isError).not.toBe(true);
    }
  } finally {
    await client.close();
    expect(stderr).toBe("");
  }
}, 20000);
