import { createConnection } from "node:net";
import { once } from "node:events";
import type { Link, CommandTransport } from "./transport.ts";

export async function openTcp(host: string, port = 6000): Promise<CommandTransport> {
  if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Set SWITCH_HOST to the Switch IP and SWITCH_PORT to a port between 1 and 65535");
  }
  const socket = createConnection({ host, port, noDelay: true });
  socket.on("error", () => {}); // Readers/writers receive errors; idle disconnects must not crash stdio.
  socket.on("timeout", () => socket.destroy(new Error("Botbase TCP operation timed out")));
  socket.setTimeout(5000);
  try { await once(socket, "connect"); }
  catch (error) { socket.destroy(); throw error; }
  finally { socket.setTimeout(0); }

  const chunks = socket[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  const link: Link = {
    async write(data) {
      socket.setTimeout(5000);
      try {
        await new Promise<void>((resolve, reject) => {
          socket.write(data, error => error ? reject(error) : resolve());
        });
      } finally { socket.setTimeout(0); }
    },
    async read(length) {
      socket.setTimeout(5000);
      try {
        if (!buffered.length) {
          const chunk = await chunks.next();
          if (chunk.done) throw new Error("Botbase TCP connection closed");
          buffered = Buffer.from(chunk.value);
        }
        const data = buffered.subarray(0, length);
        buffered = buffered.subarray(data.length);
        return data;
      } finally { socket.setTimeout(0); }
    },
    async close() { socket.destroy(); },
  };
  return tcpCommands(link);
}

export function tcpCommands(link: Link): CommandTransport {
  return {
    async command(command, reply) {
      await link.write(Buffer.from(`${command}\r\n`, "ascii"));
      if (!reply) return Buffer.alloc(0);
      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        const chunk = await link.read(16384);
        size += chunk.length;
        if (!chunk.length || size > 16 * 1024 * 1024 + 2) throw new Error("Invalid TCP response size");
        chunks.push(chunk);
        const end = chunk.indexOf(10);
        if (end < 0) continue;
        if (end !== chunk.length - 1) throw new Error("Unexpected data after TCP response");
        const line = Buffer.concat(chunks, size).toString("ascii").replace(/\r?\n$/, "");
        if (command !== "pixelPeek") return Buffer.from(line, "ascii");
        if (!/^(?:[0-9a-fA-F]{2})+$/.test(line)) throw new Error("Invalid TCP screenshot hex");
        return Buffer.from(line, "hex");
      }
    },
    close: () => link.close(),
  };
}
