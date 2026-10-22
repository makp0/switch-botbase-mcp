import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { Link } from "./usb.ts";

export const buttons = ["A", "B", "X", "Y", "L", "R", "ZL", "ZR", "PLUS", "MINUS", "DUP", "DDOWN", "DLEFT", "DRIGHT", "LSTICK", "RSTICK", "HOME", "CAPTURE"] as const;
const duration = z.number().int().min(50).max(5000);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("buttons"), buttons: z.array(z.enum(buttons)).min(1).max(8), durationMs: duration.default(100) }).strict(),
  z.object({ type: z.literal("stick"), stick: z.enum(["LEFT", "RIGHT"]), x: z.number().int().min(-32768).max(32767), y: z.number().int().min(-32768).max(32767), durationMs: duration.default(200) }).strict(),
  z.object({ type: z.literal("wait"), durationMs: z.number().int().min(0).max(5000) }).strict(),
]);
export const actionsSchema = z.array(actionSchema).min(1).max(30).refine(
  actions => actions.reduce((total, a) => total + a.durationMs, 0) <= 15000,
  "Total requested action duration must be at most 15000ms",
);

/** USB framing from USB Botbase: two transfers out, length-prefixed binary replies. */
export class Botbase {
  private link?: Link;
  private fault?: Error;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Set<AbortController>();

  constructor(private readonly connect: () => Link | Promise<Link>) {}

  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.pending.add(controller);
    const result = this.tail.then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    });
    this.tail = result.catch(() => {});
    return result.finally(() => this.pending.delete(controller));
  }

  cancel() {
    for (const controller of this.pending) controller.abort();
  }

  async command(command: string, reply = false): Promise<Buffer> {
    if (!/^[\x20-\x7e]{1,127}$/.test(command)) throw new Error("Invalid Botbase command");
    if (this.fault) throw this.fault;
    this.link ??= await this.connect();
    try {
      const payload = Buffer.from(command, "ascii");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length + 2);
      await this.link.write(header);
      await this.link.write(payload);
      if (!reply) return Buffer.alloc(0);
      const responseHeader = await this.link.read(4);
      if (responseHeader.length !== 4) throw new Error("Incomplete USB response header");
      const size = responseHeader.readUInt32LE();
      if (size === 0 || size > 8 * 1024 * 1024) throw new Error(`Invalid response size: ${size}`);
      const chunks: Buffer[] = [];
      let received = 0;
      while (received < size) {
        const chunk = await this.link.read(Math.min(16384, size - received));
        if (!chunk.length || chunk.length > size - received) throw new Error("Invalid USB response chunk");
        chunks.push(chunk);
        received += chunk.length;
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      this.fault = new Error(`USB communication failed: ${error instanceof Error ? error.message : String(error)}. No inputs were retried. Restart the MCP server and check the Switch; held inputs may need releasing.`, { cause: error });
      throw this.fault;
    }
  }

  async version() {
    return (await this.command("getVersion", true)).toString("ascii").replace(/[\0\r\n]+$/, "");
  }

  async screenshot() {
    const data = await this.command("pixelPeek", true);
    if (data[0] !== 0xff || data[1] !== 0xd8 || data.at(-2) !== 0xff || data.at(-1) !== 0xd9) {
      throw new Error("Botbase did not return a complete JPEG screenshot");
    }
    return data;
  }

  async actions(input: unknown, signal: AbortSignal) {
    const actions = actionsSchema.parse(input);
    for (const action of actions) {
      signal.throwIfAborted();
      if (action.type === "wait") {
        await sleep(action.durationMs, undefined, { signal });
      } else if (action.type === "buttons") {
        const pressed: string[] = [];
        try {
          for (const button of new Set(action.buttons)) {
            signal.throwIfAborted();
            pressed.push(button);
            await this.command(`press ${button}`);
          }
          // getVersion is a barrier: the Switch has processed the preceding input.
          await this.version();
          await sleep(action.durationMs, undefined, { signal });
        } finally {
          for (const button of pressed) await this.command(`release ${button}`);
          await this.version();
        }
      } else {
        try {
          await this.command(`setStick ${action.stick} ${action.x} ${action.y}`);
          await this.version();
          await sleep(action.durationMs, undefined, { signal });
        } finally {
          await this.command(`setStick ${action.stick} 0 0`);
          await this.version();
        }
      }
    }
  }

  async stop() {
    await this.command("clickCancel");
    await this.command("touchCancel");
    await this.command("detachController");
    await this.version();
  }

  async close() {
    this.cancel();
    await this.tail;
    if (this.link) {
      try {
        if (!this.fault) await this.stop();
      } finally {
        await this.link.close();
        this.link = undefined;
      }
    }
  }
}
