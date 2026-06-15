# Guardrails: Libre Listener Wallet Monorepo

This document defines the hard rules, security parameters, and architectural boundaries for the `libre-listener-wallet-monorepo` project. Violating any of these rules is classified as a critical system bug.

---

## 1. Security & Private Key Safety

### 1.1. Absolute Key Isolation
* **The Rule:** Private keys, seed words (BIP-39 mnemonic), and node secret keys must **never** leave the client-side execution sandbox (IndexedDB for browser, Keychain/SecureStore for mobile).
* **Network Prohibition:** Under no circumstances should the SDK transmit private keys, preimages of unclaimed HTLCs, or seed phrases over network sockets, HTTP requests, or logs.
* **Encryption at Rest:** If the client-side node serializes states (such as channel managers or channel monitors) for backup purposes, the backups must be encrypted locally using keys derived from the user's password/seed before being transmitted.

### 1.2. Zero-Custody Push Gateway
* **The Rule:** The `libre-nwc-push-gateway` must remain completely stateless regarding wallet credentials.
* **No Key Possession:** The push gateway must **never** have access to the user's node private keys or NWC (NIP-47) shared secrets.
* **Encrypted Relay Payload:** The gateway must only listen to public encrypted Nostr envelopes. It must remain a "blind" notification router, unable to read transaction amounts, preimages, or payment destinations.

---

## 2. Architectural Boundaries

### 2.1. Standalone Database Isolation
* **The Rule:** The `libre-nwc-push-gateway` must use its own isolated, standalone database (SQLite by default, or Postgres). It must **never** connect to, read, or write to the host application's core product database.
* **Reason:** This guarantees that installing the wallet infrastructure does not introduce security vulnerabilities or schema dependencies to the host player's database.

### 2.2. Portability & Dependency Isolation
* **The Rule:** The `@libre/listener-wallet` package must not import platform-specific modules directly (such as Node `fs`, browser `window`, or React Native `SecureStore`).
* **Dependency Abstraction:** All platform-specific functionality (database persistence, WebSocket streaming, logging) must be defined as abstract TypeScript interfaces and injected by the host app on wallet initialization.

---

## 3. Lightning & Networking Guardrails

### 3.1. Zero-Conf LSP Vetting
* **The Rule:** To protect users against double-spend exploits during JIT channel opens, the client SDK must only request zero-conf channels from LSPs listed in the curated `.well-known` registry.
* **Ad-Hoc Prohibited:** The client must never connect to unvetted or random nodes in the gossip network for zero-conf (0-conf) channels.

### 3.2. WebSocket TCP Bridge Security
* **The Rule:** Because browser clients connect to the LSP node via a WebSocket-to-TCP bridge, the bridge proxy (such as `websockify`) must be configured to only allow connections to the specific whitelisted LSP node IPs and ports to prevent arbitrary packet relaying.

---

## 4. Common Anti-Patterns to Avoid

Violating these patterns introduces coupling, state pollution, and testing complexity.

* **Anti-Pattern: Stateful Singletons:** Never define the LDK node as a global singleton within the library (e.g., `export const node = new LDKNode()`). This prevents concurrent testing and makes clean re-initialization impossible. Always instantiate the node context inside a class instance dynamically.
* **Anti-Pattern: Hardcoded Environment Secrets:** Never write `process.env.ESPLORA_URL` or similar variables directly inside the SDK library. The SDK must be fully configurable at runtime. All parameters (e.g., node network, Esplora endpoints, whitelisted relays) must be passed into the constructor config.
* **Anti-Pattern: Deep Submodule Imports:** Never import modules from deep relative paths (e.g. `import { foo } from "../../internal/core/LDK/manager"`). Always use clean barrel exports via `index.ts` files at the package directory boundaries.
* **Anti-Pattern: Silent Catching / Swallowing Errors:** Never write `catch (e) {}` or log an error without rethrowing or returning it as a typed failure payload. Swallowing LDK state errors hides critical channel failures from the parent podcast player.

