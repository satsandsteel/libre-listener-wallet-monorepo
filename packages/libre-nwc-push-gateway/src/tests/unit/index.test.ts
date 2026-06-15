import { describe, it, expect } from "vitest";
import { LibreNWCPushGateway } from "../../index";

describe("LibreNWCPushGateway Daemon", () => {
  it("should initialize and transition status state on start and stop", async () => {
    const gateway = new LibreNWCPushGateway({
      host: "127.0.0.1",
      port: 3000,
      relayUrl: "ws://127.0.0.1:4869",
    });

    expect(gateway.status()).toBe("Stopped");
    await gateway.start();
    expect(gateway.status()).toBe("Running");
    await gateway.stop();
    expect(gateway.status()).toBe("Stopped");
  });

  it("should process requests correctly", async () => {
    const gateway = new LibreNWCPushGateway({
      host: "127.0.0.1",
      port: 3000,
      relayUrl: "ws://127.0.0.1:4869",
    });

    const response = await gateway.processRequest({
      method: "get_info",
      params: {},
    });

    expect(response.result_type).toBe("get_info");
    expect(response.result?.success).toBe(true);
  });
});
