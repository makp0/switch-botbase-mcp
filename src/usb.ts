import { getDeviceList, InEndpoint, OutEndpoint, type Interface } from "usb";

export interface Link {
  write(data: Buffer): Promise<void>;
  read(length: number): Promise<Buffer>;
  close(): Promise<void>;
}

export async function openUsb(): Promise<Link> {
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
    return {
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
  } catch (error) {
    // A claimed interface must be released even if endpoint discovery fails.
    try { if (claimed) await iface!.releaseAsync(); }
    finally { device.close(); }
    throw error;
  }
}
