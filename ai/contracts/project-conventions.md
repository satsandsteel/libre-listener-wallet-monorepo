# Project Conventions: Libre Listener Wallet Monorepo

This document outlines the design patterns, coding conventions, and architectural templates to be followed during the development of the `libre-listener-wallet-monorepo` project.

---

## 1. Monorepo & Package Structure

We enforce a strict package boundaries model using workspaces. Cross-package imports must go through package names, not relative paths.

### Package Layout
* `packages/libre-listener-wallet`: Exposes the client SDK, compiled to ESM and CommonJS via `tsup`.
* `packages/libre-nwc-push-gateway`: Builds the server-side Docker image.
* `packages/shared`: Shared TypeScript types and serialization/deserialization helpers for NWC and Web Push protocols.

### Development Task Pipeline
We use **Turborepo** (`turbo.json`) to manage task pipelines. Tasks must be configured to run cacheable outputs.
* `pnpm build`: Builds `shared`, then compiles the SDK and builds the gateway.
* `pnpm test`: Runs Vitest across all package test folders.
* `pnpm lint`: Enforces ESLint rules.

---

## 2. API & Design Patterns

### 2.1. Abstract Storage Adapter Pattern
All packages within the SDK must use the dependency injection model. For example, storage operations must go through this adapter:

```typescript
export interface SecureStorageProvider {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```
* **Web Implementer:** The host app injects an IndexedDB implementation.
* **Mobile Implementer:** The host app injects a Keychain wrapper.

### 2.2. Abstract WebSocket Adapter Pattern
To bridge browser WASM to raw TCP node protocols, the networking layer must be injected:

```typescript
export interface WebSocketStreamProvider {
  connect(address: string, port: number): Promise<WebSocketConnection>;
}
```

---

## 3. Value-for-Value (V4V) Protocol Conventions

All Keysend payments transmitting V4V data must conform to the following TLV (Type-Length-Value) specifications:

### 3.1. TLV Key Map
* **Key `7629169`:** UTF-8 encoded JSON string of the `BoostRecord` (compliant with bLIP-10). It must **not** be hex-encoded.
* **Key `7629175`:** The Podcast Index `feedGuid` as a plain string.
* **Dynamic Keys:** Split routing key overrides (e.g. `1337` to route to a specific node's ledger sub-account).

### 3.2. Boostagram Payload Schema (bLIP-10)
Ensure the JSON string contains the following keys:
* `action`: `'boost' | 'stream' | 'auto'`
* `value_msat_total`: msat value of the transaction.
* `app_name`: string identifier.
* `podcast`: show/album title.
* `episode`: track/episode title.
* `guid`: feed GUID.
* `episode_guid`: item GUID.
* `ts`: integer playback timestamp (in seconds).
* `message`: boostagram comment string (optional).

#### 7. UUID Fields
* **`boost_uuid`**: `string` (shared UUID across all split recipients. Every recipient in a multi-destination payment receives the **exact same** `boost_uuid` to group splits together).
* **`uuid`**: `string` (unique UUID generated per-recipient transaction).

### E. Preferred Design Patterns

1. **Dependency Injection (Inversion of Control):** Platform-specific components (e.g. storage indexing, WebSocket transport sockets, and logger relays) must be defined as abstract interfaces in the core package and injected via the SDK constructor by the host app.
2. **Strategy Pattern (Liquidity Selection):** Sourcing liquidity relies on a strategy router that chooses dynamically between **Tier 1 (LSPS2)**, **Tier 2 (LSPS1)**, or **Tier 3 (BOLT 2 Gossip Ads)** based on the client's current channel count, balance, and mempool fees.
3. **Adapter / Wrapper Pattern:** The SDK acts as an adapter around LDK. LDK exposes raw, highly complex lower-level Rust bindings. The SDK wraps these into a simplified, developer-friendly interface (e.g. `start()`, `sendPayment()`, `getBalance()`) to prevent logic leaks to the host player.

### F. DRY & Code Reusability Guidelines

* **Shared Types Workspace:** Avoid copy-pasting code or type signatures between `packages/libre-listener-wallet` and `packages/libre-nwc-push-gateway`. All shared protocol specifications, request/response models, and custom TLV schemas must live in `packages/shared`.
* **Utility Extraction:** Mathematical conversions (e.g., sat-to-msat, milliseconds-to-blocks), timestamp formatting, and Nostr signature validation must be extracted into standalone utility classes (e.g., `TimestampUtils`, `TLVEncoder`, `PaymentSignatureService`) rather than inline implementation code.
* **Component Reusability:** Code relating to LSP API communication (like fetching JIT quotes or querying LSPS1 directories) must be written as generic clients that take any target URL, allowing them to query different providers without duplicating code.

---

## 4. Code & Naming Conventions

* **Files:** Use kebab-case for all files (e.g., `tlv-encoder.ts`, `storage-adapter.ts`).
* **Interfaces & Types:** Always export TS types using PascalCase. Prefer interfaces for injectable providers.
* **Variables & Functions:** Use camelCase.
* **Error Handling:** Avoid silent catches. Errors in the LDK wrapper must be caught, logged via the injected `Logger` adapter, and rethrown or returned as a typed error response `{ ok: false, error: string }`.

