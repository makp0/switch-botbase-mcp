import { expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { Botbase } from "../src/botbase.ts";
import { openTcp, tcpCommands } from "../src/tcp.ts";

async function fixture(onCommand: (command: string, socket: Socket) => void) {
  const connections = new Set<Socket>();
  const server = createServer(socket => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    socket.on("error", () => {});
    let pending = "";
    socket.on("data", data => {
      pending += data.toString();
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        onCommand(line, socket);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const bot = new Botbase(() => openTcp("127.0.0.1", address.port), "TCP");
  return { bot, async close() {
    await bot.close();
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

test("TCP reassembles fragmented version/hex JPEG replies and preserves button barriers", async () => {
  const commands: string[] = [];
  const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const f = await fixture((command, socket) => {
    commands.push(command);
    if (command === "getVersion") {
      socket.write("2.");
      setTimeout(() => socket.write("5\r\n"), 5);
    } else if (command === "pixelPeek") {
      socket.write(jpeg.toString("hex").slice(0, 3));
      setTimeout(() => socket.write(jpeg.toString("hex").slice(3) + "\n"), 5);
    }
  });
  try {
    expect(await f.bot.run(() => f.bot.version())).toBe("2.5");
    expect(await f.bot.run(() => f.bot.screenshot())).toEqual(jpeg);
    await f.bot.run(signal => f.bot.actions([{ type: "buttons", buttons: ["A", "B"], durationMs: 50 }], signal));
    expect(commands).toEqual(["getVersion", "pixelPeek", "press A", "press B", "getVersion", "release A", "release B", "getVersion"]);
  } finally { await f.close(); }
});

test("TCP rejects malformed screenshot hex and never retries input after failure", async () => {
  const commands: string[] = [];
  const f = await fixture((command, socket) => { commands.push(command); socket.write("FFD8oopsFFD9\n"); });
  try {
    await expect(f.bot.run(() => f.bot.screenshot())).rejects.toThrow("Invalid TCP screenshot hex");
    await expect(f.bot.run(() => f.bot.command("press A"))).rejects.toThrow("No inputs were retried");
    expect(commands).toEqual(["pixelPeek"]);
  } finally { await f.close(); }
});

test("TCP fails promptly when the peer closes mid-response", async () => {
  const f = await fixture((_command, socket) => socket.end("2."));
  try {
    await expect(f.bot.run(() => f.bot.version())).rejects.toThrow("TCP");
  } finally { await f.close(); }
});

test("TCP bounds reply size and rejects invalid ports", async () => {
  await expect(openTcp("localhost", 0)).rejects.toThrow("SWITCH_PORT");
  const huge = Buffer.alloc(16384, 65);
  const bot = new Botbase(() => tcpCommands({ async write() {}, async read() { return huge; }, async close() {} }), "TCP");
  await expect(bot.run(() => bot.version())).rejects.toThrow("Invalid TCP response size");
  await bot.close();
});


test("TCP times out a stalled response instead of hanging the MCP", async () => {
  const f = await fixture(() => {});
  try {
    await expect(f.bot.run(() => f.bot.version())).rejects.toThrow("timed out");
  } finally { await f.close(); }
}, 10000);
