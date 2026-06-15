import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { LibreListenerWallet, SecureStorageProvider, WebSocketStreamProvider } from "../../index";
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

const esploraUrl = "https://mock-esplora.api";

// Mock MSW Server
const mswServer = setupServer(
  http.get(`${esploraUrl}/blocks/tip/height`, () => {
    return HttpResponse.text("100");
  }),
  http.get(`${esploraUrl}/blocks/tip/hash`, () => {
    return HttpResponse.text("00".repeat(32));
  }),
  http.get(`${esploraUrl}/block-height/:height`, () => {
    return HttpResponse.text("00".repeat(32));
  }),
  http.get(`${esploraUrl}/block/:hash/header`, () => {
    return HttpResponse.text("00".repeat(80));
  }),
  http.get(`${esploraUrl}/fee-estimates`, () => {
    return HttpResponse.json({ "1": 10.0, "6": 5.0, "144": 1.0 });
  })
);

describe("LibreListenerWallet State Persistence & Cold Boot", () => {
  let wasmBinary: Uint8Array;

  beforeAll(async () => {
    wasmBinary = loadWasmBinary();
    mswServer.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    mswServer.resetHandlers();
  });

  afterAll(() => {
    mswServer.close();
  });

  it("should start fresh, persist state on stop, and recover cleanly on cold boot", async () => {
    const db = new Map<string, string>();
    const mockStorage: SecureStorageProvider = {
      getItem: async (key) => db.get(key) || null,
      setItem: async (key, val) => {
        db.set(key, val);
      },
      removeItem: async (key) => {
        db.delete(key);
      },
    };

    const mockSocketProvider: WebSocketStreamProvider = {
      connect: async () => {
        throw new Error("WS connect not implemented in unit tests");
      },
    };

    const config = {
      network: "regtest" as const,
      esploraUrl,
    };

    // 1. First Boot: Starts Fresh
    const wallet1 = new LibreListenerWallet({
      config,
      storage: mockStorage,
      socketProvider: mockSocketProvider,
      wasmBinary,
    });

    expect(wallet1.status()).toBe("Stopped");
    await wallet1.start();
    expect(wallet1.status()).toBe("Running");

    // Stop wallet1 (saves state to mockStorage)
    await wallet1.stop();
    expect(wallet1.status()).toBe("Stopped");

    // Verify state was persisted in storage
    expect(db.has("channel_manager")).toBe(true);
    expect(db.has("network_graph")).toBe(true);
    expect(db.has("scorer")).toBe(true);
    expect(db.has("ldk_seed")).toBe(true);

    // Record value hashes to verify they are loaded
    const managerState = db.get("channel_manager")!;
    const graphState = db.get("network_graph")!;
    const scorerState = db.get("scorer")!;

    // 2. Second Boot: Cold boot recovery from storage
    const wallet2 = new LibreListenerWallet({
      config,
      storage: mockStorage,
      socketProvider: mockSocketProvider,
      wasmBinary,
    });

    expect(wallet2.status()).toBe("Stopped");
    await wallet2.start();
    expect(wallet2.status()).toBe("Running");

    // Assert it reused the same keys/seed
    expect(db.get("channel_manager")).toBe(managerState);
    expect(db.get("network_graph")).toBe(graphState);
    expect(db.get("scorer")).toBe(scorerState);

    // Stop wallet2
    await wallet2.stop();
    expect(wallet2.status()).toBe("Stopped");
  });
});
