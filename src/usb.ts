import { getDeviceList, InEndpoint, OutEndpoint, type Interface } from "usb";

import type { Link, CommandTransport } from "./transport.ts";

export async function openUsb(): Promise<CommandTransport> {
  const devices = getDeviceList().filter(({ deviceDescriptor: d }) =>
    d.idVendor === 0x057e && d.idProduct === 0x3000);
  if (devices.length !== 1) {
    throw new Error(`Expected one USB Botbase device (057e:3000), found ${devices.length}. Connect the Switch with USB Botbase running; close other Botbase clients.`);
  }
  const device = devices[0]!;
  device.open();
  let iface: Interface | undefined;
  let claimed = false;
  try {
    iface = device.interface(0);
    iface.claim();
    claimed = true;
    const input = iface.endpoint(0x81);
    const output = iface.endpoint(0x01);
    if (!(input instanceof InEndpoint) || !(output instanceof OutEndpoint)) {
      throw new Error("Botbase bulk endpoints 0x81/0x01 are missing");
    }
    input.timeout = output.timeout = 5000;
    const link: Link = {
      async write(data) {
        const actual = await output.transferAsync(data);
        if (actual !== data.length) throw new Error(`Short USB write: ${actual}/${data.length}`);
      },
      async read(length) {
        const data = await input.transferAsync(length);
        if (!data?.length) throw new Error("Empty USB response");
        return data;
      },
      async close() {
        try { await iface!.releaseAsync(); }
        finally { device.close(); }
      },
    };
    return usbCommands(link);
  } catch (error) {
    // A claimed interface must be released even if endpoint discovery fails.
    try { if (claimed) await iface!.releaseAsync(); }
    finally { device.close(); }
    throw error;
  }
}

export function usbCommands(link: Link): CommandTransport {
  return {
    async command(command, reply) {
      const payload = Buffer.from(command, "ascii");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length + 2);
      await link.write(header);
      await link.write(payload);
      if (!reply) return Buffer.alloc(0);
      const responseHeader = await link.read(4);
      if (responseHeader.length !== 4) throw new Error("Incomplete USB response header");
      const size = responseHeader.readUInt32LE();
      if (size === 0 || size > 8 * 1024 * 1024) throw new Error(`Invalid response size: ${size}`);
      const chunks: Buffer[] = [];
      let received = 0;
      while (received < size) {
        const chunk = await link.read(Math.min(16384, size - received));
        if (!chunk.length || chunk.length > size - received) throw new Error("Invalid USB response chunk");
        chunks.push(chunk);
        received += chunk.length;
      }
      return Buffer.concat(chunks, size);
    },
    close: () => link.close(),
  };
}
