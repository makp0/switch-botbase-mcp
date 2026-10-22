import { expect, test } from "bun:test";
import { usbCommands } from "../src/usb.ts";
import { Botbase } from "../src/botbase.ts";

test("overlay chord holds L, right-stick click, and down together", async () => {
  const held = new Set<string>();
  const snapshots: string[][] = [];
  let payload = false;
  let body = false;
  const bot = new Botbase(() => usbCommands({
    async write(data) {
      payload = !payload;
      if (payload) return;
      const [command, button] = data.toString().split(" ");
      if (command === "press") held.add(button!);
      if (command === "release") held.delete(button!);
      snapshots.push([...held]);
    },
    async read() {
      body = !body;
      if (!body) return Buffer.from("2.5");
      const header = Buffer.alloc(4); header.writeUInt32LE(3); return header;
    },
    async close() {},
  }));
  await bot.run(signal => bot.actions([{ type: "buttons", buttons: ["L", "RSTICK", "DDOWN"], durationMs: 50 }], signal));
  expect(snapshots.slice(0, 4)).toEqual([["L"], ["L", "RSTICK"], ["L", "RSTICK", "DDOWN"], ["L", "RSTICK", "DDOWN"]]);
  expect(held.size).toBe(0);
});
