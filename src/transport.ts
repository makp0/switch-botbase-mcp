/** A byte stream/USB link, used only inside protocol adapters. */
export interface Link {
  write(data: Buffer): Promise<void>;
  read(length: number): Promise<Buffer>;
  close(): Promise<void>;
}

/** Controller logic uses commands, without knowing wire framing. */
export interface CommandTransport {
  command(command: string, reply: boolean): Promise<Buffer>;
  close(): Promise<void>;
}
