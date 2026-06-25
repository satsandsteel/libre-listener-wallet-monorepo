# Libre Listener Wallet SDK Developer Integration Guide

This guide is designed for application developers who want to embed the `@libre/listener-wallet` SDK into their existing podcast player, audio platform, or wallet client (Web/PWA or mobile wrappers).

---

## 1. Installation

Install the required core packages from the monorepo workspace.

```bash
npm install @libre/listener-wallet @libre/shared
```

> [!NOTE]
> The SDK depends internally on `@lightningdevkit/lightningdevkit` (LDK JS/WASM bindings). Ensure that your bundler configuration (Vite, Webpack, etc.) supports handling WebAssembly modules and serving `.wasm` assets.

---

## 2. Platform Adapter Implementation (Dependency Injection)

To ensure compile-time portability across both Web (IndexedDB) and Mobile (Keychain/SecureStore) environments, the SDK requires you to inject implementations of abstract storage, network, and logging interfaces.

### A. Web / PWA Implementation Example
For web and PWA clients, the SDK provides a pre-built `IndexedDBStorageProvider` that you can import directly. You will only need to implement the `WebSocketStreamProvider` to relay browser socket packets through a WebSocket-to-TCP bridge.

```typescript
import {
  LibreListenerWallet,
  IndexedDBStorageProvider,
  type WebSocketStreamProvider,
  type WebSocketConnection,
  type Logger
} from "@libre/listener-wallet";

// 1. Setup a custom logger connected to your app's telemetry or console
const appLogger: Logger = {
  info: (msg, ...args) => console.log(`[AppInfo] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[AppWarn] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[AppErr] ${msg}`, ...args)
};

// 2. Setup a WebSocket stream provider to bridge raw TCP Lightning packets
const webSocketStreamProvider: WebSocketStreamProvider = {
  async connect(address: string, port: number): Promise<WebSocketConnection> {
    // If the LSP does not support WebSockets natively, point to your deployed websockify proxy
    const wsUrl = `wss://ws-bridge.yourdomain.com`;
    const ws = new WebSocket(wsUrl);

    return {
      send: (data: Uint8Array) => ws.send(data),
      close: () => ws.close(),
      set onmessage(cb: (data: Uint8Array) => void) {
        ws.onmessage = async (e) => {
          cb(new Uint8Array(await e.data.arrayBuffer()));
        };
      },
      set onerror(cb: (err: Error) => void) {
        ws.onerror = () => cb(new Error("WebSocket transport error"));
      },
      set onclose(cb: () => void) {
        ws.onclose = () => cb();
      }
    };
  }
};
```

### B. Native Mobile Implementation Guidance
If you are running the SDK inside a mobile wrapper (React Native, Flutter, Expo), write adapters that map the SDK's storage and socket contracts to the native OS keychain and TCP socket layers:

```typescript
// Example: React Native SecureStore Storage Adapter
import * as SecureStore from "expo-secure-store";
import { type SecureStorageProvider } from "@libre/listener-wallet";

const mobileSecureStorage: SecureStorageProvider = {
  async getItem(key: string): Promise<string | null> {
    return await SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }
};
```

---

## 3. Wallet Lifecycle Management

### Initializing and Starting the Node
During initialization, the wallet automatically derives its seed phrase using secure random bytes and saves it encrypted-at-rest locally.

```typescript
const wallet = new LibreListenerWallet({
  config: {
    network: "mainnet",                   // 'mainnet' | 'testnet' | 'regtest'
    esploraUrl: "https://mempool.space/api", // Sync chain headers from Esplora
  },
  storage: new IndexedDBStorageProvider("libre-listener-db"),
  socketProvider: webSocketStreamProvider,
  logger: appLogger,
  wasmUrl: "/assets/ldk-wasm-file.wasm"    // URL path where LDK WASM is hosted on your server
});

// Boot and sync LDK with the blockchain
await wallet.start();
console.log("Node Status:", wallet.status()); // Returns 'Running'
```

### Listening to LDK Network Events
You can register event listeners to track payment status changes, new channel states, and connection drops:

```typescript
wallet.addEventListener((event) => {
  const name = event.constructor.name;
  console.log(`LDK Event: ${name}`);

  if (name === "Event_PaymentClaimed") {
    // Payment received successfully
    const amountSats = Number(event.amount_msat / 1000n);
    console.log(`Received payment of ${amountSats} Sats`);
  }
});
```

### Stopping the Node
Always perform a clean shutdown when the user closes your app or signs out to persist the latest channel managers and channel monitors:

```typescript
// Shuts down background sync intervals, disconnects peers, and persists channel states
await wallet.stop();
```

---

## 4. Liquidity & Channel Onboarding (LSPS2 / LSPS1)

New users have `0 active channels` and cannot receive payments. You must leverage the multi-tier liquidity engine to request channel capacity from a Lightning Service Provider (LSP).

### A. Fetch Vetted LSPs
Query your curated DNS registry configuration:

```typescript
const providers = await wallet.fetchLspRegistry("https://yourdomain.com/.well-known/lightning-providers.json");
const targetLsp = providers[0]; // Select your preferred or cheapest provider
```

### B. Request LSPS2 JIT Channel (Bootstrap Onboarding)
Request an incoming payment invoice that bundles JIT routing hints. When paid by an external sender, the LSP opens a zero-conf channel to the user's browser node:

```typescript
const invoice = await wallet.requestLSPS2Invoice({
  amountSats: 20000,
  description: "Podcast Wallet Onboarding",
  lsp: targetLsp
});

// Render the invoice to the user
console.log("Pay this invoice to open your wallet channel:", invoice);
```

### C. Purchase Pre-Planned Inbound Capacity (LSPS1 Leases)
If the user expects a larger volume of payments and has outbound funds, they can buy dedicated inbound channel capacity ahead of time:

```typescript
const orderResponse = await wallet.purchaseLSPS1Capacity({
  amountSats: 100000, // Request 100,000 sats inbound channel
  lsp: targetLsp
});

if (orderResponse.invoice) {
  console.log("Pay this setup invoice to activate your leased inbound channel:", orderResponse.invoice);
}
```

---

## 5. Value-for-Value (V4V) Micropayments & Split Routing

The SDK supports Keysend (spontaneous) payments, allowing audio players to stream micropayments continuously without requesting invoices.

### A. Basic Keysend Payment
```typescript
const result = await wallet.sendKeysendPayment({
  destinationPubkey: "03864ef02b102b9e...", // Destination node pubkey
  amountSats: 10
});

if (result.ok) {
  console.log("Payment sent successfully! Hash:", result.paymentHash);
} else {
  console.error("Payment failed:", result.error);
}
```

### B. Injecting Podcast Boostagram Metadata (TLV Record `7629169`)
Under the hood, keysends can transmit custom TLVs. For Value-for-Value streaming, you must pack the bLIP-10 JSON payload inside key `7629169` (Boost Record) and the Podcast Index Feed GUID inside key `7629175`.

```typescript
const boostMetadata = {
  action: "boost",
  app_name: "MyAudioApp",
  podcast: "Sovereign Audio Show",
  episode: "Episode 42 - Sovereign Coding",
  message: "Love this episode!",
  value_msat_total: 50000,
  boost_uuid: "7b0499e1-22fb-4395-8121-65f577317d7b"
};

const result = await wallet.sendKeysendPayment({
  destinationPubkey: "03864ef02b102b9e...",
  amountSats: 50,
  customRecords: {
    7629169: JSON.stringify(boostMetadata),               // bLIP-10 Boost data (non-hex)
    7629175: "fe4e09a3-5cde-47fb-bde6-7359929eb9c8"      // Podcast Index Feed GUID
  }
});
```

### C. Sending Multi-Recipient Split Payments
To automatically split a single payment across multiple content contributors (e.g., creator splits, hosting fees, app publisher cuts), compute the sats splits and call `sendSplitPayments`:

```typescript
import { type SplitResult } from "@libre/shared";

const creatorSplits: SplitResult[] = [
  {
    destinationPubkey: "03aaa...", // Creator Node
    amountSats: 45,
    tlvRecords: [
      {
        key: 7629169,
        value: new TextEncoder().encode(JSON.stringify({
          action: "stream",
          app_name: "MyAudioApp",
          boost_uuid: "7b0499e1-22fb-4395-8121-65f577317d7b"
        }))
      }
    ]
  },
  {
    destinationPubkey: "03bbb...", // Host Platform Node
    amountSats: 5,
    tlvRecords: [
      {
        key: 7629169,
        value: new TextEncoder().encode(JSON.stringify({
          action: "stream",
          app_name: "MyAudioApp",
          boost_uuid: "7b0499e1-22fb-4395-8121-65f577317d7b"
        }))
      }
    ]
  }
];

const splitRes = await wallet.sendSplitPayments(creatorSplits);
if (splitRes.ok) {
  console.log("All splits processed successfully");
}
```

---

## 6. Nostr Wallet Connect (NWC / NIP-47) Pairing

Allow external, third-party apps to securely request payments or read balances by configuring NWC pairings.

### A. Create an NWC Pairing Connection
Generate a standard pairing URI that the user can import into another app (e.g., scanning a QR code):

```typescript
// Create pairing for 'Podverse Player' with a spending limit of 500 Sats per day
const pairingUri = await wallet.nwc.createConnection("Podverse Player", {
  spendingLimitSats: 500,
  relayUrl: "wss://relay.damus.io"
});

console.log("Share this connection URI with the remote app:", pairingUri);
// URI format: nostr+walletconnect://<wallet_pubkey>?relay=wss%3A%2F%2Frelay.damus.io&secret=<secret_key>
```

### B. List and Manage Connection Pairings
Retrieve all registered pairing connections, enabling users to toggle permissions or revoke connections:

```typescript
const pairings = await wallet.nwc.listConnections();
pairings.forEach((conn) => {
  console.log(`App Name: ${conn.name}`);
  console.log(`Daily Limit: ${conn.spendingLimitSats} Sats`);
  console.log(`Status: ${conn.enabled ? "Active" : "Disabled"}`);
});

// Revoke a connection (deletes credentials and stops listening on Nostr relays)
await wallet.nwc.deleteConnection(pairings[0].clientPubkey);
```
