import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setTimeout as sleep } from "node:timers/promises";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { actionsSchema, Botbase } from "./botbase.ts";
import { version } from "../package.json";

const text = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }] });
const image = (data: Buffer): CallToolResult => ({ content: [{ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" }] });

export function createServer(bot: Botbase) {
  const server = new McpServer({ name: "switch-botbase", version }, {
    instructions: "Control the Nintendo Switch over USB or TCP. Start with switch_screenshot; observe again after short actions. Use switch_act for buttons (including chords), sticks, and waits. Stick positive X is right, positive Y is up. Inputs release automatically. switch_stop cancels queued/running actions and detaches the virtual controller. Do not assume a command achieved its goal; inspect screenshots. This is a real console: follow the user's intent before buying, deleting, or changing saves/settings.",
  });
  const call = async (operation: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    try { return await operation(); }
    catch (error) { return { ...text(error instanceof Error ? error.message : String(error)), isError: true }; }
  };
  server.registerTool("switch_status", {
    description: "Check the configured USB or TCP connection and report Botbase version without sending controller input.",
    inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => call(() => bot.run(async () => text(`${bot.transport} Botbase ${await bot.version()} connected.`))));
  server.registerTool("switch_screenshot", {
    description: "See the current Switch screen as a JPEG image. Use before acting and to verify results.",
    inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => call(() => bot.run(async () => image(await bot.screenshot()))));
  server.registerTool("switch_act", {
    description: "Run 1–30 ordered controller actions, up to 15 seconds of requested duration. Buttons can be a chord; sticks use integers -32768…32767 (Y positive up). Each input is automatically released/centered. Duration includes neither USB latency nor Botbase processing overhead. Returns a screenshot by default. Calls are serialized; prefer short sequences and inspect results.",
    inputSchema: { actions: actionsSchema, screenshot: z.boolean().default(true), settleMs: z.number().int().min(0).max(2000).default(250) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, ({ actions, screenshot, settleMs }, extra) => call(() => bot.run(async signal => {
    const cancel = () => bot.cancel();
    extra.signal.addEventListener("abort", cancel, { once: true });
    try {
      extra.signal.throwIfAborted();
      await bot.actions(actions, signal);
      await sleep(settleMs, undefined, { signal });
      return screenshot ? image(await bot.screenshot()) : text(`Completed ${actions.length} action(s).`);
    } finally { extra.signal.removeEventListener("abort", cancel); }
  })));
  server.registerTool("switch_stop", {
    description: "Cancel running and queued actions, cancel Botbase sequences/touches, and detach the virtual controller. Works between transfers; a disconnected console cannot receive stop commands.",
    inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, () => {
    bot.cancel();
    return call(() => bot.run(async () => { await bot.stop(); return text("Actions cancelled; virtual controller detached."); }));
  });
  return server;
}
