# Technical Specification: Libre Listener Wallet SDK Tech Stack & AI Agent Guidelines

This document outlines the developer stack and environment architecture for building `libre-listener-wallet`—a zero-infrastructure, non-custodial Lightning wallet distributed as an npm package for web and mobile podcast/music players.

---

## 1. Monorepo & Core Library Stack

The project is structured as a **Monorepo** using workspaces (such as `pnpm workspaces` or `npm workspaces`) and managed by **Turborepo** for parallel build and test execution. This ensures shared types remain in sync between the client and server codebases.

### Repository Package Layout:
```text
libre-listener-wallet-monorepo/
├── package.json (Monorepo root config)

├── turbo.json (Turborepo build pipeline configuration)
├── docker-compose.yml (Local regtest, LSP, and push gateway test cluster)
├── packages/
│   ├── libre-listener-wallet/ (Client-side LDK SDK library package)
│   │   ├── package.json
│   │   └── src/
│   ├── libre-nwc-push-gateway/ (Stateless server-side push helper daemon)
│   │   ├── package.json
│   │   └── src/
│   └── shared/ (Shared TypeScript typings for NWC and Web Push)
│       ├── package.json
│       └── src/
```

### Subpackage Core Stack:
To optimize code generation and maintenance for AI agents, we leverage a strongly typed, zero-config, modular tech stack inside each package:

| Layer | Tool / Tech | Purpose & Role |
| :--- | :--- | :--- |
| **Language** | **TypeScript** | Enforces strict compile-time checks across all workspaces. |
| **Lightning Engine** | **LDK JS/WASM Bindings** | The official `@lightningdevkit/lightningdevkit` (wrapped inside `libre-listener-wallet`). |
| **Bundler & Build** | **`tsup`** (esbuild-based) | Zero-configuration bundler used inside the SDK package. Outputs ESM and CJS. |
| **Testing Engine** | **Vitest** | Native TS runner used inside workspaces. |
| **Mocking** | **MSW (Mock Service Worker)** | Intercepts HTTP requests to mock LSP endpoints during unit tests. |

---

## 2. Dynamic Discovery & Chain Sync Architecture

The library must remain agnostic of both the hosting platform (web vs. mobile) and the blockchain network (mainnet vs. testnet/mutinynet).

### A. Dynamic LSP Discovery (DNS/.well-known)
The SDK does not hardcode LSP details. It dynamically retrieves them by querying:
`https://v4vmusic.com/.well-known/lightning-providers.json`

This JSON config lists active, vetted LSPs, their node URIs, API endpoints, and supported protocols (LSPS1, LSPS2). The client dynamically requests fee quotes from these nodes.

### B. Chain Sync via Esplora Client
Because LDK needs to track blockchain blocks and transaction spending:
* The SDK includes an HTTP-based client to sync chain data.
* It communicates with **Esplora API** endpoints (e.g. Blockstream API for mainnet/testnet, or `https://mutinynet.com/api` for Mutinynet).
* The client implements LDK's `Confirm` and `Filter` interfaces, mapping block monitoring to simple HTTP GET/POST queries.

---

## 3. Storage & Network Abstraction (Clean Architecture)

To ensure compile-time portability across Web (IndexedDB) and Mobile (React Native / Expo SecureStore), AI agents must write code conforming to abstract interfaces.

### Storage Interface Example
```typescript
export interface SecureStorageProvider {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

### Network Proxy Interface Example
Because browsers cannot open raw TCP sockets, LDK peers must connect over WebSockets.
```typescript
export interface WebSocketStreamProvider {
  connect(address: string, port: number): Promise<WebSocketConnection>;
}
```

The parent application (e.g., the web player or React Native app) injects these implementations into the SDK constructor upon initialization.

---

## 3.5. Value-for-Value (V4V) Requirements (Keysend & TLV)

For the SDK to serve the `v4vmusic.com` / Podcasting 2.0 ecosystem natively, it must support spontaneous payments and precise metadata injection as defined in the `v4vmusic` codebase.

### A. Keysend payments
Unlike standard invoice-based payments, V4V players stream micropayments continuously without requesting invoices beforehand.
* The SDK must support **Keysend payments (spontaneous payments)** directly to a destination node's public key.
* Under the hood, LDK's `pay_keysend` parameters must be exposed via the SDK's top-level API (e.g., `sdk.sendKeysendPayment({ destinationPubkey, amountSats, customRecords })`).

### B. Custom TLV Record Mapping Matrix
When constructing a Keysend payment, the SDK must support injecting the following custom TLV records:

1. **Key `7629169` (bLIP-10 Boost Data):** UTF-8 encoded JSON string of the `BoostRecord`. It must **not** be hex-encoded.
2. **Key `7629175` (Podcast Index ID):** Contains the podcast's `feedGuid` or legacy `feedID` as a plain text string.
3. **Custom Routing Keys (Numeric):** A dynamic numeric key (e.g., `1337`) mapped to a custom routing value string (required by certain LSPs/nodes to forward payments to sub-accounts).

### C. The `BoostRecord` JSON Structure (bLIP-10 Schema)
Any JSON payload injected into TLV record **`7629169`** must match the following structure:

#### 1. Required Fields
* **`action`**: `'boost' | 'stream' | 'auto'` (identifies type of payment; defaults to `'boost'`).
* **`value_msat_total`**: `number` (total transaction value in millisats across all split recipients).
* **`app_name`**: `string` (e.g. `'v4vmusic-player'`).
* **`url`**: `string` (RSS feed URL of the music/podcast source; required if `podcast` is missing).
* **`ts`**: `number` (playback position in seconds; required if `time` is missing).
* **`time`**: `string` (playback position formatted as `HH:MM:SS`; required if `ts` is missing).

#### 2. Recommended Fields
* **`app_version`**: `string` (current version of the player client).
* **`speed`**: `string` (playback speed multiplier as a string, e.g., `'1.0'`, `'1.25'`).
* **`sender_id`**: `string` (a persistent, anonymous identifier for the user).
* **`signature`**: `string` (cryptographic Nostr event signature for verification).
* **`sender_name`**: `string` (display name/nickname of the sending user).
* **`name`**: `string` (recipient's name from the RSS value block).
* **`message`**: `string` (the text comment associated with a "boostagram").

#### 3. Content Identification
* **`podcast`**: `string` (album, show, or main podcast title).
* **`episode`**: `string` (track or episode title).
* **`guid`**: `string` (Podcast feed GUID; preferred identifier).
* **`episode_guid`**: `string` (Track/Item GUID; preferred identifier).

#### 4. Legacy Compatibility (Deprecated)
* **`feedGuid`**: `string` (deprecated legacy copy; use `guid` instead).
* **`itemGuid`**: `string` (deprecated legacy copy; use `episode_guid` instead).
* **`feedID`**: `string` (deprecated legacy database ID; use `guid` instead).

#### 5. Optional & Reply Fields
* **`boost_link`**: `string` (shareable web link to the song/podcast snippet).
* **`reply_address`**: `string` (lightning address or node pubkey for return messages).
* **`reply_custom_key`**: `string` (custom key for reply payment routing).
* **`reply_custom_value`**: `string` (custom value for reply payment routing).

#### 6. Remote Feed Support (Cross-App Split Data)
* **`remote_feed_guid`**: `string` (GUID of the remote feed, used for cross-app compatibility).
* **`remote_item_guid`**: `string` (GUID of the remote item, used for cross-app compatibility).

#### 7. UUID Fields
* **`boost_uuid`**: `string` (shared UUID across all split recipients. Every recipient in a multi-destination payment receives the **exact same** `boost_uuid` to group splits together).
* **`uuid`**: `string` (unique UUID generated per-recipient transaction).

### D. Nostr Wallet Connect (NWC / NIP-47) Portability
To ensure wallet portability and allow users to spend their funds in other podcast/music apps (e.g. Podverse, Podcast Guru), the SDK must support acting as an **NWC Wallet Provider**.

* **NWC Connection Generation:** The SDK must be able to generate an NWC connection string:
  `nostr+walletconnect://<wallet_pubkey>?relay=<relay_url>&secret=<shared_secret>`
* **Nostr Relay Listener:** The SDK must include a Nostr protocol client (using a library like `nostr-tools`) that connects to the specified `<relay_url>`, listens for encrypted NIP-47 request events (e.g. `pay_invoice`, `send_keysend`, `get_balance`), decrypts them using the `<shared_secret>`, calls the corresponding LDK methods, and returns the encrypted response.
* **Environment Constraints:**
  * **Mobile Target:** Runs natively in background threads or wakes up via push notifications to process NWC requests.
  * **Web Target:** NWC is active only while the browser tab is open and running. The SDK should support standard event listeners to notify host apps when NWC requests are processed.

---


## 4. Testing Environments (AI-Driven Integration)

AI agents require a deterministic environment to run integration tests. Two test network targets are supported:

### Target A: Local Regtest Environment (Dockerized Integration)
For automated local testing, the AI agent can run a docker-compose cluster containing:
1. **`bitcoind` (Regtest mode)**: Generated blocks instantly via RPC for transaction settlement.
2. **Esplora Indexer**: Provides the HTTP blockchain API.
3. **Mock LSP (CLN or LND)**: Programmed to respond to LSPS2 interposition requests.
4. **websockify (TCP-to-WS Bridge)**: Allows the LDK WASM client to connect to the dockerized LSP.

*Integration Test Flow:* The test script initializes LDK, requests an LSPS2 invoice, instructs the mock LSP to pay it, triggers `bitcoin-cli generatetoaddress` to mine a block, and asserts that the LDK channel moves to active state.

### Target B: Mutinynet (Rapid Developer Testing)
For lighter manual or integration tests without running local Docker containers:
* **Network:** Set the SDK config network to `mutinynet`.
* **Genesis Hash:** Configure LDK with the Mutinynet custom genesis hash.
* **Sync:** Connect the Esplora client to `https://mutinynet.com/api`.
* **Funding:** Call the Mutinynet Faucet API programmatically in the test setup suite (`https://faucet.mutinynet.com/api/onchain`) to acquire test sats.

---

## 5. Guidelines for AI Agents Writing Code

When implementing features or debugging this SDK:
1. **TDD First:** Write or update the unit tests in `/src/tests` using Vitest before changing the corresponding logic.
2. **Minimize Config Alterations:** Do not modify `tsup.config.ts` or `vitest.config.ts` unless adding a global dependency.
3. **Strict Typings:** Avoid using `any` or `unknown` casts. All LDK interfaces should be mapped cleanly.
4. **Environment Isolation:** Do not import `window`, `document`, or Node-native modules (`fs`, `path`) into core LDK files. Use the storage/network interfaces instead.
