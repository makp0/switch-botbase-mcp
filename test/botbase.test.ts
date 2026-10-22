import { expect, test } from "bun:test";
import { Botbase, actionsSchema } from "../src/botbase.ts";
import type { Link } from "../src/usb.ts";

function mockLink() {
  const writes: Buffer[] = [];
  const reads: Buffer[] = [];
  const link: Link = {
    async write(data) { writes.push(Buffer.from(data)); },
    async read() { return reads.shift() ?? Buffer.alloc(0); },
    async close() {},
  };
  function reply(data: Buffer) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(data.length);
    reads.push(header, data);
  }
  return { link, writes, reads, reply, commands: () => writes.filter((_, i) => i % 2 === 1).map(b => b.toString()) };
}

test("USB framing adds two to payload length and reassembles split replies", async () => {
  const m = mockLink();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(5);
  m.reads.push(header, Buffer.from("2."), Buffer.from("5\r\n"));
  const bot = new Botbase(() => m.link);
  expect(await bot.run(() => bot.version())).toBe("2.5");
  expect(m.writes[0]!.readUInt32LE()).toBe(12);
  expect(m.commands()).toEqual(["getVersion"]);
});

test("bad framing faults the connection and never replays an input", async () => {
  const m = mockLink();
  m.reads.push(Buffer.alloc(3));
  const bot = new Botbase(() => m.link);
  await expect(bot.run(() => bot.version())).rejects.toThrow("Restart the MCP server");
  await expect(bot.run(() => bot.command("press A"))).rejects.toThrow("No inputs were retried");
  expect(m.commands()).toEqual(["getVersion"]);
});

test("oversized, empty, and short response bodies are rejected", async () => {
  for (const size of [0, 8 * 1024 * 1024 + 1, 5]) {
    const m = mockLink();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(size);
    m.reads.push(header);
    const bot = new Botbase(() => m.link);
    await expect(bot.run(() => bot.version())).rejects.toThrow("USB communication failed");
  }
});

test("actions validate durations, button names, stick range, and total budget", () => {
  for (const input of [
    [{ type: "buttons", buttons: ["A\npress HOME"] }],
    [{ type: "buttons", buttons: ["A"], durationMs: -1 }],
    [{ type: "stick", stick: "LEFT", x: 32768, y: 0 }],
    Array(4).fill({ type: "wait", durationMs: 5000 }),
    [],
  ]) expect(actionsSchema.safeParse(input).success).toBe(false);
});

test("cancelling a held chord releases all buttons and skips queued input", async () => {
  const m = mockLink();
  m.reply(Buffer.from("2.5"));
  m.reply(Buffer.from("2.5"));
  const bot = new Botbase(() => m.link);
  const action = bot.run(signal => bot.actions([{ type: "buttons", buttons: ["A", "B"], durationMs: 5000 }], signal));
  const queued = bot.run(signal => bot.actions([{ type: "buttons", buttons: ["HOME"] }], signal));
  const checks = Promise.allSettled([action, queued]);
  while (!m.commands().includes("getVersion")) await Bun.sleep(1);
  bot.cancel();
  const results = await checks;
  expect(results.map(r => r.status)).toEqual(["rejected", "rejected"]);
  expect(m.commands()).toEqual(["press A", "press B", "getVersion", "release A", "release B", "getVersion"]);
});

test("stick returns to center after cancellation", async () => {
  const m = mockLink();
  m.reply(Buffer.from("2.5"));
  m.reply(Buffer.from("2.5"));
  const bot = new Botbase(() => m.link);
  const action = bot.run(signal => bot.actions([{ type: "stick", stick: "LEFT", x: -32768, y: 32767, durationMs: 5000 }], signal));
  const check = Promise.allSettled([action]);
  while (!m.commands().includes("getVersion")) await Bun.sleep(1);
  bot.cancel();
  expect((await check)[0]!.status).toBe("rejected");
  expect(m.commands()).toEqual(["setStick LEFT -32768 32767", "getVersion", "setStick LEFT 0 0", "getVersion"]);
});

test("screenshot validates the JPEG before returning it", async () => {
  const m = mockLink();
  const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  m.reply(jpeg);
  m.reply(Buffer.from("not an image"));
  const bot = new Botbase(() => m.link);
  expect(await bot.run(() => bot.screenshot())).toEqual(jpeg);
  await expect(bot.run(() => bot.screenshot())).rejects.toThrow("complete JPEG");
});

test("concurrent operations execute in order, including after a failure", async () => {
  const bot = new Botbase(() => mockLink().link);
  const order: number[] = [];
  const first = bot.run(async () => { order.push(1); await Bun.sleep(5); order.push(2); throw new Error("failed"); });
  const second = bot.run(async () => { order.push(3); });
  await Promise.allSettled([first, second]);
  expect(order).toEqual([1, 2, 3]);
});
