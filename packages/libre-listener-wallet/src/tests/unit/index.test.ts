import { describe, it, expect } from "vitest";
import {
  LibreListenerWallet,
  SecureStorageProvider,
  WebSocketStreamProvider,
  WebSocketConnection,
} from "../../index";

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
    });

    expect(wallet.status()).toBe("Stopped");
    await wallet.start();
    expect(wallet.status()).toBe("Running");
    await wallet.stop();
    expect(wallet.status()).toBe("Stopped");
  });
});
