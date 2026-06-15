import { describe, it, expect } from "vitest";
import {
  LibreListenerWallet,
  SecureStorageProvider,
  WebSocketStreamProvider,
  WebSocketConnection,
} from "../../index";
import * as fs from "fs";
import * as path from "path";

function loadWasmBinary(): Uint8Array {
  const paths = [
    path.resolve(__dirname, "../../../node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(__dirname, "../../../../node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(__dirname, "../../../../../node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(__dirname, "../../../../../node_modules/.pnpm/node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(process.cwd(), "node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(process.cwd(), "../../node_modules/lightningdevkit/liblightningjs.wasm"),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p);
    }
  }
  throw new Error("Could not find liblightningjs.wasm");
}

describe("LibreListenerWallet Core Node Manager", () => {
  const mockStorage: SecureStorageProvider = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };

  const mockSocketProvider: WebSocketStreamProvider = {
    connect: async () =>
      ({
        send: () => {},
        close: () => {},
      } as unknown as WebSocketConnection),
  };

  it("should initialize and transition status state on start and stop", async () => {
    const wallet = new LibreListenerWallet({
      config: {
        network: "regtest",
        esploraUrl: "http://127.0.0.1:3002",
      },
      storage: mockStorage,
      socketProvider: mockSocketProvider,
      wasmBinary: loadWasmBinary(),
    });

    expect(wallet.status()).toBe("Stopped");
    await wallet.start();
    expect(wallet.status()).toBe("Running");
    await wallet.stop();
    expect(wallet.status()).toBe("Stopped");
  });
});
