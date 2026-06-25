import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LibreNWCPushGateway } from "../../index";

describe("LibreNWCPushGateway Daemon & API", () => {
  let gateway: LibreNWCPushGateway;
  const PORT = 3099;

  beforeAll(async () => {
    gateway = new LibreNWCPushGateway({
      host: "127.0.0.1",
      port: PORT,
      dbPath: ":memory:", // use in-memory DB for isolated unit tests
    });
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  it("should start running and expose the VAPID public key", async () => {
    expect(gateway.status()).toBe("Running");

    const res = await fetch(`http://127.0.0.1:${PORT}/api/vapid-public-key`);
    expect(res.status).toBe(200);
    
    const body = await res.json() as { publicKey: string };
    expect(body.publicKey).toBeDefined();
    expect(typeof body.publicKey).toBe("string");
    expect(body.publicKey.length).toBeGreaterThan(20);
  });

  it("should register a subscription successfully and persist in SQLite", async () => {
    const registrationPayload = {
      walletPubkey: "02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      relayUrl: "ws://127.0.0.1:4869",
      subscription: {
        endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA...",
        keys: {
          auth: "authsecret123",
          p256dh: "p256dhkey123"
        }
      }
    };

    const res = await fetch(`http://127.0.0.1:${PORT}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registrationPayload)
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);

    // Verify it is saved in the DB
    const pubkeys = gateway.getRegisteredPubkeys("ws://127.0.0.1:4869");
    expect(pubkeys).toContain(registrationPayload.walletPubkey);
  });

  it("should unregister a subscription successfully", async () => {
    const unregisterPayload = {
      walletPubkey: "02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      relayUrl: "ws://127.0.0.1:4869"
    };

    const res = await fetch(`http://127.0.0.1:${PORT}/api/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(unregisterPayload)
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);

    const pubkeys = gateway.getRegisteredPubkeys("ws://127.0.0.1:4869");
    expect(pubkeys).not.toContain(unregisterPayload.walletPubkey);
  });
});
