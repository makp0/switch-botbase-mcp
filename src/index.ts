import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Botbase } from "./botbase.ts";
import { createServer } from "./server.ts";
import { openUsb } from "./usb.ts";
import { openTcp } from "./tcp.ts";

const host = process.env.SWITCH_HOST;
const bot = host
  ? new Botbase(() => openTcp(host, Number(process.env.SWITCH_PORT ?? 6000)), "TCP")
  : new Botbase(openUsb);
const server = createServer(bot);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await bot.close(); }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { await server.close(); }
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.stdin.once("end", () => void shutdown());
await server.connect(new StdioServerTransport());
