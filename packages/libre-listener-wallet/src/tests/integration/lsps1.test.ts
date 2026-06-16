// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  LibreListenerWallet,
  SecureStorageProvider,
  WebSocketStreamProvider,
  WebSocketConnection,
} from "../../index";
import { bytesToHex } from "../../storage-cache";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
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

const lspApiUrl = "http://127.0.0.1:9099/lsps1";
const esploraUrl = "http://127.0.0.1:3002";

const mswServer = setupServer(
  // Esplora endpoints mocked statically
  http.get(`${esploraUrl}/blocks/tip/height`, () => {
    return HttpResponse.text("100");
  }),
  http.get(`${esploraUrl}/blocks/tip/hash`, () => {
    return HttpResponse.text("0000000000000000000000000000000000000000000000000000000000000000");
  }),
  http.get(`${esploraUrl}/fee-estimates`, () => {
    return HttpResponse.json({ "1": 15.0, "6": 8.0, "144": 2.0 });
  }),

  // LSPS1 API Mocks
  http.post(lspApiUrl, async ({ request }) => {
    const body = (await request.json()) as any;
    const { id, method } = body;

    if (method === "lsps1.get_info") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          min_channel_balance_sat: "20000",
          max_channel_balance_sat: "1000000",
          min_initial_client_balance_sat: "0",
          max_initial_client_balance_sat: "0",
          min_channel_expiry_blocks: 2016,
          max_channel_expiry_blocks: 4032,
        },
      });
    }

    if (method === "lsps1.create_order") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          order_id: "test_order_id_123",
          lsp_balance_sat: body.params.lsp_balance_sat,
          client_balance_sat: "0",
          payment_value_msat: "500000",
          payment_addr: "00112233445566778899aabbccddeeff",
          invoice: "lnbc500n1pvjlxyz...",
        },
      });
    }

    return HttpResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  })
);

class MockSocketProvider implements WebSocketStreamProvider {
  async connect(): Promise<WebSocketConnection> {
    return {
      send: () => {},
      close: () => {},
    };
  }
}

describe("LibreListenerWallet LSPS1 Inbound Capacity Purchase Tests", () => {
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    mswServer.resetHandlers();
  });

  afterAll(() => {
    mswServer.close();
  });

  it("should query LSPS1 info and successfully purchase inbound capacity", async () => {
    const db = new Map<string, string>();
    const storage: SecureStorageProvider = {
      getItem: async (k) => db.get(k) || null,
      setItem: async (k, v) => {
        db.set(k, v);
      },
      removeItem: async (k) => {
        db.delete(k);
      },
    };

    const wallet = new LibreListenerWallet({
      config: {
        network: "regtest",
        esploraUrl,
      },
      storage,
      socketProvider: new MockSocketProvider(),
      wasmBinary: loadWasmBinary(),
      logger: {
        info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
        warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
        error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
      },
    });

    await wallet.start();

    const lsp = {
      name: "mock-lsp",
      pubkey: "02bdafbf7a60765a9ab4673350c1b5954449e290f498d1ff3a77c58eb7cebfbf24",
      connection_string: "02bdafbf7a60765a9ab4673350c1b5954449e290f498d1ff3a77c58eb7cebfbf24@127.0.0.1:9735",
      api_url: lspApiUrl,
      protocols: ["lsps1" as const],
    };

    // Purchase inbound capacity
    const invoice = await wallet.purchaseLSPS1Capacity({
      amountSats: 50000,
      lsp,
    });

    expect(invoice).toBe("lnbc500n1pvjlxyz...");

    await wallet.stop();
  });

  it("should throw error if requested capacity is outside LSP limits", async () => {
    const db = new Map<string, string>();
    const storage: SecureStorageProvider = {
      getItem: async (k) => db.get(k) || null,
      setItem: async (k, v) => {
        db.set(k, v);
      },
      removeItem: async (k) => {
        db.delete(k);
      },
    };

    const wallet = new LibreListenerWallet({
      config: {
        network: "regtest",
        esploraUrl,
      },
      storage,
      socketProvider: new MockSocketProvider(),
      wasmBinary: loadWasmBinary(),
    });

    await wallet.start();

    const lsp = {
      name: "mock-lsp",
      pubkey: "02bdafbf7a60765a9ab4673350c1b5954449e290f498d1ff3a77c58eb7cebfbf24",
      connection_string: "02bdafbf7a60765a9ab4673350c1b5954449e290f498d1ff3a77c58eb7cebfbf24@127.0.0.1:9735",
      api_url: lspApiUrl,
      protocols: ["lsps1" as const],
    };

    // LSP min limit is 20000, 5000 sat should fail
    await expect(
      wallet.purchaseLSPS1Capacity({
        amountSats: 5000,
        lsp,
      })
    ).rejects.toThrow("Requested amount 5000 sat is outside LSP bounds");

    await wallet.stop();
  });
});
