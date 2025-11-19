import { Module } from "@ocd-js/core";

export const STORAGE_CLIENT = Symbol.for("OCD_STORAGE_CLIENT");

export interface StorageClient {
  putObject(key: string, data: Buffer | string): Promise<void>;
  getObject(key: string): Promise<Buffer | undefined>;
}

export class MemoryStorageClient implements StorageClient {
  private readonly blobs = new Map<string, Buffer>();

  async putObject(key: string, data: Buffer | string): Promise<void> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.blobs.set(key, buffer);
  }

  async getObject(key: string): Promise<Buffer | undefined> {
    return this.blobs.get(key);
  }
}

@Module({
  providers: [
    {
      token: STORAGE_CLIENT,
      useClass: MemoryStorageClient,
    },
  ],
  exports: [STORAGE_CLIENT],
})
export class StorageModule {}
